#!/usr/bin/env python3
"""Finish a self-contained Tauri AppImage, including WebKit's helper processes.
Run after `npm run bundle` on Linux. Supports ordinary SDKs and relocated SDKs.
No system installation or privilege changes are performed.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

from package_notices import stage_appdir_notices, verify_appdir, verify_notices

root = Path(__file__).resolve().parent.parent
p = argparse.ArgumentParser(description=__doc__)
product_name = json.loads((root/'src-tauri/tauri.conf.json').read_text())['productName']
p.add_argument('--appdir', type=Path, default=root/f'target/release/bundle/appimage/{product_name}.AppDir')
app_version = json.loads((root/'package.json').read_text())['version']
p.add_argument('--output', type=Path, default=root/f'target/release/bundle/appimage/{product_name}_{app_version}_amd64.AppImage')
p.add_argument('--webkit-dir', type=Path, help='Matching WebKitGTK 4.1 helper directory')
p.add_argument('--plugin', type=Path, default=Path.home()/'.cache/tauri/linuxdeploy-plugin-appimage.AppImage')
args = p.parse_args()
appdir = args.appdir.resolve()
# Fail before staging native files when frontend notices are missing or stale.
verify_notices(root/'frontend/dist/third-party', root)
if not (appdir/'usr/bin/chronoscope-desktop').is_file():
    raise SystemExit('Build the Tauri AppImage first; AppDir executable is missing.')
sysroot = Path(os.environ.get('PKG_CONFIG_SYSROOT_DIR', '/') or '/')
candidates = [args.webkit_dir] if args.webkit_dir else [
    sysroot/'usr/lib/x86_64-linux-gnu/webkit2gtk-4.1',
    sysroot/'usr/lib/webkit2gtk-4.1',
    sysroot/'usr/lib64/webkit2gtk-4.1',
]
helper = next((d for d in candidates if d and (d/'WebKitNetworkProcess').is_file()), None)
if helper is None:
    raise SystemExit('Matching WebKit helper directory not found; provide --webkit-dir.')
# Tauri rewrites /usr to ././ in bundled WebKit and AppRun uses usr as cwd.
# Place helpers in the matching library-directory suffix, without SDK prefixes.
parts = helper.parts
try:
    relative = Path(*parts[parts.index('usr')+1:])
except ValueError:
    raise SystemExit('WebKit directory must be under a usr/lib layout.')
shutil.copytree(helper, appdir/'usr'/relative, dirs_exist_ok=True)
# GLES is dlopened by WebKit, so dependency scanners may skip it.
for libdir in [helper.parent, sysroot/'usr/lib/x86_64-linux-gnu', sysroot/'usr/lib64', sysroot/'usr/lib']:
    gles = libdir/'libGLESv2.so.2'
    if gles.exists():
        shutil.copy2(gles.resolve(), appdir/'usr/lib/libGLESv2.so.2')
        break
else:
    raise SystemExit('libGLESv2.so.2 is required for the portable WebKit runtime.')
for package in ['libgles2', 'libwebkit2gtk-4.1-0', 'libjavascriptcoregtk-4.1-0']:
    source = sysroot/'usr/share/doc'/package
    if not (source/'copyright').is_file():
        raise SystemExit(f'Matching distro copyright missing: {source}/copyright')
    shutil.copytree(source, appdir/'usr/share/doc'/package, dirs_exist_ok=True)
# Relocated SDK paths must never remain runtime paths inside the package.
if sysroot != Path('/'):
    prefix = str(sysroot.resolve())
    staged = appdir/prefix.lstrip('/')
    if (staged/'usr').is_dir():
        shutil.copytree(staged/'usr', appdir/'usr', dirs_exist_ok=True)
        shutil.rmtree(staged)
    for file in (appdir/'apprun-hooks').glob('*.sh'):
        file.write_text(file.read_text().replace(prefix, ''))
    for file in (appdir/'usr').rglob('*.cache'):
        try:
            content = file.read_text()
        except UnicodeError:
            continue
        if prefix in content:
            file.write_text(content.replace(prefix, ''))
# Keep an accessible filesystem copy as well as Vite's embedded frontend copy.
# Inventory existing distro docs; hashes are not full native license clearance.
stage_appdir_notices(root, appdir)
verify_appdir(appdir)
if not args.plugin.is_file():
    raise SystemExit('Tauri AppImage packaging plugin not found; provide --plugin.')
output = args.output.resolve()
output.parent.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix='chronoscope-package-') as temporary:
    env = dict(os.environ, ARCH='x86_64', APPIMAGE_EXTRACT_AND_RUN='1')
    subprocess.run([str(args.plugin.resolve()), '--appimage-extract-and-run', '--appdir', str(appdir)], cwd=temporary, env=env, check=True)
    verify_appdir(appdir)
    products = list(Path(temporary).glob('*.AppImage'))
    if len(products) != 1:
        raise SystemExit('Expected exactly one AppImage product.')
    shutil.copy2(products[0], output)
    output.chmod(0o755)
print(output)
