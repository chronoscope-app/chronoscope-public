//! Machine-local, origin-scoped client identities. Keys/PINs never enter this store.
//! macOS uses URLSession; OS curl delegates signing to Schannel or PKCS#11.
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    io::{Read, Write},
    path::PathBuf,
    process::{Command, Stdio},
    sync::mpsc,
    time::{Duration, Instant},
};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum IdentityKind {
    Disabled,
    MacosKeychain,
    WindowsStore,
    Pkcs11,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Profile {
    pub origin: String,
    pub kind: IdentityKind,
    pub identity: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Entry {
    pub profile: Profile,
    pub cache_scope: String,
}
#[derive(Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Store {
    profiles: BTreeMap<String, Entry>,
}
pub struct AuthStore {
    path: PathBuf,
}
pub struct Response {
    pub status: u16,
    pub bytes: Vec<u8>,
    /// Unknown OS curl identity use is treated conservatively as authenticated.
    pub authenticated: bool,
}

pub fn origin(url: &str) -> Result<String, String> {
    let url = reqwest::Url::parse(url).map_err(|_| "Invalid authentication origin")?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err(
            "Client authentication requires HTTPS without embedded credentials or fragments".into(),
        );
    }
    Ok(url.origin().ascii_serialization())
}
impl Profile {
    pub fn validate(&mut self) -> Result<(), String> {
        self.origin = origin(&self.origin)?;
        self.identity = self.identity.trim().to_owned();
        if self.kind == IdentityKind::Disabled {
            self.identity.clear();
            return Ok(());
        }
        if self.identity.is_empty()
            || self.identity.len() > 2048
            || self.identity.chars().any(char::is_control)
        {
            return Err("A client certificate identity is required (maximum 2048 bytes)".into());
        }
        match self.kind {
            IdentityKind::Disabled => unreachable!(),
            IdentityKind::MacosKeychain => {
                // curl accepts certificate files and :password as well as labels.
                // Only labels are allowed here: never load/export a private key file.
                if self.identity.contains(['/', '\\', ':', '"'])
                    || self.identity.starts_with('.')
                    || self.identity.len() > 256
                {
                    return Err("Use the Keychain client identity's unique name, without a file path, password or colon".into());
                }
            }
            IdentityKind::WindowsStore => {
                let thumbprint = self.identity.strip_prefix("CurrentUser\\MY\\").ok_or(
                    "Use CurrentUser\\MY\\ followed by the certificate's 40-digit SHA-1 thumbprint",
                )?;
                if thumbprint.len() != 40 || !thumbprint.bytes().all(|b| b.is_ascii_hexdigit()) {
                    return Err(
                        "Windows certificate thumbprint must contain exactly 40 hexadecimal digits"
                            .into(),
                    );
                }
                self.identity = format!("CurrentUser\\MY\\{}", thumbprint.to_ascii_uppercase());
            }
            IdentityKind::Pkcs11 => validate_pkcs11(&self.identity)?,
        }
        Ok(())
    }
}
fn validate_pkcs11(uri: &str) -> Result<(), String> {
    let attributes = uri
        .strip_prefix("pkcs11:")
        .ok_or("Use a PKCS#11 certificate URI")?;
    // Whitelist RFC 7512 token/object attributes. Query parameters may specify a
    // PIN, PIN source or an arbitrary shared library: none are accepted.
    if attributes.is_empty()
        || uri.contains(['?', '#', '"', '\\'])
        || !uri.bytes().all(|b| (33..=126).contains(&b))
    {
        return Err(
            "Use a percent-encoded PKCS#11 URI without PINs, queries, module paths or providers"
                .into(),
        );
    }
    let mut seen = std::collections::BTreeSet::new();
    for part in attributes.split(';') {
        let (key, value) = part.split_once('=').ok_or("Invalid PKCS#11 attribute")?;
        if !matches!(
            key,
            "token" | "manufacturer" | "serial" | "model" | "object" | "id" | "type"
        ) || value.is_empty()
            || !seen.insert(key)
            || (key == "type" && value != "cert")
        {
            return Err(
                "PKCS#11 URI must identify a certificate; only token/object attributes are allowed"
                    .into(),
            );
        }
        let mut bytes = value.bytes();
        while let Some(b) = bytes.next() {
            if b == b'%' {
                if !bytes.next().is_some_and(|v| v.is_ascii_hexdigit())
                    || !bytes.next().is_some_and(|v| v.is_ascii_hexdigit())
                {
                    return Err("Invalid PKCS#11 percent encoding".into());
                }
            } else if !b.is_ascii_alphanumeric() && !b"-._~!$&'()*+,=:@".contains(&b) {
                return Err("Percent-encode special characters in PKCS#11 attribute values".into());
            }
        }
    }
    if !seen.contains("type") || !(seen.contains("id") || seen.contains("object")) {
        return Err("PKCS#11 URI needs type=cert and an id or object attribute".into());
    }
    Ok(())
}
impl AuthStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }
    fn locked(&self) -> Result<(std::fs::File, Store), String> {
        let mut options = std::fs::OpenOptions::new();
        options.create(true).read(true).write(true).truncate(false);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let lock = options
            .open(self.path.with_extension("lock"))
            .map_err(|_| "Cannot lock local WMTS authentication settings")?;
        lock.lock()
            .map_err(|_| "Cannot lock local WMTS authentication settings")?;
        let store = match std::fs::File::open(&self.path) {
            Ok(file) => {
                if file
                    .metadata()
                    .map_err(|_| "Cannot read WMTS authentication settings")?
                    .len()
                    > 256 * 1024
                {
                    return Err("WMTS authentication settings exceed size limit".into());
                }
                let mut bytes = Vec::new();
                file.take(256 * 1024 + 1)
                    .read_to_end(&mut bytes)
                    .map_err(|_| "Cannot read WMTS authentication settings")?;
                let mut store: Store = serde_json::from_slice(&bytes).map_err(|_| {
                    "Invalid local WMTS authentication settings; authentication was not bypassed"
                })?;
                if store.profiles.len() > 64 {
                    return Err("Too many WMTS authentication profiles".into());
                }
                for (key, entry) in &mut store.profiles {
                    entry.profile.validate()?;
                    if key != &entry.profile.origin
                        || entry.cache_scope.len() != 32
                        || !entry.cache_scope.bytes().all(|b| b.is_ascii_hexdigit())
                    {
                        return Err("Invalid local WMTS authentication profile".into());
                    }
                }
                store
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Store::default(),
            Err(_) => return Err(
                "Cannot read local WMTS authentication settings; authentication was not bypassed"
                    .into(),
            ),
        };
        Ok((lock, store))
    }
    pub fn get(&self, url: &str) -> Result<Option<Entry>, String> {
        let (_lock, store) = self.locked()?;
        let url = reqwest::Url::parse(url).map_err(|_| "Invalid WMTS URL")?;
        Ok(store
            .profiles
            .get(&url.origin().ascii_serialization())
            .cloned())
    }
    pub fn profiles(&self) -> Result<Vec<Profile>, String> {
        let (_lock, store) = self.locked()?;
        Ok(store.profiles.into_values().map(|e| e.profile).collect())
    }
    pub fn set(&self, mut profile: Profile, verify_backend: bool) -> Result<(), String> {
        profile.validate()?;
        if verify_backend && profile.kind != IdentityKind::Disabled {
            require_backend(&profile.kind)?;
        }
        let (_lock, mut store) = self.locked()?;
        if store.profiles.len() >= 64 && !store.profiles.contains_key(&profile.origin) {
            return Err("At most 64 local WMTS authentication origins are supported".into());
        }
        let mut random = [0u8; 16];
        getrandom::fill(&mut random).map_err(|_| "Cannot create private map cache scope")?;
        let cache_scope = random.iter().map(|b| format!("{b:02x}")).collect();
        store.profiles.insert(
            profile.origin.clone(),
            Entry {
                profile,
                cache_scope,
            },
        );
        self.save(&store)
    }
    pub fn remove(&self, url: &str) -> Result<(), String> {
        let origin = origin(url)?;
        let (_lock, mut store) = self.locked()?;
        store.profiles.remove(&origin);
        self.save(&store)
    }
    fn save(&self, store: &Store) -> Result<(), String> {
        let mut temp = tempfile::NamedTempFile::new_in(
            self.path.parent().ok_or("Invalid settings directory")?,
        )
        .map_err(|_| "Cannot save WMTS authentication settings")?;
        serde_json::to_writer_pretty(&mut temp, store)
            .map_err(|_| "Cannot save WMTS authentication settings")?;
        temp.flush()
            .map_err(|_| "Cannot save WMTS authentication settings")?;
        temp.as_file()
            .sync_all()
            .map_err(|_| "Cannot save WMTS authentication settings")?;
        temp.persist(&self.path)
            .map_err(|_| "Cannot replace WMTS authentication settings")?;
        Ok(())
    }
}
fn executable() -> PathBuf {
    #[cfg(windows)]
    {
        PathBuf::from(std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into()))
            .join("System32")
            .join("curl.exe")
    }
    #[cfg(not(windows))]
    {
        PathBuf::from("/usr/bin/curl")
    }
}
fn command() -> Command {
    let mut c = Command::new(executable());
    c.arg("--disable")
        .stdin(Stdio::null())
        .env_remove("SSLKEYLOGFILE");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x08000000); // CREATE_NO_WINDOW; OS provider may display PIN UI.
    }
    c
}
// Drain both pipes concurrently, cap allocations, and enforce a wall clock limit
// even if middleware blocks inside a PIN challenge. No raw curl stderr is returned.
fn run(
    command: Command,
    max: u64,
    timeout: Duration,
) -> Result<(std::process::ExitStatus, Vec<u8>, Vec<u8>), String> {
    run_with_input(command, max, timeout, None)
}
fn run_with_input(
    mut command: Command,
    max: u64,
    timeout: Duration,
    input: Option<Vec<u8>>,
) -> Result<(std::process::ExitStatus, Vec<u8>, Vec<u8>), String> {
    if input.is_some() {
        command.stdin(Stdio::piped());
    }
    let mut child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| {
            "OS curl is unavailable; public WMTS still uses the built-in Rust transport"
        })?;
    let writing = input.map(|bytes| {
        let mut stdin = child.stdin.take().expect("piped request input");
        let (sent, written) = mpsc::sync_channel(1);
        std::thread::spawn(move || {
            let _ = sent.send(stdin.write_all(&bytes));
        });
        written
    });
    let mut input_written = writing.is_none();
    let stdout = child.stdout.take().ok_or("Cannot read OS transport")?;
    let stderr = child.stderr.take().ok_or("Cannot read OS transport")?;
    let (send, recv) = mpsc::channel();
    for (index, pipe, limit) in [
        (0, Box::new(stdout) as Box<dyn Read + Send>, max),
        (1, Box::new(stderr) as Box<dyn Read + Send>, 8192),
    ] {
        let send = send.clone();
        std::thread::spawn(move || {
            let mut bytes = Vec::new();
            let result = pipe.take(limit + 1).read_to_end(&mut bytes).map(|_| bytes);
            let _ = send.send((index, result));
        });
    }
    drop(send);
    let mut output = [None, None];
    let start = Instant::now();
    let result = (|| loop {
        crate::operation::check()?;
        if !input_written {
            match writing.as_ref().unwrap().try_recv() {
                Ok(Ok(())) => input_written = true,
                Ok(Err(_)) | Err(mpsc::TryRecvError::Disconnected) => {
                    return Err("Cannot write OS transport request".into())
                }
                Err(mpsc::TryRecvError::Empty) => {}
            }
        }

        while let Ok((index, data)) = recv.try_recv() {
            let data = data.map_err(|_| "Cannot read OS transport response")?;
            if data.len() as u64 > if index == 0 { max } else { 8192 } {
                return Err("Map response exceeds size limit".into());
            }
            output[index] = Some(data);
        }
        if start.elapsed() >= timeout {
            return Err(
                "WMTS client authentication timed out; check card, PIN prompt and middleware"
                    .into(),
            );
        }
        if let Some(status) = child
            .try_wait()
            .map_err(|_| "Cannot monitor OS transport")?
        {
            if input_written && output.iter().all(Option::is_some) {
                return Ok((status, output[0].take().unwrap(), output[1].take().unwrap()));
            }
        }
        std::thread::sleep(Duration::from_millis(10));
    })();
    if result.is_err() {
        let _ = child.kill();
    }
    let _ = child.wait();
    result
}
pub fn platform_kind() -> IdentityKind {
    #[cfg(target_os = "macos")]
    {
        IdentityKind::MacosKeychain
    }
    #[cfg(target_os = "windows")]
    {
        IdentityKind::WindowsStore
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        IdentityKind::Pkcs11
    }
}
fn require_backend(kind: &IdentityKind) -> Result<String, String> {
    if kind != &platform_kind() {
        return Err("This identity type belongs to a different operating system".into());
    }
    if cfg!(target_os = "macos") {
        return Ok("Native URLSession / Keychain / CryptoTokenKit".into());
    }
    let mut cmd = command();
    cmd.arg("--version");
    let (status, out, _) = run(cmd, 8192, Duration::from_secs(3))?;
    let version = String::from_utf8_lossy(&out)
        .lines()
        .next()
        .unwrap_or("")
        .to_owned();
    let compatible = match kind {
        IdentityKind::Disabled => false,
        IdentityKind::MacosKeychain => {
            version.contains("SecureTransport") || version.contains("Secure Transport")
        }
        IdentityKind::WindowsStore => version.contains("Schannel"),
        IdentityKind::Pkcs11 => version.contains("OpenSSL") || version.contains("GnuTLS"),
    };
    if !status.success() || !compatible {
        return Err("OS curl does not expose the required native TLS backend (Windows: Schannel; Linux: OpenSSL/GnuTLS with PKCS#11 middleware)".into());
    }
    Ok(version)
}
pub fn status(store: &AuthStore) -> Result<serde_json::Value, String> {
    let kind = platform_kind();
    let backend = require_backend(&kind);
    Ok(
        serde_json::json!({"platform_kind":kind,"transport_available":backend.is_ok(),"automatic":cfg!(any(target_os="macos",target_os="windows")),"tls_backend":backend.as_ref().ok(),"unavailable_reason":backend.err(),"profiles":store.profiles()?,"hardware_verified":false,"pin_handling":"OS/card middleware only; no PIN accepted by Chronoscope","notice": if cfg!(target_os="macos") {"Automatic TLS challenge detection with native certificate selection; choices stay in this process's session."} else if cfg!(target_os="windows") {"Schannel automatically selects an eligible client certificate when the server requests one. The card provider handles PIN prompts."} else {"Linux needs an explicit PKCS#11 certificate URI and compatible installed curl/middleware. Browser-style automatic token selection is not implemented."}}),
    )
}
pub fn fetch(profile: Option<&Profile>, url: &str, max: u64) -> Result<Response, String> {
    if let Some(profile) = profile {
        if origin(url)? != profile.origin {
            return Err("Client identity cannot be sent to a different HTTPS origin".into());
        }
        require_backend(&profile.kind)?;
    } else {
        require_backend(&platform_kind())?;
    }
    let mut cmd = command();
    cmd.args([
        "--silent",
        "--show-error",
        "--proto",
        "=https",
        "--proto-redir",
        "=https",
        "--max-redirs",
        "0",
        "--connect-timeout",
        "15",
        "--max-time",
        "40",
        "--max-filesize",
        &max.to_string(),
        "--user-agent",
        concat!(
            "Chronoscope/",
            env!("CARGO_PKG_VERSION"),
            " (desktop GIS; direct disk cache)"
        ),
    ]);
    if let Some(profile) = profile {
        cmd.args(["--cert", &profile.identity]);
    } else if cfg!(target_os = "windows") {
        cmd.arg("--ssl-auto-client-cert");
    } else {
        return Err("Automatic smartcard selection is unavailable on this platform".into());
    }
    if let Some(profile) = profile.filter(|p| p.kind == IdentityKind::Pkcs11) {
        let key = profile
            .identity
            .split(';')
            .map(|s| if s == "type=cert" { "type=private" } else { s })
            .collect::<Vec<_>>()
            .join(";");
        // type may be the first attribute after the scheme.
        let key = key.replacen("pkcs11:type=cert;", "pkcs11:type=private;", 1);
        cmd.args(["--key", &key]);
    }
    // No --location, -k, --ssl-auto-client-cert, curlrc, shell, key file or PIN.
    cmd.args(["--write-out", "%{stderr}\n%{http_code}", "--url", url]);
    let (exit, bytes, stderr) = run(cmd, max, Duration::from_secs(45))?;
    if !exit.success() {
        return Err(match exit.code() {
            Some(28) => "WMTS TLS authentication timed out; check the OS PIN prompt",
            Some(58) => "WMTS client identity unavailable; check certificate name, inserted card and middleware",
            Some(60 | 77) => "WMTS server certificate could not be verified; install the organization's trusted CA through the OS",
            Some(63) => "Map response exceeds size limit",
            _ => "WMTS native TLS request failed; check server trust, client certificate, card PIN/cancellation and middleware",
        }.into());
    }
    let status = std::str::from_utf8(&stderr)
        .ok()
        .and_then(|s| s.lines().last())
        .and_then(|s| s.parse().ok())
        .ok_or("Invalid OS transport HTTP status")?;
    Ok(Response {
        status,
        bytes,
        authenticated: true,
    })
}

/// SI request content and its bearer token travel only through stdin, never argv
/// or temporary files. Client private keys/PINs remain with the OS/card provider.
#[cfg(not(target_os = "macos"))]
pub(crate) fn post(
    profile: Option<&Profile>,
    url: &str,
    body: &serde_json::Value,
    key: &str,
    timeout: Duration,
) -> Result<Response, String> {
    if let Some(profile) = profile {
        if origin(url)? != profile.origin {
            return Err("SI certificate belongs to a different HTTPS origin".into());
        }
        require_backend(&profile.kind)?;
    } else {
        if !cfg!(target_os = "windows") {
            return Err(
                "Automatic SI certificate selection is unavailable on this platform".into(),
            );
        }
        require_backend(&platform_kind())?;
    }
    let (cmd, input) = post_command(profile, url, body, key, timeout)?;
    finish_post(run_with_input(cmd, 1024 * 1024, timeout, Some(input)))
}
#[cfg(not(target_os = "macos"))]
fn quote_config(value: &str) -> String {
    format!(
        "\"{}\"",
        value
            .replace('\\', "\\\\")
            .replace('\"', "\\\"")
            .replace('\n', "\\n")
            .replace('\r', "\\r")
    )
}
#[cfg(not(target_os = "macos"))]
fn post_command(
    profile: Option<&Profile>,
    url: &str,
    body: &serde_json::Value,
    key: &str,
    timeout: Duration,
) -> Result<(Command, Vec<u8>), String> {
    origin(url)?;
    if key.chars().any(char::is_control) {
        return Err("Invalid SI API key".into());
    }
    let json = serde_json::to_string(body).map_err(|_| "Cannot encode SI request")?;
    if json.len() > 1024 * 1024 {
        return Err("RESOURCE_LIMIT: SI request exceeded 1 MiB".into());
    }
    let mut input = format!("url = {}\nrequest = \"POST\"\nheader = \"Content-Type: application/json\"\nheader = \"Accept: application/json\"\ndata-binary = {}\n", quote_config(url), quote_config(&json));
    if !key.is_empty() {
        input.push_str(&format!(
            "header = {}\n",
            quote_config(&format!("Authorization: Bearer {key}"))
        ));
    }
    let mut cmd = command();
    cmd.args([
        "--silent",
        "--show-error",
        "--proto",
        "=https",
        "--proto-redir",
        "=https",
        "--max-redirs",
        "0",
        "--connect-timeout",
        "10",
        "--max-time",
        &timeout.as_secs_f64().to_string(),
        "--max-filesize",
        "1048576",
        "--write-out",
        "%{stderr}\n%{http_code}",
        "--config",
        "-",
    ]);
    if let Some(profile) = profile {
        cmd.args(["--cert", &profile.identity]);
        if profile.kind == IdentityKind::Pkcs11 {
            let key = profile
                .identity
                .split(';')
                .map(|part| {
                    if part == "type=cert" {
                        "type=private"
                    } else {
                        part
                    }
                })
                .collect::<Vec<_>>()
                .join(";")
                .replacen("pkcs11:type=cert;", "pkcs11:type=private;", 1);
            cmd.args(["--key", &key]);
        }
    } else if cfg!(target_os = "windows") {
        cmd.arg("--ssl-auto-client-cert");
    }
    Ok((cmd, input.into_bytes()))
}
#[cfg(not(target_os = "macos"))]
fn finish_post(
    result: Result<(std::process::ExitStatus, Vec<u8>, Vec<u8>), String>,
) -> Result<Response, String> {
    let (exit, bytes, stderr) = result.map_err(|e| {
        if e == "Map response exceeds size limit" {
            "RESOURCE_LIMIT: SI response exceeded 1 MiB".to_string()
        } else {
            e.replace("WMTS", "SI")
        }
    })?;
    if !exit.success() {
        return Err(match exit.code() {
            Some(28) => "SI TLS authentication timed out; check the OS certificate/PIN prompt",
            Some(58) => "SI client certificate unavailable; check the inserted card, certificate and middleware",
            Some(60 | 77) => "SI server certificate could not be verified; install the organization's trusted CA through the OS",
            Some(63) => "RESOURCE_LIMIT: SI response exceeded 1 MiB",
            _ => "SI TLS authentication failed or was cancelled; check client certificate, server trust and card middleware. No automatic retry.",
        }.into());
    }
    let status = std::str::from_utf8(&stderr)
        .ok()
        .and_then(|s| s.lines().last())
        .and_then(|s| s.parse().ok())
        .filter(|s| (100..=599).contains(s))
        .ok_or("Invalid SI HTTP status")?;
    Ok(Response {
        status,
        bytes,
        authenticated: true,
    })
}

#[cfg(all(test, target_os = "linux"))]
mod si_tls_tests {
    use super::*;
    use std::io::BufRead;
    #[test]
    #[ignore = "local mTLS fixture requires python3 and openssl; no OS trust changes"]
    fn si_post_uses_client_tls_without_exposing_or_replaying_request_secrets() {
        let dir = tempfile::tempdir().unwrap();
        let mut child = Command::new("python3")
            .arg(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/tests/fixtures/si_tls.py"
            ))
            .arg(dir.path())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        struct Stop(std::process::Child);
        impl Drop for Stop {
            fn drop(&mut self) {
                let _ = self.0.kill();
                let _ = self.0.wait();
            }
        }
        let mut line = String::new();
        std::io::BufReader::new(child.stdout.take().unwrap())
            .read_line(&mut line)
            .unwrap();
        let _stop = Stop(child);
        let url = line.trim();
        let body = serde_json::json!({"model":"fixture", "messages":[{"role":"user","content":"Keep quotes \" and \\ and \n and 雪; no config injection"}]});
        let key = "session-secret-\"quoted\\token";
        let make = |route: &str, identity: bool, trust: bool, timeout: Duration| {
            let (mut cmd, input) =
                post_command(None, &format!("{url}/{route}"), &body, key, timeout).unwrap();
            if identity {
                cmd.arg("--cert")
                    .arg(dir.path().join("client.pem"))
                    .arg("--key")
                    .arg(dir.path().join("client.key"));
            }
            if trust {
                cmd.arg("--cacert").arg(dir.path().join("ca.pem"));
            }
            assert!(!format!("{cmd:?}").contains(key));
            assert!(!format!("{cmd:?}").contains("Keep quotes"));
            finish_post(run_with_input(cmd, 1024 * 1024, timeout, Some(input)))
        };
        assert!(make("ok", false, true, Duration::from_secs(5)).is_err());
        assert!(make("ok", true, false, Duration::from_secs(5))
            .err()
            .unwrap()
            .contains("server certificate"));
        let response = make("ok", true, true, Duration::from_secs(5)).unwrap();
        assert_eq!(response.status, 200);
        let data: serde_json::Value = serde_json::from_slice(&response.bytes).unwrap();
        assert_eq!(data["request"], body);
        assert_eq!(data["authorization"], format!("Bearer {key}"));
        assert_eq!(data["content_type"], "application/json");
        assert_eq!(data["peer_certificate"], true);
        assert_eq!(data["requests"], 1);
        assert_eq!(
            make("redirect", true, true, Duration::from_secs(5))
                .unwrap()
                .status,
            307
        );
        let denied = make("denied", true, true, Duration::from_secs(5)).unwrap();
        assert_eq!(denied.status, 401);
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&denied.bytes).unwrap()["requests"],
            3
        );
        assert!(make("large", true, true, Duration::from_secs(5))
            .err()
            .unwrap()
            .contains("1 MiB"));
        let started = Instant::now();
        assert!(make("slow", true, true, Duration::from_millis(200)).is_err());
        assert!(started.elapsed() < Duration::from_secs(2));
        let cancelled = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true));
        let result = crate::operation::with_context(
            crate::operation::Context {
                cancelled,
                progress: None,
                scope: None,
            },
            || make("slow", true, true, Duration::from_secs(5)),
        );
        assert!(result.err().unwrap().starts_with("CANCELLED:"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn profile(kind: IdentityKind, identity: &str) -> Profile {
        Profile {
            origin: "https://MAPS.example.test:443/wmts".into(),
            kind,
            identity: identity.into(),
        }
    }
    #[test]
    fn origin_and_identity_validation() {
        assert_eq!(
            origin("https://MAPS.example.test:443/path?q=1").unwrap(),
            "https://maps.example.test"
        );
        assert_ne!(
            origin("https://maps.example.test:444").unwrap(),
            origin("https://maps.example.test").unwrap()
        );
        for url in [
            "http://maps.example.test",
            "https://user:pass@maps.example.test",
            "file:///tmp/cert",
            "https://maps.example.test/#fragment",
        ] {
            assert!(origin(url).is_err());
        }
        assert!(profile(IdentityKind::MacosKeychain, "User Authentication")
            .validate()
            .is_ok());
        for identity in [
            "",
            "./key.p12",
            "/tmp/key.p12",
            "name:password",
            "name\n--insecure",
        ] {
            assert!(profile(IdentityKind::MacosKeychain, identity)
                .validate()
                .is_err());
        }
        let mut p = profile(
            IdentityKind::WindowsStore,
            "CurrentUser\\MY\\0123456789abcdef0123456789abcdef01234567",
        );
        p.validate().unwrap();
        assert!(p.identity.ends_with("ABCDEF01234567"));
        assert!(profile(
            IdentityKind::WindowsStore,
            "LocalMachine\\MY\\0123456789abcdef0123456789abcdef01234567"
        )
        .validate()
        .is_err());
    }
    #[test]
    fn token_uris_cannot_supply_pins_or_code() {
        for good in [
            "pkcs11:token=My%20Card;id=%01;type=cert",
            "pkcs11:type=cert;object=PIV%20Authentication",
        ] {
            assert!(
                profile(IdentityKind::Pkcs11, good).validate().is_ok(),
                "{good}"
            );
        }
        for bad in [
            "pkcs11:token=Card;type=cert",
            "pkcs11:id=%01;type=private",
            "pkcs11:id=%01;type=cert?pin-value=1234",
            "pkcs11:id=%01;type=cert?pin-source=file:/secret",
            "pkcs11:id=%01;type=cert;module-path=/tmp/code.so",
            "pkcs11:id=%01;type=cert;pin-value=1234",
            "pkcs11:object=Bad%;type=cert",
            "pkcs11:object=Card;object=Other;type=cert",
            "pkcs11:object=My Card;type=cert",
        ] {
            assert!(
                profile(IdentityKind::Pkcs11, bad).validate().is_err(),
                "{bad}"
            );
        }
    }
    #[test]
    fn local_profiles_are_atomic_scoped_and_rotate_cache_identity() {
        let dir = tempfile::tempdir().unwrap();
        let store = AuthStore::new(dir.path().join("wmts-auth.json"));
        let p = profile(IdentityKind::MacosKeychain, "User Authentication");
        store.set(p.clone(), false).unwrap();
        let first = store
            .get("https://maps.example.test/tiles/1")
            .unwrap()
            .unwrap();
        assert!(store.get("https://other.example.test").unwrap().is_none());
        assert!(store
            .get("https://maps.example.test:444")
            .unwrap()
            .is_none());
        assert!(store.get("http://maps.example.test").unwrap().is_none());
        store.set(p, false).unwrap();
        let second = store
            .get("https://maps.example.test/wmts")
            .unwrap()
            .unwrap();
        assert_ne!(first.cache_scope, second.cache_scope);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(dir.path().join("wmts-auth.json"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
        store.remove("https://maps.example.test/wmts").unwrap();
        assert!(store.profiles().unwrap().is_empty());
        std::fs::write(dir.path().join("wmts-auth.json"), "broken").unwrap();
        assert!(
            store.get("https://maps.example.test").is_err(),
            "Corrupt settings must not downgrade authentication"
        );
    }
    #[test]
    fn process_fixture() {
        if let Ok(mode) = std::env::var("CHRONOSCOPE_TEST_TRANSPORT_FIXTURE") {
            if mode == "hang" {
                std::thread::sleep(Duration::from_secs(10));
            }
            if mode == "large" {
                let _ = std::io::stdout().write_all(&vec![0x61; 200000]);
            }
            std::process::exit(0);
        }
    }
    #[test]
    fn si_stdin_upload_cannot_block_transport_deadline() {
        let mut child = Command::new(std::env::current_exe().unwrap());
        child
            .args([
                "--exact",
                "wmts_auth::tests::process_fixture",
                "--nocapture",
            ])
            .env("CHRONOSCOPE_TEST_TRANSPORT_FIXTURE", "hang");
        let start = Instant::now();
        assert!(run_with_input(
            child,
            1024,
            Duration::from_millis(100),
            Some(vec![b'x'; 1024 * 1024])
        )
        .is_err());
        assert!(start.elapsed() < Duration::from_secs(2));
    }
    #[test]
    fn native_process_has_hard_time_and_memory_bounds() {
        for (mode, max, timeout) in [
            ("hang", 1024, Duration::from_millis(100)),
            ("large", 1024, Duration::from_secs(3)),
        ] {
            let mut child = Command::new(std::env::current_exe().unwrap());
            child
                .args([
                    "--exact",
                    "wmts_auth::tests::process_fixture",
                    "--nocapture",
                ])
                .env("CHRONOSCOPE_TEST_TRANSPORT_FIXTURE", mode);
            let start = Instant::now();
            assert!(run(child, max, timeout).is_err());
            assert!(start.elapsed() < Duration::from_secs(5));
        }
    }
}
