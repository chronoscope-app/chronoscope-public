#!/usr/bin/env python3
"""Bounded, optional CI acceleration. Never cache credentials or app packages."""
import argparse
import os
from pathlib import Path
import shutil

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

def prepare(destination, limit=LIMIT):
    destination = destination.resolve()
    if destination == ROOT or destination in ROOT.parents or any(destination == p.resolve() or destination in p.resolve().parents or p.resolve() in destination.parents for _, p in locations()):
        raise ValueError('Cache staging must be separate from source and dependency directories')
    if destination.exists(): shutil.rmtree(destination)
    destination.mkdir(parents=True)
    used = 0
    # Compiled dependencies are included together or omitted together. Cargo
    # still validates fingerprints; no cached application executable is staged.
    groups = locations()
    for group in [groups[4:], groups[:2], groups[3:4], groups[2:3]]:
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
