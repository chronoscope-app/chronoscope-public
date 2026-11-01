#!/usr/bin/env python3
"""Local backend phase probe for an existing synthetic portable workspace.

Run under scripts/guarded_run.py. Each run owns a disposable profile; the input
workspace stays unchanged. This measures CPU/RPC latency, not GPU or native FPS.
"""
import argparse
import hashlib
import json
from pathlib import Path
import queue
import subprocess
import tempfile
import threading
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', type=Path, required=True)
    parser.add_argument('--project', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--expected-count', type=int, default=1000000)
    parser.add_argument('--filter-phases', action='store_true',
                        help='Split six cold time-filter refreshes into summary, display and render phases')
    parser.add_argument('--spatial-probes', action='store_true',
                        help='Also compare broad, narrow, dateline and polar viewport packets and timings')
    parser.add_argument('--overview', action='store_true',
                        help='Measure overview requests without camera bounds, matching canonical UI refresh')
    parser.add_argument('--alternating-filters', action='store_true',
                        help='Repeat two adjacent time windows to check ordering-cache reuse')
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    samples = []
    with tempfile.TemporaryDirectory(prefix='refresh-probe-', dir=args.output.parent) as profile:
        with args.output.with_suffix('.stderr.log').open('w') as stderr:
            process = subprocess.Popen([str(args.binary.resolve()), '--data-dir', profile, 'session'],
                                       stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=stderr, text=True)
            incoming = queue.Queue()
            def read():
                for line in process.stdout:
                    incoming.put(line)
                incoming.put(None)
            threading.Thread(target=read, daemon=True).start()
            def call(command, parameters=None):
                started = time.monotonic()
                process.stdin.write(json.dumps({'id': len(samples) + 1, 'command': command, 'args': parameters or {}}) + '\n')
                process.stdin.flush()
                line = incoming.get(timeout=180)
                if line is None:
                    raise RuntimeError('Local CLI disconnected')
                reply = json.loads(line)
                if not reply.get('ok'):
                    raise RuntimeError(reply.get('error'))
                sample = {'command': command, 'ms': (time.monotonic() - started) * 1000, 'args': parameters or {}}
                result = reply['result']
                summary = result.get('snapshot', result)
                if 'histogram' in summary:
                    sample['summary'] = {key: summary.get(key) for key in (
                        'count', 'visible', 'entities', 'categories', 'histogram', 'layers', 'stats')}
                packets = {key: result[key] for key in ('display', 'render', 'geometries') if key in result}
                if command in ('display_data', 'render_data', 'render_geometries'):
                    packets = {command: result}
                if packets:
                    sample['packet_sha256'] = {
                        key: hashlib.sha256(json.dumps(
                            {k: v for k, v in packet.items() if k not in ('revision', 'cache_hit')},
                            sort_keys=True, separators=(',', ':')).encode()).hexdigest()
                        for key, packet in packets.items() if isinstance(packet, dict)
                    }
                samples.append(sample)
                print(json.dumps(sample), flush=True)
                return result
            try:
                call('open', {'path': str(args.project.resolve())})
                call('filter', {'filter': {}})
                call('view_set', {'mode': 'space-time', 'render_budget': 20000, 'display': {'mode': 'points', 'bloom': True, 'show_tracks': True, 'show_trails': True}})
                state = call('snapshot', {'compact': True})
                assert state['count'] == args.expected_count
                lo, hi = state['time_bounds']
                frame = {'version': 1, 'generation': 'probe', 'include_render': True,
                         'bounds': [-180, -90, 180, 90], 'max_points': 20000}
                if args.overview:
                    frame.pop('bounds')
                bounds_args = {'bounds': frame['bounds']} if 'bounds' in frame else {}
                if args.filter_phases:
                    assert call('view_snapshot_v1', frame)['snapshot']['count'] == args.expected_count
                else:
                    for _ in range(3):
                        call('snapshot', {'include_statistics': False})
                        call('render_data', {'max_points': 20000, **bounds_args})
                        call('render_geometries', bounds_args)
                        assert call('view_snapshot_v1', frame)['snapshot']['count'] == args.expected_count
                for step in range(6):
                    start = lo + step * (hi - lo) / 20
                    call('filter', {'filter': {'start': start, 'end': start + (hi - lo) / 4}})
                    if args.filter_phases:
                        snapshot = call('snapshot', {'include_statistics': False})
                        assert snapshot['count'] == args.expected_count
                        assert sum(snapshot['histogram']) == snapshot['visible']
                        call('display_data', {'level': 4, 'time_bin_minutes': 0, 'partition': 'all',
                                              'weight': 'count', 'max_cells': 4000, **bounds_args})
                        call('render_data', {'max_points': 20000, **bounds_args})
                        call('render_geometries', bounds_args)
                    assert call('view_snapshot_v1', frame)['snapshot']['count'] == args.expected_count
                if args.alternating_filters:
                    for step in [2, 3] * 4:
                        start = lo + step * (hi - lo) / 20
                        call('filter', {'filter': {'start': start, 'end': start + (hi - lo) / 4}})
                        assert call('view_snapshot_v1', frame)['snapshot']['count'] == args.expected_count
                if args.spatial_probes:
                    call('filter', {'filter': {}})
                    overview_frame = {key: value for key, value in frame.items() if key != 'bounds'}
                    # Normal UI flow warms the canonical overview before panning.
                    # Read it again afterward to expose ordering-cache regressions.
                    assert call('view_snapshot_v1', overview_frame)['snapshot']['count'] == args.expected_count
                    for bounds in ([-180, -90, 180, 90], [-125, 15, 10, 85],
                                   [-85, 30, -84, 31], [179, -90, -179, 90], [-180, 85, 180, 90]):
                        for _ in range(2):
                            call('render_data', {'max_points': 20000, 'bounds': bounds})
                            call('display_data', {'level': 4, 'time_bin_minutes': 0, 'partition': 'all',
                                                  'weight': 'count', 'max_cells': 4000, 'bounds': bounds})
                    assert call('view_snapshot_v1', overview_frame)['snapshot']['count'] == args.expected_count
            finally:
                args.output.write_text(json.dumps(samples, indent=2) + '\n')
                process.stdin.close()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)


if __name__ == '__main__':
    main()
