#!/usr/bin/env python3
"""Pinned Windows installer inputs and complete payload/source inventories.

Local input review never claims Windows capability. Native checks fail early on
the actual Windows host. No cache purge, policy change, build or publication.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import zipfile

from package_source import read_regular, safe_name
from package_notices import regular_files, verify_notices

ROOT = Path(__file__).resolve().parents[1]
PROVENANCE = 'assets/licenses/windows-installer/PROVENANCE.json'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def metadata(root=ROOT):
    return json.loads(read_regular(root, PROVENANCE))


def checked_download(record, cache):
    cache.mkdir(parents=True, exist_ok=True)
    path = cache / (record['sha256'] + '.download')
    if path.is_symlink():
        raise ValueError('Installer cache symlink refused')
    if path.exists():
        data = path.read_bytes()
    else:
        if not record['url'].startswith(('https://github.com/tauri-apps/', 'https://codeload.github.com/')):
            raise ValueError('Unreviewed installer source URL')
        with urllib.request.urlopen(record['url'], timeout=90) as response:
            data = response.read(64 * 1024**2 + 1)
        if len(data) != record['bytes'] or digest(data) != record['sha256']:
            raise ValueError('Installer input checksum mismatch')
        temporary = path.with_suffix('.partial')
        temporary.write_bytes(data)
        temporary.replace(path)
    if len(data) != record['bytes'] or digest(data) != record['sha256']:
        raise ValueError('Cached installer input checksum mismatch; preserved for review')
    return data


def prepare_toolchain(cache, destination, root=ROOT):
    if destination.is_symlink():
        raise ValueError('NSIS cache directory symlink refused')
    def target_for(name):
        path = destination
        for part in safe_name(name).parts:
            path = path / part
            if path.is_symlink():
                raise ValueError('NSIS cache path symlink refused')
        return path
    manifest = metadata(root)
    data = checked_download(manifest['nsis_binary'], cache)
    # Exact upstream archive; still reject unsafe members and refuse overwriting
    # an existing different cache entry. Preserve all unrelated cached tools.
    with zipfile.ZipFile(__import__('io').BytesIO(data)) as archive:
        for info in archive.infolist():
            if info.is_dir():
                continue
            name = info.filename.removeprefix('nsis-3.13/')
            safe_name(name)
            if info.filename == name or (info.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError('Unsafe NSIS input archive')
            content = archive.read(info)
            target = target_for(name)
            if target.is_symlink() or (target.exists() and target.read_bytes() != content):
                raise ValueError('Different existing NSIS cache entry; preserved: ' + name)
            if not target.exists():
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(content)
    plugin = checked_download(manifest['tauri_plugin_binary'], cache)
    target = target_for('Plugins/x86-unicode/additional/nsis_tauri_utils.dll')
    if target.is_symlink() or (target.exists() and target.read_bytes() != plugin):
        raise ValueError('Different existing Tauri plugin cache entry; preserved')
    if not target.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(plugin)


def installer_inventory(directory, root=ROOT):
    """Account for every physical NSIS member, including bitmap/data/notices."""
    manifest = metadata(root)
    notice = verify_notices(directory / 'third-party', root)
    expected_notices = {e['path']: e['sha256'] for e in notice['files']}
    expected_notices['NOTICE-MANIFEST.json'] = digest(read_regular(directory / 'third-party', 'NOTICE-MANIFEST.json'))
    entries = []
    for name in regular_files(directory):
        data = read_regular(directory, name)
        sha = digest(data)
        if name in ('chronoscope-desktop.exe', 'uninstall.exe'):
            if not data.startswith(b'MZ'):
                raise ValueError('Generated Windows executable header missing')
            group = 'application-and-installer-source'
        elif name in manifest['payloads']:
            record = manifest['payloads'][name]
            if sha not in record['sha256']:
                raise ValueError('Unreviewed installer component bytes: ' + name)
            group = record['source_group']
        elif name.startswith('third-party/'):
            relative = name.removeprefix('third-party/')
            if expected_notices.get(relative) != sha:
                raise ValueError('Unknown or changed installed notice: ' + name)
            group = 'retained-notices'
        elif name.startswith('terrain/'):
            relative = 'assets/' + name
            if name == 'terrain/balanced.cterrain':
                terrain = json.loads(read_regular(root, 'assets/data-assets.json'))['terrain']
                expected = terrain['sha256']
                if len(data) != terrain['bytes']:
                    raise ValueError('Changed installed terrain length')
            else:
                expected = digest(read_regular(root, relative))
            if sha != expected:
                raise ValueError('Changed installed terrain input: ' + name)
            group = 'terrain-source-and-data'
        else:
            raise ValueError('Uncovered installer file (including non-executable): ' + name)
        entries.append({'path': name, 'bytes': len(data), 'sha256': sha, 'source_group': group})
    names = {e['path'] for e in entries}
    required = set(manifest['payloads']) | {'chronoscope-desktop.exe', 'uninstall.exe',
        'terrain/balanced.cterrain', 'terrain/balanced.json', 'terrain/README.md'}
    required |= {'third-party/' + name for name in expected_notices}
    if not required <= names:
        raise ValueError('Incomplete installed payload inventory')
    return {'format': 1, 'scope': 'Every physical installer file; embedded web assets have a separate inventory',
            'source_groups': manifest['source_groups'], 'files': entries}


def download_inventory(directory, installer, root=ROOT):
    verify_notices(directory / 'third-party', root)
    entries = []
    names = regular_files(directory)
    required = {installer, 'INSTALL.txt', 'SOURCE-ACCESS.txt'}
    if not required <= set(names):
        raise ValueError('Incomplete Windows wrapper files')
    for name in names:
        if name not in required and not name.startswith('third-party/'):
            raise ValueError('Uncovered download file (including non-executable): ' + name)
        data = read_regular(directory, name)
        entries.append({'path': name, 'bytes': len(data), 'sha256': digest(data),
            'source_group': 'retained-notices' if name.startswith('third-party/') else 'application-and-installer-source'})
    return entries


def frontend_inventory(root=ROOT):
    """Bind executable AND non-executable embedded web files to their inputs."""
    dist = root / 'frontend/dist'
    verify_notices(dist / 'third-party', root)
    tracked = set(subprocess.check_output(['git', '-C', str(root), 'ls-files', '-z']).decode().split('\0'))
    # Vite copies fonts/images/binary grids under content-hashed names. Match
    # their bytes to actual source inputs instead of treating every asset as code.
    static = {}
    for parent in (root / 'frontend/src', root / 'frontend/node_modules/katex/dist/fonts'):
        for path in parent.rglob('*'):
            if path.is_file() and not path.is_symlink() and path.suffix.lower() not in ('.ts', '.css'):
                relative = str(path.relative_to(root)).replace('\\', '/')
                if relative.startswith('frontend/src/') and relative not in tracked:
                    continue
                static.setdefault(digest(path.read_bytes()), relative)
    entries = []
    for name in regular_files(dist):
        data = read_regular(dist, name)
        sha = digest(data)
        if name.startswith('cesium/'):
            upstream = 'frontend/node_modules/cesium/Build/Cesium/' + name.removeprefix('cesium/')
            if name in ('cesium/LICENSE.md', 'cesium/CHANGES.md'):
                upstream = 'frontend/node_modules/cesium/' + name.split('/')[-1]
            if digest(read_regular(root, upstream)) != sha:
                raise ValueError('Changed Cesium runtime data: ' + name)
            source, group = upstream, 'locked-registry-sources'
        elif name.startswith('third-party/'):
            source, group = name.removeprefix('third-party/'), 'retained-notices'
        elif 'frontend/public/' + name in tracked:
            source, group = 'frontend/public/' + name, 'application-source-and-asset-notices'
            if digest(read_regular(root, source)) != sha:
                raise ValueError('Changed public asset: ' + name)
        elif (name.endswith('.html') and 'frontend/' + name in tracked) or (name.startswith('assets/') and Path(name).suffix in ('.js', '.css')):
            source, group = 'frontend/vite.config.ts and locked module graph', 'application-and-locked-registry-sources'
        elif name.startswith('assets/') and sha in static:
            source, group = static[sha], 'application-and-locked-registry-sources'
        else:
            raise ValueError('Uncovered embedded file (including non-executable): ' + name)
        entries.append({'path': name, 'bytes': len(data), 'sha256': sha, 'source': source, 'source_group': group})
    return {'format': 1, 'scope': 'Every embedded frontend file, including fonts, imagery, JSON, WASM and binary data', 'files': entries}


def native_identity():
    if sys.platform != 'win32':
        raise ValueError('Real Windows prerequisites require Windows')
    programs = Path(os.environ['ProgramFiles(x86)'])
    vswhere = programs / 'Microsoft Visual Studio/Installer/vswhere.exe'
    linkers = subprocess.check_output([str(vswhere), '-latest', '-products', '*', '-requires',
        'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-find', 'VC/Tools/MSVC/*/bin/Hostx64/x64/link.exe'], text=True).splitlines()
    if not linkers or not Path(linkers[-1]).is_file():
        raise ValueError('MSVC x64 linker missing')
    kits = programs / 'Windows Kits/10'
    versions = sorted(p.name for p in (kits / 'Include').iterdir()
                      if (p / 'um/Windows.h').is_file() and (kits / 'Lib' / p.name / 'um/x64/kernel32.lib').is_file())
    if not versions:
        raise ValueError('Windows SDK x64 headers/import libraries missing')
    linker = Path(linkers[-1])
    return {'msvc': linker.parts[-5], 'windows_sdk': versions[-1],
            'linker_sha256': digest(linker.read_bytes()),
            'compiler_sha256': digest(linker.with_name('cl.exe').read_bytes()),
            'sdk_header_sha256': digest((kits / 'Include' / versions[-1] / 'um/Windows.h').read_bytes()),
            'sdk_import_sha256': digest((kits / 'Lib' / versions[-1] / 'um/x64/kernel32.lib').read_bytes())}


def preflight(cache, native=False, root=ROOT):
    from windows_build_probe import probe_symlinks, release_profile
    info = metadata(root)
    base = json.loads(read_regular(root, 'src-tauri/tauri.conf.json'))
    windows = json.loads(read_regular(root, 'src-tauri/tauri.windows.conf.json'))
    if windows['bundle']['targets'] != ['nsis'] or windows['bundle']['windows']['webviewInstallMode']['type'] != 'skip':
        raise ValueError('Unreviewed Windows package/runtime selection')
    if base['bundle']['windows']['nsis']['installMode'] != 'currentUser' or not release_profile(root)['passed']:
        raise ValueError('Installer scope or release optimization changed')
    lock = json.loads(read_regular(root, 'frontend/package-lock.json'))['packages']
    if lock['node_modules/@tauri-apps/cli']['version'] != info['tauri_cli_version']:
        raise ValueError('Installer provenance does not match locked Tauri CLI')
    for relative, expected in info['retained_notices'].items():
        if digest(read_regular(root, 'assets/licenses/windows-installer/' + relative)) != expected:
            raise ValueError('Original installer license text changed')
    # Confirm corresponding installer source availability BEFORE runner dispatch.
    sources = {key: digest(checked_download(record, cache)) for key, record in info['sources'].items()}
    binaries = {key: digest(checked_download(info[key], cache)) for key in ('nsis_binary', 'tauri_plugin_binary')}
    result = {'format': 1, 'input_checks_passed': True, 'source_archive_hashes': sources,
              'installer_input_hashes': binaries,
              'native_windows_checked': native, 'release_profile': release_profile(root)}
    if native:
        result['native_identity'] = native_identity()
        if sys.version_info[:2] != (3, 13):
            raise ValueError('Windows release requires Python 3.13')
        rust = subprocess.check_output(['rustc', '-Vv'], text=True)
        if not rust.startswith('rustc 1.98.0 ') or 'host: x86_64-pc-windows-msvc' not in rust:
            raise ValueError('Windows release requires Rust 1.98.0')
        if not subprocess.check_output(['node', '--version'], text=True).startswith('v22.'):
            raise ValueError('Windows release requires Node 22')
        for tool in ['7z', 'llvm-objdump']:
            path = shutil.which(tool) or str(Path(os.environ['ProgramFiles']) / ('7-Zip/7z.exe' if tool == '7z' else 'LLVM/bin/llvm-objdump.exe'))
            if not Path(path).is_file():
                raise ValueError('Native Windows prerequisite missing: ' + tool)
        cache.mkdir(parents=True, exist_ok=True)
        result['symlinks'] = probe_symlinks(cache)
        if not result['symlinks']['passed']:
            raise ValueError('File and directory symlink privileges missing')
        import winreg
        runtimes = []
        for hive in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
            for prefix in ('SOFTWARE/Microsoft/EdgeUpdate/Clients', 'SOFTWARE/WOW6432Node/Microsoft/EdgeUpdate/Clients'):
                try:
                    with winreg.OpenKey(hive, prefix.replace('/', '\\')) as clients:
                        for index in range(winreg.QueryInfoKey(clients)[0]):
                            with winreg.OpenKey(clients, winreg.EnumKey(clients, index)) as client:
                                try:
                                    if 'WebView2' in winreg.QueryValueEx(client, 'name')[0]:
                                        runtimes.append(winreg.QueryValueEx(client, 'pv')[0])
                                except OSError:
                                    pass
                except OSError:
                    pass
        if not runtimes:
            raise ValueError('User-installed WebView2 runtime prerequisite missing')
        result['webview2_runtime'] = runtimes
        prepare_toolchain(cache, Path(os.environ['LOCALAPPDATA']) / 'tauri/NSIS', root)
    return result


def source_archive(output, cache, root=ROOT):
    if output.resolve().is_relative_to(root.resolve()):
        raise ValueError('Release source output must be outside checkout')
    info = metadata(root)
    with tempfile.TemporaryDirectory() as temporary:
        stage = Path(temporary)
        for key, record in info['sources'].items():
            (stage / (key + '-source.tar.gz')).write_bytes(checked_download(record, cache))
        (stage / 'SOURCE-ACCESS.json').write_text(json.dumps(info, indent=2)+'\n')
        (stage / 'README.txt').write_text('Exact Windows installer source companions. Extract each original upstream tar.gz. NSIS 3.13 includes the LZMA compression source under CPL-1.0 and its build instructions; plugins and graphics retain their original licenses. Tauri source includes the installer template. No library-replacement restriction is imposed by Chronoscope. Microsoft WebView2 runtime is a user-installed prerequisite and is not redistributed. See the matching application and locked registry source archives for application/static dependency sources.\n')
        with tarfile.open(output, 'w:xz', preset=1) as archive:
            archive.add(stage, arcname='chronoscope-windows-installer-sources')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['preflight', 'frontend', 'sources'])
    parser.add_argument('--native', action='store_true')
    parser.add_argument('--cache', type=Path, default=ROOT / '.local-build/windows-release-inputs/cache')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.action == 'sources':
        source_archive(args.output, args.cache)
    else:
        result = preflight(args.cache, args.native) if args.action == 'preflight' else frontend_inventory()
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2)+'\n')
        print('Windows release ' + args.action + ': passed')
