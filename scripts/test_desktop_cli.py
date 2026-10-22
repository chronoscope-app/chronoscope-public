#!/usr/bin/env python3
"""Verify the bundled desktop executable is a headless CLI/MCP launcher."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--binary', type=Path, required=True)
a = p.parse_args()
binary = a.binary.resolve()
env = os.environ.copy()
env.pop('DISPLAY', None)
env.pop('WAYLAND_DISPLAY', None)
def run(args, stdin=None):
    result = subprocess.run([str(binary), *args], input=stdin, capture_output=True, text=True, env=env, timeout=30)
    if result.returncode:
        raise RuntimeError(f'Desktop CLI failed ({result.returncode}): {result.stderr[-2000:]}')
    return result.stdout
help_text = run(['--help'])
assert all(word in help_text for word in ['mcp', 'agent', '--attach'])
with tempfile.TemporaryDirectory(prefix='chronoscope desktop CLI ') as temporary:
    data = Path(temporary)/'app data'
    args = ['--data-dir', str(data)]
    config = json.loads(run([*args, 'agent', 'config']))['mcpServers']['chronoscope']
    assert Path(config['command']).resolve() == binary
    assert config['args'] == [*args, 'mcp', '--attach']
    enabled = json.loads(run([*args, 'agent', 'enable']))
    assert enabled['enabled'] and enabled['pending'] and not enabled['connected']
    assert not list(data.glob('workspace-*')), 'Agent setup must not initialize a separate working database'
    disabled = json.loads(run([*args, 'agent', 'disable']))
    assert not disabled['enabled'] and not disabled['connected']
    scope = Path(temporary)/'exchange folder'
    scope.mkdir()
    requests = [
        {'jsonrpc':'2.0','id':1,'method':'initialize','params':{'protocolVersion':'2024-11-05','capabilities':{},'clientInfo':{'name':'desktop-cli-smoke','version':'1'}}},
        {'jsonrpc':'2.0','id':2,'method':'tools/list'},
        {'jsonrpc':'2.0','id':3,'method':'tools/call','params':{'name':'chronoscope_snapshot','arguments':{'compact':True}}},
    ]
    output = run([*args,'mcp','--root',str(scope)], '\n'.join(json.dumps(r) for r in requests)+'\n')
    messages = [json.loads(line) for line in output.splitlines()]
    replies = {m.get('id'):m for m in messages if 'id' in m}
    assert replies[1]['result']['serverInfo']['name'] == 'chronoscope'
    assert any(t['name']=='chronoscope_wmts_servers' for t in replies[2]['result']['tools'])
    assert replies[3]['result']['structuredContent']['count'] == 0
print('Passed: desktop binary --help, agent enable/config/disable, paths with spaces, and real stdio MCP initialization/discovery/query without a display.')
