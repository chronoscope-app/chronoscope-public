#!/usr/bin/env python3
"""Serial ABBA portable save/full-reopen probe; run under guarded_run.py.

Each run owns a disposable CLI profile. Input remains unchanged. Hashing is
outside timed operations; reopen uses normal full application validation.
"""
import argparse
from contextlib import closing
import hashlib
import json
from pathlib import Path
import queue
import sqlite3
import subprocess
import tempfile
import threading
import time


def payload_digest(path):
    digest = hashlib.sha256()
    with closing(sqlite3.connect(f'{path.resolve().as_uri()}?mode=ro', uri=True)) as db:
        for row in db.execute('SELECT r,id,payload FROM events ORDER BY r'):
            digest.update(json.dumps(row, separators=(',', ':')).encode())
            digest.update(b'\n')
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline', type=Path, required=True)
    parser.add_argument('--candidate', type=Path, required=True)
    parser.add_argument('--project', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--expected-count', type=int, default=1000000)
    parser.add_argument('--blocks', type=int, default=1, help='Number of ABBA blocks')
    parser.add_argument('--open-only', action='store_true', help='Reopen the immutable input without saving')
    args = parser.parse_args()
    if args.blocks < 1:
        parser.error('--blocks must be positive')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    result = {'project': str(args.project.resolve()), 'input_bytes': args.project.stat().st_size,
              'payload_sha256': payload_digest(args.project), 'open_only': args.open_only,
              'blocks': args.blocks, 'runs': []}
    for variant in ('baseline', 'candidate', 'candidate', 'baseline') * args.blocks:
        binary = getattr(args, variant).resolve()
        with tempfile.TemporaryDirectory(prefix='project-io-', dir=args.output.parent) as profile:
            run = {'variant': variant, 'binary': str(binary),
                   'binary_sha256': hashlib.sha256(binary.read_bytes()).hexdigest()}
            with args.output.with_suffix('.stderr.log').open('a') as stderr:
                process = subprocess.Popen([str(binary), '--data-dir', profile, 'session'],
                    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=stderr, text=True)
                incoming = queue.Queue()

                def read():
                    for line in process.stdout:
                        incoming.put(line)
                    incoming.put(None)
                reader = threading.Thread(target=read, daemon=True)
                reader.start()
                sequence = 0

                def call(command, parameters=None):
                    nonlocal sequence
                    sequence += 1
                    started = time.monotonic()
                    process.stdin.write(json.dumps({'id': sequence, 'command': command,
                                                    'args': parameters or {}}) + '\n')
                    process.stdin.flush()
                    line = incoming.get(timeout=240)
                    if line is None:
                        raise RuntimeError('CLI disconnected')
                    reply = json.loads(line)
                    if not reply.get('ok'):
                        raise RuntimeError(reply.get('error'))
                    return reply['result'], (time.monotonic() - started) * 1000

                try:
                    _, run['initial_open_ms'] = call('open', {'path': str(args.project.resolve())})
                    assert call('snapshot', {'compact': True})[0]['count'] == args.expected_count
                    sample_args = {'limit': 100, 'fields': ['id', 'entity', 'value']}
                    before = call('query', sample_args)[0]['events']
                    if args.open_only:
                        reopened = args.project.resolve()
                    else:
                        reopened = Path(profile) / 'saved.chronoscope'
                        reply, run['save_ms'] = call('save', {'path': str(reopened)})
                        assert reply['format'] == 'sqlite_v3'
                        run['saved_bytes'] = reopened.stat().st_size
                    _, run['reopen_ms'] = call('open', {'path': str(reopened)})
                    assert call('snapshot', {'compact': True})[0]['count'] == args.expected_count
                    assert call('query', sample_args)[0]['events'] == before
                    if not args.open_only:
                        run['payload_sha256'] = payload_digest(reopened)
                        assert run['payload_sha256'] == result['payload_sha256']
                    run['passed'] = True
                finally:
                    process.stdin.close()
                    try:
                        process.wait(timeout=15)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=5)
                    reader.join(timeout=5)
                    result['runs'].append(run)
                    args.output.write_text(json.dumps(result, indent=2) + '\n')
            print(json.dumps(run), flush=True)
    result['final_input_payload_sha256'] = payload_digest(args.project)
    assert result['final_input_payload_sha256'] == result['payload_sha256']
    args.output.write_text(json.dumps(result, indent=2) + '\n')


if __name__ == '__main__':
    main()
