"""One inventory for the maintained frontend release checks."""
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / 'scripts/validation-suites.json'


def load_suites():
    manifest = json.loads(MANIFEST.read_text())
    if manifest.get('version') != 1:
        raise ValueError('Unsupported validation manifest version')
    groups = manifest['groups']
    classified = [name for names in groups.values() for name in names]
    if len(classified) != len(set(classified)):
        raise ValueError('Each validation suite must run once')
    serial = manifest.get('serial_browser', [])
    if len(serial) != len(set(serial)) or not set(serial) <= set(groups['browser']):
        raise ValueError('Serial browser suites must each name one active browser suite')
    known = set(classified)
    for name in known:
        if Path(name).name != name or not (ROOT/'frontend/scripts'/name).is_file():
            raise ValueError(f'Invalid or missing suite: {name}')
    package = json.loads((ROOT/'frontend/package.json').read_text())
    advertised = set()
    for key, command in package['scripts'].items():
        if key == 'test':
            if command != 'node --test scripts/*-test.mjs':
                raise ValueError('npm test must discover the maintained frontend unit suites')
            targets = {p.name for p in (ROOT/'frontend/scripts').glob('*-test.mjs')}
            if targets != set(groups['unit']):
                raise ValueError('npm test discovery must match the unit suite inventory')
            advertised.update(targets)
        elif key.startswith('test:'):
            targets = re.findall(r'node scripts/([\w-]+\.mjs)', command)
            remainder = re.sub(r'node scripts/[\w-]+\.mjs', '', command).replace('&&', '').strip()
            if not targets or remainder:
                raise ValueError(f'Unrecognized npm test runner {key}: classify its command explicitly')
            advertised.update(targets)
    if 'test' not in package['scripts']:
        raise ValueError('npm test must run the frontend unit suites')
    discovered = {p.name for p in (ROOT/'frontend/scripts').glob('*.mjs')
                  if p.name.endswith(('-qa.mjs', '-test.mjs')) or p.name == 'qa.mjs'}
    missing = (advertised | discovered) - known
    if missing:
        raise ValueError(f'Unclassified validation suites: {sorted(missing)}. Update {MANIFEST.name}.')
    return manifest


if __name__ == '__main__':
    inventory = load_suites()
    print(json.dumps({group: len(names) for group, names in inventory['groups'].items()}, indent=2))
