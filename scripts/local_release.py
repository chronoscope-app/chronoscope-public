#!/usr/bin/env python3
"""Resumable native release build. Never pushes, uploads or dispatches runners."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import uuid

import build_portable
import ci_verification
from validation_runtime import prepare_command, run_command, sha256

ROOT = Path(__file__).resolve().parent.parent
TARGETS = {'darwin': 'macos-arm64', 'win32': 'windows-x86_64', 'linux': 'linux-x86_64'}


def utc():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def capture(command, environment):
    return subprocess.check_output(prepare_command(command, ROOT, environment), cwd=ROOT,
                                   env=environment, text=True).strip()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix+'.tmp')
    temporary.write_text(json.dumps(value, indent=2)+'\n')
    temporary.replace(path)


def file_hashes(paths):
    return {str(p.resolve()): sha256(p) for p in paths if p.is_file() and not p.is_symlink()}


def reusable(record, identity):
    if not record or record.get('identity') != identity or record.get('exit_code') != 0:
        return False
    try:
        return bool(record['outputs']) and all(not Path(p).is_symlink() and
                   Path(p).is_file() and sha256(p) == digest for p, digest in record['outputs'].items())
    except (OSError, KeyError):
        return False


def preflight(target, environment):
    if target != TARGETS.get(sys.platform):
        raise ValueError('Build on the native platform for the requested target')
    machine = capture(['rustc', '-vV'], environment)
    host = 'aarch64-apple-darwin' if target == 'macos-arm64' else 'x86_64-pc-windows-msvc' if target.startswith('windows') else 'x86_64-unknown-linux-gnu'
    if 'host: '+host not in machine:
        raise ValueError('Rust host architecture does not match the release target')
    versions = {name: capture(command, environment) for name, command in {
        'rust': ['rustc', '-Vv'], 'cargo': ['cargo', '-V'], 'node': ['node', '--version'],
        'npm': ['npm', '--version']}.items()}
    if not versions['rust'].startswith('rustc 1.98.') or not versions['node'].startswith('v22.'):
        raise ValueError('Prepared release environment requires Rust 1.98 and Node 22')
    if sys.version_info[:2] != (3, 13):
        raise ValueError('Prepared release environment requires Python 3.13')
    # Exercise the capabilities required by real rejection tests before any
    # expensive compilation. Do not skip security tests on a restricted host.
    (ROOT/'.qa').mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(dir=ROOT/'.qa', prefix='release-capability-') as temporary:
        base = Path(temporary); (base/'file').write_text('probe'); (base/'directory').mkdir()
        try:
            (base/'file-link').symlink_to(base/'file')
            (base/'directory-link').symlink_to(base/'directory', target_is_directory=True)
            if (base/'file-link').read_text() != 'probe' or not (base/'directory-link').is_dir():
                raise OSError('Symlink round trip failed')
        except OSError as error:
            raise ValueError('Release tests require working file and directory symlink privileges') from error
    if target.startswith('windows') and not (shutil.which('7z', path=environment.get('PATH')) or Path('C:/Program Files/7-Zip/7z.exe').is_file()):
        raise ValueError('7-Zip is required for actual installer payload validation')
    if target.startswith('linux'):
        versions['gtk_webkit'] = capture(['pkg-config', '--modversion', 'gtk+-3.0', 'webkit2gtk-4.1'], environment)
        versions['native_compiler'] = capture(['cc', '--version'], environment)
    if target.startswith('macos'):
        versions['sdk'] = capture(['xcrun', '--sdk', 'macosx', '--show-sdk-version'], environment)
        versions['xcode'] = capture(['xcodebuild', '-version'], environment)
        versions['swift'] = capture(['xcrun', 'swiftc', '--version'], environment)
    if environment.get('CARGO_TARGET_DIR') and Path(environment['CARGO_TARGET_DIR']).resolve() != (ROOT/'target').resolve():
        raise ValueError('CARGO_TARGET_DIR must match checkout target (a stable target symlink is supported)')
    if shutil.disk_usage(ROOT).free < 5*1024**3:
        raise ValueError('At least 5 GiB free space is required')
    return versions


def stash_stale_bundles(target, version, evidence, dry_run=False):
    kind, suffix = ('nsis', '.exe') if target.startswith('windows') else ('appimage', '.AppImage')
    if target.startswith('macos'):
        return []
    folder = ROOT/'target/release/bundle'/kind
    moved = []
    for path in folder.glob('*'+suffix):
        if version in path.name:
            continue
        if not path.name.startswith('Chronoscope_') or path.is_symlink():
            raise ValueError('Unexpected bundle output; preserve it and inspect before building')
        if dry_run:
            moved.append(str(path)); continue
        destination = evidence/'stale-bundles'/str(time.time_ns())/path.name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(path), destination)
        moved.append(str(destination))
    return moved


def bundle_hashes(target):
    release = ROOT/'target/release'
    if target.startswith('macos'):
        from package_tester import mac_app_inventory
        app = release/'bundle/macos/Chronoscope.app'
        return {'app_inventory': json.loads(json.dumps(mac_app_inventory(app)))}
    folder, suffix = ('nsis', '*.exe') if target.startswith('windows') else ('appimage', '*.AppImage')
    packages = list((release/'bundle'/folder).glob(suffix))
    if len(packages) != 1:
        raise ValueError('Exactly one actual native package is required')
    return file_hashes([*packages, release/('chronoscope-desktop.exe' if target.startswith('windows') else 'chronoscope-desktop')])


def cache_telemetry():
    result = {}
    for name in ['deps', 'build', '.fingerprint']:
        folder = ROOT/'target/release'/name
        paths = [p for p in folder.rglob('*') if p.is_file() and not p.is_symlink()]
        result[name] = {'files': len(paths), 'bytes': sum(p.stat().st_size for p in paths)}
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', required=True, choices=sorted(TARGETS.values()))
    parser.add_argument('--expected-sha', required=True)
    parser.add_argument('--output', type=Path, required=True, help='Dedicated package directory outside checkout')
    parser.add_argument('--evidence', type=Path, default=ROOT/'.qa/local-release')
    parser.add_argument('--preflight-only', action='store_true')
    parser.add_argument('--verify-only', action='store_true')
    args = parser.parse_args()
    environment = dict(os.environ, PLATFORM=args.target, CARGO_INCREMENTAL='0')
    if build_portable.configured_flags_required(environment, ['cargo', 'build']):
        raise ValueError('Review configured Cargo flags and set explicit effective flags before release')
    environment = build_portable.build_environment(environment)
    source = capture(['git', 'rev-parse', 'HEAD'], environment)
    if source != args.expected_sha or capture(['git', 'status', '--porcelain'], environment):
        raise ValueError('Release checkout must be clean and match --expected-sha')
    output = args.output.resolve(); evidence = args.evidence.resolve()/args.target
    if output.is_relative_to(ROOT) or args.output.is_symlink():
        raise ValueError('Package output must be outside checkout and not a symlink')
    evidence.mkdir(parents=True, exist_ok=True)
    versions = preflight(args.target, environment)
    # Fingerprints include effective compiler flags, all local Cargo configs,
    # SDK/native flags, tool versions and stable source/target paths.
    configs = [p/'.cargo'/name for p in [ROOT, *ROOT.parents] for name in ['config', 'config.toml']]
    configs += [Path(environment.get('CARGO_HOME', str(Path.home()/'.cargo')))/name for name in ['config', 'config.toml']]
    identity = {'source': source, 'platform': args.target, 'tools': versions, 'python': sys.version,
                'checkout': str(ROOT), 'target_directory': str((ROOT/'target').resolve()), 'configs': file_hashes(configs),
                'native_wrappers': file_hashes([Path(environment[k]) for k in ['PKG_CONFIG', 'CC', 'CXX'] if environment.get(k) and Path(environment[k]).is_file()]),
                'build_environment_hashes': {k: hashlib.sha256(v.encode()).hexdigest() for k, v in environment.items()
                    if k.startswith(('VITE_', 'CARGO_PROFILE_', 'CARGO_TARGET_', 'CMAKE_')) or k == 'NODE_ENV'},
                'environment': {k: environment.get(k, '') for k in ['CARGO_ENCODED_RUSTFLAGS', 'CARGO_TARGET_DIR',
                    'MACOSX_DEPLOYMENT_TARGET', 'SDKROOT', 'DEVELOPER_DIR', 'CC', 'CXX', 'CFLAGS', 'CXXFLAGS',
                    'PKG_CONFIG', 'PKG_CONFIG_PATH', 'PKG_CONFIG_SYSROOT_DIR', 'CARGO_BUILD_JOBS', 'RUST_TEST_THREADS']}}
    write_json(evidence/'preflight.json', identity)
    version = json.loads((ROOT/'src-tauri/tauri.conf.json').read_text())['version']
    stash_stale_bundles(args.target, version, evidence, dry_run=True)
    if args.preflight_only:
        print(evidence/'preflight.json'); return 0
    state_path = evidence/'state.json'
    try: old = json.loads(state_path.read_text())
    except (OSError, ValueError): old = {}
    if old.get('identity') != identity: old = {}
    if output.exists() and any(output.iterdir()) and not (old.get('output') == str(output)):
        raise ValueError('Refuse an existing package directory not owned by this exact release state')
    state = {'identity': identity, 'output': str(output), 'phases': dict(old.get('phases', {})),
             'started_utc': utc(), 'reused': [], 'passed': False, 'cache_before': cache_telemetry()}
    run = evidence/'runs'/(datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+uuid.uuid4().hex[:8])
    run.mkdir(parents=True); start = time.monotonic()
    def save():
        state['elapsed_seconds'] = time.monotonic()-start
        write_json(state_path, state); write_json(run/'run.json', state)
    def phase(name, command, timeout=1800, outputs=(), can_reuse=False):
        previous = state['phases'].get(name)
        if can_reuse and reusable(previous, identity):
            state['reused'].append(name); save(); print(name+' reused', flush=True); return
        record = {'identity': identity, 'command': command, 'started_utc': utc(), 'exit_code': None}
        state['phases'][name] = record; save(); print(name+' ...', flush=True)
        result = run_command(command, ROOT, environment, run/(name+'.log'), timeout)
        record.update(result, finished_utc=utc())
        paths = list(outputs)+[run/(name+'.log')]
        record['outputs'] = file_hashes(paths); save()
        if result['exit_code']:
            raise RuntimeError(name+' failed; see '+str(run/(name+'.log')))
    save()
    state['stashed_bundles'] = stash_stale_bundles(args.target, version, evidence); save()
    lock_hash = hashlib.sha256((ROOT/'frontend/package-lock.json').read_bytes()).hexdigest()
    marker = ROOT/'frontend/node_modules/.chronoscope-release-lock'
    if not marker.exists() or marker.read_text() != lock_hash:
        phase('npm-install', ['npm', '--prefix', 'frontend', 'ci'], outputs=[ROOT/'frontend/package-lock.json'])
        marker.write_text(lock_hash)
    phase('cargo-fetch', ['cargo', 'fetch', '--locked'], can_reuse=True)
    source_report = evidence/'source-report.json'; contracts = evidence/'contracts-report.json'
    phase('source-checks', [sys.executable, '-B', 'scripts/source_checks.py', '--packaging', '--report', str(source_report)],
          timeout=7200, outputs=[source_report], can_reuse=True)
    # Tauri's build script validates physical notice resources even during
    # desktop lint. Fresh checkouts need the frontend before native compilation.
    dist = ROOT/'frontend/dist'
    try: frontend_ok = old.get('frontend') == ci_verification.hashes(dist)
    except (OSError, ValueError): frontend_ok = False
    if not frontend_ok: phase('frontend-build', ['npm', '--prefix', 'frontend', 'run', 'build', '--', '--configLoader', 'runner'])
    state['frontend'] = ci_verification.hashes(dist); save()
    phase('desktop-clippy', ['cargo', 'clippy', '--locked', '-p', 'chronoscope-desktop', '--', '-D', 'warnings'], can_reuse=True)
    phase('cli-release', ['cargo', 'build', '--locked', '--release', '--timings', '-p', 'chronoscope', '--bin', 'chronoscope'])
    cli = ROOT/'target/release'/('chronoscope.exe' if args.target.startswith('windows') else 'chronoscope')
    phase('contracts', [sys.executable, '-B', 'scripts/source_checks.py', '--contracts-only', '--cli', str(cli), '--report', str(contracts)], outputs=[contracts])
    verified = evidence/'verified'; environment['CHRONOSCOPE_VERIFICATION_DIR'] = str(verified)
    phase('seal', [sys.executable, 'scripts/ci_verification.py', 'seal', '--source-report', str(source_report), '--contracts-report', str(contracts)])
    if args.verify_only:
        state.update(passed=True, finished_utc=utc(), verification_only=True); save(); return 0
    try: gui_ok = old.get('frontend') == state['frontend'] and old.get('bundle') == bundle_hashes(args.target) and reusable(old.get('phases', {}).get('gui-release'), identity)
    except (OSError, ValueError): gui_ok = False
    if not gui_ok:
        if args.target.startswith('macos'): command = ['bash', 'script/build_and_run.sh', '--build-only']
        else:
            hook = json.dumps({'build': {'beforeBuildCommand': 'python scripts/ci_verification.py verify-frontend'}})
            command = ['npm', '--prefix', 'frontend', 'run', 'tauri', '--', 'build', '--bundles', 'nsis' if args.target.startswith('windows') else 'appimage', '--config', hook, '--', '--locked', '--timings']
        phase('gui-release', command, timeout=5400)
        if args.target.startswith('linux'): phase('linux-runtime', [sys.executable, 'scripts/package_linux.py'])
    else: state['reused'].append('gui-release')
    state['bundle'] = bundle_hashes(args.target); save()
    previous = old.get('phases', {}).get('package')
    if old.get('output') == str(output) and old.get('bundle') == state['bundle'] and reusable(previous, identity):
        state['reused'].append('package')
    else:
        if output.exists() and any(output.iterdir()):
            if old.get('output') != str(output): raise ValueError('Refuse to overwrite unknown output')
            output.rename(output.with_name(output.name+'-preserved-'+str(time.time_ns())))
        phase('package', [sys.executable, 'scripts/package_tester.py', '--target', args.target, '--output', str(output)],
              outputs=[], timeout=1800)
        state['phases']['package']['outputs'].update(file_hashes(list(output.iterdir())))
    state.update(passed=True, finished_utc=utc(), cache_after=cache_telemetry()); save()
    print(json.dumps({'passed': True, 'output': str(output), 'state': str(state_path), 'reused': state['reused'], 'elapsed_seconds': state['elapsed_seconds']}))
    return 0


if __name__ == '__main__':
    from guarded_run import is_guarded, run_guarded
    if is_guarded() or any(arg in sys.argv for arg in ['--help', '-h']):
        raise SystemExit(main())
    raise SystemExit(run_guarded([sys.executable, str(Path(__file__).resolve()), *sys.argv[1:]]))
