#!/usr/bin/env python3
"""Native light-marker and numeric playback-fade regression through app MCP.

Launches one isolated profile, imports 202 synthetic records in two concurrent
entities, captures near/far light-mode markers, and closes only that app PID.
MCP capture is independent of computer-use controls. --baseline captures the
appearance without requiring the numeric control in an older app. The normal
run verifies the installed CLI shortcut, recent history, pause/resume, longer
low fades and rejected invalid percentages. No normal workspace is opened.
"""
import argparse, base64, datetime, json, os, signal, subprocess, sys, tempfile, time
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_mcp import NativeMcp

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--app', type=Path, required=True)
    p.add_argument('--label', required=True)
    p.add_argument('--baseline', action='store_true')
    p.add_argument('--capture-only', action='store_true', help='Validate OS sampling and near/far captures without animation assertions')
    a = p.parse_args()
    assert a.label not in ('.', '..') and len(a.label) <= 80 and all((c.isalnum() or c in '._-' for c in a.label)), 'Invalid label'
    app = a.app.resolve()
    binary = app / 'Contents/MacOS/chronoscope-desktop'
    out = ROOT / '.qa/fade-native' / a.label
    out.mkdir(parents=True, exist_ok=True)
    profile = Path(tempfile.mkdtemp(prefix='profile-', dir=out)).resolve()

    def pids():
        result = set()
        for line in subprocess.check_output(['/bin/ps', '-axo', 'pid=,comm='], text=True).splitlines():
            parts = line.split(None, 1)
            if len(parts) == 2 and parts[1] == str(binary):
                result.add(int(parts[0]))
        return result
    before = pids()
    subprocess.run([str(binary), '--data-dir', str(profile), 'agent', 'enable'], capture_output=True, check=True)
    subprocess.run(['/usr/bin/open', '-n', '--env', 'CHRONOSCOPE_DATA_DIR=' + str(profile), str(app)], check=True)
    pid = None
    client = None
    report = {'passed': False, 'checks': [], 'baseline': a.baseline, 'capture_only': a.capture_only}

    def publish():
        (out / 'report.json').write_text(json.dumps(report, indent=2) + '\n')

    def check(name):
        report['checks'].append(name)
        publish()
        print('PASS', name, flush=True)
    try:
        for _ in range(50):
            new = pids() - before
            if len(new) == 1:
                pid = next(iter(new))
                break
            time.sleep(0.2)
        assert pid, 'QA app PID unavailable'
        client = NativeMcp(binary, profile, out)
        capabilities = client.call('capabilities')
        report['version'] = capabilities['version']
        report['frontend_readiness'] = []
        # Agent connection precedes the frontend listener. A read-only request
        # sent during startup can expire before the UI is ready; retry only
        # this readiness observation, never a navigation or playback mutation.
        for attempt in range(3):
            try:
                report['initial'] = client.call('view_status')
                report['frontend_readiness'].append({'attempt': attempt + 1, 'ready': True})
                break
            except RuntimeError as error:
                report['frontend_readiness'].append({'attempt': attempt + 1, 'ready': False, 'error': str(error)})
                publish()
                if 'UNAVAILABLE' not in str(error) or attempt == 2:
                    raise
                time.sleep(1)
        check('Native frontend ready before fixture changes')
        if 'system_resources' in capabilities['commands']:
            sample = client.call('system_resources')
            assert sample['supported'] and sample['total_bytes'] > 0, sample
            assert 0 <= sample['available_bytes'] <= sample['total_bytes'], sample
            governor = report['initial']['diagnostics']['resourceGovernor']
            assert governor['automatic'] and governor['memory']['supported'], governor
            report['system_resources'] = sample
            check('Native OS memory sample and automatic renderer diagnostics are available')
        client.call('preferences', {'preferences': {'theme': 'light', 'basemap': 'none', 'terrain_builtin': False, 'terrain_path': None, 'map_layers': [], 'auto_save_unsaved': False}})
        report['light_ready'] = client.call('view_status')
        exchange = profile / 'agent-files'
        exchange.mkdir(exist_ok=True)
        csv = exchange / 'fade-fixture.csv'
        base = datetime.datetime(2026, 10, 29, tzinfo=datetime.timezone.utc)
        rows = ['entity,timestamp,latitude,longitude,value']
        for i in range(101):
            for group in range(2):
                stamp = (base + datetime.timedelta(seconds=i)).isoformat()
                rows.append(f'Group {group},{stamp},{40 + (i % 10 - 5) * 0.05 + group * 0.015},{-74 + (i // 10 - 5) * 0.05},{i}')
        csv.write_text('\n'.join(rows) + '\n')
        ticket = client.call('import_preview', {'path': str(csv)})
        client.call('import_commit', {'import_id': ticket['import_id']})
        report['import_ready'] = client.call('view_status')
        client.call('view_set', {'mode': 'globe', 'globe_time': False, 'globe_altitude': False, 'display': {'mode': 'points', 'point_scale': 0.4, 'show_points': True, 'show_tracks': False, 'show_trails': False, 'bloom': False, 'spatial_culling': False}})

        def capture(name):
            response = client.rpc('tools/call', {'name': 'chronoscope_view_capture', 'arguments': {'target': 'app', 'window': 'main'}})
            assert not response.get('isError'), response
            content = next((c for c in response['content'] if c['type'] == 'image'))
            (out / (name + '.png')).write_bytes(base64.b64decode(content['data']))
        for name, distance in [('near', 300000), ('far', 15000000)]:
            client.call('view_navigate', {'action': 'look_at', 'center': [-74, 40, 0], 'distance_m': distance, 'heading_degrees': 0, 'tilt_degrees': 0})
            client.call('view_wait', {'timeout_ms': 10000, 'imagery': False, 'terrain': False})
            time.sleep(0.5)
            capture('light-' + name)
            status = client.call('view_status')
            assert status['diagnostics']['renderErrorCount'] == 0, status
            report[name] = status
            check('Light entities at ' + name + ' distance captured through app MCP')
        if not (a.baseline or a.capture_only):
            result = subprocess.run([str(binary), '--data-dir', str(profile), '--attach', 'view', 'fade', '100'], capture_output=True, text=True, timeout=30)
            assert result.returncode == 0, result.stderr
            state = client.call('view_playback', {'action': 'status'})
            assert state['fade_amount'] == 100, state
            client.call('view_playback', {'action': 'configure', 'speed': 1, 'increment_seconds': 1})
            client.call('view_playback', {'action': 'play'})
            time.sleep(2)
            client.call('view_playback', {'action': 'pause'})
            snap = client.call('snapshot', {'compact': True})
            status = client.call('view_status')
            report['maximum'] = {'snapshot': snap, 'status': status}
            assert snap['filter']['start'] is not None and snap['filter']['end'] is not None, 'Native playback did not advance in two seconds; a locked/occluded session may suspend animation. Playback is unverified.'
            width = snap['filter']['end'] - snap['filter']['start']
            assert abs(width - 2) < 0.01, (width, snap)
            assert 2 <= snap['visible'] <= 6, snap
            assert status['diagnostics']['pointCount'] == snap['visible'], status
            assert status['diagnostics']['fadeDurationsMs']['departure'] <= 121, status
            report['maximum'] = {'snapshot': snap, 'status': status}
            check('Maximum fade keeps only recent concurrent time slices; exact table agrees')
            client.call('view_playback', {'action': 'play'})
            time.sleep(1)
            client.call('view_playback', {'action': 'pause'})
            resumed = client.call('snapshot', {'compact': True})
            assert abs(resumed['filter']['end'] - resumed['filter']['start'] - 2) < 0.01, resumed
            check('Pause/resume preserves the history scale')
            client.call('view_playback', {'action': 'configure', 'fade_amount': 10})
            client.call('view_playback', {'action': 'play'})
            time.sleep(1)
            client.call('view_playback', {'action': 'pause'})
            slow = client.call('snapshot', {'compact': True})
            status = client.call('view_status')
            assert slow['visible'] > snap['visible'], slow
            assert status['diagnostics']['fadeDurationsMs']['departure'] > 3000, status
            report['low'] = {'snapshot': slow, 'status': status}
            check('Low fade retains more history and uses longer departure fades')
            saved = client.call('view_playback', {'action': 'status'})
            for value in [-1, 101, 1.5, 'high']:
                denied = client.rpc('tools/call', {'name': 'chronoscope_view_playback', 'arguments': {'action': 'configure', 'fade_amount': value}})
                assert denied.get('isError'), denied
            assert client.call('view_playback', {'action': 'status'})['fade_amount'] == saved['fade_amount']
            check('Invalid percentages leave the live setting unchanged')
        report['passed'] = True
    except Exception as error:
        report['error'] = str(error)
        raise
    finally:
        publish()
        if client:
            client.close()
        if pid:
            try:
                os.kill(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
if __name__ == '__main__':
    from guarded_run import is_guarded, run_guarded
    if any((arg in sys.argv for arg in ['--help', '-h'])) or is_guarded():
        main()
    else:
        raise SystemExit(run_guarded([sys.executable, str(Path(__file__).resolve()), *sys.argv[1:]]))
