"""Serial native test-thread comparison using already built, explicitly selected binaries.

Requires psutil in the developer's monitoring Python. Keeps the repository resource
guard, measures process-tree RSS and minimum system headroom, and stops only the
owned tree if headroom drops below the requested floor. It never rebuilds tests.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import statistics
import subprocess
import sys
import time

import psutil


def utc():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--binary', type=Path, action='append', required=True)
    parser.add_argument('--threads', nargs='+', type=int, default=[2, 4, 8])
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--min-free-gib', type=float, default=3.0)
    parser.add_argument('--timeout', type=float, default=300)
    args = parser.parse_args()
    if os.name != 'nt' or any(n < 1 or n > 32 for n in args.threads):
        parser.error('Use Windows and 1..32 threads')
    args.root = args.root.resolve()
    args.output.mkdir(parents=True, exist_ok=False)
    report = {'started_utc': utc(), 'source': subprocess.check_output(
        ['git', 'rev-parse', 'HEAD'], cwd=args.root, text=True).strip(),
        'cache': 'existing prebuilt native test executables; no compilation or OS-cache purge',
        'order': args.threads + list(reversed(args.threads)), 'binaries': [], 'runs': [],
        'min_free_gib_required': args.min_free_gib, 'passed': False}
    for binary in args.binary:
        binary = binary.resolve()
        report['binaries'].append({'path': str(binary), 'bytes': binary.stat().st_size,
                                   'sha256': hashlib.file_digest(binary.open('rb'), 'sha256').hexdigest()})

    def save():
        (args.output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')

    def run(binary, threads, label, flags):
        if psutil.virtual_memory().available < args.min_free_gib * 1024 ** 3:
            raise RuntimeError('Insufficient system memory headroom before benchmark')
        env = dict(os.environ, RUST_TEST_THREADS=str(threads))
        # This is a top-level guarded command. Do not inherit a nested guard token.
        env.pop('CHRONOSCOPE_RESOURCE_GUARD', None)
        command = [sys.executable, str(args.root / 'scripts/guarded_run.py'), '--',
                   str(binary), '--test-threads=' + str(threads), *flags]
        record = {'binary': str(binary), 'threads': threads, 'label': label,
                  'started_utc': utc(), 'peak_tree_rss': 0,
                  'minimum_available_bytes': psutil.virtual_memory().available}
        print('START', label, threads, binary.name, flush=True)
        started = time.perf_counter()
        log = args.output / (label + '.log')
        with log.open('w', encoding='utf-8') as stream:
            process = subprocess.Popen(command, cwd=args.root, env=env, stdout=stream,
                                       stderr=subprocess.STDOUT,
                                       creationflags=subprocess.CREATE_NEW_PROCESS_GROUP)
            while process.poll() is None:
                memory = psutil.virtual_memory().available
                record['minimum_available_bytes'] = min(record['minimum_available_bytes'], memory)
                try:
                    root = psutil.Process(process.pid)
                    record['peak_tree_rss'] = max(record['peak_tree_rss'], sum(
                        child.memory_info().rss for child in [root, *root.children(recursive=True)]
                        if child.is_running()))
                except psutil.Error:
                    pass
                if memory < args.min_free_gib * 1024 ** 3 or time.perf_counter() - started > args.timeout:
                    record['stopped'] = 'memory headroom or timeout'
                    subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'],
                                   capture_output=True, check=False)
                time.sleep(0.1)
            record.update(exit_code=process.returncode, elapsed_seconds=time.perf_counter() - started,
                          finished_utc=utc(), log=str(log))
        text = log.read_text(errors='replace')
        result = re.search(r'test result: (\w+)\. (\d+) passed; (\d+) failed; (\d+) ignored;.*?finished in ([\d.]+)s', text)
        if result:
            record['test_result'] = {'status': result[1], 'passed': int(result[2]),
                                     'failed': int(result[3]), 'ignored': int(result[4]),
                                     'libtest_seconds': float(result[5])}
            record['outside_libtest_seconds'] = record['elapsed_seconds'] - float(result[5])
        report['runs'].append(record)
        save()
        print('FINISH', json.dumps(record), flush=True)
        if process.returncode or record.get('stopped'):
            raise RuntimeError('Benchmark failed; see retained log')
        return record

    try:
        for index, binary in enumerate(args.binary):
            run(binary.resolve(), 1, 'list-' + str(index), ['--list'])
        for iteration, threads in enumerate(report['order']):
            for index, binary in enumerate(args.binary):
                run(binary.resolve(), threads, 'round-' + str(iteration) + '-suite-' + str(index), [])
        report['thread_totals'] = {}
        for threads in args.threads:
            rounds = [sum(r['elapsed_seconds'] for r in report['runs']
                          if r['label'].startswith('round-' + str(i) + '-') and r['threads'] == threads)
                      for i, value in enumerate(report['order']) if value == threads]
            report['thread_totals'][str(threads)] = {'round_seconds': rounds,
                                                     'median_seconds': statistics.median(rounds)}
        for binary in args.binary:
            counts = [r['test_result']['passed'] for r in report['runs']
                      if r['binary'] == str(binary.resolve()) and r['label'].startswith('round-')]
            if len(set(counts)) != 1:
                raise RuntimeError('Test coverage changed between thread settings')
        report['passed'] = True
    finally:
        report['finished_utc'] = utc()
        save()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
