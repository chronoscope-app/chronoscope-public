#!/usr/bin/env python3
"""Bounded, optional CI acceleration. Never cache credentials or app packages."""
import argparse
import os
from pathlib import Path
import shutil
import re
from collections import defaultdict

ROOT = Path(__file__).resolve().parent.parent
LIMIT = 2 * 1024**3

def locations():
    cargo = Path(os.environ.get('CARGO_HOME', str(Path.home()/'.cargo')))
    npm = Path(os.environ.get('npm_config_cache', str(Path.home()/'.npm')))
    return [('cargo-cache', cargo/'registry/cache'), ('cargo-index', cargo/'registry/index'),
            ('cargo-source', cargo/'registry/src'), ('npm', npm/'_cacache'),
            ('release-deps', ROOT/'target/release/deps'),
            ('release-build', ROOT/'target/release/build'),
            ('release-fingerprints', ROOT/'target/release/.fingerprint')]

def files(folder):
    if not folder.exists(): return []
    return [p for p in folder.rglob('*') if p.is_file() and not p.is_symlink()
            and not any(part.startswith(('chronoscope', 'libchronoscope')) for part in p.relative_to(folder).parts)]

def compiled_groups(locations):
    """Keep each crate's objects, build outputs and fingerprints together.

    Missing dependency groups are safe: Cargo validates its graph and rebuilds
    them. A large target directory must not discard every reusable small crate.
    """
    groups = defaultdict(list)
    for name, folder in locations:
        for path in files(folder):
            first = path.relative_to(folder).parts[0]
            stem = first[3:] if first.startswith('lib') and name == 'release-deps' else first
            match = re.match(r'(.+?)[-_][0-9a-f]{8,}(?:[.\-]|$)', stem)
            crate = (match[1] if match else stem.split('.')[0]).replace('-', '_')
            groups[crate].append((name, folder, path))
    # Recent crates first; deterministic ties. Never select a partial crate.
    return sorted(groups.items(), key=lambda item: (-max(p.stat().st_mtime_ns for _, _, p in item[1]), item[0]))

def prepare(destination, limit=LIMIT):
    destination = destination.resolve()
    if destination == ROOT or destination in ROOT.parents or any(destination == p.resolve() or destination in p.resolve().parents or p.resolve() in destination.parents for _, p in locations()):
        raise ValueError('Cache staging must be separate from source and dependency directories')
    if destination.exists(): shutil.rmtree(destination)
    destination.mkdir(parents=True)
    used = 0
    groups = locations()
    compiled = [p for p in groups if p[0].startswith('release-')]
    selected_crates = skipped_crates = 0
    for _, members in compiled_groups(compiled):
        size = sum(p.stat().st_size for _, _, p in members)
        if size + used > limit:
            skipped_crates += 1
            continue
        for name, folder, p in members:
            target = destination/name/p.relative_to(folder)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(p, target)
        used += size
        selected_crates += 1
    print(f'Compiled cache: {selected_crates} complete crate groups retained, {skipped_crates} skipped; {used} bytes')
    # Download groups are optional and lower priority than compiled objects.
    downloads = [p for p in groups if not p[0].startswith('release-')]
    for group in [[p] for p in downloads]:
        selected = [(name, folder, files(folder)) for name, folder in group]
        size = sum(p.stat().st_size for _, _, members in selected for p in members)
        if size + used > limit:
            print(f'Cache group skipped: {size} bytes exceeds remaining bounded capacity')
            continue
        for name, folder, members in selected:
            for p in members:
                target = destination/name/p.relative_to(folder)
                target.parent.mkdir(parents=True,exist_ok=True)
                shutil.copy2(p,target)
        used += size
    print(f'Prepared optional dependency cache: {used} bytes; cap {limit}')
    return used

def restore(source):
    if not source.exists(): return
    members = list(source.rglob('*'))
    if any(p.is_symlink() for p in members) or sum(p.stat().st_size for p in members if p.is_file()) > LIMIT:
        raise ValueError('Dependency cache exceeds cap or contains symlinks')
    targets=dict(locations())
    if any(p.name not in targets for p in source.iterdir()): raise ValueError('Unknown cache directory')
    for name, destination in targets.items():
        folder=source/name
        if folder.exists(): shutil.copytree(folder,destination,dirs_exist_ok=True)

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['prepare','restore'])
    parser.add_argument('--directory',type=Path,required=True)
    args=parser.parse_args()
    (prepare if args.action=='prepare' else restore)(args.directory)
