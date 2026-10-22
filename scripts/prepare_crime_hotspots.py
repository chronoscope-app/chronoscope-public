#!/usr/bin/env python3
"""Rebuild the crime heat-map example from its fixed Police.uk CSV snapshot."""
import argparse
import csv
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent
STEM = 'police-uk-london-theft-2025-01'
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--cli', type=Path, required=True, help='Built Chronoscope executable')
a = p.parse_args()
binary = a.cli.resolve()
csv_path = ROOT/'samples/public'/f'{STEM}.csv'
assert hashlib.sha256(csv_path.read_bytes()).hexdigest() == 'd75137871bdb3da1159060a1d79b0c20e13b91e3841dc507d3cc6252ee564e3e'
with csv_path.open() as f:
    rows = list(csv.DictReader(f))
assert len(rows) == 4053 and len({r['api_id'] for r in rows}) == 4053
assert all(r['month'] == '2025-01' and r['category'] == 'theft-from-the-person' for r in rows)
assert all(r['month_anchor_utc'] == '2025-01-01T00:00:00Z' for r in rows)
with tempfile.TemporaryDirectory(prefix='chronoscope-crime-') as temporary:
    temp = Path(temporary)
    command = [str(binary), '--data-dir', str(temp/'profile')]
    imported = temp/'import.chronoscope'
    result = json.loads(subprocess.check_output(command+[
        'import', str(csv_path), '--mapping', str(csv_path.with_suffix('.mapping.json')),
        '--output', str(imported)], text=True))
    assert result['accepted'] == 4053 and result['rejected'] == 0
    with zipfile.ZipFile(imported) as z:
        project = json.loads(z.read('manifest.json'))
    project['provenance'] = json.loads(Path(str(csv_path)+'.attribution.json').read_text())
    project['dataset']['name'] = 'Reported theft · Central London · January 2025 (month only)'
    project['mode'] = 'Map'
    project['scene'].update(mode='map', inspector_tab='views', render_budget=20000,
        display=dict(mode='heatmap', show_points=False, show_tracks=False,
        show_trails=False, heat_radius=28, heat_weight='count', bloom=False,
        spatial_culling=False))
    output = ROOT/'samples'/f'{STEM}.chronoscope'
    with zipfile.ZipFile(output, 'w') as z:
        info = zipfile.ZipInfo('manifest.json', (2025, 2, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(info, json.dumps(project, ensure_ascii=False, separators=(',', ':')))
    snapshot = json.loads(subprocess.check_output(command+['--project', str(output),
        'call', 'snapshot', '--args', '{"compact":true}'], text=True))
    assert snapshot['count'] == 4053 and snapshot['visible'] == 4053
    assert snapshot['scene']['display']['mode'] == 'heatmap'
    assert not snapshot['scene']['display']['show_tracks']
    print(f'Imported and reopened {len(rows)} published crime reports: {output}')
