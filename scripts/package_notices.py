#!/usr/bin/env python3
"""Verify selected notices and stage them into an AppDir; never run a binary.

The hashes prove notice-payload integrity, not license completeness, native
source availability, or that a lockfile describes the final linked artifact.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import tempfile

from package_source import read_regular, safe_name

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = 'NOTICE-MANIFEST.json'
APP_NOTICES = 'usr/share/chronoscope/third-party'
NATIVE_MANIFEST = 'usr/share/chronoscope/NATIVE-NOTICE-MANIFEST.json'
REQUIRED_FILES = {
    'vendor/glib/LICENSE', 'vendor/glib/COPYRIGHT', 'vendor/glib/BACKPORT.md',
    'LICENSE', 'THIRD_PARTY.md', 'docs/DATA-ATTRIBUTION.md', 'docs/DISTRIBUTION.md',
    'assets/NOTICE.md', 'frontend/src/assets/egm96-15-NOTICE.txt',
    'assets/terrain/README.md',
    'samples/README.md', 'samples/public/SOURCES.md',
    'samples/public/demo-provenance.json', 'samples/public/wildlife-provenance.json',
    'docs/ALTITUDE-DEMOS.md', 'samples/public/altitude-provenance.json',
    'samples/public/flights-philippines-week-2026.csv.attribution.json',
    'docs/SPACE-DEMOS.md', 'samples/public/space-provenance.json',
    'samples/public/starlink-128-predicted-orbits-2024.csv.attribution.json',
    'samples/public/falcon9-launch-history-2010-2026.csv.attribution.json',
    'docs/NOAA-HURRICANE-DEMO.md', 'docs/REAL-WORLD-DEMOS.md', 'docs/WILDLIFE-DEMOS.md',
}
REQUIRED_TREES = ('assets/licenses', 'frontend/public/licenses')
OPTIONAL_FILES = ('NOTICE', 'NOTICE.md', 'docs/MEDIA-RIGHTS.json',
                  'samples/public/animal-gps-black-rock-forest-2023-03.csv.attribution.json',
                  'tests/fixtures/cesium/README.md', 'tests/fixtures/gis/README.md',
                  'tests/fixtures/terrain/README.md')
OPTIONAL_TREES = ('assets/provenance',)
NATIVE_COPYRIGHTS = tuple('usr/share/doc/' + package + '/copyright' for package in (
    'libgles2', 'libwebkit2gtk-4.1-0', 'libjavascriptcoregtk-4.1-0'))


def regular_files(root, name=''):
    """Inventory without following a symlink, including directory symlinks."""
    directory = root / name
    if directory.is_symlink():
        raise ValueError(f'Notice symlink refused: {name}')
    files = []
    for child in sorted(directory.iterdir()):
        relative = child.relative_to(root).as_posix()
        safe_name(relative)
        mode = child.lstat().st_mode
        if stat.S_ISLNK(mode):
            raise ValueError(f'Notice symlink refused: {relative}')
        if stat.S_ISDIR(mode):
            files.extend(regular_files(root, relative))
        elif stat.S_ISREG(mode):
            files.append(relative)
        else:
            raise ValueError(f'Non-regular notice: {relative}')
    return files


def verify_entries(root, manifest, actual, manifest_name):
    if manifest.get('format') != 1 or manifest.get('algorithm') != 'SHA256':
        raise ValueError('Unsupported notice manifest')
    expected = {manifest_name}
    folded = {manifest_name.casefold()}
    for entry in manifest['files']:
        name = str(safe_name(entry['path']))
        if name.casefold() in folded:
            raise ValueError(f'Duplicate notice manifest entry: {name}')
        folded.add(name.casefold())
        expected.add(name)
        content = read_regular(root, name)
        if len(content) != entry['bytes'] or hashlib.sha256(content).hexdigest() != entry['sha256']:
            raise ValueError(f'Notice hash mismatch: {name}')
    if set(actual) != expected:
        raise ValueError('Missing or unmanifested notice files')
    return expected


def verify_notices(directory, repository=None):
    directory = Path(directory).absolute()
    manifest = json.loads(read_regular(directory, MANIFEST))
    expected = verify_entries(directory, manifest, regular_files(directory), MANIFEST)
    if not REQUIRED_FILES <= expected:
        raise ValueError('Required notices missing: ' + ', '.join(sorted(REQUIRED_FILES - expected)))
    for tree in REQUIRED_TREES:
        if not any(name.startswith(tree + '/') for name in expected):
            raise ValueError(f'Required notice tree empty: {tree}')
    if repository is not None:
        # Additions matter too: an old manifest must not hide a newly supplied
        # root NOTICE or a new upstream license text in the reviewed selection.
        selected = set(REQUIRED_FILES)
        for tree in REQUIRED_TREES + OPTIONAL_TREES:
            path = repository / tree
            if tree in OPTIONAL_TREES and not (path.exists() or path.is_symlink()):
                continue
            selected.update(regular_files(repository, tree))
        for name in OPTIONAL_FILES:
            path = repository / name
            if path.exists() or path.is_symlink():
                selected.add(name)
        if expected - {MANIFEST} != selected:
            raise ValueError('Built notice file set differs from checkout; rebuild frontend')
        # Reject stale built notices after root/provenance documents change.
        for entry in manifest['files']:
            content = read_regular(repository, entry['path'])
            if hashlib.sha256(content).hexdigest() != entry['sha256']:
                raise ValueError(f'Built notice differs from checkout; rebuild frontend: {entry["path"]}')
    return manifest


def checked_directory(root, name):
    path = root
    if root.is_symlink() or not root.is_dir():
        raise ValueError(f'Not a regular AppDir directory: {root}')
    for part in safe_name(name).parts:
        path = path / part
        if path.is_symlink():
            raise ValueError(f'Notice output symlink refused: {path}')
        path.mkdir(exist_ok=True)
    return path


def appdir_notice_files(appdir):
    files = regular_files(appdir, APP_NOTICES)
    docdir = appdir / 'usr/share/doc'
    if docdir.exists() or docdir.is_symlink():
        files.extend(regular_files(appdir, 'usr/share/doc'))
    return sorted(files)


def verify_appdir(appdir):
    appdir = Path(appdir).absolute()
    verify_notices(appdir / APP_NOTICES)
    manifest = json.loads(read_regular(appdir, NATIVE_MANIFEST))
    actual = appdir_notice_files(appdir) + [NATIVE_MANIFEST]
    expected = verify_entries(appdir, manifest, actual, NATIVE_MANIFEST)
    if not set(NATIVE_COPYRIGHTS) <= expected:
        raise ValueError('Required WebKit/JSC/GLES distro copyrights missing')
    return manifest


def stage_appdir_notices(repository, appdir, notice_dir=None):
    repository, appdir = Path(repository).resolve(), Path(appdir).absolute()
    source = Path(notice_dir) if notice_dir is not None else repository / 'frontend/dist/third-party'
    verify_notices(source, repository)
    # Existing Linux packaging already supplies distribution documentation.
    # Preserve/inventory it; do not describe these notices as absent or complete.
    for name in NATIVE_COPYRIGHTS:
        read_regular(appdir, name)
    parent = checked_directory(appdir, 'usr/share/chronoscope')
    dest = parent / 'third-party'
    if dest.is_symlink() or (dest.exists() and not dest.is_dir()):
        raise ValueError('Refusing non-directory AppDir notice destination')
    with tempfile.TemporaryDirectory(prefix='.notice-stage-', dir=parent) as temporary:
        staged = Path(temporary) / 'third-party'
        shutil.copytree(source, staged)
        verify_notices(staged, repository)
        if dest.exists():
            shutil.rmtree(dest)
        staged.replace(dest)
    files = []
    for name in appdir_notice_files(appdir):
        content = read_regular(appdir, name)
        files.append({'path': name, 'bytes': len(content),
                      'sha256': hashlib.sha256(content).hexdigest()})
    manifest = {'format': 1, 'algorithm': 'SHA256',
                'scope': 'Selected app notices and existing distro documentation only; native source/relinking compliance requires release review',
                'files': files}
    output = parent / 'NATIVE-NOTICE-MANIFEST.json'
    if output.is_symlink():
        raise ValueError('Refusing native notice manifest symlink')
    # A temporary regular file prevents partial JSON on interrupted writes.
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=parent, delete=False) as temporary:
        staged_manifest = Path(temporary.name)
        json.dump(manifest, temporary, indent=2, sort_keys=True)
        temporary.write('\n')
    try:
        staged_manifest.replace(output)
    finally:
        staged_manifest.unlink(missing_ok=True)
    verify_appdir(appdir)
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument('--check', type=Path, help='Check a built/extracted third-party directory')
    modes.add_argument('--check-appdir', type=Path, help='Check staged notices and distro docs, no execution')
    modes.add_argument('--appdir', type=Path, help='Stage notices into an existing AppDir, no execution')
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--notice-dir', type=Path, help='Built third-party payload (default frontend/dist/third-party)')
    args = parser.parse_args()
    if args.check:
        result = verify_notices(args.check)
        print(f'Verified {len(result["files"])} notice files')
    elif args.check_appdir:
        result = verify_appdir(args.check_appdir)
        print(f'Verified {len(result["files"])} AppDir notice/doc files')
    else:
        print(stage_appdir_notices(args.root, args.appdir, args.notice_dir))


if __name__ == '__main__':
    main()
