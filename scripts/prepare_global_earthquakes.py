#!/usr/bin/env python3
"""Rebuild the portable globe example from its checked-in USGS CSV snapshot."""
import argparse
import csv
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent
STEM = 'usgs-global-earthquakes-2025-01'
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--cli', type=Path, required=True, help='Built Chronoscope executable')
a = p.parse_args()
binary = a.cli.resolve()
csv_path = ROOT/'samples/public'/f'{STEM}.csv'
assert hashlib.sha256(csv_path.read_bytes()).hexdigest() == '8fd920fcda60cc01f66089342e0ca5045225eec477682605a869b88dfdf7ad3d'
with csv_path.open() as f:
    rows = list(csv.DictReader(f))
assert len(rows) == 652 and len({r['id'] for r in rows}) == 652
assert all(all(r[k] == 'us' for k in ('net', 'locationSource', 'magSource')) for r in rows)
with tempfile.TemporaryDirectory(prefix='chronoscope-earthquakes-') as temporary:
    temp = Path(temporary)
    command = [str(binary), '--data-dir', str(temp/'profile')]
    imported = temp/'import.chronoscope'
    result = json.loads(subprocess.check_output(command+[
        'import', str(csv_path), '--mapping', str(csv_path.with_suffix('.mapping.json')),
        '--output', str(imported)], text=True))
    assert result['accepted'] == 652 and result['rejected'] == 0
    with zipfile.ZipFile(imported) as z:
        project = json.loads(z.read('manifest.json'))
    project['provenance'] = json.loads(Path(str(csv_path)+'.attribution.json').read_text())
    project['dataset']['name'] = 'Global earthquakes · January 2025 · M ≥4.5'
    project['mode'] = 'Map'
    project['scene'].update(mode='globe', inspector_tab='views', render_budget=20000,
        entity_colors={'Earthquakes':'#ffd166'}, display=dict(mode='points',
        show_points=True, show_tracks=False, show_trails=False, point_scale=.8,
        bloom=False, spatial_culling=False))
    output = ROOT/'samples'/f'{STEM}.chronoscope'
    # Stable ZIP metadata makes identical input/build outputs byte-reproducible.
    with zipfile.ZipFile(output, 'w') as z:
        info = zipfile.ZipInfo('manifest.json', (2025, 2, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(info, json.dumps(project, ensure_ascii=False, separators=(',', ':')))
    snapshot = json.loads(subprocess.check_output(command+['--project', str(output),
        'call', 'snapshot', '--args', '{"compact":true}'], text=True))
    assert snapshot['count'] == 652 and snapshot['visible'] == 652
    assert snapshot['scene']['mode'] == 'globe'
    assert not snapshot['scene']['display']['show_tracks']
    print(f'Imported and reopened {len(rows)} global epicenters: {output}')
