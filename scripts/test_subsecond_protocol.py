#!/usr/bin/env python3
"""Exercise fractional timestamps through the real CLI and stdio MCP process."""
import json
import os
from pathlib import Path
import select
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
CLI = os.environ.get('CHRONOSCOPE_CLI', str(ROOT / 'target/debug/chronoscope'))
BASE = 1791879301


def main():
    checks = []
    with tempfile.TemporaryDirectory(prefix='chronoscope-time-') as temporary:
        root = Path(temporary)
        profile = root / 'profile'
        result = subprocess.run(
            [CLI, '--data-dir', str(profile), '--json', 'call', 'time_parse',
             '--args', json.dumps({'value': '2026-10-13T08:15:01.123456Z'})],
            text=True, capture_output=True, timeout=30, check=True)
        value = json.loads(result.stdout)['result']
        assert value['epoch'] == BASE + .123456, value
        assert value['precision'] == 'fractional_second', value
        checks.append('CLI time_parse retains microseconds')
        process = subprocess.Popen(
            [CLI, '--data-dir', str(profile), 'mcp', '--root', str(root)],
            text=True, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, bufsize=1)
        sequence = 0

        def request(method, params):
            nonlocal sequence
            sequence += 1
            message = {'jsonrpc': '2.0', 'id': sequence, 'method': method, 'params': params}
            process.stdin.write(json.dumps(message) + '\n')
            process.stdin.flush()
            assert select.select([process.stdout], [], [], 30)[0], 'MCP response timed out'
            response = json.loads(process.stdout.readline())
            assert response.get('id') == sequence and 'error' not in response, response
            return response['result']

        def tool(name, arguments):
            response = request('tools/call', {'name': 'chronoscope_' + name, 'arguments': arguments})
            assert not response.get('isError'), response
            return response['structuredContent']

        try:
            request('initialize', {'protocolVersion': '2025-06-18', 'capabilities': {},
                                   'clientInfo': {'name': 'fractional-clock-test', 'version': '1'}})
            tools = request('tools/list', {})['tools']
            parse_tool = next(t for t in tools if t['name'] == 'chronoscope_time_parse')
            assert 'discarded' not in parse_tool['description'], parse_tool
            parsed = tool('time_parse', {'value': '2026-10-13T08:15:01.123456Z'})
            assert parsed['epoch'] == BASE + .123456, parsed
            checks.append('MCP discovery and tool response advertise fractional precision')
            csv = root / 'precision.csv'
            csv.write_text('entity,timestamp,latitude,longitude\n'
                           'A,2026-10-13T08:15:01.125Z,33.749,-84.388\n'
                           'A,2026-10-13T08:15:01.375Z,33.750,-84.387\n')
            preview = tool('import_preview', {'path': str(csv)})
            tool('import_commit', {'import_id': preview['import_id']})
            rows = tool('query', {'fields': ['id', 'time', 'time_utc'], 'sort_by': 'time'})['events']
            assert [row['time'] for row in rows] == [BASE + .125, BASE + .375], rows
            filtered = tool('query', {'filter': {'start': BASE + .2, 'end': BASE + .4},
                                      'fields': ['id', 'time']})
            assert [r['id'] for r in filtered['events']] == ['2'], filtered
            tool('edit', {'id': '2', 'changes': {'time': BASE + .400123}})
            file = root / 'precision.chronoscope'
            saved = tool('save', {'path': str(file)})
            assert saved['format'] == 'zip_v6', saved
            tool('open', {'path': str(file)})
            reopened = tool('events', {'id': '2'})['events'][0]
            assert reopened['time'] == BASE + .400123, reopened
            checks.append('MCP imports, precise queries, edits and save/reopen retain fractions')
        finally:
            process.stdin.close()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
            process.stdout.close()
            process.stderr.close()
    print(json.dumps({'passed': True, 'checks': checks}, indent=2))


if __name__ == '__main__':
    main()
