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
    owners = [suite for feature in manifest['features'].values() for suite in feature['browser']]
    if len(owners) != len(set(owners)) or set(owners) != set(groups['browser']):
        raise ValueError('Every browser suite must have exactly one feature owner')
    if not set(manifest['smoke']) <= set(groups['browser']):
        raise ValueError('Smoke must reference active browser suites')
    for feature in manifest['features'].values():
        for target in feature['rust']:
            if Path(target).name != target or not (ROOT/'tests'/f'{target}.rs').is_file():
                raise ValueError(f'Unknown Rust target {target}')
    python = [name for names in manifest['python_suites'].values() for name in names]
    if len(python) != len(set(python)) or set(python) != {p.name for p in (ROOT/'scripts').glob('test_*.py')}:
        raise ValueError('Every Python test must have exactly one inventory group')
    for name in manifest['native_gui']:
        if Path(name).name != name or not (ROOT/'scripts'/name).is_file():
            raise ValueError(f'Unknown native GUI check {name}')
    return manifest


def select_browser(manifest, tier, browser, suites=(), features=()):
    selected = set()
    known = manifest['groups']['browser']
    if tier == 'full' and not suites and not features:
        selected.update(known)
    elif browser and not suites and not features:
        selected.update(manifest['smoke'])
    for suite in suites:
        normalized = suite if suite.endswith('.mjs') else suite.removesuffix('-qa') + '-qa.mjs'
        if normalized not in known:
            raise ValueError(f'Unknown browser suite: {suite}')
        selected.add(normalized)
    for feature in features:
        if feature not in manifest['features']:
            raise ValueError(f'Unknown feature: {feature}')
        selected.update(manifest['features'][feature]['browser'])
    return [suite for suite in known if suite in selected]


if __name__ == '__main__':
    inventory = load_suites()
    print(json.dumps({group: len(names) for group, names in inventory['groups'].items()}, indent=2))
