#!/usr/bin/env python3
"""Keep generated data and validation captures outside the Git source tree."""
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent.parent


def external_asset(name):
    if name.startswith('assets/terrain/') and name.endswith('.cterrain'):
        return True
    if name.startswith('samples/public/source-snapshots/') and not name.endswith(('README.md', 'SHA256.json')):
        return True
    if name.startswith('samples/public/') and name.endswith('.csv') and name != 'samples/public/flights-philippines-week-2026.csv':
        return True
    if name.startswith('samples/') and name.endswith('.demo.zip'):
        return True
    return Path(name).suffix.lower() in {'.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4', '.mov'} and (name.startswith(('docs/validation/', 'docs/performance/')) or (name.startswith('docs/screenshots/') and not name.startswith('docs/screenshots/current/')))


def main():
    names = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode().split('\0')
    total = 0
    errors = []
    for name in filter(None, names):
        path = ROOT / name
        if path.is_symlink():
            errors.append('Tracked source symlink refused: ' + name)
        if external_asset(name):
            errors.append('External data/evidence must remain untracked: ' + name)
        if path.is_file():
            size = path.stat().st_size
            total += size
            if size > 8_000_000:
                errors.append('Tracked file exceeds 8 MB: ' + name)
    if total > 160_000_000:
        errors.append('Tracked source tree exceeds 160 MB')
    if errors:
        raise SystemExit('\n'.join(errors))
    print(f'Tracked source assets: {total:,} bytes (160 MB budget; 8 MB per file)')


if __name__ == '__main__':
    main()
