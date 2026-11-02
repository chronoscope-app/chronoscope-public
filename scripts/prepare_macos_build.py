#!/usr/bin/env python3
"""Install pinned release tools in an ignored directory; leave system tools alone."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tarfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent.parent
NODE = '22.23.4'
PYTHON = '3.13.18'
UV = '0.13.6'
UV_SHA256 = '51361029b7cf91185d0092c4b356d110b4ad629e9cb11593f1e006ac72a72ca9'
UV_URL = 'https://files.pythonhosted.org/packages/f4/14/77230cc4f6a73a31578cb8070a5f67f58a76946ead643ae8a4155620d6da/uv-0.13.6-py3-none-macosx_11_0_arm64.whl'


def download(url):
    with urllib.request.urlopen(url, timeout=120) as response:
        data = response.read(150*1024**2+1)
    if len(data) > 150*1024**2:
        raise ValueError('Tool archive exceeds download limit')
    return data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, default=ROOT/'.local-build/release-tools')
    args = parser.parse_args()
    if sys.platform != 'darwin' or os.uname().machine != 'arm64':
        raise ValueError('This preparation script is for Apple Silicon macOS')
    tools = args.directory.resolve(); tools.mkdir(parents=True, exist_ok=True)
    uv = tools/'bin/uv'; uv.parent.mkdir(exist_ok=True)
    if not uv.exists():
        data = download(UV_URL)
        if hashlib.sha256(data).hexdigest() != UV_SHA256:
            raise ValueError('Pinned uv wheel checksum mismatch')
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            members = [n for n in archive.namelist() if n.endswith('/uv')]
            if len(members) != 1: raise ValueError('Expected one uv executable')
            uv.write_bytes(archive.read(members[0])); uv.chmod(0o755)
    if subprocess.check_output([str(uv), '--version'], text=True).split()[1] != UV:
        raise ValueError('Unexpected prepared uv version')
    node = tools/('node-v'+NODE+'-darwin-arm64')
    if not (node/'bin/node').exists():
        name = node.name+'.tar.gz'; base = 'https://nodejs.org/dist/v'+NODE+'/'
        checksums = download(base+'SHASUMS256.txt').decode()
        expected = dict(reversed(line.split()) for line in checksums.splitlines())[name]
        data = download(base+name)
        if hashlib.sha256(data).hexdigest() != expected: raise ValueError('Node archive checksum mismatch')
        with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
            # Hash-verified official archive; still bound paths and link targets.
            for member in archive.getmembers():
                path = Path(member.name)
                if path.is_absolute() or '..' in path.parts or path.parts[0] != node.name or member.isdev():
                    raise ValueError('Unexpected Node archive path')
                if member.issym() and (Path(member.linkname).is_absolute() or not (tools/path.parent/member.linkname).resolve().is_relative_to(node)):
                    raise ValueError('Unexpected Node archive symlink')
                if member.islnk(): raise ValueError('Unexpected Node hard link')
            if sys.version_info >= (3, 12): archive.extractall(tools, filter='data')
            else: archive.extractall(tools)
    environment = dict(os.environ, UV_PYTHON_INSTALL_DIR=str(tools/'python'),
                       UV_PYTHON_BIN_DIR=str(tools/'bin'), UV_SYSTEM_CERTS='true')
    subprocess.run([str(uv), 'python', 'install', PYTHON], env=environment, check=True)
    python = subprocess.check_output([str(uv), 'python', 'find', PYTHON], env=environment, text=True).strip()
    alias = tools/'bin/python'
    if alias.is_symlink(): alias.unlink()
    elif alias.exists(): raise ValueError('Refuse to replace an unknown Python launcher')
    alias.symlink_to(python)
    alias3 = tools/'bin/python3'
    if alias3.is_symlink(): alias3.unlink()
    elif alias3.exists(): raise ValueError('Refuse to replace an unknown Python launcher')
    alias3.symlink_to(python)
    cargo_home = Path(environment.get('CARGO_HOME', str(Path.home()/'.cargo')))
    rustup = cargo_home/'bin/rustup'
    subprocess.run([str(rustup), 'toolchain', 'install', '1.98.0', '--profile', 'minimal', '--component', 'clippy,rustfmt'], check=True)
    developer = environment.get('DEVELOPER_DIR', '/Applications/Xcode.app/Contents/Developer')
    sdk = subprocess.check_output(['xcrun', '--sdk', 'macosx', '--show-sdk-path'], env=dict(environment, DEVELOPER_DIR=developer), text=True).strip()
    exports = {'CARGO_HOME': str(cargo_home), 'RUSTUP_HOME': environment.get('RUSTUP_HOME', str(Path.home()/'.rustup')),
               'RUSTUP_TOOLCHAIN': '1.98.0', 'DEVELOPER_DIR': developer, 'SDKROOT': sdk,
               'MACOSX_DEPLOYMENT_TARGET': '11.0', 'npm_config_cache': str(tools/'npm-cache')}
    lines = ['# Prepared local release environment. No system/global settings changed.']
    lines += ['export '+k+'='+shlex.quote(v) for k,v in exports.items()]
    lines += ['export PATH='+shlex.quote(str(tools/'bin')+':'+str(node/'bin')+':'+str(cargo_home/'bin'))+':"$PATH"']
    output = tools/'environment.sh'; output.write_text('\n'.join(lines)+'\n')
    print(json.dumps({'environment': str(output), 'rust': '1.98.0', 'node': NODE, 'python': PYTHON, 'uv': UV}))


if __name__ == '__main__': main()
