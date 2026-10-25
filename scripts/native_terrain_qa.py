#!/usr/bin/env python3
"""Local native terrain/portable-workspace smoke; use a disposable profile."""
import base64
import json
import os
from pathlib import Path
import shutil
import time

import argparse
parser = argparse.ArgumentParser(description="Verify real terrain in an already launched disposable macOS app through attached MCP.")
parser.add_argument('--cli', required=True, type=Path)
parser.add_argument('--data-dir', required=True, type=Path)
parser.add_argument('--output', required=True, type=Path)
args = parser.parse_args()
ROOT = Path(__file__).resolve().parents[1]
OUT = args.output.resolve()
OUT.mkdir(parents=True, exist_ok=True)
PROFILE = args.data_dir.resolve()
BIN = args.cli.resolve()
from native_mcp import NativeMcp
client = NativeMcp(BIN, PROFILE, OUT)
rpc, call = client.rpc, client.call
report = {'run_id': os.environ.get('CHRONOSCOPE_QA_RUN_ID'), 'passed': False, 'transport': 'stdio MCP attached to native macOS WebKit app', 'checks': [], 'scenes': []}

def save_report():
    (OUT / 'report.json').write_text(json.dumps(report, indent=2) + '\n')

def check(name):
    report['checks'].append(name)
    print('PASS', name, flush=True)
    save_report()

def idle_scene(label, mode, bounds):
    call('view_set', {'mode': mode, 'fit': True, **({'bounds': bounds} if bounds else {})})
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        before = call('view_status')
        time.sleep(1.3)
        after = call('view_status')
        delta = after['diagnostics']['performance']['renderedFrames'] - before['diagnostics']['performance']['renderedFrames']
        if before['mode'] == after['mode'] == mode and before['diagnostics']['terrain']['terrainActive'] and after['diagnostics']['terrain']['terrainActive'] and 0 <= delta <= 2:
            assert after['diagnostics']['renderErrorCount'] == 0, after
            report['scenes'].append({'label': label, 'idle_frames_1_3s': delta, 'status': after})
            result = rpc('tools/call', {'name': 'chronoscope_view_capture', 'arguments': {'target': 'app', 'window': 'main'}})
            assert not result.get('isError'), result
            (OUT / (label + '.png')).write_bytes(base64.b64decode(next(c['data'] for c in result['content'] if c['type'] == 'image')))
            check(label + ': active terrain, no render errors, settled native scene')
            return
    raise TimeoutError(label + ': scene never settled')

def navigate_scene(label):
    before = call('view_status')
    installed = before['diagnostics']['terrain']['terrainProviderChanges']
    tilt = 0 if before['mode'] == 'map' else 30
    results = []
    for arguments in [
        {'action': 'zoom', 'factor': 1.15},
        {'action': 'zoom', 'factor': 1 / 1.15},
        {'action': 'look_at', 'center': [87.3, 28.1, 5000], 'distance_m': 250000, 'tilt_degrees': tilt},
        {'action': 'look_at', 'center': [87, 28, 5000], 'distance_m': 200000, 'tilt_degrees': tilt},
    ]:
        result = call('view_navigate', arguments)
        time.sleep(.25)  # Include the throttled viewport terrain refresh.
        result = call('view_status')
        terrain = result['diagnostics']['terrain']
        assert terrain['terrainActive'], result
        assert terrain['terrainProviderChanges'] == installed, 'Native navigation discarded the terrain/imagery quadtree'
        assert result['diagnostics']['renderErrorCount'] == 0, result
        results.append({'action': arguments, 'terrain': terrain})
    report.setdefault('navigation', []).append({'label': label, 'samples': results})
    check(label + ': native pan/zoom retains terrain provider and imagery cache')

try:
    call('preferences', {'preferences': {'terrain_builtin': True, 'terrain_path': None, 'terrain_vertical_datum': 'egm96'}})
    info = call('terrain_info')
    assert info['tiles'][0]['width'] == 21600, info
    assert call('preferences')['terrain_builtin'] is True
    report['terrain_info'] = info
    check('Native packaged app discovers real Balanced terrain and EGM96 default')
    # Enter a real workspace before captures; the fresh-profile Welcome overlay
    # would otherwise cover the terrain even while the renderer reports success.
    call('demo_open', {'id': 'local-wildlife'})
    prefs = call('preferences')
    call('preferences', {'preferences': {**prefs, 'basemap': 'none', 'map_layers': [], 'map': {**prefs['map'], 'enabled': False}}})
    idle_scene('native-himalayas-globe', 'globe', [85, 27, 89, 29])
    navigate_scene('globe')
    idle_scene('native-himalayas-map', 'map', [85, 27, 89, 29])
    navigate_scene('map')
    idle_scene('native-himalayas-time', 'space-time', [85, 27, 89, 29])
    navigate_scene('space-time')
    idle_scene('native-antarctica', 'globe', [-15, -89.9, 15, -87])
    idle_scene('native-greenland', 'globe', [-50, 80, -30, 83])
    workspace = PROFILE / 'agent-files/native-balanced.chronoscope'
    call('save', {'path': str(workspace), 'overwrite': True})
    assert workspace.stat().st_size < 1024 * 1024
    call('terrain_unload')
    assert call('terrain_info') is None
    assert call('preferences')['terrain_builtin'] is False
    call('open', {'path': str(workspace)})
    assert call('preferences')['terrain_builtin'] is True
    assert call('terrain_info')['tiles'][0]['width'] == 21600
    report['workspace_bytes'] = workspace.stat().st_size
    check('Native unload and portable save/open retain built-in identity without copying world pack')
    fixture = PROFILE / 'agent-files/synthetic-n43.dt0'
    shutil.copy2(ROOT / 'tests/fixtures/terrain/synthetic-n43.dt0', fixture)
    call('terrain_load', {'path': str(fixture)})
    prefs = call('preferences')
    assert prefs['terrain_builtin'] is False
    assert prefs['terrain_vertical_datum'] == 'unresolved-msl'
    call('preferences', {'preferences': {**prefs, 'terrain_vertical_datum': 'egm96'}})
    idle_scene('native-custom-dted', 'globe', call('terrain_info')['bounds'])
    check('Native custom DTED replaces built-in terrain and requires explicit vertical datum')
    call('preferences', {'preferences': {'terrain_builtin': True, 'terrain_path': None, 'terrain_vertical_datum': 'egm96'}})
    call('demo_open', {'id': 'local-wildlife'})
    idle_scene('native-wildlife-time', 'space-time', None)
    report['passed'] = True
    save_report()
finally:
    client.close()
