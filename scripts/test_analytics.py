#!/usr/bin/env python3
"""Offline CLI/MCP arithmetic oracle using bundled public Atlantic hurricane Events.

Python is a test oracle only; the application calculates these statistics in Rust.
"""
import json
import math
import os
from pathlib import Path
import statistics
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent
CLI = Path(os.environ.get('CHRONOSCOPE_CLI', str(ROOT / 'target/debug' / ('chronoscope.exe' if os.name == 'nt' else 'chronoscope'))))
PROJECT = ROOT / 'samples/atlantic-hurricanes-2021-2025-tracks.chronoscope'
OUT = Path(os.environ.get('CHRONOSCOPE_QA_OUT', str(ROOT / '.qa/analytics')))
OUT.mkdir(parents=True, exist_ok=True)

with tempfile.TemporaryDirectory(prefix='chronoscope-analytics-') as profile:
    base = [str(CLI), '--data-dir', profile, '--project', str(PROJECT)]
    # Cursors bind to the live store: preserve one process across all pages.
    session = subprocess.Popen(base + ['session'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    try:
        def call(command, args):
            session.stdin.write(json.dumps({'command': command, 'args': args}) + '\n')
            session.stdin.flush()
            response = json.loads(session.stdout.readline())
            assert response['ok'], response
            return response['result']

        rows, cursor = [], None
        while True:
            args = {'apply_filter': False, 'fields': ['id', 'time_utc', 'attribute:max_wind_kt', 'attribute:min_pressure_mb'], 'limit': 1000}
            if cursor is not None:
                args['cursor'] = cursor
            page = call('query', args)
            rows.extend(page['events'])
            cursor = page.get('next_cursor')
            if cursor is None:
                assert len(rows) == page['count']
                break
        result = call('statistics', {'apply_filter': False, 'field': 'attribute:max_wind_kt', 'other_field': 'attribute:min_pressure_mb'})
    finally:
        session.stdin.close()
        session.wait(timeout=30)
    assert session.returncode == 0
    x = [float(r['attribute:max_wind_kt']) for r in rows if r.get('attribute:max_wind_kt') is not None]
    pairs = [(float(r['attribute:max_wind_kt']), float(r['attribute:min_pressure_mb'])) for r in rows if r.get('attribute:max_wind_kt') is not None and r.get('attribute:min_pressure_mb') is not None]
    oracle = {'count': len(x), 'missing': len(rows) - len(x), 'sum': math.fsum(x), 'mean': statistics.mean(x), 'variance_population': statistics.pvariance(x), 'standard_deviation_sample': statistics.stdev(x), 'pearson_r': statistics.correlation(*zip(*pairs))}
    for key in ['sum', 'mean', 'variance_population', 'standard_deviation_sample']:
        assert math.isclose(result['summary'][key], oracle[key], rel_tol=1e-12, abs_tol=1e-9), (key, result, oracle)
    assert result['evaluated_count'] == len(rows)
    assert result['summary']['count'] == oracle['count']
    assert result['summary']['missing'] == oracle['missing']
    assert result['paired']['count'] == len(pairs)
    assert math.isclose(result['paired']['pearson_r'], oracle['pearson_r'], abs_tol=1e-12)

    requests = [
        {'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {'protocolVersion': '2025-11-25', 'clientInfo': {'name': 'local-analytics-qa', 'version': '1'}, 'capabilities': {}}},
        {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/call', 'params': {'name': 'chronoscope_statistics', 'arguments': {'apply_filter': False, 'field': 'attribute:max_wind_kt', 'other_field': 'attribute:min_pressure_mb'}}},
        {'jsonrpc': '2.0', 'id': 3, 'method': 'tools/call', 'params': {'name': 'chronoscope_aggregate', 'arguments': {'apply_filter': False, 'group_by': 'year'}}},
    ]
    process = subprocess.run(base + ['mcp', '--root', str(ROOT)], input=''.join(json.dumps(v) + '\n' for v in requests), text=True, capture_output=True, timeout=60, check=True)
    responses = {v['id']: v for line in process.stdout.splitlines() if (v := json.loads(line)).get('id') is not None}
    assert not responses[2]['result'].get('isError', False), responses[2]
    mcp = responses[2]['result']['structuredContent']
    assert mcp['evaluated_count'] == len(rows) and mcp['summary'] == result['summary']
    assert not responses[3]['result'].get('isError', False), responses[3]
    years = responses[3]['result']['structuredContent']
    assert not years['limited']
    assert sum(g['count'] for g in years['groups']) == len(rows)
    expected_years = {}
    for row in rows:
        year = row['time_utc'][:4]
        expected_years[year] = expected_years.get(year, 0) + 1
    assert {g['key']: g['count'] for g in years['groups']} == expected_years
    report = {'passed': True, 'dataset': str(PROJECT.relative_to(ROOT)), 'event_count': len(rows), 'oracle': 'Python standard-library statistics over complete projected Events, independent of Rust arithmetic', 'oracle_results': oracle, 'rust_statistics': result, 'mcp_statistics_match': True, 'mcp_year_groups': years, 'public_requests': 0}
    (OUT / 'hurricane-analytics.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'passed': True, 'event_count': len(rows), 'oracle': oracle, 'mcp_roundtrip': True}))
