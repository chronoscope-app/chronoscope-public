#!/usr/bin/env python3
"""Fast, focused and full local verification. Never dispatches hosted workflows."""
import argparse
import datetime
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import uuid
from threading import Lock
from validation_suites import load_suites, select_browser
from validation_runtime import run_command, sha256, build_receipt, matches_build_receipt
from source_checks import check_plan

ROOT = Path(__file__).resolve().parent.parent


def cli_build_config(target, release=False):
    profile = 'release' if release else 'debug'
    command = ['cargo', 'build', '--locked', '-p', 'chronoscope', '--bin', 'chronoscope']
    if release:
        command.append('--release')
    return profile, Path(target)/profile/('chronoscope.exe' if os.name == 'nt' else 'chronoscope'), command


def source_digest():
    import hashlib
    digest = hashlib.sha256()
    inputs = [ROOT/'Cargo.toml', ROOT/'Cargo.lock', ROOT/'build.rs',
              ROOT/'frontend/package-lock.json', ROOT/'frontend/package.json', ROOT/'frontend/vite.config.ts',
              ROOT/'frontend/tsconfig.json', ROOT/'frontend/index.html', ROOT/'frontend/scripts/prepare-cesium.mjs',
              ROOT/'assets/terrain/balanced.json']
    for folder in ['src', 'native', 'frontend/src', 'frontend/public/demos', 'frontend/scripts/patches']:
        inputs.extend(p for p in (ROOT/folder).rglob('*') if p.is_file())
    # Generated vendor assets follow package-lock.json; include other public
    # assets so edits to icons/licenses also invalidate the copied frontend.
    inputs.extend(p for p in (ROOT/'frontend/public').rglob('*')
                  if p.is_file() and p.relative_to(ROOT/'frontend/public').parts[0] not in {'cesium', 'third-party', 'demos'})
    for p in sorted(inputs):
        digest.update(str(p.relative_to(ROOT)).encode())
        digest.update(p.read_bytes())
    return digest.hexdigest()


def main():
    inventory = load_suites()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tier', choices=['fast', 'full'], default='fast')
    parser.add_argument('--browser', action='store_true', help='Fast tier: short smoke journey; full tier: all browser suites.')
    parser.add_argument('--suite', action='append', default=[], help='Run a browser suite by name; repeat to combine.')
    parser.add_argument('--feature', action='append', choices=sorted(inventory['features']), default=[], help='Run the owning browser suites and Rust test targets.')
    parser.add_argument('--rust-test', action='append', default=[], help='Explicit Rust integration target; repeat to combine.')
    parser.add_argument('--skip-build', action='store_true', help='Reuse only a matching local build receipt and artifact hashes.')
    parser.add_argument('--release-cli', action='store_true', help='Use the optimized release CLI for browser/oracle checks; native checks remain debug.')
    parser.add_argument('--browser-jobs', type=int, default=1, choices=range(1, 5))
    parser.add_argument('--timeout', type=int, default=420, help='Seconds per browser/Python suite; kills its process tree on expiry.')
    parser.add_argument('--performance', action='store_true', help='Opt-in resource-intensive browser benchmarks.')
    parser.add_argument('--packaging', action='store_true')
    parser.add_argument('--oracles', action='store_true', help='Independent Python numerical/protocol oracles; needs NumPy/SciPy/sklearn.')
    parser.add_argument('--native', action='store_true', help='Current-platform native compile/lint and headless CLI/MCP check.')
    parser.add_argument('--native-gui', action='store_true', help='Build/launch an isolated macOS app and run real terrain GUI checks.')
    parser.add_argument('--native-video', action='store_true', help='Include native MP4 navigation recordings and frame-by-frame analysis (requires PyAV).')
    parser.add_argument('--chromium')
    parser.add_argument('--list', action='store_true', help='Print inventory and feature owners without running anything.')
    parser.add_argument('--report', type=Path, default=ROOT/'.qa/local-validation/report.json')
    args = parser.parse_args()
    if args.timeout <= 0:
        parser.error('--timeout must be positive')
    args.native_gui = args.native_gui or args.native_video
    if args.native_video:
        import importlib.util
        if any(importlib.util.find_spec(name) is None for name in ['av', 'numpy', 'PIL']):
            parser.error('--native-video requires PyAV, NumPy and Pillow in the local QA Python environment')
    if args.native_gui and sys.platform != 'darwin':
        parser.error('--native-gui currently implements macOS only; see manual_checks for Linux capture')
    try:
        browsers = select_browser(inventory, args.tier, args.browser, args.suite, args.feature)
    except ValueError as error:
        parser.error(str(error))
    rust_targets = set(args.rust_test)
    for feature in args.feature:
        rust_targets.update(inventory['features'][feature]['rust'])
    if any(not (ROOT/'tests'/f'{name}.rs').is_file() or Path(name).name != name for name in rust_targets):
        parser.error('Unknown Rust integration test target')
    if args.list:
        print(json.dumps({'inventory': inventory, 'selected_browser': browsers, 'selected_rust': sorted(rust_targets)}, indent=2))
        return 0
    if args.oracles or args.tier == 'full':
        import importlib.util
        missing = [name for name in ['numpy', 'scipy', 'sklearn'] if importlib.util.find_spec(name) is None]
        if missing:
            parser.error('Independent oracles need NumPy/SciPy/scikit-learn. Use a local QA venv; missing: ' + ', '.join(missing))
    npm, node = shutil.which('npm'), shutil.which('node')
    if not npm or not node:
        parser.error('Node/npm and installed frontend dependencies are required')
    env = os.environ.copy()
    env['CHRONOSCOPE_QA_PUBLIC_WMTS'] = '0'
    env['CHRONOSCOPE_QA_FULL'] = '1' if args.tier == 'full' else '0'
    # Cargo.toml and .cargo/config.toml are shared with the Mac Run script.
    # Do not override debug/incremental settings here and trigger a second cache.
    target = Path(env.get('CARGO_TARGET_DIR', ROOT/'target')).resolve()
    cli_profile, cli, cli_command = cli_build_config(target, args.release_cli)
    env['CHRONOSCOPE_CLI'] = str(cli)
    env['CHRONOSCOPE_QA_RUST_PROFILE'] = cli_profile
    chromium = args.chromium or env.get('CHRONOSCOPE_CHROMIUM') or shutil.which('chromium') or shutil.which('chromium-browser')
    if chromium:
        env['CHRONOSCOPE_CHROMIUM'] = chromium
    run_id = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:8]
    destination = args.report.resolve()
    work = destination.parent/'runs'/run_id
    work.mkdir(parents=True)
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    env.update(CHRONOSCOPE_QA_RUN_ID=run_id, CHRONOSCOPE_QA_SOURCE_REVISION=revision)
    report = {'run_id': run_id, 'source_revision': revision, 'dirty': bool(subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT)),
              'cli_build_profile': cli_profile, 'native_build_profile': 'debug' if args.native or args.native_gui else None,
              'platform': sys.platform, 'tier': args.tier, 'started_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'test_infrastructure_sha256': {str(p.relative_to(ROOT)): sha256(p) for p in [
                  ROOT/'scripts/validate_local.py', ROOT/'scripts/validation_runtime.py',
                  ROOT/'scripts/validation_suites.py', ROOT/'scripts/validation-suites.json', ROOT/'scripts/source_checks.py',
                  ROOT/'frontend/scripts/qa-runtime.mjs', ROOT/'frontend/scripts/qa-config.mjs',
                  ROOT/'frontend/scripts/local-browser.mjs', ROOT/'frontend/scripts/workspace-qa-helpers.mjs']},
              'passed': False, 'github_runners_used': False, 'checks': [], 'unrun_browser_suites': sorted(set(inventory['groups']['browser']) - set(browsers)),
              'manual_checks_not_run': inventory['manual_checks'], 'evidence_directory': str(work),
              'limitations': ['Native results apply to this operating system only.', 'Browser launch metadata records Metal or SwiftShader; it does not certify GPU performance.',
                              'Paid model quality, smartcard hardware and downloaded-package acceptance are separate checks.']}

    def publish():
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(json.dumps(report, indent=2) + '\n')
        (work/'run.json').write_text(json.dumps(report, indent=2) + '\n')

    report_lock = Lock()

    def run(name, command, cwd=ROOT, extra=None, browser=False, timeout=None):
        print(name + ' ...', flush=True)
        evidence = work/'artifacts'/name
        profile = work/'profiles'/name
        evidence.mkdir(parents=True, exist_ok=True)
        profile.mkdir(parents=True, exist_ok=True)
        variables = {**env, 'CHRONOSCOPE_QA_DATA_DIR': str(profile), 'CHRONOSCOPE_GIS_DATA_DIR': str(profile),
                     'CHRONOSCOPE_QA_OUT': str(evidence), 'CHRONOSCOPE_PERF_OUT': str(evidence),
                     'CHRONOSCOPE_QA_SCREENSHOTS': str(evidence/'screenshots'), **(extra or {})}
        log = work/'logs'/f'{name}.log'
        result = run_command(command, cwd, variables, log, timeout or args.timeout)
        if browser and result['exit_code'] == 0:
            runtime = evidence/'runtime.json'
            try:
                metadata = json.loads(runtime.read_text())
                if metadata['run_id'] != run_id or metadata.get('exit_code') != 0:
                    raise ValueError('runtime receipt belongs to another run or did not complete')
                result['browser_launches'] = metadata['browser_launches']
            except (OSError, ValueError, KeyError) as error:
                result.update(exit_code=1, evidence_error=str(error))
        if browser:
            result['suite_sha256'] = sha256(ROOT/command[-1])
        with report_lock:
            report['checks'].append({'name': name, 'command': list(map(str, command)), 'log': str(log), **result})
            publish()
        print(('  passed: ' if result['exit_code'] == 0 else '  FAILED: ') + str(log), flush=True)
        return result['exit_code'] == 0

    plan = check_plan(inventory, rust_targets, args.tier == 'full')
    def source_check(check):
        return run(check['name'], check['command'], timeout=check['timeout'])

    ok = True
    try:
        for check in plan['unit']:
            if not source_check(check):
                return 1
        if not args.skip_build:
            for check in plan['prebuild']:
                ok = source_check(check) and ok
        focused = bool(args.suite or args.feature or args.rust_test)
        if not focused or rust_targets:
            ok = source_check(plan['rust'][0]) and ok
        receipt = ROOT/('.qa/local-build-receipt-release.json' if args.release_cli else '.qa/local-build-receipt.json')
        current = source_digest()
        if args.skip_build:
            built = matches_build_receipt(receipt, current, cli, ROOT/'frontend/dist', cli_profile)
            if not built:
                raise ValueError('--skip-build requires matching source and artifact receipts; run once without it')
        else:
            built = run('cli-build', cli_command, timeout=1800)
            frontend = run('frontend-build', [npm, '--prefix', 'frontend', 'run', 'build', '--', '--configLoader', 'runner'])
            built = frontend and built
            if built:
                receipt.parent.mkdir(exist_ok=True)
                receipt.write_text(json.dumps(build_receipt(current, cli, ROOT/'frontend/dist', cli_profile)))
        ok = built and ok
        if built:
            report['cli_sha256'] = sha256(cli)
            ok = source_check(plan['contracts'][0]) and ok
        ok = source_check(plan['frontend'][0]) and ok
        if built:
            # Timing-sensitive suites always run alone. Default all suites are serial.
            from concurrent.futures import ThreadPoolExecutor
            serial = set(inventory['serial_browser'])
            with ThreadPoolExecutor(max_workers=args.browser_jobs) as executor:
                jobs = list(executor.map(lambda suite: run(suite.removesuffix('.mjs'), [node, 'frontend/scripts/'+suite], browser=True), [s for s in browsers if s not in serial]))
            jobs += [run(s.removesuffix('.mjs'), [node, 'frontend/scripts/'+s], browser=True) for s in browsers if s in serial]
            ok = all(jobs) and ok
            if args.performance:
                for suite in inventory['groups']['performance']:
                    ok = run(suite.removesuffix('.mjs'), [node, 'frontend/scripts/'+suite], browser=True, timeout=max(args.timeout, 1800)) and ok
            for group, enabled in [('packaging', args.packaging or args.tier == 'full'), ('oracles', args.oracles or args.tier == 'full')]:
                if enabled:
                    if group == 'packaging':
                        for check in plan[group]:
                            ok = source_check(check) and ok
                    else:
                        for suite in inventory['python_suites'][group]:
                            ok = run(suite.removesuffix('.py'), [sys.executable, 'scripts/'+suite]) and ok
        if args.native or args.native_gui:
            ok = run('native-clippy', ['cargo', 'clippy', '--locked', '-p', 'chronoscope-desktop', '--', '-D', 'warnings'], timeout=1800) and ok
            native = run('native-build', ['cargo', 'build', '--locked', '-p', 'chronoscope-desktop'], timeout=1800)
            ok = native and ok
            if native:
                binary = target/'debug'/('chronoscope-desktop.exe' if os.name == 'nt' else 'chronoscope-desktop')
                ok = run('native-cli-smoke', [sys.executable, 'scripts/test_desktop_cli.py', '--binary', binary]) and ok
            if native and args.native_gui:
                profile = work/'native-profile'
                launch = run('native-bundle-launch', ['bash', 'script/build_and_run.sh', '--verify'], extra={'CHRONOSCOPE_DATA_DIR': str(profile)}, timeout=1800)
                ok = launch and ok
                if launch:
                    binary = target/'debug/bundle/macos/Chronoscope.app/Contents/MacOS/chronoscope-desktop'
                    ok = run('native-terrain-gui', [sys.executable, 'scripts/native_terrain_qa.py', '--cli', binary, '--data-dir', profile, '--output', work/'artifacts/native-terrain-gui']) and ok
                    ok = run('native-mcp-live-gui', [sys.executable, 'scripts/native_mcp_live_qa.py', '--cli', binary, '--data-dir', profile, '--output', work/'artifacts/native-mcp-live-gui']) and ok
                    if args.native_video:
                        ok = run('native-video-gui', [sys.executable, 'scripts/native_video_qa.py', '--cli', binary, '--data-dir', profile, '--output', work/'artifacts/native-video-gui'], timeout=max(args.timeout, 600)) and ok
        report['passed'] = ok
    except (ValueError, OSError) as error:
        report['error'] = str(error)
        ok = False
        print(error, file=sys.stderr)
    finally:
        report['finished_utc'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        publish()
    print(destination)
    return 0 if ok else 1


if __name__ == '__main__':
    from guarded_run import is_guarded, run_guarded
    if any(arg in sys.argv for arg in ['--list', '--help', '-h']) or is_guarded():
        raise SystemExit(main())
    raise SystemExit(run_guarded([sys.executable, str(Path(__file__).resolve()), *sys.argv[1:]]))
