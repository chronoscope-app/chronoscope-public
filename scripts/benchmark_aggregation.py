#!/usr/bin/env python3
"""Opt-in repeatable large-CSV aggregation check. No external services used."""
import argparse
import csv
import json
from pathlib import Path
import subprocess
import time
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--cli', type=Path, required=True)
p.add_argument('--directory', type=Path, required=True)
p.add_argument('--rows', type=int, default=1_000_000)
a = p.parse_args()
a.directory.mkdir(parents=True, exist_ok=True)
source = a.directory/'busy.csv'
with source.open('w', newline='') as f:
    writer = csv.writer(f)
    writer.writerow(['entity', 'timestamp', 'latitude', 'longitude', 'value'])
    for i in range(a.rows):
        writer.writerow([f'Entity {i % 1000}', '2026-01-01 00:01', 43.26, -79.94, i % 1000])
print(f'Generated {a.rows:,} rows ({source.stat().st_size:,} bytes)', flush=True)
start = time.monotonic()
workspace = a.directory/'summaries.chronoscope'
r = subprocess.run([str(a.cli.resolve()), '--json', '--data-dir', str(a.directory/'app'), 'import', str(source), '--aggregate-window-minutes', '15', '--aggregate-radius-m', '100', '--output', str(workspace)], text=True, capture_output=True, check=True)
value = json.loads(r.stdout)
result = value['result']
assert result['accepted'] == a.rows, result
assert result['retained'] == min(a.rows, 1000), result
reopen = subprocess.run([str(a.cli.resolve()), '--json', '--project', str(workspace), '--data-dir', str(a.directory/'reopen'), 'call', 'query', '--args', '{"limit":1}'], text=True, capture_output=True, check=True)
query = json.loads(reopen.stdout)['result']
assert query['count'] == min(a.rows, 1000), query
assert int(query['events'][0]['attrs']['chronoscope.aggregate.count']) == (a.rows + 999)//1000, query
report = {'rows': a.rows, 'source_bytes': source.stat().st_size, 'retained': result['retained'], 'seconds_including_reopen': round(time.monotonic()-start, 3), 'workspace_bytes': workspace.stat().st_size, 'build': 'caller-selected CLI; elapsed time is not a cross-platform guarantee', 'result': result}
(a.directory/'report.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2), flush=True)
