#!/usr/bin/env python3
"""Fetch pinned build data and optional source/evidence archives; no runtime network."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import stat
import tempfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent.parent


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def safe_path(root, name):
    path = PurePosixPath(name)
    if (path.is_absolute() or str(path) != name or not name or
            any(p in {'', '.', '..'} for p in name.split('/')) or
            '\\' in name or ':' in name):
        raise ValueError('Unsafe asset path: ' + name)
    target = root
    for part in path.parts:
        target = target / part
        if target.is_symlink():
            raise ValueError('Asset symlink refused: ' + name)
    return target


def fetch(entry, target, opener=urllib.request.urlopen):
    if not entry['url'].startswith('https://'):
        raise ValueError('Asset downloads require HTTPS')
    if target.is_symlink():
        raise ValueError('Asset symlink refused')
    if target.exists() and target.is_file() and target.stat().st_size == entry['bytes'] and digest(target) == entry['sha256']:
        return target
    if target.exists():
        raise ValueError('Cached asset does not match pinned size or checksum; remove it and retry')
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=target.parent, prefix='.' + target.name + '.', delete=False) as out:
            temporary = Path(out.name)
            request = urllib.request.Request(entry['url'], headers={'User-Agent': 'Chronoscope-build-data/1'})
            h = hashlib.sha256()
            size = 0
            with opener(request, timeout=120) as response:
                for chunk in iter(lambda: response.read(1024 * 1024), b''):
                    size += len(chunk)
                    if size > entry['bytes']:
                        raise ValueError('Asset exceeds pinned size')
                    h.update(chunk)
                    out.write(chunk)
            if size != entry['bytes'] or h.hexdigest() != entry['sha256']:
                raise ValueError('Asset checksum or size mismatch')
            out.flush()
            os.fsync(out.fileno())
        os.replace(temporary, target)
        return target
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def restore(archive, root, kind):
    with zipfile.ZipFile(archive) as source:
        names = source.namelist()
        if len(names) != len(set(names)) or sum(i.file_size for i in source.infolist()) > 1_000_000_000:
            raise ValueError('Invalid or oversized data archive')
        selected = []
        for info in source.infolist():
            path = safe_path(root, info.filename)
            if info.is_dir() or stat.S_ISLNK(info.external_attr >> 16):
                raise ValueError('Archive directories or links refused')
            name = info.filename
            if kind == 'demo-source-inputs':
                include = name.startswith('samples/public/') and (name.endswith('.csv') or name.startswith('samples/public/source-snapshots/'))
            else:
                include = name.startswith(('docs/validation/', 'docs/performance/', 'docs/screenshots/')) and Path(name).suffix.lower() in {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp4', '.mov'}
            if include:
                data = source.read(info)
                if path.exists() and path.read_bytes() != data:
                    raise ValueError('Refusing to overwrite changed input: ' + name)
                selected.append((path, data))
        # Validate the entire archive before restoring any selected file.
        for path, data in selected:
            path.parent.mkdir(parents=True, exist_ok=True)
            if not path.exists():
                with path.open('xb') as stream:
                    stream.write(data)
        return len(selected)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sources', action='store_true', help='Restore optional demo CSVs and generator source snapshots')
    parser.add_argument('--validation-media', action='store_true', help='Restore archived validation images locally')
    args = parser.parse_args()
    manifest = json.loads((ROOT / 'assets/data-assets.json').read_text())
    terrain = manifest['terrain']
    fetch(terrain, safe_path(ROOT, terrain['path']))
    print('Verified pinned offline terrain: ' + terrain['sha256'])
    for flag, key in [(args.sources, 'demo-source-inputs'), (args.validation_media, 'validation-media')]:
        if flag:
            entry = manifest[key]
            name = entry['url'].rsplit('/', 1)[-1]
            archive = fetch(entry, safe_path(ROOT, '.local-build/data-assets/' + name))
            print(f'Restored {restore(archive, ROOT, key)} optional {key} files')


if __name__ == '__main__':
    main()
