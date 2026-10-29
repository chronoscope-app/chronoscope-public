#!/usr/bin/env python3
"""Check both altitude demos through a running native app's private MCP exchange.

Launch a disposable profile with script/build_and_run.sh first. This never
changes the user's normal workspace or broadens the agent's file scope.
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import subprocess
from native_mcp import NativeMcp

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cli', type=Path, default=ROOT/'target/debug/chronoscope')
    parser.add_argument('--data-dir', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=True)
    client = NativeMcp(args.cli.resolve(), args.data_dir.resolve(), out)
    report = dict(passed=False, runtime='macOS WKWebView', datasets=[],
                  source_commit=subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
                  cli_sha256=hashlib.sha256(args.cli.read_bytes()).hexdigest())

    def publish():
        (out/'report.json').write_text(json.dumps(report, indent=2)+'\n')

    try:
        report['app_version'] = client.call('capabilities')['version']
        prefs = client.call('preferences')
        client.call('preferences', {'preferences': {**prefs, 'auto_save_unsaved': False,
                    'basemap': 'none', 'map_layers': [], 'terrain_builtin': False,
                    'terrain_path': None, 'map': {**prefs['map'], 'enabled': False}}})
        for name, count, entities in [('flights-philippines-week-2026', 11018, 175),
                                      ('starlink-128-predicted-orbits-2024', 46208, 128)]:
            exchange = args.data_dir.resolve()/'agent-files'
            exchange.mkdir(exist_ok=True)
            dataset = exchange/(name+'.chronoscope')
            # Reuse the same immutable sample bytes; normal file scope still applies.
            dataset.write_bytes((ROOT/'samples'/dataset.name).read_bytes())
            client.call('open', {'path': str(dataset)})
            snapshot = client.call('snapshot', {'compact': False})
            assert len(snapshot['entities']) == entities
            client.call('view_wait', {'timeout_ms': 10000, 'imagery': False, 'terrain': False})
            state = client.call('view_status')
            diag = state['diagnostics']
            visible = 11648 if name.startswith('starlink') else count
            assert diag['pointCount'] == visible, (name, diag['pointCount'])
            assert diag['globeAltitude'] and not diag['globeTime']
            assert (diag['stemSegments'] == count if name.startswith('flights') else diag['stemSegments'] == 0) and diag['altitude']['known'] == visible
            assert diag['renderErrorCount'] == 0
            report['datasets'].append(dict(name=name, points=visible, records=count, entities=entities,
                                          altitude=diag['altitude'], graphics=diag.get('graphics'),
                                          stems=diag['stemSegments']))
            publish()
            for command in [{'globe_time': True}, {'globe_time': False}, {'globe_altitude': True}]:
                client.call('view_set', command)
                client.call('view_wait', {'timeout_ms': 10000, 'imagery': False, 'terrain': False})
                current = client.call('view_status')['diagnostics']
                assert not (current['globeTime'] and current['globeAltitude'])
            if name == 'starlink-128-predicted-orbits-2024':
                client.call('view_navigate', {'action': 'fit'})
                capture = client.rpc('tools/call', {'name': 'chronoscope_view_capture',
                                                   'arguments': {'target': 'app'}})
                pixels = next(item for item in capture['content'] if item['type'] == 'image')
                (out/'starlink-native.png').write_bytes(base64.b64decode(pixels['data']))
        tools = client.rpc('tools/list', {})['tools']
        reset_tool = next(tool for tool in tools if tool['name'] == 'chronoscope_view_reset')
        assert reset_tool['inputSchema']['properties']['confirm']['const'] is True
        assert not reset_tool['annotations']['readOnlyHint']
        def cli_view(*arguments):
            result = subprocess.run([str(args.cli.resolve()), '--data-dir', str(args.data_dir.resolve()),
                                     '--attach', 'view', *arguments], capture_output=True, text=True, timeout=30)
            assert result.returncode == 0, result.stderr
            client.call('view_wait', {'timeout_ms':10000,'imagery':False,'terrain':False})
            return client.call('view_status')
        for mode, time_on, altitude_on in [('time',True,False), ('ground',False,False), ('altitude',False,True)]:
            extra = ('--scale','2') if mode == 'time' else ()
            current = cli_view('height', mode, *extra)
            assert current['diagnostics']['globeTime'] is time_on
            assert current['diagnostics']['globeAltitude'] is altitude_on
            assert current['scene']['globe_time_scale'] == 2
        client.call('select', {'ids':['1']})
        before = client.call('view_status')
        for confirm in [None, False]:
            arguments = {} if confirm is None else {'confirm':confirm}
            try:
                client.call('view_reset', arguments)
            except RuntimeError as error:
                assert 'INVALID_ARGUMENT' in str(error), str(error)
            else:
                raise AssertionError('Unconfirmed MCP reset accepted')
        reset = client.call('view_reset', {'confirm':True})
        assert reset['reset'] is True
        assert reset['diagnostics']['contextRecoveries'] == before['diagnostics']['contextRecoveries'] + 1
        assert reset['diagnostics']['pointCount'] == 11648 and reset['diagnostics']['globeAltitude']
        after_cli = cli_view('reset','--confirm')
        assert after_cli['diagnostics']['contextRecoveries'] == reset['diagnostics']['contextRecoveries'] + 1
        assert after_cli['diagnostics']['pointCount'] == 11648 and after_cli['diagnostics']['renderErrorCount'] == 0
        assert client.call('snapshot', {'compact':False})['selected'] == ['1']
        for field in ['position','direction','up']:
            for a,b in zip(before['scene']['cesium_camera'][field],after_cli['scene']['cesium_camera'][field]):
                assert abs(a-b)<1e-8, field
        report['automation_controls'] = dict(cli_height_modes=['time','ground','altitude'], retained_scale=2,
                                           mcp_reset_confirmed=True,cli_reset_confirmed=True,
                                           unconfirmed_resets_rejected=True,selection_and_camera_preserved=True)
        report['passed'] = True
        print(json.dumps(report))
    finally:
        publish()
        client.close()


if __name__ == '__main__':
    main()
