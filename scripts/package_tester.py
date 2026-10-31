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

def verify_nsis_gui(build_data, installed_data):
    # Tauri replaces exactly the first bundle marker while creating NSIS, then
    # restores the loose binary. Reject every other byte difference.
    # https://github.com/tauri-apps/tauri/blob/tauri-bundler-v2.9.2/crates/tauri-bundler/src/bundle.rs
    unknown = b"__TAURI_BUNDLE_TYPE_VAR_UNK"
    nsis = b"__TAURI_BUNDLE_TYPE_VAR_NSS"
    if installed_data == build_data:
        return 'identical'
    index = build_data.find(unknown)
    if index < 0 or installed_data != build_data[:index] + nsis + build_data[index + len(unknown):]:
        raise ValueError('Actual installer GUI differs beyond the Tauri NSIS bundle marker')
    return 'Tauri NSIS bundle marker only'

# Mac-only seal-to-archive identity guards. Never follow bundle symlinks while
# inventorying; reject special files and bound both traversal and hashed bytes.
MAC_MAX_ENTRIES = 20000
MAC_MAX_BYTES = 512 * 1024 * 1024

def mac_file_identity(info):
    # Reading can update atime on hosted APFS volumes. Keep identity, content
    # timestamps and security metadata in the guard, but exclude access time.
    return (info.st_dev, info.st_ino, info.st_mode, info.st_nlink,
            info.st_uid, info.st_gid, info.st_size, info.st_mtime_ns,
            info.st_ctime_ns, getattr(info, 'st_flags', 0))

def mac_app_inventory(app):
    inventory = {}
    total = 0
    def visit(path, name):
        nonlocal total
        if len(inventory) >= MAC_MAX_ENTRIES:
            raise ValueError('Mac app inventory entry cap exceeded')
        info = path.lstat()
        mode = info.st_mode & 0o7777
        if path.is_symlink():
            inventory[name] = ('symlink', mode, os.readlink(path))
        elif path.is_dir():
            inventory[name] = ('directory', mode)
            for child in sorted(path.iterdir()):
                visit(child, child.name if name == '.' else name + '/' + child.name)
        elif path.is_file():
            total += info.st_size
            if total > MAC_MAX_BYTES:
                raise ValueError('Mac app inventory byte cap exceeded')
            digest = hashlib.sha256()
            size = 0
            with path.open('rb') as stream:
                while block := stream.read(1024 * 1024):
                    size += len(block)
                    if size > info.st_size:
                        raise ValueError('Mac app changed during inventory')
                    digest.update(block)
            if size != info.st_size or mac_file_identity(path.lstat()) != mac_file_identity(info):
                raise ValueError('Mac app changed during inventory')
            inventory[name] = ('file', mode, size, digest.hexdigest())
        else:
            raise ValueError('Mac app contains unsupported file type')
    visit(app, '.')
    return inventory

def mac_metadata_check(app):
    metadata = app / 'Contents/Resources/Metadata.appintents'
    # Require a physical, nonempty regular metadata file, not an empty entry
    # or external symlink target standing in for generated metadata.
    if (metadata.is_symlink() or not metadata.is_dir() or
            not any(p.is_file() and not p.is_symlink() and p.stat().st_size > 0
                    for p in metadata.iterdir())):
        raise ValueError('App Intents metadata missing or empty')

def mac_archive_inventory(package, app_name):
    prefix = 'Chronoscope/' + app_name
    inventory = {}
    total = 0
    with tarfile.open(package, 'r:xz') as archive:
        # Stream bounded headers rather than getmembers() on an unchecked tar.
        for member in archive:
            if member.name != prefix and not member.name.startswith(prefix + '/'):
                continue
            name = '.' if member.name == prefix else member.name[len(prefix) + 1:]
            if (name in inventory or len(inventory) >= MAC_MAX_ENTRIES or
                    (name != '.' and any(p in ('', '.', '..') for p in name.split('/')))):
                raise ValueError('Invalid Mac archive inventory')
            mode = member.mode & 0o7777
            if member.isdir():
                inventory[name] = ('directory', mode)
            elif member.issym():
                inventory[name] = ('symlink', mode, member.linkname)
            elif member.isfile():
                total += member.size
                if total > MAC_MAX_BYTES:
                    raise ValueError('Mac archive inventory byte cap exceeded')
                digest = hashlib.sha256()
                size = 0
                with archive.extractfile(member) as stream:
                    while block := stream.read(1024 * 1024):
                        size += len(block)
                        if size > member.size:
                            raise ValueError('Invalid Mac archive file size')
                        digest.update(block)
                if size != member.size:
                    raise ValueError('Invalid Mac archive file size')
                inventory[name] = ('file', mode, size, digest.hexdigest())
            else:
                raise ValueError('Mac archive contains unsupported file type')
    return inventory

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
            installed = list(extracted.rglob('chronoscope-desktop.exe'))
            if len(installed) != 1 or architecture(installed[0]) != expected:
                raise ValueError('Actual installer GUI executable missing or wrong architecture')
            installed_hash = hashlib.sha256(installed[0].read_bytes()).hexdigest()
            evidence['installer_binary_difference'] = verify_nsis_gui(gui.read_bytes(), installed[0].read_bytes())
            # Smoke the actual installer payload after validating its exact,
            # narrowly allowed difference from the source-tree executable.
            subprocess.run(['python', str(ROOT / 'scripts/test_desktop_cli.py'), '--binary', str(installed[0])], check=True, timeout=180)
            if hashlib.sha256(installed[0].read_bytes()).hexdigest() != installed_hash:
                raise ValueError('Installer GUI changed during smoke')
            evidence['build_tree_gui_sha256'] = evidence['gui_sha256']
            evidence['gui_sha256'] = installed_hash
            evidence['installer_gui_sha256'] = installed_hash
            evidence['automated_tests'].extend(['installer GUI byte identity except Tauri NSIS marker', 'installer desktop CLI/agent/MCP smoke'])
            # Ship the complete installer once, not duplicate GUI/CLI binaries.
            # The installed desktop executable also exposes the tested CLI/MCP.
            shutil.copy2(packages[0], root / packages[0].name)
            inspect = shutil.which('llvm-objdump') or str(Path('C:/Program Files/LLVM/bin/llvm-objdump.exe'))
            evidence['linkage'] = subprocess.check_output([inspect, '-p', str(installed[0])], text=True)
            (root / 'INSTALL.txt').write_text('Experimental builds for testing; you may encounter bugs.\n\nWindows x64: use the included current-user installer. The installed Chronoscope executable also supports CLI/MCP commands. Unsigned; Windows may display a publisher warning. Microsoft Edge WebView2 Evergreen Runtime must already be installed (not redistributed). Get it at https://developer.microsoft.com/microsoft-edge/webview2/ .\n')
        elif target == 'macos-arm64':
            apps = list((release / 'bundle/macos').glob('*.app'))
            if len(apps) != 1:
                raise ValueError('Actual macOS GUI app required')
            # Validate the copied payload that will actually enter the archive.
            # Bundler signing can legitimately change the build-tree GUI bytes.
            packaged_app = root / apps[0].name
            shutil.copytree(apps[0], packaged_app, symlinks=True)
            bundled = packaged_app / 'Contents/MacOS/chronoscope-desktop'
            if architecture(bundled) != expected:
                raise ValueError('Bundled GUI architecture mismatch')
            subprocess.run(['codesign', '--verify', '--deep', '--strict', str(packaged_app)], check=True)
            verify_notices(packaged_app / 'Contents/Resources/third-party', ROOT)
            mac_metadata_check(packaged_app)
            sealed_inventory = mac_app_inventory(packaged_app)
            smoked_hash = hashlib.sha256(bundled.read_bytes()).hexdigest()
            subprocess.run(['python', str(ROOT / 'scripts/test_desktop_cli.py'), '--binary', str(bundled)], check=True, timeout=180)
            if hashlib.sha256(bundled.read_bytes()).hexdigest() != smoked_hash:
                raise ValueError('Packaged Mac GUI changed during smoke')
            evidence['build_tree_gui_sha256'] = evidence['gui_sha256']
            evidence['gui_sha256'] = smoked_hash
            evidence['linkage'] = subprocess.check_output(['otool', '-L', str(bundled)], text=True)
            if hashlib.sha256(bundled.read_bytes()).hexdigest() != smoked_hash:
                raise ValueError('Packaged Mac GUI changed during linkage')
            subprocess.run(['codesign', '--verify', '--deep', '--strict', str(packaged_app)], check=True)
            verify_notices(packaged_app / 'Contents/Resources/third-party', ROOT)
            mac_metadata_check(packaged_app)
            if mac_app_inventory(packaged_app) != sealed_inventory:
                raise ValueError('Sealed Mac app changed during validation')
            evidence['automated_tests'].extend(['copied app codesign --verify --deep --strict', 'copied app frontend notices', 'copied app App Intents metadata present', 'packaged desktop CLI/agent/MCP smoke'])
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
            # Write privately; compare actual archived bytes/types/modes/links
            # with the sealed pre-smoke inventory before exposing any output.
            staged_package = Path(temporary) / f'chronoscope-{target}.tar.xz'
            if mac_app_inventory(packaged_app) != sealed_inventory:
                raise ValueError('Sealed Mac app changed before archive')
            with tarfile.open(staged_package, 'w:xz') as archive:
                archive.add(root, arcname='Chronoscope')
            archived_inventory = mac_archive_inventory(staged_package, packaged_app.name)
            archived_gui = archived_inventory.get('Contents/MacOS/chronoscope-desktop')
            if not archived_gui or archived_gui[0] != 'file' or archived_gui[3] != smoked_hash:
                raise ValueError('Archived Mac GUI differs from smoked GUI')
            if (archived_inventory != sealed_inventory or
                    mac_app_inventory(packaged_app) != sealed_inventory):
                raise ValueError('Sealed Mac app changed at archive boundary')
            evidence['archived_gui_sha256'] = smoked_hash
            evidence['automated_tests'].extend(['final copied app strict seal/notices/nonempty metadata', 'archived app file/symlink/mode inventory matches sealed app'])
            package = output / staged_package.name
            staged_package.replace(package)
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
    p.add_argument('--max-bytes', type=int, default=256 * 1024 * 1024)
    a = p.parse_args()
    stage(a.target, a.output, a.max_bytes)
