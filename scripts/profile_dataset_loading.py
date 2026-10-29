#!/usr/bin/env python3
"""Measure isolated demo-opening CPU/elapsed time; no windows or hosted runners.

Example: python3 scripts/guarded_run.py -- python3 scripts/profile_dataset_loading.py \
    --binary target/debug/chronoscope --label debug
CPU seconds accumulate across this process's threads; they are not GPU time or
an Activity Monitor CPU percentage. Repeated trials use fresh private profiles.
"""
import argparse
import hashlib
import json
from pathlib import Path
import queue
import subprocess
import sys
import tempfile
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
DEMOS = [('starlink-orbits', 46208), ('flight-altitude', 11018),
         ('hurricanes', 3568), ('falcon9-launches', 700)]


def cpu_seconds(pid):
    # macOS ps reports cumulative user+system CPU across process threads.
    text = subprocess.check_output(
        ['/bin/ps', '-p', str(pid), '-o', 'time='], text=True, timeout=5).strip()
    seconds = 0.0
    for component in text.split(':'):
        seconds = seconds * 60 + float(component)
    return seconds


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', type=Path, required=True)
    parser.add_argument('--label', required=True)
    parser.add_argument('--runs', type=int, default=2, choices=range(1, 6))
    parser.add_argument('--output', type=Path, default=ROOT/'.qa/dataset-loading/report.json')
    args = parser.parse_args()
    if sys.platform != 'darwin':
        parser.error('CPU accounting currently supports macOS only')
    binary = args.binary.resolve(strict=True)
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    report = dict(passed=False, label=args.label, binary=str(binary),
                  executable_sha256=hashlib.sha256(binary.read_bytes()).hexdigest(),
                  source_revision=subprocess.check_output(
                      ['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
                  cases=[], limitations=['Backend only; excludes WebKit, GPU and UI work.'])

    def publish():
        output.write_text(json.dumps(report, indent=2)+'\n')

    publish()
    try:
        for trial in range(args.runs):
            with tempfile.TemporaryDirectory(prefix='dataset-loading-', dir=output.parent) as directory:
                with tempfile.TemporaryFile(mode='w+') as error_log:
                    process = subprocess.Popen(
                        [str(binary), '--data-dir', directory, 'session'],
                        stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                        stderr=error_log, text=True)
                    incoming = queue.Queue()

                    def read(stream=process.stdout, destination=incoming):
                        for line in stream:
                            destination.put(line)
                        destination.put(None)

                    reader = threading.Thread(target=read, daemon=True)
                    reader.start()
                    sequence = 0

                    def call(command, arguments=None):
                        nonlocal sequence
                        sequence += 1
                        process.stdin.write(json.dumps(dict(
                            id=sequence, command=command, args=arguments or {}))+'\n')
                        process.stdin.flush()
                        line = incoming.get(timeout=90)
                        if line is None:
                            raise RuntimeError('CLI session disconnected')
                        response = json.loads(line)
                        if not response.get('ok'):
                            raise RuntimeError(response.get('error'))
                        return response['result']

                    try:
                        report['version'] = call('capabilities')['version']
                        for demo, count in DEMOS:
                            before = cpu_seconds(process.pid)
                            started = time.monotonic()
                            call('demo_open', {'id': demo})
                            elapsed = time.monotonic() - started
                            used = cpu_seconds(process.pid) - before
                            snapshot = call('snapshot', {'compact': True, 'include_statistics': False})
                            if snapshot['count'] != count:
                                raise RuntimeError(f'{demo}: unexpected source count')
                            row = dict(trial=trial, demo=demo, elapsed_ms=elapsed*1000,
                                       cpu_ms=used*1000, count=count, visible=snapshot['visible'])
                            report['cases'].append(row)
                            publish()
                            print(json.dumps(row), flush=True)
                    except Exception:
                        error_log.seek(0)
                        report['cli_stderr'] = error_log.read()[-4000:]
                        raise
                    finally:
                        process.stdin.close()
                        try:
                            process.wait(timeout=5)
                        except subprocess.TimeoutExpired:
                            process.kill()
                            process.wait(timeout=5)
                        reader.join(timeout=2)
                        process.stdout.close()
        report['passed'] = True
    finally:
        publish()


if __name__ == '__main__':
    sys.path.insert(0, str(ROOT/'scripts'))
    from guarded_run import is_guarded, run_guarded
    if any(arg in sys.argv for arg in ['--help', '-h']) or is_guarded():
        main()
    else:
        raise SystemExit(run_guarded([sys.executable, str(Path(__file__).resolve()), *sys.argv[1:]]))
