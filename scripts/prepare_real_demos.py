#!/usr/bin/env python3
"""Build deterministic real-world CSV demos and portable workspaces.

Download the three sources in docs/REAL-WORLD-DEMOS.md into INPUT_DIR first.
Requires Python 3 and zstandard (only for NOAA's .zst source).
"""
import argparse
import csv
import datetime as dt
import gzip
import hashlib
import io
import json
import math
from pathlib import Path
import zipfile

AIS_FILE = 'ais-2024-01-01.csv.zst'
GPS_FILE = 'HG_OOSTENDE-gps-2021.csv.gz'
AIS_SHA = '04e80b2f2896f51a7623e098eb48503b95786c9badf06550ce9e7d418654cb2d'
GPS_SHA = 'cdfb143713be31631d1262fdb6feb86e907b563265118cf44ccfef61d3a6fb53'
VESSELS = {'367008020', '367513170', '368052630', '366989360', '338157873',
           '538005171', '215193000', '367533950', '368302170', '366985270'}
VESSEL_TYPES = {'30': 'Fishing', '31': 'Towing', '36': 'Sailing', '50': 'Pilot',
                '52': 'Tug', '60': 'Passenger', '80': 'Tanker'}
ROOT = Path(__file__).resolve().parents[1]
FILTER = dict(start=None, end=None, hidden_entities=[], hidden_categories=[],
              hidden_sources=[], search='', predicates=[], selected_only=False,
              bounds=None, located_only=False)
CAMERA = dict(yaw=-0.55, pitch=0.65, zoom=1., pan=[0., 0.], time_scale=1.)


def verified(path, expected):
    actual = hashlib.sha256(path.read_bytes()).hexdigest()
    if actual != expected:
        raise ValueError(f'{path.name}: unexpected SHA-256 {actual}')


def timestamp(text):
    value = dt.datetime.fromisoformat(text.replace('Z', '+00:00'))
    return value.astimezone(dt.timezone.utc) if value.tzinfo else value.replace(tzinfo=dt.timezone.utc)


def write_demo(stem, name, rows, bounds, source_url, checksum, selection, *, chart_preset=None, provenance=None):
    rows.sort(key=lambda r: (timestamp(r['timestamp']), r['entity'], int(r['source_row'])))
    fields = list(rows[0])
    csv_path = ROOT / 'samples/public' / (stem + '.csv')
    with csv_path.open('w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=fields, lineterminator='\n')
        w.writeheader()
        w.writerows(rows)
    events = []
    for i, r in enumerate(rows, 1):
        epoch = timestamp(r['timestamp']).timestamp()
        value = float(r['value']) if r['value'] else None
        if value is not None and not math.isfinite(value):
            raise ValueError('Non-finite observation value')
        end = timestamp(r['end_timestamp']).timestamp() if r.get('end_timestamp') else None
        events.append(dict(id=i, entity=r['entity'], time=epoch, end=end,
                           lat=float(r['latitude']), lon=float(r['longitude']),
                           category=r['category'], label=r['label'], value=value,
                           related_to='', attrs=r, tags=[], note='',
                           source=stem + '.csv / CSV', source_row=int(r['source_row'])))
    scene = dict(renderer='cesium', mode='space-time', bounds=bounds, time_height=2.8,
                 render_budget=20000, inspector_tab='views', table_attributes=True,
                 entity_colors=dict(zip(sorted({r['entity'] for r in rows}),
                                        ['#65c4e8', '#ffb3a7', '#ffd166', '#ad9feb', '#8bd6bc',
                                         '#f2a8d3', '#85b1ff', '#d9be89', '#b2d583', '#d59dee'])),
                 display=dict(mode='points', show_points=True, show_tracks=True,
                              show_trails=True, track_opacity=.25, trail_opacity=.25,
                              trail_gap_minutes=180, bloom=False))
    if chart_preset:
        scene['chart'] = chart_preset['config']
        scene['chart_presets'] = [chart_preset]
    views = []
    for title, mode, extra in [('Space-time tracks', 'space-time', {}),
                               ('2D tracks', 'map', {}), ('Globe tracks', 'globe', {}),
                               ('Bloom', 'space-time', {'bloom': True})]:
        view_scene = {**scene, 'mode': mode, 'display': {**scene['display'], **extra}}
        views.append(dict(scene=view_scene, name=title, mode='SpaceTime',
                          filter=FILTER, selected=[], camera=CAMERA))
    project = dict(format='chronoscope.workspace', time_resolution='fractional_second', version=6,
                   mode='SpaceTime', scene=scene, dataset=dict(name=name, events=events),
                   filter=FILTER, selected=[], camera=CAMERA, views=views, groups=[], imports=[])
    if provenance:
        project['provenance'] = provenance
        Path(str(csv_path) + '.attribution.json').write_text(json.dumps(provenance, indent=2) + '\n')
    project_path = ROOT / 'samples' / (stem + '.chronoscope')
    with zipfile.ZipFile(project_path, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        entry = zipfile.ZipInfo('manifest.json', (2024, 1, 1, 0, 0, 0))
        entry.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(entry, json.dumps(project, ensure_ascii=False, separators=(',', ':')))
    return dict(id=stem, name=name, records=len(rows), entities=len({r['entity'] for r in rows}),
                source_url=source_url, source_sha256=checksum, selection=selection,
                csv_sha256=hashlib.sha256(csv_path.read_bytes()).hexdigest(),
                project_sha256=hashlib.sha256(project_path.read_bytes()).hexdigest(),
                first_timestamp=rows[0]['timestamp'], last_timestamp=rows[-1]['timestamp'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input_dir', type=Path)
    args = parser.parse_args()
    import zstandard
    verified(args.input_dir / AIS_FILE, AIS_SHA)
    verified(args.input_dir / GPS_FILE, GPS_SHA)
    ais = []
    with (args.input_dir / AIS_FILE).open('rb') as f:
        with zstandard.ZstdDecompressor().stream_reader(f) as stream:
            for rownum, r in enumerate(csv.DictReader(io.TextIOWrapper(stream)), 2):
                if r['mmsi'] not in VESSELS:
                    continue
                if not (37.45 <= float(r['latitude']) <= 38.15 and
                        -122.65 <= float(r['longitude']) <= -122.05):
                    continue
                ais.append(dict(entity=r['vessel_name'] + ' · ' + r['mmsi'],
                                category=VESSEL_TYPES.get(r['vessel_type'], r['vessel_type']),
                                label=r['vessel_name'], timestamp=r['base_date_time'].replace(' ', 'T') + 'Z',
                                value=r['sog'], source_row=str(rownum), **r))
    gps = []
    with gzip.open(args.input_dir / GPS_FILE, 'rt') as f:
        for rownum, r in enumerate(csv.DictReader(f), 2):
            if not (r['timestamp'].startswith('2021-06-') and r['visible'] == 'true' and
                    r['import-marked-outlier'] != 'true' and r['manually-marked-outlier'] != 'true'):
                continue
            raw_time = r['timestamp']
            # Keep the original timestamp field as well as the canonical ISO column.
            r = {'original_timestamp': raw_time, **r}
            r.pop('timestamp')
            gps.append(dict(entity=r['individual-local-identifier'],
                            category=r['individual-taxon-canonical-name'],
                            label=r['individual-local-identifier'] + ' · herring gull',
                            timestamp=raw_time.replace(' ', 'T') + 'Z', latitude=r['location-lat'],
                            longitude=r['location-long'], value=r['ground-speed'],
                            source_row=str(rownum), **r))
    report = [write_demo('noaa-ais-san-francisco-2024-01-01', 'NOAA AIS · San Francisco Bay · 1 Jan 2024', ais,
                         [-122.65, 37.45, -122.05, 38.15],
                         'https://noaaocm.blob.core.windows.net/ais/csv2/csv2024/' + AIS_FILE, AIS_SHA,
                         dict(mmsi=sorted(VESSELS), bounds=[-122.65, 37.45, -122.05, 38.15],
                              rule='Every original observation inside the bounds for these ten vessels; no resampling.')),
              write_demo('animal-gps-herring-gulls-2021-06', 'Animal GPS · Belgian herring gulls · June 2021', gps,
                         [2.7, 50.9, 3.3, 51.5],
                         'https://zenodo.org/records/6594838/files/' + GPS_FILE, GPS_SHA,
                         dict(study='HG_OOSTENDE', month='2021-06', visible=True, exclude_flagged_outliers=True,
                              rule='All June observations meeting the flags; no interpolation or resampling.'))]
    (ROOT / 'samples/public/demo-provenance.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
