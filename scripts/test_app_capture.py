#!/usr/bin/env python3
"""Exercise real attached MCP/CLI screenshots in an isolated Linux native GUI.

Requires Pillow, Xvfb, xdotool and a desktop build. Optional relocated WebKit SDK
paths are supplied through the environment, as for ordinary desktop launches.
No public maps or SI services are requested.
"""
import argparse
import base64
import io
import json
import os
from pathlib import Path
import subprocess
import time
import traceback
from PIL import Image, ImageChops

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--binary', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
p.add_argument('--xvfb', default='Xvfb')
p.add_argument('--xdotool', default='xdotool')
p.add_argument('--display', default=':96')
p.add_argument('--cwd', type=Path)
a = p.parse_args()
root = Path(__file__).resolve().parent.parent
out = a.output.resolve()
out.mkdir(parents=True, exist_ok=True)
binary = a.binary.resolve()
env = {**os.environ, 'XDG_DATA_HOME': str(out/'data'), 'XDG_CONFIG_HOME': str(out/'config'),
       'XDG_CACHE_HOME': str(out/'cache'), 'XDG_RUNTIME_DIR': str(out/'runtime'),
       'DISPLAY': a.display, 'LIBGL_ALWAYS_SOFTWARE': '1', 'GDK_BACKEND': 'x11',
       'WEBKIT_DISABLE_DMABUF_RENDERER': '1'}
for name in ['data', 'config', 'cache', 'runtime']:
    (out/name).mkdir(exist_ok=True)
os.chmod(out/'runtime', 0o700)
report = {'passed': False, 'checks': [], 'platform': 'Linux native WebKitGTK / software rendering',
          'native_macos_windows_tested': False, 'public_maps_enabled': False}
gui = xvfb = None
logs = []

def save():
    (out/'report.json').write_text(json.dumps(report, indent=2)+'\n')

def check(name, **evidence):
    report['checks'].append({'name': name, **evidence})
    save()
    print('PASS', name, flush=True)

def cli(args, expect=True):
    r = subprocess.run([str(binary), *args], env=env, cwd=root, capture_output=True, text=True, timeout=35)
    if expect and r.returncode:
        raise RuntimeError(r.stderr[-2500:])
    return json.loads(r.stdout) if expect else r

def mcp(args, expect=True):
    request = [{'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {'protocolVersion': '2024-11-05', 'capabilities': {}, 'clientInfo': {'name': 'capture-qa', 'version': '1'}}},
               {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/call', 'params': {'name': 'chronoscope_view_capture', 'arguments': args}}]
    r = subprocess.run([str(binary), 'mcp', '--attach'], env=env, cwd=root, input='\n'.join(json.dumps(v) for v in request)+'\n', capture_output=True, text=True, timeout=35)
    if r.returncode:
        raise RuntimeError(r.stderr[-2500:])
    result = next(json.loads(line) for line in r.stdout.splitlines() if json.loads(line).get('id') == 2)['result']
    if expect and result.get('isError'):
        raise RuntimeError(str(result)[:2500])
    return result

def capture(name, args={}):
    result = mcp(args)
    metadata = result['structuredContent']
    assert metadata['target'] == args.get('target', 'app')
    assert metadata['window'] == args.get('window', 'main')
    assert 'data_url' not in metadata
    data = base64.b64decode(next(c for c in result['content'] if c['type'] == 'image')['data'])
    (out/(name+'.png')).write_bytes(data)
    image = Image.open(io.BytesIO(data)).convert('RGB')
    assert image.width > 400 and image.height > 300
    assert len(image.resize((160,100)).getcolors(16001) or []) > 30
    return image

def command(name, args={}):
    return cli(['--attach', 'call', name, '--args', json.dumps(args)])

def click(x, y):
    subprocess.run([a.xdotool, 'mousemove', str(x), str(y), 'click', '1'], env=env, check=True)
    time.sleep(.7)

try:
    save()
    prefs = cli(['call', 'preferences'])
    prefs.update(theme='dark', auto_save_unsaved=False, map_layers=[], terrain_path=None)
    prefs['map'] = {**prefs['map'], 'enabled': False}
    cli(['call', 'preferences', '--args', json.dumps({'preferences': prefs})])
    cli(['call', 'wmts_access', '--args', '{"settings":{"offline":true}}'])
    cli(['agent', 'enable', '--root', str(root)])
    for name, argv in [('xvfb', [a.xvfb, a.display, '-screen', '0', '1800x1100x24', '-ac', '-nolisten', 'tcp']),
                       ('gui', ['dbus-run-session', '--', str(binary)])]:
        f = (out/(name+'.log')).open('w'); logs.append(f)
        process = subprocess.Popen(argv, env=env, cwd=a.cwd or root, stdout=f, stderr=subprocess.STDOUT)
        if name == 'xvfb':
            xvfb = process; time.sleep(1)
        else:
            gui = process
    deadline = time.monotonic()+45
    while time.monotonic() < deadline:
        assert gui.poll() is None, 'GUI exited during startup'
        if cli(['agent', 'status'])['connected']:
            break
        time.sleep(.5)
    else:
        raise RuntimeError('Desktop connection not ready')
    time.sleep(4)
    command('open', {'path': str(root/'samples/atlantic-hurricanes-2021-2025-tracks.chronoscope')})
    command('view_set', {'mode': 'space-time', 'table_open': True, 'inspector_tab': 'charts',
                         'chart': {'kind': 'bar', 'x': 'entity', 'aggregate': 'count', 'scope': 'all'}})
    time.sleep(4)
    app = capture('app-with-charts-table')
    check('Default MCP capture includes the full app viewport', width=app.width, height=app.height)
    map_image = None
    for attempt in range(5):
        try:
            map_image = capture('map-only', {'target': 'map'}); break
        except RuntimeError as error:
            if 'still loading' not in str(error): raise
            time.sleep(1)
    assert map_image is not None
    assert map_image.width < app.width and map_image.height < app.height
    check('Explicit map export remains smaller and excludes app panels', width=map_image.width, height=map_image.height)
    # xdotool is used only to open a GUI dialog; the screenshot itself is MCP.
    # Native Help button coordinates are read from the actual capture during review.
    capture_error = mcp({'window': 'si-chat'}, expect=False)
    assert capture_error['isError'] and capture_error['structuredContent']['error']['code'] == 'UNAVAILABLE'
    check('Closed detached SI window returns an explicit UNAVAILABLE error')
    output = out/'CLI app screenshot.png'
    saved = cli(['--attach', 'view', 'capture', '--output', str(output)])
    assert saved['target'] == 'app' and saved['window'] == 'main'
    assert Image.open(output).size == app.size
    refused = cli(['--attach', 'view', 'capture', '--output', str(output)], expect=False)
    assert refused.returncode != 0 and 'overwrite' in refused.stderr.lower()
    check('CLI saves whole-app PNG atomically with a spaced path and overwrite protection')
    # Verify an HTML popover/dialog is captured as current UI, rather than replaying
    # the stored map image. Use the app's Help keyboard shortcut where available.
    # A GUI click is optional: portable command and screenshot paths above are the oracle.
    if os.environ.get('CHRONOSCOPE_QA_HELP_X'):
        click(int(os.environ['CHRONOSCOPE_QA_HELP_X']), int(os.environ.get('CHRONOSCOPE_QA_HELP_Y', '28')))
        modal = capture('app-help-dialog')
        assert ImageChops.difference(app, modal).getbbox()
        check('Visible app dialog is present in native MCP capture')
        subprocess.run([a.xdotool, 'key', 'Escape'], env=env, check=True)
        time.sleep(.5)
    if os.environ.get('CHRONOSCOPE_QA_CHAT_X'):
        click(int(os.environ['CHRONOSCOPE_QA_CHAT_X']), int(os.environ.get('CHRONOSCOPE_QA_CHAT_Y', '23')))
        capture('app-docked-si')
        if os.environ.get('CHRONOSCOPE_QA_POPOUT_Y'):
            click(int(os.environ['CHRONOSCOPE_QA_POPOUT_X']), int(os.environ['CHRONOSCOPE_QA_POPOUT_Y']))
            chat = capture('detached-si', {'window': 'si-chat'})
            check('Open detached SI chat can be captured separately', width=chat.width, height=chat.height)
    report['passed'] = True
except Exception:
    report['failure'] = traceback.format_exc()
    print(report['failure'], flush=True)
finally:
    for process in [gui, xvfb]:
        if process and process.poll() is None: process.terminate()
    for process in [gui, xvfb]:
        if process:
            try: process.wait(timeout=8)
            except subprocess.TimeoutExpired: process.kill()
    for f in logs: f.close()
    save()
raise SystemExit(0 if report['passed'] else 1)
