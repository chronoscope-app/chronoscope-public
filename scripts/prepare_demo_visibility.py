#!/usr/bin/env python3
"""Refresh trajectory demo presentation without rebuilding observation data."""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
STEMS = [
    'flights-philippines-week-2026',
    'starlink-128-predicted-orbits-2024',
    'noaa-ais-san-francisco-2024-01-01',
    'animal-gps-herring-gulls-2021-06',
    'animal-gps-black-rock-forest-2023-03',
    'animal-gps-white-storks-2018',
    'animal-telemetry-elephant-seals-2004',
    'atlantic-hurricanes-2016-2025',
    'atlantic-hurricanes-2021-2025-tracks',
]


def refresh(check=False):
    projects = {}
    for stem in STEMS:
        path = ROOT/'samples'/f'{stem}.chronoscope'
        with zipfile.ZipFile(path) as archive:
            entries = [(entry, archive.read(entry)) for entry in archive.infolist()]
        original = json.loads(next(data for entry, data in entries if entry.filename == 'manifest.json'))
        project = copy.deepcopy(original)
        for scene in [project['scene'], *(view['scene'] for view in project['views'])]:
            display = scene.setdefault('display', {})
            display['point_scale'] = max(1.2, display.get('point_scale', 1.0))
            display['track_opacity'] = max(0.8, display.get('track_opacity', 0.25))
        # This edit touches presentation only, including every saved camera view.
        assert project['dataset'] == original['dataset']
        assert project.get('provenance') == original.get('provenance')
        if project != original:
            if check:
                raise ValueError(f'{stem}: visibility defaults need refreshing')
            with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
                for entry, data in entries:
                    if entry.filename == 'manifest.json':
                        data = json.dumps(project, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()
                    archive.writestr(entry, data)
        projects[stem] = dict(project_sha256=hashlib.sha256(path.read_bytes()).hexdigest(), project_bytes=path.stat().st_size)
        print(f'{stem}: entity size 1.2×; track opacity 80%; {len(project["views"])} saved views')
    for name in ['demo-provenance.json', 'wildlife-provenance.json', 'altitude-provenance.json', 'space-provenance.json']:
        path = ROOT/'samples/public'/name
        report = json.loads(path.read_text())
        updated = copy.deepcopy(report)
        rows = [(row['id'], row) for row in updated] if isinstance(updated, list) else list(updated.items())
        for key, row in rows:
            stem = 'starlink-128-predicted-orbits-2024' if key == 'starlink' else key
            if stem in projects:
                for field in ['project_sha256', 'project_bytes']:
                    if field in row:
                        row[field] = projects[stem][field]
        if updated != report:
            if check:
                raise ValueError(f'{name}: project checksum needs refreshing')
            path.write_text(json.dumps(updated, ensure_ascii=False, indent=2)+'\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    refresh(parser.parse_args().check)
