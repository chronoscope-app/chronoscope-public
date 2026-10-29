#!/usr/bin/env python3
"""Measure dataset opening and idle CPU in an isolated native macOS app.

Requires an unlocked display and an already-built Chronoscope.app. This launches
one private-profile instance, exercises three bundled demos, captures only its
app window, and terminates only the PID it launched. The process inventory uses
before/after snapshots; avoid launching other WebKit apps during the measurement.
Use --expect-idle-limit to validate idle, navigation and playback update cadence.
CPU accounting excludes processes that existed before the isolated app launched.
"""
import argparse, base64, json, os, signal, subprocess, sys, time, tempfile
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_mcp import NativeMcp

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--app', type=Path, required=True)
    p.add_argument('--label', required=True)
    p.add_argument('--expect-idle-limit', action='store_true')
    a = p.parse_args()
    assert a.label not in ('.', '..') and len(a.label) <= 80 and all((c.isalnum() or c in '._-' for c in a.label)), 'Invalid label'
    app = a.app.resolve()
    binary = app / 'Contents/MacOS/chronoscope-desktop'
    out = ROOT / '.qa/native-dataset-cpu' / a.label
    out.mkdir(parents=True, exist_ok=True)
    out = out.resolve()
    profile = Path(tempfile.mkdtemp(prefix='profile-', dir=out))

    def processes():
        rows = {}
        for line in subprocess.check_output(['/bin/ps', '-axo', 'pid=,ppid=,time=,comm='], text=True, timeout=5).splitlines():
            parts = line.split(None, 3)
            if len(parts) != 4:
                continue
            pid, parent, t, command = parts
            cpu = 0.0
            for part in t.split(':'):
                cpu = cpu * 60 + float(part)
            rows[int(pid)] = {'parent': int(parent), 'cpu': cpu, 'command': command}
        return rows
    before = processes()
    subprocess.run([str(binary), '--data-dir', str(profile), 'agent', 'enable'], capture_output=True, check=True)
    subprocess.run(['/usr/bin/open', '-n', '--env', 'CHRONOSCOPE_DATA_DIR=' + str(profile), str(app)], check=True)
    client = None
    pid = None
    report = {'passed': False, 'label': a.label, 'cases': [], 'source_revision': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(), 'runtime': 'native macOS WKWebView'}

    def publish():
        (out / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    try:
        for _ in range(50):
            current = processes()
            candidates = [p for p, v in current.items() if p not in before and v['command'] == str(binary)]
            if len(candidates) == 1:
                pid = candidates[0]
                break
            time.sleep(0.2)
        assert pid, 'Isolated app PID unavailable'
        client = NativeMcp(binary, profile, out)
        time.sleep(2)
        current = processes()
        owned = {pid}
        for p, v in current.items():
            if p not in before and ('WebKit' in v['command'] or v['parent'] == pid):
                owned.add(p)
        report['processes'] = {p: v['command'] for p, v in current.items() if p in owned}
        report['version'] = client.call('capabilities')['version']
        report['initial_preferences'] = client.call('preferences')
        client.call('preferences', {'preferences': {'auto_save_unsaved': False, 'basemap': 'none', 'map_layers': [], 'terrain_builtin': False, 'terrain_path': None, 'theme': 'system'}})
        for id in ['starlink-orbits', 'hurricanes', 'falcon9-launches']:
            c0 = processes()
            started = time.monotonic()
            client.call('demo_open', {'id': id})
            engine = time.monotonic() - started
            client.call('view_wait', {'timeout_ms': 10000, 'imagery': False, 'terrain': False})
            time.sleep(1)
            state = client.call('view_status')
            assert state['diagnostics']['renderErrorCount'] == 0, state
            c1 = processes()
            row = {'id': id, 'engineOpenMs': engine * 1000, 'settledOpenMs': (time.monotonic() - started) * 1000, 'openCpuMs': {str(p): (c1[p]['cpu'] - c0.get(p, {'cpu': 0})['cpu']) * 1000 for p in owned if p in c1}, 'before': state}
            trace = client.call('view_profile', {'action': 'start', 'max_seconds': 10})
            c2 = processes()
            idle = time.monotonic()
            time.sleep(5)
            c3 = processes()
            row['idleSeconds'] = time.monotonic() - idle
            row['idleCpuMs'] = {str(p): (c3[p]['cpu'] - c2.get(p, {'cpu': 0})['cpu']) * 1000 for p in owned if p in c3}
            row['trace'] = client.call('view_profile', {'action': 'stop', 'id': trace['id']})
            row['after'] = client.call('view_status')
            report['cases'].append(row)
            publish()
            if a.expect_idle_limit:
                assert row['after']['diagnostics']['performance']['updateRateLimitHz'] == 10, row['after']
                client.call('view_navigate', {'action': 'zoom', 'factor': 1.02})
                awake = client.call('view_status')
                assert awake['diagnostics']['performance']['updateRateLimitHz'] is None, awake
                client.call('view_playback', {'action': 'configure', 'speed': 1, 'increment_seconds': 60})
                client.call('view_playback', {'action': 'play'})
                time.sleep(1.2)
                playing = client.call('view_status')
                assert playing['diagnostics']['performance']['updateRateLimitHz'] is None, playing
                client.call('view_playback', {'action': 'pause'})
                time.sleep(2)
                paused = client.call('view_status')
                assert paused['diagnostics']['performance']['updateRateLimitHz'] == 10, paused
                assert paused['diagnostics']['renderErrorCount'] == 0, paused
                row['idle_navigation_playback_checks'] = True
            publish()
            print(json.dumps({k: row[k] for k in ['id', 'engineOpenMs', 'settledOpenMs', 'openCpuMs', 'idleSeconds', 'idleCpuMs']}), flush=True)
            if id == 'starlink-orbits':
                response = client.rpc('tools/call', {'name': 'chronoscope_view_capture', 'arguments': {'target': 'app', 'window': 'main'}})
                if not response.get('isError'):
                    content = next((c for c in response['content'] if c['type'] == 'image'))
                    (out / 'starlink-system-theme.png').write_bytes(base64.b64decode(content['data']))
        report['passed'] = True
    except Exception as e:
        report['error'] = str(e)
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
