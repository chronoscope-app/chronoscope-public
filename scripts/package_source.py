#!/usr/bin/env python3
"""Archive only allowlisted Git-tracked working-tree files, never a filesystem walk.

Run from a reviewed checkout; tracked local modifications are included, untracked
files are not. This is an export boundary, not a secret or rights clearance.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import stat
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent
SKIP_PARTS = {'.git', 'target', 'node_modules', '.qa', '__pycache__', 'dist',
              'gen', '.hyperframes', '.media', 'renders'}
MANIFEST = 'SOURCE-MANIFEST.json'


def safe_name(name):
    path = PurePosixPath(name)
    if (not name or path.is_absolute() or str(path) != name or
            any(part in {'', '.', '..'} for part in name.split('/')) or
            chr(92) in name or ':' in name or any(ord(c) < 32 for c in name)):
        raise ValueError(f'Unsafe archive path: {name!r}')
    return path


def allowed(name):
    path = safe_name(name)
    return not (set(path.parts) & SKIP_PARTS or path.name == '.DS_Store' or
                (path.name.startswith('.env') and path.name != '.env.example'))


def read_regular(root, name):
    """Refuse links in every component; never dereference an export symlink."""
    path = root
    for part in safe_name(name).parts:
        path = path / part
        info = path.lstat()
        if stat.S_ISLNK(info.st_mode):
            raise ValueError(f'Symlink is not exportable: {name}')
    if not stat.S_ISREG(info.st_mode):
        raise ValueError(f'Not a regular file: {name}')
    # O_NOFOLLOW additionally protects the final component on supporting hosts.
    fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) |
                 getattr(os, 'O_NONBLOCK', 0))
    with os.fdopen(fd, 'rb') as source:
        if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
            raise ValueError(f'Not a regular file: {name}')
        return source.read()


def tracked_files(root):
    data = subprocess.check_output(['git', '-C', str(root), 'ls-files', '--stage', '-z'])
    files = {}
    folded = {MANIFEST.casefold()}
    for item in data.split(b'\0'):
        if not item:
            continue
        metadata, raw_name = item.split(b'\t', 1)
        mode, _object, stage = metadata.decode('ascii').split()
        name = raw_name.decode('utf-8', errors='strict')
        if not allowed(name):
            continue
        if stage != '0' or mode not in {'100644', '100755'}:
            raise ValueError(f'Unmerged, symlink or submodule entry: {name}')
        if name == MANIFEST or name.casefold() in folded:
            raise ValueError(f'Reserved or case-colliding archive path: {name}')
        folded.add(name.casefold())
        files[name] = mode
    if not files:
        raise ValueError('No tracked export files found')
    return sorted(files.items())


def verify_archive(path):
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if len(names) != len({name.casefold() for name in names}) or archive.testzip() is not None:
            raise ValueError('Source ZIP integrity or duplicate-entry failure')
        for name in names:
            safe_name(name)
            info = archive.getinfo(name)
            if not name.startswith('chronoscope/') or info.is_dir() or stat.S_ISLNK(info.external_attr >> 16):
                raise ValueError(f'Unsafe source ZIP member: {name}')
        manifest_name = 'chronoscope/' + MANIFEST
        manifest = json.loads(archive.read(manifest_name))
        if manifest.get('format') != 1 or manifest.get('algorithm') != 'SHA256':
            raise ValueError('Unsupported source manifest')
        if not manifest['files']:
            raise ValueError('Empty source file manifest')
        expected = {manifest_name}
        for entry in manifest['files']:
            if not allowed(entry['path']):
                raise ValueError(f'Excluded source ZIP path: {entry["path"]}')
            name = 'chronoscope/' + str(safe_name(entry['path']))
            if name in expected:
                raise ValueError('Duplicate source manifest entry')
            expected.add(name)
            info = archive.getinfo(name)
            if stat.S_ISLNK(info.external_attr >> 16):
                raise ValueError('Source archive contains a symlink')
            content = archive.read(name)
            if len(content) != entry['bytes'] or hashlib.sha256(content).hexdigest() != entry['sha256']:
                raise ValueError(f'Source hash mismatch: {name}')
        if set(names) != expected:
            raise ValueError('Source ZIP contains unmanifested or missing files')
    return manifest


def package_source(root, output):
    root = root.resolve()
    output = output.parent.resolve() / output.name
    # Never replace a checkout input (tracked or not), nor follow an output link.
    if output.is_relative_to(root) or output.is_symlink():
        raise ValueError('Source ZIP output must be outside the checkout and not a symlink')
    files = tracked_files(root)
    commit = subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip()
    manifest = {'format': 1, 'algorithm': 'SHA256', 'base_commit': commit,
                'content': 'Git-tracked working-tree files; local tracked edits may differ from base_commit',
                'files': []}
    with tempfile.NamedTemporaryFile(dir=output.parent, suffix='.zip', delete=False) as temporary:
        staged = Path(temporary.name)
    try:
        with zipfile.ZipFile(staged, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for name, mode in files:
                content = read_regular(root, name)
                info = zipfile.ZipInfo('chronoscope/' + name, date_time=(1980, 1, 1, 0, 0, 0))
                info.create_system = 3
                info.external_attr = (stat.S_IFREG | int(mode[-3:], 8)) << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(info, content)
                manifest['files'].append({'path': name, 'bytes': len(content),
                                          'sha256': hashlib.sha256(content).hexdigest()})
            archive.writestr('chronoscope/' + MANIFEST,
                             json.dumps(manifest, indent=2, sort_keys=True) + '\n')
        verify_archive(staged)
        staged.replace(output)
    finally:
        staged.unlink(missing_ok=True)
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT.parent / 'chronoscope-source.zip')
    parser.add_argument('--check', type=Path, help='Verify an existing source ZIP only')
    args = parser.parse_args()
    if args.check:
        verify_archive(args.check)
        print(f'Verified source ZIP: {args.check}')
    else:
        print(package_source(ROOT, args.output))


if __name__ == '__main__':
    main()
