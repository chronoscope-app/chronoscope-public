#!/usr/bin/env python3
"""Build and stage the source-pinned AppImageKit AppRun launcher."""
import hashlib
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'third_party/appimage-apprun'
PINNED = {
    'AppRun.c': '79c8a946886f7966f8b3a54bb7e8f81c46828625552db7b33a8d6d28a03e4268',
    'LICENSE': '9cb22a08334c3a108ec4da96c1d6aea7a17a732fa9f5ca3413a9b4ce651397d8',
    'long-path.patch': '8610d47583e1186309f641f06a04101e7f104c3e6759073757af5bf5361c2b54',
}


def stage_launcher(appdir, source=SOURCE):
    appdir, source = Path(appdir), Path(source)
    wrapper, target = appdir / 'AppRun', appdir / 'AppRun.wrapped'
    if not wrapper.is_file() or wrapper.is_symlink() or 'AppRun.wrapped' not in wrapper.read_text():
        raise ValueError('Expected a linuxdeploy AppRun wrapper')
    if not target.is_file() or target.is_symlink():
        raise ValueError('Expected a regular AppRun.wrapped launcher')
    for name, expected in PINNED.items():
        path = source / name
        if path.is_symlink() or not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise ValueError(f'Pinned AppRun input differs: {name}')
    readme = source / 'README.md'
    if readme.is_symlink() or not readme.is_file():
        raise ValueError('AppRun rebuild instructions missing')
    compiler = shlex.split(os.environ.get('CC', 'cc'))
    if not compiler:
        raise ValueError('CC does not name a compiler')
    # Build in a temporary directory on the same filesystem; do not replace the
    # existing launcher unless verification, patching and compilation succeed.
    with tempfile.TemporaryDirectory(prefix='.apprun-', dir=appdir) as temporary:
        work = Path(temporary)
        (work / 'src').mkdir()
        shutil.copyfile(source / 'AppRun.c', work / 'src/AppRun.c')
        subprocess.run(['patch', '--batch', '--forward', '-p1', '-i', str((source / 'long-path.patch').resolve())],
                       cwd=work, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        built = work / 'AppRun.wrapped'
        subprocess.run([*compiler, '-O2', f'-ffile-prefix-map={work}=.',
                        str(work / 'src/AppRun.c'), '-o', str(built)], check=True)
        built.chmod(0o755)
        os.replace(built, target)
    docs = appdir / 'usr/share/doc/chronoscope-apprun'
    docs.mkdir(parents=True, exist_ok=True)
    for name in (*PINNED, 'README.md'):
        shutil.copyfile(source / name, docs / name)


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('appdir', type=Path)
    stage_launcher(parser.parse_args().appdir)
