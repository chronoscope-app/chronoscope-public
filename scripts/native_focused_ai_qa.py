#!/usr/bin/env python3
"""Local on-device QA using the app's typed MCP tools; no computer control."""
import json, subprocess, time, base64, select
from pathlib import Path
import argparse, os
ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description='Verify focused AI in a launched disposable native QA profile through real stdio MCP. Replaces its current workspace with the hurricane demo.')
parser.add_argument('--cli', default=os.environ.get('CHRONOSCOPE_CLI', str(ROOT / 'target/debug/chronoscope')))
parser.add_argument('--data-dir', required=True, type=Path, help='Dedicated QA profile used by the launched app; never a personal profile')
parser.add_argument('--out', type=Path, default=ROOT / '.qa/focused-ai/native')
options = parser.parse_args()
OUT = options.out.resolve()
OUT.mkdir(parents=True, exist_ok=True)
CLI = Path(options.cli).resolve()
PROFILE = options.data_dir.resolve()
p = subprocess.Popen([str(CLI), '--data-dir', str(PROFILE), 'mcp', '--attach'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=(OUT / 'mcp-stderr.log').open('w'), text=True)
seq = 0
report = {'passed': False, 'computer_control_used': False, 'transport': 'actual stdio MCP attached to the native Mac app', 'checks': []}

def rpc(method, params):
    global seq
    seq += 1
    p.stdin.write(json.dumps({'jsonrpc': '2.0', 'id': seq, 'method': method, 'params': params}) + '\n')
    p.stdin.flush()
    end = time.monotonic() + 90
    while time.monotonic() < end:
        if not select.select([p.stdout], [], [], 1)[0]:
            continue
        line = p.stdout.readline()
        if not line:
            raise RuntimeError('MCP closed')
        value = json.loads(line)
        if value.get('id') == seq:
            if 'error' in value:
                raise RuntimeError(str(value['error']))
            return value['result']
    raise TimeoutError(method)

def call(name, args=None):
    r = rpc('tools/call', {'name': 'chronoscope_' + name, 'arguments': args or {}})
    if r.get('isError'):
        raise RuntimeError(json.dumps(r))
    return r['structuredContent']

def check(name):
    report['checks'].append(name)
    print('PASS ' + name, flush=True)
    (OUT / 'report.json').write_text(json.dumps(report, indent=2) + '\n')

def capture(name):
    r = rpc('tools/call', {'name': 'chronoscope_view_capture', 'arguments': {'target': 'app', 'window': 'main'}})
    if r.get('isError'):
        raise RuntimeError(json.dumps(r))
    (OUT / name).write_bytes(base64.b64decode(next((c['data'] for c in r['content'] if c['type'] == 'image'))))

def wait_ui(predicate):
    end = time.monotonic() + 90
    while time.monotonic() < end:
        status = call('assist_ui', {'action': 'status'})
        if predicate(status):
            return status
        time.sleep(0.2)
    raise TimeoutError('UI ' + json.dumps(status))
try:
    rpc('initialize', {'protocolVersion': '2025-11-25', 'clientInfo': {'name': 'focused-ai-native-qa', 'version': '1'}, 'capabilities': {}})
    tools = rpc('tools/list', {})['tools']
    names = {t['name'] for t in tools}
    assert all(('chronoscope_' + n in names for n in ['assist_ui', 'assist_status', 'assist_explain', 'assist_tags', 'assist_tags_apply', 'job_start', 'job_status', 'job_cancel']))
    call('assist_ui', {'action': 'close'})
    call('demo_open', {'id': 'hurricanes'})
    prefs = call('preferences')
    prefs.update({'basemap': 'none', 'map': {**prefs['map'], 'enabled': False}, 'map_layers': [], 'terrain_path': None})
    call('preferences', {'preferences': prefs})
    rows = call('query', {'limit': 3, 'fields': ['id']})['events']
    ids = [r['id'] for r in rows]
    for (i, id) in enumerate(ids):
        call('edit', {'id': id, 'changes': {'note': 'Survey recorded nesting seabirds beside a rocky coastline.' if i == 0 else '', 'tags': ['reviewed'] if i == 0 else []}})
    call('select', {'ids': ids, 'mode': 'replace'})
    call('view_set', {'inspector_tab': 'inspect', 'mode': 'map'})
    last = None
    stable = time.monotonic()
    deadline = stable + 12
    while time.monotonic() < deadline:
        revision = call('revision')['revision']
        if revision != last:
            last = revision
            stable = time.monotonic()
        if time.monotonic() - stable > 2:
            break
        time.sleep(0.2)
    state = call('assist_status')
    report['provider_status'] = state
    assert any((p['id'] == 'apple-local' and p['available'] for p in state['providers'])), state
    check('Native MCP discovers all focused-feature commands and actual Apple Intelligence is available')
    s = call('snapshot', {'compact': True, 'include_statistics': False})
    job = call('job_start', {'command': 'assist_tags', 'arguments': {'provider': 'apple-local', 'ids': [ids[0]], 'field': 'note', 'expected_revision': s['revision'], 'expected_workspace': s['workspace_id']}})
    inference_deadline = time.monotonic() + 90
    while True:
        if time.monotonic() > inference_deadline:
            call('job_cancel', {'job_id': job['job_id']})
            raise TimeoutError('On-device tagging')
        status = call('job_result', {'job_id': job['job_id']})
        if status['status'] not in ['running', 'queued']:
            break
        time.sleep(0.2)
    assert status['status'] == 'completed', status
    tags = status['result']
    report['actual_model_tags'] = tags
    assert tags['records'][0]['tags'], tags
    assert call('events', {'id': ids[0]})['events'][0]['tags'] == ['reviewed']
    call('assist_tags_apply', {'items': [{'id': ids[0], 'tags': tags['records'][0]['tags']}], 'expected_revision': tags['revision'], 'expected_workspace': tags['workspace_id']})
    assert 'reviewed' in call('events', {'id': ids[0]})['events'][0]['tags']
    call('undo')
    call('job_release', {'job_id': job['job_id']})
    check('Actual on-device tagging through MCP returns reviewable suggestions; additive apply and Undo preserve existing tags')
    artifact = call('analytics_run', {'plan': {'capability': 'quantiles', 'scope': 'all', 'parameters': {'field': 'value', 'probabilities': [0.5]}}})
    call('assist_ui', {'action': 'open-explain', 'source': {'result_id': artifact['result_id']}})
    state = call('assist_ui', {'action': 'generate', 'provider': 'apple-local'})
    assert state['busy'], state
    capture('explain-processing.png')
    state = wait_ui(lambda s: not s['busy'])
    assert state['explanation'], state
    report['actual_model_explanation'] = state['explanation']
    capture('explain-complete.png')
    check('MCP opens the native explanation dialog, sees its busy state and captures a real Apple-generated explanation')
    call('assist_ui', {'action': 'generate', 'provider': 'apple-local'})
    call('assist_ui', {'action': 'cancel'})
    state = wait_ui(lambda s: not s['busy'])
    assert 'cancel' in state['status'].lower(), state
    check('MCP cancels native generation and the real dialog reports cancellation')
    call('assist_ui', {'action': 'close'})
    call('assist_ui', {'action': 'open-tags'})
    state = call('assist_ui', {'action': 'generate', 'provider': 'apple-local', 'field': 'note'})
    assert state['busy']
    capture('tags-processing.png')
    state = wait_ui(lambda s: not s['busy'])
    assert state['tag_rows'] == 3, state
    capture('tags-review.png')
    check('MCP opens native tag suggestions, observes processing, and verifies per-Event review with blank records skipped')
    call('assist_ui', {'action': 'close'})
    call('assist_ui', {'action': 'open-tags'})
    report['passed'] = True
except Exception as error:
    report['error'] = str(error)
    raise
finally:
    (OUT / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    p.stdin.close()
    p.wait(timeout=15)
