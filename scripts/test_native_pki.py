"""Ephemeral WMTS/SI software-certificate mTLS smoke test on macOS/Windows.

Opt-in test: installs its own throwaway test CA/identity, removes both in finally.
No card is needed. This verifies automatic TLS selection, not hardware PIN UI.
"""
import argparse
import datetime
import hashlib
import http.server
import ipaddress
import json
import os
from pathlib import Path
import platform
import ssl
import subprocess
import tempfile
import threading

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID


def run(*args):
    print(f"Test setup: {args[0]} {args[1]}", flush=True)
    result = subprocess.run(args, capture_output=True, text=True, timeout=90)
    if result.returncode:
        raise RuntimeError(f"Test setup command {args[0]} failed: {result.stderr.strip()}")
    return result.stdout.strip()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cli", required=True)
    args = parser.parse_args()
    system = platform.system()
    assert system in ("Darwin", "Windows"), "Native automatic auth test is macOS/Windows only"
    cli = str(Path(args.cli).resolve())
    if system == "Windows" and not cli.lower().endswith(".exe"):
        cli += ".exe"
    now = datetime.datetime.now(datetime.timezone.utc)
    name = lambda s: x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, s)])
    ca_key = rsa.generate_private_key(65537, 2048)
    ca = (x509.CertificateBuilder().subject_name(name("Chronoscope throwaway CI CA"))
          .issuer_name(name("Chronoscope throwaway CI CA")).public_key(ca_key.public_key())
          .serial_number(x509.random_serial_number()).not_valid_before(now - datetime.timedelta(days=1))
          .not_valid_after(now + datetime.timedelta(days=2))
          .add_extension(x509.BasicConstraints(ca=True, path_length=0), True)
          .add_extension(x509.KeyUsage(False, False, False, False, False, True, True, False, False), True)
          .add_extension(x509.SubjectKeyIdentifier.from_public_key(ca_key.public_key()), False)
          .sign(ca_key, hashes.SHA256()))

    def leaf(label, eku, server=False):
        key = rsa.generate_private_key(65537, 2048)
        cert = (x509.CertificateBuilder().subject_name(name(label)).issuer_name(ca.subject)
                .public_key(key.public_key()).serial_number(x509.random_serial_number())
                .not_valid_before(now - datetime.timedelta(hours=1)).not_valid_after(now + datetime.timedelta(days=1))
                .add_extension(x509.BasicConstraints(ca=False, path_length=None), True)
                .add_extension(x509.KeyUsage(True, False, server, False, False, False, False, False, False), True)
                .add_extension(x509.ExtendedKeyUsage([eku]), False)
                .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()), False))
        if server:
            cert = cert.add_extension(x509.SubjectAlternativeName([x509.DNSName("localhost"), x509.IPAddress(ipaddress.ip_address("127.0.0.1"))]), False)
        return key, cert.sign(ca_key, hashes.SHA256())

    client_key, client_cert = leaf("Chronoscope CI authentication", ExtendedKeyUsageOID.CLIENT_AUTH)
    server_key, server_cert = leaf("localhost", ExtendedKeyUsageOID.SERVER_AUTH, True)
    ca_hash = ca.fingerprint(hashes.SHA1()).hex().upper()
    client_hash = client_cert.fingerprint(hashes.SHA1()).hex().upper()
    with tempfile.TemporaryDirectory(prefix="chronoscope-pki-") as tmp:
        tmp = Path(tmp)
        ca_file = tmp / "ca.pem"
        ca_file.write_bytes(ca.public_bytes(serialization.Encoding.PEM))
        (tmp / "ca.cer").write_bytes(ca.public_bytes(serialization.Encoding.DER))
        (tmp / "server.pem").write_bytes(server_cert.public_bytes(serialization.Encoding.PEM))
        (tmp / "server.key").write_bytes(server_key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
        # Legacy PBE is solely for this throwaway test identity: Apple PKCS#12
        # import does not accept the default modern OpenSSL/cryptography encoding.
        (tmp / "client.p12").write_bytes(pkcs12.serialize_key_and_certificates(b"Chronoscope CI authentication", client_key, client_cert, [ca], (serialization.PrivateFormat.PKCS12.encryption_builder().kdf_rounds(50000).key_cert_algorithm(pkcs12.PBES.PBESv1SHA1And3KeyTripleDESCBC).hmac_hash(hashes.SHA1()).build(b"test-only-password"))))
        original = []
        keychain = tmp / "test.keychain-db"
        server = None
        try:
            if system == "Darwin":
                import shlex
                original = shlex.split(run("security", "list-keychains", "-d", "user"))
                run("security", "create-keychain", "-p", "test-only-password", str(keychain))
                run("security", "unlock-keychain", "-p", "test-only-password", str(keychain))
                run("security", "list-keychains", "-d", "user", "-s", str(keychain), *original)
                run("security", "import", str(tmp / "client.p12"), "-k", str(keychain), "-P", "test-only-password", "-A")
                run("security", "set-key-partition-list", "-S", "apple-tool:,apple:,unsigned:", "-s", "-k", "test-only-password", str(keychain))
                run("sudo", "-n", "security", "add-trusted-cert", "-d", "-r", "trustRoot", "-k", "/Library/Keychains/System.keychain", str(ca_file))
            else:
                run("certutil", "-f", "-user", "-addstore", "Root", str(tmp / "ca.cer"))
                run("certutil", "-f", "-user", "-p", "test-only-password", "-importpfx", "My", str(tmp / "client.p12"), "NoRoot")
            requests = []
            class Handler(http.server.BaseHTTPRequestHandler):
                def do_GET(self):
                    peer = self.connection.getpeercert(binary_form=True)
                    assert peer and hashlib.sha1(peer).hexdigest().upper() == client_hash
                    requests.append(self.path)
                    body = b'<Capabilities><ServiceIdentification><Title>Native automatic mTLS test</Title></ServiceIdentification><Contents/></Capabilities>'
                    self.send_response(200)
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                def do_POST(self):
                    peer = self.connection.getpeercert(binary_form=True)
                    assert peer and hashlib.sha1(peer).hexdigest().upper() == client_hash
                    assert self.path == "/v1/chat/completions"
                    request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                    assert request["model"] == "fixture"
                    assert self.headers.get("Authorization") == "Bearer fixture-session-key"
                    requests.append(self.path)
                    body = json.dumps({"choices":[{"message":{"role":"assistant","content":"Native SI certificate verified"}}]}).encode()
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                def log_message(self, *_):
                    pass
            ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            ctx.load_cert_chain(str(tmp / "server.pem"), str(tmp / "server.key"))
            ctx.load_verify_locations(str(ca_file))
            ctx.verify_mode = ssl.CERT_REQUIRED
            class TLSServer(http.server.ThreadingHTTPServer):
                def get_request(self):
                    raw, address = super().get_request()
                    raw.settimeout(5)
                    try:
                        return ctx.wrap_socket(raw, server_side=True), address
                    except Exception:
                        raw.close()
                        raise
            server = TLSServer(("127.0.0.1", 0), Handler)
            threading.Thread(target=server.serve_forever, daemon=True).start()
            print("OS certificate stores prepared; starting automatic mTLS check", flush=True)
            if system == "Darwin":
                print(run("security", "find-identity", "-v", "-p", "ssl-client", str(keychain)), flush=True)
            url = f"https://localhost:{server.server_port}/capabilities.xml"
            env = dict(os.environ, CHRONOSCOPE_WMTS_NO_UI="1", CHRONOSCOPE_SI_NO_UI="1", NO_PROXY="localhost,127.0.0.1", no_proxy="localhost,127.0.0.1")
            def invoke(command, arguments):
                print(f"Invoking native transport: {command}", flush=True)
                result = subprocess.run([cli, "--data-dir", str(tmp / "data"), "call", command, "--args", json.dumps(arguments)], capture_output=True, text=True, env=env, timeout=110)
                assert result.returncode == 0, result.stderr
                return json.loads(result.stdout)
            # No local profile or certificate name is supplied: one eligible identity
            # must be found from the server's TLS request and used automatically.
            result = invoke("wmts_capabilities", {"url": url})
            assert result["title"] == "Native automatic mTLS test", result
            assert len(requests) == 1
            status = invoke("wmts_auth_status", {})
            assert status["automatic"] and status["profiles"] == []
            # Same certificate request/OS-store selection for a real SI POST.
            commands = [
                {"id":1,"command":"si_configure","args":{"url":f"https://localhost:{server.server_port}/v1","model":"fixture","api_key":"fixture-session-key"}},
                {"id":2,"command":"si_run","args":{"prompt":"Verify this local certificate-authenticated SI service"}},
                {"id":3,"command":"si_disconnect","args":{}},
            ]
            si = subprocess.run([cli,"--data-dir",str(tmp/"si-data"),"session"],input="\n".join(json.dumps(c) for c in commands)+"\n",capture_output=True,text=True,env=env,timeout=110)
            assert si.returncode == 0, si.stderr
            responses = [json.loads(line) for line in si.stdout.splitlines()]
            assert responses[1]["result"]["answer"] == "Native SI certificate verified", responses
            assert len(requests) == 2, requests
            print("PASS: WMTS GET and SI POST automatic native mTLS with an OS-store client identity, no per-server configuration; no hardware/PIN claim")
        finally:
            if server:
                server.shutdown()
                server.server_close()
            if system == "Darwin":
                if original:
                    subprocess.run(["security", "list-keychains", "-d", "user", "-s", *original], capture_output=True, timeout=90)
                subprocess.run(["security", "delete-keychain", str(keychain)], capture_output=True, timeout=90)
                subprocess.run(["sudo", "-n", "security", "remove-trusted-cert", "-d", str(ca_file)], capture_output=True, timeout=90)
                subprocess.run(["sudo", "-n", "security", "delete-certificate", "-Z", ca_hash, "/Library/Keychains/System.keychain"], capture_output=True, timeout=90)
            else:
                subprocess.run(["certutil", "-f", "-user", "-delstore", "My", client_hash], capture_output=True, timeout=90)
                subprocess.run(["certutil", "-f", "-user", "-delstore", "Root", ca_hash], capture_output=True, timeout=90)

if __name__ == "__main__":
    main()
