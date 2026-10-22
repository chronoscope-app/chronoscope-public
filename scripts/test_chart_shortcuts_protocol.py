#!/usr/bin/env python3
"""Check new chart discovery, calculations and selection in real CLI/MCP processes."""
import json
import os
from pathlib import Path
import select
import subprocess
import tempfile

CLI = os.environ.get('CHRONOSCOPE_CLI', str(Path(__file__).resolve().parents[1] / 'target/debug/chronoscope'))


def main():
    with tempfile.TemporaryDirectory(prefix='chronoscope-charts-') as temporary:
        root = Path(temporary)
        profile = root / 'profile'
        csv = root / 'events.csv'
        csv.write_text('entity,timestamp,latitude,longitude,value\n'
                       'A,2026-01-05T00:00:00.125Z,34,-84,10\n'
                       'A,2026-01-05T01:00:00.125Z,34,-84,20\n'
                       'A,2026-01-06T00:00:00.125Z,34,-84,30\n')
        process = subprocess.Popen([CLI, '--data-dir', str(profile), 'mcp', '--root', str(root)],
                                   text=True, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, bufsize=1)
        sequence = 0

        def request(method, params):
            nonlocal sequence
            sequence += 1
            process.stdin.write(json.dumps({'jsonrpc': '2.0', 'id': sequence,
                                            'method': method, 'params': params}) + '\n')
            process.stdin.flush()
            assert select.select([process.stdout], [], [], 30)[0], 'MCP response timed out'
            response = json.loads(process.stdout.readline())
            assert response.get('id') == sequence and 'error' not in response, response
            return response['result']

        def tool(name, arguments):
            result = request('tools/call', {'name': 'chronoscope_' + name, 'arguments': arguments})
            assert not result.get('isError'), result
            return result['structuredContent']

        try:
            request('initialize', {'protocolVersion': '2025-06-18', 'capabilities': {},
                                   'clientInfo': {'name': 'eight-charts-test', 'version': '1'}})
            chart = next(t for t in request('tools/list', {})['tools'] if t['name'] == 'chronoscope_chart_data')
            kinds = chart['inputSchema']['properties']['config']['properties']['kind']['enum']
            assert 'heatmap' in kinds and 'period' in kinds, kinds
            assert 'period-comparison' in chart['description'], chart['description']
            preview = tool('import_preview', {'path': str(csv)})
            tool('import_commit', {'import_id': preview['import_id']})
            config = {'kind': 'heatmap', 'x': 'time', 'x_axis': 'time'}
            grid = tool('chart_data', {'config': config})
            assert len(grid['rows']) == 168 and sum(r['count'] for r in grid['rows']) == 3, grid
            selected = tool('select_query', {'config': grid['config'], 'expected_revision': grid['revision'],
                                             'chart_marks': [{'x': 0, 'series': 0}]})
            assert selected['selected'] == 1, selected
            periods = tool('chart_data', {'config': {'kind': 'period'}})
            assert periods['rows'][0]['before'] == 2 and periods['rows'][0]['after'] == 1, periods
            assert periods['rows'][0]['percent_change'] == -50, periods
            file = root / 'charts.chronoscope'
            tool('save', {'path': str(file)})
            cli = subprocess.run([CLI, '--data-dir', str(profile), '--project', str(file), '--json',
                                  'call', 'chart_data', '--args', json.dumps({'config': config})],
                                 text=True, capture_output=True, timeout=30, check=True)
            result = json.loads(cli.stdout)['result']
            assert result['rows'] == grid['rows'], result
        finally:
            process.stdin.close()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
            process.stdout.close()
            process.stderr.close()
    print(json.dumps({'passed': True, 'checks': ['MCP discovery', 'UTC grid', 'Exact selection',
                                              'Rust period changes', 'CLI/MCP parity']}, indent=2))


if __name__ == '__main__':
    main()
