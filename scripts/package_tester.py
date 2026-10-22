#!/usr/bin/env python3
"""Validate real GUI packages and stage bounded, hashed tester downloads."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import tarfile
import tempfile
from package_notices import verify_notices
ROOT = Path(__file__).resolve().parent.parent

def architecture(path):
    data = path.read_bytes()[:4096]
    if data[:2] == b'MZ':
        offset = struct.unpack_from('<I', data, 0x3c)[0]
        if data[offset:offset + 4] != b'PE\0\0':
            raise ValueError('Invalid PE header')
        return {0x8664: 'x86_64', 0xaa64: 'arm64'}[struct.unpack_from('<H', data, offset + 4)[0]]
    if data[:4] == b'\x7fELF':
        return {62: 'x86_64', 183: 'arm64'}[struct.unpack_from('<H', data, 18)[0]]
    if data[:4] == b'\xcf\xfa\xed\xfe':
        return {0x1000007: 'x86_64', 0x100000c: 'arm64'}[struct.unpack_from('<I', data, 4)[0]]
    raise ValueError('Unknown executable header')

def stage(target, output, max_bytes):
    output = output.resolve()
    if output.is_relative_to(ROOT):
        raise ValueError('Output must be outside checkout')
    output.mkdir(parents=True, exist_ok=True)
    if any(output.iterdir()):
        raise ValueError('Refuse nonempty output directory')
    verify_notices(ROOT / 'frontend/dist/third-party', ROOT)
    expected = 'arm64' if target == 'macos-arm64' else 'x86_64'
    release = ROOT / 'target/release'
    gui = release / ('chronoscope-desktop.exe' if target == 'windows-x86_64' else 'chronoscope-desktop')
    if architecture(gui) != expected:
        raise ValueError('GUI architecture mismatch')
    subprocess.run(['python', str(ROOT / 'scripts/test_desktop_cli.py'), '--binary', str(gui)], check=True, timeout=180)
    evidence = {'target': target, 'architecture': expected, 'commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(), 'gui_sha256': hashlib.sha256(gui.read_bytes()).hexdigest(), 'automated_tests': ['built desktop CLI/agent/MCP smoke', 'built frontend notices'], 'real_device_tests': False}
    with tempfile.TemporaryDirectory(prefix='chronoscope-tester-') as temporary:
        root = Path(temporary) / 'Chronoscope'
        root.mkdir()
        if target == 'windows-x86_64':
            cargo_home = Path(os.environ.get('CARGO_HOME', str(Path.home() / '.cargo')))
            loaders = list((cargo_home / 'registry/src').glob('*/webview2-com-sys-0.39.1/x64/WebView2LoaderStatic.lib'))
            if len(loaders) != 1 or hashlib.sha256(loaders[0].read_bytes()).hexdigest() != '89c6b872783b8f6c3cedbff618adb42082d455c615453ae10cfc753f1e8f25d8':
                raise ValueError('Exact reviewed Microsoft SDK loader build input missing/altered')
            evidence['webview2_loader_sha256'] = hashlib.sha256(loaders[0].read_bytes()).hexdigest()
            packages = list((release / 'bundle/nsis').glob('*.exe'))
            if len(packages) != 1:
                raise ValueError('Actual NSIS GUI installer required')
            extractor = shutil.which('7z') or str(Path('C:/Program Files/7-Zip/7z.exe'))
            extracted = Path(temporary) / 'installer-extracted'
            subprocess.run([extractor, 'x', '-y', '-o' + str(extracted), str(packages[0])], check=True)
            manifests = list(extracted.rglob('NOTICE-MANIFEST.json'))
            if not manifests:
                raise ValueError('Actual installer missing physical notice resources')
            for manifest in manifests:
                verify_notices(manifest.parent, ROOT)
            evidence['installer_notice_manifests'] = len(manifests)
            shutil.copy2(gui, root / gui.name)
            shutil.copy2(packages[0], root / packages[0].name)
            shutil.copy2(release / 'chronoscope.exe', root / 'chronoscope.exe')
            inspect = shutil.which('llvm-objdump') or str(Path('C:/Program Files/LLVM/bin/llvm-objdump.exe'))
            evidence['linkage'] = subprocess.check_output([inspect, '-p', str(gui)], text=True)
            (root / 'INSTALL.txt').write_text('Experimental builds for testing; you may encounter bugs.\n\nWindows x64: use the included current-user installer, or run chronoscope-desktop.exe. Unsigned; Windows may display a publisher warning. Microsoft Edge WebView2 Evergreen Runtime must already be installed (not redistributed). Get it at https://developer.microsoft.com/microsoft-edge/webview2/ .\n')
        elif target == 'macos-arm64':
            apps = list((release / 'bundle/macos').glob('*.app'))
            if len(apps) != 1:
                raise ValueError('Actual macOS GUI app required')
            bundled = apps[0] / 'Contents/MacOS/chronoscope-desktop'
            if architecture(bundled) != expected:
                raise ValueError('Bundled GUI architecture mismatch')
            verify_notices(apps[0] / 'Contents/Resources/third-party', ROOT)
            shutil.copytree(apps[0], root / apps[0].name, symlinks=True)
            evidence['linkage'] = subprocess.check_output(['otool', '-L', str(bundled)], text=True)
            subprocess.run(['codesign', '--verify', '--deep', '--strict', str(apps[0])], check=True)
            metadata = apps[0] / 'Contents/Resources/Metadata.appintents'
            if not metadata.is_dir() or not any(metadata.iterdir()):
                raise ValueError('App Intents metadata missing')
            (root / 'INSTALL.txt').write_text('Experimental builds for testing; you may encounter bugs.\n\nApple Silicon macOS: extract and drag Chronoscope.app to Applications. Ad-hoc signed, not notarized. macOS may block first launch: after reviewing source/checksum, use System Settings > Privacy & Security > Open Anyway if offered. Not for Intel Macs.\n')
        elif target == 'linux-x86_64':
            packages = list((release / 'bundle/appimage').glob('*.AppImage'))
            if len(packages) != 1:
                raise ValueError('Actual GUI AppImage required')
            shutil.copy2(packages[0], root / packages[0].name)
            evidence['linkage'] = subprocess.check_output(['ldd', str(gui)], text=True)
            (root / 'INSTALL.txt').write_text('Experimental builds for testing; you may encounter bugs.\n\nLinux x64: chmod +x Chronoscope_*.AppImage then run it. FUSE-free option: --appimage-extract-and-run. See native source/replacement record for covered shared libraries.\n')
        shutil.copytree(ROOT / 'frontend/dist/third-party', root / 'third-party')
        (root / 'SOURCE-ACCESS.txt').write_text('Exact application source and dependency sources with retained licenses/NOTICE and SHA256 manifests accompany these downloads on the same prerelease: chronoscope-source.zip and chronoscope-dependency-sources.tar.xz. MPL covered source is included. Application source includes patched GLib and frontend Knockout modification. Root MIT does not replace upstream/data/media licenses. See third-party/docs/DISTRIBUTION.md. Linux additionally requires its native source archive and replacement instructions.\n')
        if target == 'macos-arm64':
            package = output / f'chronoscope-{target}.tar.xz'
            with tarfile.open(package, 'w:xz') as archive:
                archive.add(root, arcname='Chronoscope')
        else:
            package = Path(shutil.make_archive(str(output / f'chronoscope-{target}'), 'zip', root.parent, root.name))
    evidence.update(package=package.name, package_sha256=hashlib.sha256(package.read_bytes()).hexdigest(), package_bytes=package.stat().st_size)
    (output / f'VALIDATION-{target}.json').write_text(json.dumps(evidence, indent=2) + '\n')
    (output / f'SHA256SUMS-{target}.txt').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest() + '  ' + p.name + '\n' for p in sorted(output.iterdir())))
    if sum(p.stat().st_size for p in output.iterdir()) + 1024 * 1024 > max_bytes:
        raise ValueError('Artifact storage cap including ZIP headroom exceeded: nothing may upload')
    print(json.dumps(evidence, indent=2))

if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--target', required=True, choices=['windows-x86_64', 'macos-arm64', 'linux-x86_64'])
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--max-bytes', type=int, default=60 * 1024 * 1024)
    a = p.parse_args()
    stage(a.target, a.output, a.max_bytes)
