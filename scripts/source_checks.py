#!/usr/bin/env python3
"""Shared local/manual-hosted source checks; never dispatches workflows."""
import argparse
import datetime
import subprocess
import uuid
import json
import os
from pathlib import Path
import sys
from validation_suites import load_suites
from validation_runtime import run_command

ROOT = Path(__file__).resolve().parent.parent


def check_plan(inventory, rust_targets=(), full=False):
    def check(name, command, timeout=420):
        return {'name': name, 'command': command, 'timeout': timeout}
    rust = ['cargo', 'test', '--locked', '-p', 'chronoscope']
    for name in sorted(set(rust_targets)):
        rust += ['--test', name]
    if full:
        rust += ['--', '--include-ignored']
    return {
        'unit': [check(s.removesuffix('.py'), [sys.executable, '-B', 'scripts/'+s])
                 for s in inventory['python_suites']['unit']],
        'prebuild': [
            check('rust-format', ['cargo', 'fmt', '--all', '--check']),
            *[check(s.removesuffix('.py'), [sys.executable, '-B', 'scripts/'+s])
              for s in inventory['python_suites']['integrity']],
            check('core-clippy', ['cargo', 'clippy', '--locked', '-p', 'chronoscope', '--all-targets', '--', '-D', 'warnings'], 1800),
        ],
        'rust': [check('rust-tests', rust, 1800)],
        'frontend': [check('frontend-unit-tests', ['npm', '--prefix', 'frontend', 'test'])],
        'contracts': [check('generated-contracts', ['node', 'scripts/generate_contracts.mjs', '--check'])],
        'packaging': [check(s.removesuffix('.py'), [sys.executable, '-B', 'scripts/'+s])
                      for s in inventory['python_suites']['packaging']],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--packaging', action='store_true')
    parser.add_argument('--contracts-only', action='store_true', help='Check against an already built exact CLI')
    parser.add_argument('--cli', type=Path)
    parser.add_argument('--list', action='store_true')
    parser.add_argument('--report', type=Path, default=ROOT/'.qa/source-checks/report.json')
    args = parser.parse_args()
    plan = check_plan(load_suites())
    groups = ['contracts'] if args.contracts_only else ['unit', 'prebuild', 'rust', 'frontend'] + (['packaging'] if args.packaging else [])
    checks = [check for group in groups for check in plan[group]]
    if args.list:
        print(json.dumps(checks, indent=2))
        return 0
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1')
    if args.cli:
        env['CHRONOSCOPE_CLI'] = str(args.cli.resolve())
    run_id = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+uuid.uuid4().hex[:8]
    result = {'passed': False, 'checks': [], 'github_actions': env.get('GITHUB_ACTIONS') == 'true',
              'run_id': run_id, 'source_revision': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
              'dirty': bool(subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT)),
              'started_utc': datetime.datetime.now(datetime.timezone.utc).isoformat()}
    destination = args.report.resolve()
    work = destination.parent/'runs'/run_id
    work.mkdir(parents=True)
    result['evidence_directory'] = str(work)
    # Never carry a success from a previous invocation into this run.
    destination.write_text(json.dumps(result, indent=2)+'\n')
    for check in checks:
        print(check['name']+' ...', flush=True)
        outcome = run_command(check['command'], ROOT, env,
                              work/'logs'/(check['name']+'.log'), check['timeout'])
        result['checks'].append({**check, **outcome})
        result['finished_utc'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        destination.write_text(json.dumps(result, indent=2)+'\n')
        if outcome['exit_code']:
            return 1
    result['passed'] = True
    destination.write_text(json.dumps(result, indent=2)+'\n')
    (work/'run.json').write_text(json.dumps(result, indent=2)+'\n')
    print(destination)
    return 0


if __name__ == '__main__':
    from guarded_run import run_guarded, is_guarded
    if is_guarded() or any(a in sys.argv for a in ['--help', '-h', '--list']):
        raise SystemExit(main())
    raise SystemExit(run_guarded([sys.executable, str(Path(__file__).resolve()), *sys.argv[1:]]))
