#!/usr/bin/env python3
"""Run Chronoscope release checks locally; never dispatches CI or installs tools."""
import argparse
import datetime
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from threading import Lock
from validation_suites import load_suites

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--browser', action='store_true', help='Run every current offline Chromium regression in validation-suites.json.')
parser.add_argument('--browser-jobs', type=int, default=1, choices=range(1, 5), help='Independent browser workers; default 1 for reproducible software rendering.')
parser.add_argument('--performance', action='store_true', help='Also run the opt-in performance suites serially (requires --browser).')
parser.add_argument('--apple-local', action='store_true', help='Also run real Apple Intelligence suites on a ready Mac.')
parser.add_argument('--list', action='store_true', help='List suite groups and requirements without running checks.')
parser.add_argument('--native', action='store_true', help='Check/build Tauri using the current OS SDK; no packaging or trust-store changes.')
parser.add_argument('--chromium', help='Installed Chromium path; otherwise use CHRONOSCOPE_CHROMIUM or system chromium.')
parser.add_argument('--report', type=Path, default=ROOT/'.qa/local-validation/report.json')
args = parser.parse_args()
try:
    inventory = load_suites()
except (ValueError, KeyError) as error:
    parser.error(str(error))
if args.list:
    print(json.dumps(inventory, indent=2))
    sys.exit(0)
if args.performance and not args.browser:
    parser.error('--performance requires --browser')
if args.apple_local and sys.platform != 'darwin':
    parser.error('--apple-local requires macOS with a ready Apple Intelligence model')
report_path = args.report.resolve()
report_path.parent.mkdir(parents=True, exist_ok=True)
logs = report_path.parent/'logs'
logs.mkdir(exist_ok=True)
report = {'started_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'platform': sys.platform,
          'offline_browser_fixtures': True, 'github_runners_used': False, 'checks': [],
          'suite_manifest': str(ROOT/'scripts/validation-suites.json'), 'skipped': [],
          'limitations': ['Cesium WebGL2 is verified with software rendering; physical GPU and smartcard hardware are not verified by this script.',
                          'Native checks apply only to the current operating system.',
                          'The archived extension bridge is disabled; the WebMCP suite verifies absence of its commands and interface.',
                          'Signing, notarization and paid SI-provider evaluation are separate checks.']}
env = os.environ.copy()
report_lock = Lock()
env['CARGO_INCREMENTAL'] = '0'
# Release checks need assertions, not multi-gigabyte debug symbols per test
# executable. Use one consistent profile for Clippy, tests, CLI and child suites.
env.setdefault('CARGO_PROFILE_DEV_DEBUG', '0')
env.setdefault('CARGO_PROFILE_TEST_DEBUG', '0')
env['CHRONOSCOPE_QA_PUBLIC_WMTS'] = '0'
target_dir=Path(env.get('CARGO_TARGET_DIR',str(ROOT/'target')))
if not target_dir.is_absolute():target_dir=ROOT/target_dir
env['CHRONOSCOPE_CLI'] = str(target_dir/'debug'/('chronoscope.exe' if os.name=='nt' else 'chronoscope'))
chromium = args.chromium or env.get('CHRONOSCOPE_CHROMIUM') or shutil.which('chromium') or shutil.which('chromium-browser')
if chromium:
    env['CHRONOSCOPE_CHROMIUM'] = chromium
npm = shutil.which('npm')
node = shutil.which('node')
if not npm or not node:
    parser.error('Install Node/npm and run npm --prefix frontend ci first.')

def run(name, command, cwd=ROOT, extra=None):
    print(f'{name} ...', flush=True)
    start = time.monotonic()
    log = logs/f'{name}.log'
    step_env = {**env, **(extra or {})}
    # Windows npm.cmd requires cmd; arguments here are fixed local script names.
    command = list(command)
    if os.name == 'nt' and command[0].lower().endswith(('.cmd', '.bat')):
        command = ['cmd.exe', '/d', '/c', *command]
    try:
        with log.open('w') as output:
            process = subprocess.run(command, cwd=cwd, env=step_env, stdout=output, stderr=subprocess.STDOUT)
        code = process.returncode
    except OSError as error:
        log.write_text(str(error))
        code = 127
    with report_lock:
        report['checks'].append({'name': name, 'command': command, 'exit_code': code,
                                 'elapsed_s': round(time.monotonic()-start, 3), 'log': str(log)})
        report_path.write_text(json.dumps(report, indent=2)+'\n')
    print(f'  {"passed" if code == 0 else "FAILED"}: {log}', flush=True)
    return code == 0

ok = run('rust-format', ['cargo', 'fmt', '--all', '--check'])
# Static integrity/graph gate only; native optimized GLib regression is separate.
ok = run('glib-backport-integrity', [sys.executable, 'scripts/test_glib_backport.py']) and ok
ok = run('core-clippy', ['cargo', 'clippy', '--locked', '-p', 'chronoscope', '--all-targets', '--', '-D', 'warnings']) and ok
ok = run('rust-tests', ['cargo', 'test', '--locked', '-p', 'chronoscope']) and ok
built = run('cli-build', ['cargo', 'build', '--locked', '-p', 'chronoscope', '--bin', 'chronoscope'])
ok = built and ok
if built:
    ok = run('generated-contracts', [node, 'scripts/generate_contracts.mjs', '--check']) and ok
frontend = run('frontend-build', [npm, 'run', 'build'], ROOT/'frontend')
ok = frontend and ok
selected = {'unit'}
if args.browser and built and frontend:
    selected.add('browser')
if args.performance and built and frontend:
    selected.add('performance')
if args.apple_local and built and frontend:
    selected.add('apple')
for group, suites in inventory['groups'].items():
    if group not in selected:
        report['skipped'].extend({'suite': suite, 'reason': inventory['requirements'][group]} for suite in suites)
        continue
    if group == 'unit':
        ok = run('frontend-unit-tests', [npm, 'test'], ROOT/'frontend') and ok
        continue
    # Unique profiles keep recovery state and assets isolated between workers/runs.
    with tempfile.TemporaryDirectory(prefix=f'chronoscope-{group}-qa-') as data:
        def suite_check(suite):
            name = Path(suite).stem
            suite_dir = Path(data)/name
            suite_dir.mkdir(parents=True, exist_ok=True)
            extra = {'CHRONOSCOPE_QA_DATA_DIR': str(suite_dir),
                     'CHRONOSCOPE_GIS_DATA_DIR': str(suite_dir),
                     'CHRONOSCOPE_QA_OUT': str(report_path.parent/'artifacts'/name),
                     'CHRONOSCOPE_PERF_OUT': str(report_path.parent/'artifacts'/name),
                     'CHRONOSCOPE_QA_SCREENSHOTS': str(report_path.parent/'screenshots'/name)}
            return run(group+'-'+name, [node, 'scripts/'+suite], ROOT/'frontend', extra)
        workers = args.browser_jobs if group == 'browser' else 1
        serial = set(inventory.get('serial_browser', [])) if group == 'browser' else set()
        with ThreadPoolExecutor(max_workers=workers) as executor:
            results = list(executor.map(suite_check, [suite for suite in suites if suite not in serial]))
        # Wall-clock pacing and double-click windows must not compete with
        # another software-rendered browser from this gate.
        results.extend(suite_check(suite) for suite in suites if suite in serial)
        ok = all(results) and ok
if args.native:
    ok = run('native-clippy', ['cargo', 'clippy', '--locked', '-p', 'chronoscope-desktop', '--', '-D', 'warnings']) and ok
    native_built = run('native-build', ['cargo', 'build', '--locked', '-p', 'chronoscope-desktop'])
    ok = native_built and ok
    if native_built:
        ok = run('native-cli-smoke', [sys.executable, 'scripts/test_desktop_cli.py', '--binary', str(target_dir/'debug'/('chronoscope-desktop.exe' if os.name=='nt' else 'chronoscope-desktop'))]) and ok
report['finished_utc'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
report['passed'] = ok
report_path.write_text(json.dumps(report, indent=2)+'\n')
print(report_path)
sys.exit(0 if ok else 1)
