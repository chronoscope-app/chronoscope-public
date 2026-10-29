"""Native WKWebView playback evidence through discovered public MCP tools."""
import argparse
import base64
import json
from pathlib import Path
import sys
import time
import statistics
import hashlib
import subprocess

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_mcp import NativeMcp

parser = argparse.ArgumentParser()
for name in ['cli', 'profile', 'dataset', 'output']:
    parser.add_argument('--' + name, type=Path, required=True)
parser.add_argument('--seconds', type=float, default=25)
parser.add_argument('--expect-position-reuse', action='store_true')
parser.add_argument('--controls-only', action='store_true', help='Check reverse seek, empty/full windows and small native bloom playback instead of timing cases')
args = parser.parse_args()
if not 0 < args.seconds <= 25:
    parser.error('--seconds must be between 0 and 25 for the bounded 30-second trace')
out = args.output.resolve()
out.mkdir(parents=True, exist_ok=True)
client = NativeMcp(args.cli.resolve(), args.profile.resolve(), out)
report = {'passed': False, 'runtime': 'native macOS WKWebView', 'cases': [],
          'source_commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
          'binary_sha256': hashlib.sha256(args.cli.read_bytes()).hexdigest(),
          'sampling': 'status only before/after timed playback; per-render bounded trace',
          'limitations': ['CPU submission excludes asynchronous GPU time; trace is not physical presentation timing.']}
def publish():
    (out / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
try:
    tools = client.rpc('tools/list', {})['tools']
    schemas = {t['name']: t['inputSchema'] for t in tools}
    (out / 'schemas.json').write_text(json.dumps(schemas, indent=2))
    for name in ['view_profile', 'view_playback', 'view_set', 'view_status', 'open']:
        assert 'chronoscope_' + name in schemas
    client.call('preferences', {'preferences': {'auto_save_unsaved': False,
                'basemap': 'none', 'map_layers': [], 'terrain_builtin': False,
                'terrain_path': None, 'theme': 'dark'}})
    client.call('open', {'path': str(args.dataset.resolve())})
    prefs = client.call('preferences')
    client.call('preferences', {'preferences': {**prefs, 'auto_save_unsaved': False,
                'basemap': 'none', 'map_layers': [], 'terrain_builtin': False,
                'terrain_path': None, 'theme': 'dark',
                'map': {**prefs['map'], 'enabled': False}}})
    time.sleep(.5)
    snapshot = client.call('snapshot', {'compact': True})
    report['dataset'] = snapshot
    lo, hi = snapshot['time_bounds']
    cases = [] if args.controls_only else [
        ('space-time', True, .1, False), ('space-time', True, .25, True),
        ('space-time', False, .25, True), ('map', True, .1, False),
    ]
    for mode, fade, fraction, bloom in cases:
        label = f'{mode}-fade-{fade}-window-{fraction}-bloom-{bloom}'
        client.call('view_playback', {'action': 'pause'})
        client.call('filter', {'filter': {'start': lo, 'end': lo + (hi - lo) * fraction}})
        client.call('view_set', {'mode': mode, 'fit': True, 'render_budget': 100000,
                    'playback_fade': fade, 'display': {'mode': 'points', 'show_tracks': True,
                    'show_trails': True, 'show_points': True, 'bloom': bloom, 'trail_pixels': 2}})
        client.call('view_wait', {'timeout_ms': 10000, 'imagery': False, 'terrain': False})
        client.call('view_playback', {'action': 'configure', 'speed': 2, 'increment_seconds': 3600})
        client.call('view_playback', {'action': 'play'})
        time.sleep(3)
        client.call('view_playback', {'action': 'pause'})
        before = client.call('view_status')
        assert before['mode'] == mode, before
        assert before['diagnostics']['terrain']['basemap'] == 'none', before
        assert not before['diagnostics']['terrain']['terrainActive'], before
        trace = client.call('view_profile', {'action': 'start', 'max_seconds': 30})
        started = time.monotonic()
        client.call('view_playback', {'action': 'play'})
        time.sleep(args.seconds)
        client.call('view_playback', {'action': 'pause'})
        elapsed = time.monotonic() - started
        trace = client.call('view_profile', {'action': 'stop', 'id': trace['id']})
        after = client.call('view_status')
        position_reuses = (after['diagnostics']['resourceReuse'].get('trackPositionReuses', 0)
                           - before['diagnostics']['resourceReuse'].get('trackPositionReuses', 0))
        if args.expect_position_reuse:
            assert position_reuses > 0, 'Native candidate did not exercise position sharing'
        intervals = [r[trace['columns'].index('frame_interval_ms')] for r in trace['samples'] if r[trace['columns'].index('frame_interval_ms')] > 0]
        stages = {}
        for name, sample in after['diagnostics'].get('trackCpuStages', {}).items():
            previous = before['diagnostics'].get('trackCpuStages', {}).get(name, {})
            calls = sample['calls'] - previous.get('calls', 0)
            total = sample['totalMs'] - previous.get('totalMs', 0)
            stages[name] = {'calls': calls, 'totalMs': total, 'meanMs': total / calls if calls else None}
        case = {'label': label, 'seconds': elapsed, 'before': before, 'after': after, 'trace': trace,
                'trackPositionReuses': position_reuses,
                'cpuStagesIncludingPauseSettlement': stages,
                'frameIntervalMedianMs': statistics.median(intervals) if intervals else None}
        report['cases'].append(case)
        publish()
        assert after['diagnostics']['renderErrorCount'] == 0, after
        assert len(trace['samples']) > 0, trace
        capture = client.rpc('tools/call', {'name': 'chronoscope_view_capture', 'arguments': {'target': 'app', 'window': 'main'}})
        if capture.get('isError'):
            case['captureError'] = capture
        else:
            image = next(c for c in capture['content'] if c['type'] == 'image')
            (out / (label + '.png')).write_bytes(base64.b64decode(image['data']))
        print(label, len(trace['samples']), trace['summary'], flush=True)
    if args.controls_only:
        report['controls'] = []
        def checked(label):
            state = client.call('view_status')
            assert state['diagnostics']['renderErrorCount'] == 0, state
            report['controls'].append({'label': label, 'status': state})
            publish()
            return state
        client.call('view_playback', {'action': 'pause'})
        client.call('filter', {'filter': {'start': lo, 'end': lo + (hi - lo) * .1}})
        client.call('view_set', {'mode': 'space-time', 'fit': True, 'render_budget': 100000,
                    'playback_fade': True, 'display': {'mode': 'points', 'show_tracks': True,
                    'show_trails': True, 'show_points': True, 'bloom': False}})
        for fraction in [.7, .2, .9]:
            target = lo + (hi - lo) * fraction
            seek = client.call('view_playback', {'action': 'seek', 'time': target})
            assert abs(seek['time'] - target) < .001, seek
            assert checked('seek-' + str(fraction))['diagnostics']['pointCount'] > 0
        client.call('view_set', {'time_height': 0})
        assert checked('zero-height')['diagnostics']['timeHeightMeters'] == 0
        client.call('view_set', {'time_height': 2.8, 'display': {'show_tracks': False, 'show_trails': False}})
        client.call('view_navigate', {'action': 'zoom', 'factor': 1.1})
        client.call('view_set', {'display': {'show_tracks': True, 'show_trails': True}})
        assert checked('hidden-camera-reentry')['diagnostics']['trackPolylines'] > 0
        client.call('filter', {'filter': {'search': 'native-qa-no-matching-events-20261028'}})
        empty = checked('empty-window')['diagnostics']
        assert empty['pointCount'] == 0 and empty['stemSegments'] == 0, empty
        client.call('filter', {'filter': {'start': lo, 'end': lo + 19 * 60,
                    'predicates': [{'field': 'entity', 'op': 'Equals', 'value': 'T000'}]}})
        client.call('view_set', {'fit': True, 'display': {'bloom': True}})
        client.call('view_wait', {'timeout_ms': 10000})
        before = checked('small-bloom-ready')
        assert before['diagnostics']['pointCount'] == 20, before
        client.call('view_playback', {'action': 'configure', 'speed': 1, 'increment_seconds': 60})
        trace = client.call('view_profile', {'action': 'start', 'max_seconds': 10})
        client.call('view_playback', {'action': 'play'})
        time.sleep(3)
        client.call('view_playback', {'action': 'pause'})
        trace = client.call('view_profile', {'action': 'stop', 'id': trace['id']})
        after = checked('small-bloom-paused')
        assert after['diagnostics']['resourceReuse']['playbackMarkerSmallRebuilds'] > before['diagnostics']['resourceReuse']['playbackMarkerSmallRebuilds']
        intervals = [row[1] for row in trace['samples'] if row[1] > 0]
        assert len(trace['samples']) >= 20 and statistics.median(intervals) < 180, trace
        report['small_bloom_trace'] = trace
        client.call('filter', {'filter': {}})
        client.call('view_set', {'mode': 'space-time', 'fit': True, 'display': {'bloom': False}})
        full = checked('full-100k')['diagnostics']
        assert full['pointCount'] == 100000 and full['stemSegments'] == 100000, full
    report['passed'] = True
except Exception as error:
    report['error'] = str(error)
    raise
finally:
    publish()
    client.close()
