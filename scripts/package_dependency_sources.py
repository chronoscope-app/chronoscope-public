#!/usr/bin/env python3
"""Collect exact locked registry sources, licenses and checksums for recipients.
No dependency code is run. Includes optional/build entries conservatively.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import time
import tomllib
import urllib.request

ROOT = Path(__file__).resolve().parent.parent


def download(url, algorithm, expected):
    if not url.startswith(('https://static.crates.io/', 'https://registry.npmjs.org/')):
        raise ValueError('Unapproved locked source host: ' + url)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=90) as response:
                data = response.read(150 * 1024 * 1024 + 1)
            if len(data) > 150 * 1024 * 1024:
                raise ValueError('Source archive exceeds bounded download')
            digest = hashlib.new(algorithm, data).digest()
            if digest != expected:
                raise ValueError('Source checksum mismatch: ' + url)
            return data
        except (OSError, TimeoutError):
            if attempt == 2:
                raise
            time.sleep(5 * (attempt + 1))


def collect(output):
    output = output.resolve()
    if output.is_relative_to(ROOT):
        raise ValueError('Output must be outside checkout')
    records = []
    with tempfile.TemporaryDirectory(prefix='chronoscope-sources-') as temporary:
        stage = Path(temporary)
        crates = tomllib.loads((ROOT / 'Cargo.lock').read_text())['package']
        for package in crates:
            if 'source' not in package:
                continue  # workspace + complete patched GLib are in app source ZIP
            if package['source'] != 'registry+https://github.com/rust-lang/crates.io-index':
                raise ValueError('Unreviewed Cargo source')
            name, version = package['name'], package['version']
            url = f'https://static.crates.io/crates/{name}/{name}-{version}.crate'
            expected = package['checksum']
            caches = list((Path(os.environ.get('CARGO_HOME', str(Path.home() / '.cargo'))) / 'registry/cache').glob(f'*/{name}-{version}.crate'))
            data = caches[0].read_bytes() if caches else download(url, 'sha256', bytes.fromhex(expected))
            if hashlib.sha256(data).hexdigest() != expected:
                raise ValueError('Cached crate checksum mismatch')
            relative = f'cargo/{name}-{version}.crate'
            path = stage / relative
            path.parent.mkdir(exist_ok=True)
            path.write_bytes(data)
            records.append(dict(ecosystem='cargo', name=name, version=version, path=relative,
                                url=url, sha256=expected, modifications='none; patched GLib source is in application source archive'))
        packages = json.loads((ROOT / 'frontend/package-lock.json').read_text())['packages']
        seen = set()
        for location, package in packages.items():
            if not location:
                continue
            url = package.get('resolved')
            integrity = package.get('integrity', '')
            if not url or not integrity or package.get('link'):
                raise ValueError('Missing locked npm source')
            if url in seen:
                continue
            seen.add(url)
            algorithm, encoded = integrity.split('-', 1)
            if algorithm not in {'sha512', 'sha256'}:
                raise ValueError('Unsupported npm integrity')
            data = download(url, algorithm, base64.b64decode(encoded))
            digest = hashlib.sha256(data).hexdigest()
            relative = f'npm/{digest}.tgz'
            path = stage / relative
            path.parent.mkdir(exist_ok=True)
            path.write_bytes(data)
            records.append(dict(ecosystem='npm', name=location.split('node_modules/')[-1],
                                version=package['version'], license=package.get('license'),
                                path=relative, url=url, sha256=digest, integrity=integrity,
                                modifications='Knockout global lookup rewritten from eval to globalThis by application frontend/vite.config.ts; other sources unchanged'))
        commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
        manifest = dict(format=1, application_commit=commit, components=records,
                        scope='All locked Cargo registry and frontend npm packages, including build/optional/platform extras; not a claim all are shipped. Native distro source is separate.')
        (stage / 'SOURCE-ACCESS.json').write_text(json.dumps(manifest, indent=2) + '\n')
        (stage / 'README.txt').write_text('''Exact dependency source for Chronoscope

Each .crate/.tgz is the original registry source archive, including its license/copyright/NOTICE files. SOURCE-ACCESS.json records exact versions, original public URLs and independently verified hashes. This archive deliberately includes optional/build/platform extras; only actual redistributed components create executable obligations.

Application source, complete patched GLib source and the frontend Knockout transformation are in the matching chronoscope-source.zip. Extract .crate/.tgz using tar; retain upstream license and notice files. For locked builds use the exact Rust/Node versions and commands in application .github/workflows/build.yml, cargo build --locked and npm --prefix frontend ci. Selected AND obligations remain; use Apache-2.0 where DOMPurify and other packages offer Apache-2.0 OR MPL-2.0, MIT where MIT OR Apache-2.0. MPL-only and combined-license files remain under their upstream terms, with exact covered source provided here. No waiver of mandatory notices or source rights.

This supplies registry sources, not Linux distro sources; see separate native source record if Linux binaries are distributed. macOS system frameworks and Windows WebView2 runtime are OS/user-installed prerequisites, not included in these archives.
''')
        output.parent.mkdir(parents=True, exist_ok=True)
        with tarfile.open(output, 'w:xz') as archive:
            archive.add(stage, arcname='chronoscope-dependency-sources')
    print(json.dumps({'output': output.name, 'components': len(records), 'bytes': output.stat().st_size,
                      'sha256': hashlib.sha256(output.read_bytes()).hexdigest()}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    collect(parser.parse_args().output)
