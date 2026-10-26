#!/usr/bin/env python3
"""Check release metadata or preview a version plan. Never edits or publishes."""
import argparse
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parent.parent
MANIFESTS = ['Cargo.toml', 'src-tauri/Cargo.toml', 'package.json',
             'frontend/package.json', 'src-tauri/tauri.conf.json']
VERSION = r'\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?'


def literal(block, key):
    values = re.findall(r'^'+re.escape(key)+r'\s*=\s*"([^"\r\n]+)"\s*(?:#.*)?$', block, re.M)
    if len(values) != 1:
        raise ValueError(f'Expected one literal {key} in package metadata')
    return values[0]


def package_version(path):
    text = path.read_text()
    package = re.search(r'^\[package\]\s*\n(.*?)(?=^\[|\Z)', text, re.M | re.S)
    if not package:
        raise ValueError(f'Missing [package]: {path}')
    return literal(package[1], 'version')


def check_metadata(root=ROOT, for_release=False):
    root = Path(root)
    versions = {}
    for name in MANIFESTS:
        path = root/name
        versions[name] = package_version(path) if path.suffix == '.toml' else json.loads(path.read_text())['version']
    lock = json.loads((root/'frontend/package-lock.json').read_text())
    versions['frontend/package-lock.json:version'] = lock['version']
    versions['frontend/package-lock.json:packages/root'] = lock['packages']['']['version']
    packages = (root/'Cargo.lock').read_text().split('[[package]]')[1:]
    for name in ['chronoscope', 'chronoscope-desktop']:
        matches = [literal(block, 'version') for block in packages if literal(block, 'name') == name]
        if len(matches) != 1:
            raise ValueError(f'Cargo.lock must contain one {name} package')
        versions['Cargo.lock:'+name] = matches[0]
    if len(set(versions.values())) != 1:
        raise ValueError('Version mismatch: '+json.dumps(versions, sort_keys=True))
    version = next(iter(versions.values()))
    if not isinstance(version, str) or not re.fullmatch(VERSION, version):
        raise ValueError('Invalid application version')
    changelog = (root/'CHANGELOG.md').read_text()
    if changelog.count('## Unreleased\n') != 1:
        raise ValueError('Changelog needs one Unreleased section')
    notes = changelog.split('## Unreleased\n', 1)[1].split('\n## ', 1)[0].strip()
    if for_release:
        if notes:
            raise ValueError('Move Unreleased changes into the new versioned release section before freezing a release')
        if not re.search(r'^## '+re.escape(version)+r'(?:\s|$)', changelog, re.M):
            raise ValueError('Changelog is missing notes for the candidate version')
    return {'version': version, 'versions': versions, 'unreleased_notes': notes,
            'release_candidate_notes_ready': not notes and bool(re.search(r'^## '+re.escape(version)+r'(?:\s|$)', changelog, re.M))}


def version_plan(metadata, version):
    if not re.fullmatch(VERSION, version) or version == metadata['version']:
        raise ValueError('Choose a valid new version instead of replacing the existing download version')
    return {'current_version': metadata['version'], 'proposed_version': version,
            'files_to_update': MANIFESTS+['Cargo.lock', 'frontend/package-lock.json'],
            'notes_to_move': metadata['unreleased_notes'], 'edits_performed': False,
            'publication_performed': False}



def check_frozen_revision(root, version, expected_sha):
    if not expected_sha or not re.fullmatch(r'[0-9a-f]{40}', expected_sha):
        raise ValueError('--for-release requires --expected-sha with the exact reviewed 40-character commit')
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
    if head != expected_sha or subprocess.check_output(['git', 'status', '--porcelain'], cwd=root):
        raise ValueError('Release source must be clean and match the reviewed commit')
    for tag in [f'refs/tags/v{version}', f'refs/tags/public/v{version}']:
        if subprocess.run(['git', 'show-ref', '--verify', '--quiet', tag], cwd=root).returncode == 0:
            raise ValueError('This version already has a local release tag; preserve it and choose a new version')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan-version', help='Print a proposed version/notes plan without changing files')
    parser.add_argument('--for-release', action='store_true', help='Require frozen versioned notes, a clean tree and a fresh local tag')
    parser.add_argument('--expected-sha', help='Required with --for-release: exact reviewed commit')
    args = parser.parse_args()
    try:
        if args.for_release and args.plan_version:
            raise ValueError('Planning and release acceptance are separate checks')
        metadata = check_metadata(for_release=args.for_release)
        if args.for_release:
            check_frozen_revision(ROOT, metadata['version'], args.expected_sha)
        print(json.dumps(version_plan(metadata, args.plan_version) if args.plan_version else metadata, indent=2))
        return 0
    except (OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        parser.exit(1, f'Release preflight: {error}\n')


if __name__ == '__main__':
    raise SystemExit(main())
