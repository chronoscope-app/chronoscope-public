"""Real Windows build capabilities; failures are reported, never skipped."""
import argparse
import json
import os
from pathlib import Path
import sys
import tempfile
import tomllib


def probe_symlinks(parent):
    try:
        with tempfile.TemporaryDirectory(prefix='symlink-capability-', dir=parent) as temporary:
            # MSIX can redirect logical LocalAppData paths. A native absolute
            # symlink must point at the physical target, not the virtual alias.
            root = Path(temporary).resolve()
            target = root / 'target'
            target.mkdir()
            (target / 'marker').write_bytes(b'fixture')
            directory = root / 'directory-link'
            directory.symlink_to(target, target_is_directory=True)
            file = root / 'file-link'
            file.symlink_to(target / 'marker')
            assert directory.is_symlink() and file.is_symlink()
            assert (directory / 'marker').read_bytes() == file.read_bytes() == b'fixture'
            directory.unlink()
            file.unlink()
            assert (target / 'marker').read_bytes() == b'fixture'
        return {'passed': True, 'file': True, 'directory': True}
    except (OSError, AssertionError) as error:
        return {'passed': False, 'error': str(error), 'winerror': getattr(error, 'winerror', None)}


def release_profile(root):
    profile = tomllib.loads((root / 'Cargo.toml').read_text())['profile']['release']
    return {'passed': profile.get('lto') == 'thin' and profile.get('codegen-units') == 1,
            'lto': profile.get('lto'), 'codegen_units': profile.get('codegen-units')}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--scratch', type=Path, required=True)
    args = parser.parse_args()
    args.scratch.mkdir(parents=True, exist_ok=True)
    result = {'windows': os.name == 'nt', 'python': sys.version.split()[0],
              'python_pinned_minor': sys.version_info[:2] == (3, 13),
              'symlinks': probe_symlinks(args.scratch), 'release_profile': release_profile(args.root)}
    result['ready'] = (result['windows'] and result['python_pinned_minor']
                       and result['symlinks']['passed'] and result['release_profile']['passed'])
    print(json.dumps(result))
    return 0 if result['ready'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
