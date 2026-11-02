#!/usr/bin/env python3
"""Probe whether an extracted AppDir loads a locally modified WebKit library.

This is a narrow loader smoke test: it does not rebuild source, verify every
library, exercise a GUI, or establish legal/relinking compliance. The supplied
AppDir is never modified. The test copies into a new output directory.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


def digest(path):
    with path.open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def verify_tree(tree, inventory):
    expected = {x['path']: x for x in inventory['files']}
    seen = set()
    for base, dirs, files in os.walk(tree, followlinks=False):
        for name in dirs + files:
            p = Path(base) / name
            rel = p.relative_to(tree).as_posix()
            if p.is_dir() and not p.is_symlink():
                continue
            record = expected.get(rel)
            if record is None:
                raise ValueError('Uninventoried path: ' + rel)
            seen.add(rel)
            if p.is_symlink():
                target = os.readlink(p)
                if record['type'] != 'symlink' or record['target'] != target or os.path.isabs(target):
                    raise ValueError('Unsafe or changed symlink: ' + rel)
                resolved = (p.parent / target).resolve(strict=False)
                if not resolved.is_relative_to(tree.resolve()):
                    raise ValueError('Symlink escapes AppDir: ' + rel)
            elif not p.is_file() or record['type'] != 'file' or p.stat().st_size != record['bytes'] or digest(p) != record['sha256']:
                raise ValueError('Changed or special file: ' + rel)
    if seen != set(expected):
        raise ValueError('AppDir is missing inventoried entries')


def probe(inventory_file, output):
    inventory_file = inventory_file.resolve(strict=True)
    report = json.loads(inventory_file.read_text())
    image = Path(report['appimage']).resolve(strict=True)
    if digest(image) != report['appimage_sha256']:
        raise ValueError('AppImage no longer matches inventory')
    tree = inventory_file.parent / 'appdir'
    verify_tree(tree, report)
    if output.exists() or output.is_symlink():
        raise ValueError('Refusing existing output')
    output.mkdir(parents=True)
    copy = output / 'appdir'
    shutil.copytree(tree, copy, symlinks=True)
    verify_tree(copy, report)
    library = copy / 'usr/lib/libwebkit2gtk-4.1.so.0'
    if library.is_symlink() or not library.is_file():
        raise ValueError('Expected regular packaged WebKit library')
    marker = output / 'replacement-marker.bin'
    marker.write_bytes(b'chronoscope replacement probe; not a source rebuild\n')
    replacement = output / 'replacement.so'
    subprocess.run(['objcopy', '--add-section', '.chronoscope_replacement=' + str(marker.resolve()), str(library), str(replacement)], check=True)
    before, after = digest(library), digest(replacement)
    if before == after:
        raise ValueError('Probe replacement did not change bytes')
    os.replace(replacement, library)
    env = os.environ.copy()
    for name in ('XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'CHRONOSCOPE_DATA_DIR'):
        path = output.resolve() / name.lower()
        path.mkdir()
        env[name] = str(path)
    env['HOME'] = str((output / 'home').resolve())
    Path(env['HOME']).mkdir()
    env['APPDIR'] = str(copy.resolve())
    env['LD_DEBUG'] = 'libs'
    env.pop('LD_PRELOAD', None)
    env.pop('LD_LIBRARY_PATH', None)
    run = subprocess.run([str((copy / 'AppRun').resolve()), '--help'], cwd=output, env=env, capture_output=True, text=True, timeout=120)
    (output / 'stdout.log').write_text(run.stdout)
    (output / 'loader.log').write_text(run.stderr)
    loaded = any('calling init:' in line and str(library.resolve()) in line for line in run.stderr.splitlines())
    result = {'appimage_sha256': report['appimage_sha256'], 'library': str(library.resolve()),
              'original_sha256': before, 'modified_sha256': after, 'exit': run.returncode,
              'loader_observed_modified_library': loaded, 'release_clearance': False,
              'limitations': ['Marker-only modification, not a source rebuild.', 'CLI --help only, no GUI or functional WebKit test.', 'Does not establish complete replacement/relinking or license compliance.']}
    (output / 'replacement-result.json').write_text(json.dumps(result, indent=2) + '\n')
    if run.returncode != 0 or not loaded:
        raise ValueError('Modified library was not confirmed loaded during successful --help')
    return result


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--inventory', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    a = p.parse_args()
    try:
        print(json.dumps(probe(a.inventory, a.output), indent=2))
        return 0
    except (OSError, ValueError, subprocess.SubprocessError) as e:
        print('Replacement probe failed: ' + str(e), file=sys.stderr)
        return 1

if __name__ == '__main__':
    sys.exit(main())
