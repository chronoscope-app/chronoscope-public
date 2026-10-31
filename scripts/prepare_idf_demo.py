#!/usr/bin/env python3
"""Build the complete usable IDF GPS demo from pinned, locally extracted CSVs.

See docs/IDF-UAV-DEMO.md. No network access, interpolation or row thinning.
"""
import argparse
import csv
import hashlib
import json
import io
import math
from pathlib import Path
import re
import zipfile
from prepare_real_demos import CAMERA, FILTER

ROOT = Path(__file__).resolve().parents[1]
STEM = 'idf-fixed-wing-gps'
ANCHOR = 946684800.0  # 2000-01-01 UTC is a display anchor, not a flight date.
CREDIT = dict(
    title='IDF_DS · Fixed-Wing UAS Telemetry Benchmark, v1.0 (2025)',
    creator='César García Gascón; Javier Bas Bolufer, Pablo Castelló Pedrero and Juan A. Garcia-Manrique · Universitat Politècnica de València / Instituto IDF',
    source_url='https://doi.org/10.5281/zenodo.16992976',
    license='CC BY 4.0', license_url='https://creativecommons.org/licenses/by/4.0/',
    changes='All 399,331 positions from 224 nonempty published processed GPS logs (103 SpeedyBee, 121 Pixhawk); eight header-only GPS logs and one non-GPS telemetry file excluded. Every original GPS row and field retained, without interpolation or thinning. Each log starts at elapsed zero on the artificial display date 2000-01-01 UTC; these are aligned elapsed flight times, not actual UTC or simultaneous flights. Original microsecond counters and archive member paths remain attributes. SpeedyBee GPS_altitude and Pixhawk alt are retained in metres as approximate reported heights; no vertical datum conversion. The nested, differently recorded Pixhawk lap_032 is kept as a separate log. Zenodo v1.0 metadata specifies CC BY 4.0; the archive README also describes education/research use.')


def camera(bounds, altitude, tilt_degrees=40):
    w, s, e, n = bounds
    lat, lon = math.radians((s+n)/2), math.radians((w+e)/2)
    sn, cs = math.sin(lat), math.cos(lat)
    sl, cl = math.sin(lon), math.cos(lon)
    radius = 6378137 / math.sqrt(1-6.6943799901413165e-3*sn*sn)
    target = [(radius+altitude)*cs*cl, (radius+altitude)*cs*sl,
              (radius*(1-6.6943799901413165e-3)+altitude)*sn]
    north, up = [-sn*cl, -sn*sl, cs], [cs*cl, cs*sl, sn]
    tilt = math.radians(tilt_degrees)
    direction = [v*math.sin(tilt)-u*math.cos(tilt) for v, u in zip(north, up)]
    camera_up = [v*math.cos(tilt)+u*math.sin(tilt) for v, u in zip(north, up)]
    distance = max((e-w)*math.cos(lat), n-s)*111320*1.3
    return dict(position=[t-d*distance for t, d in zip(target, direction)], direction=direction, up=camera_up)


def generate(source):
    inputs = json.loads((ROOT/'samples/public/idf-source-manifest.json').read_text())
    events, counts, empty = [], {}, []
    for item in inputs['files']:
        file = source/item['local_path']
        data = file.read_bytes()
        if hashlib.sha256(data).hexdigest() != item['sha256']:
            raise ValueError('Source checksum mismatch: '+str(file))
        platform = item['platform']
        rows = list(csv.DictReader(data.decode('utf-8-sig').splitlines()))
        if not item['gps']:
            continue
        if not rows:
            empty.append(item['archive_member'])
            continue
        clock = 'time (us)' if platform == 'SpeedyBee' else 'timestamp'
        start = float(rows[0][clock])
        lap = re.search(r'[Ll]ap_?(\d+)', file.name)[1]
        suffix = '' if platform == 'SpeedyBee' else ' · log '+re.search(r'log_(\d+)_', file.name)[1]
        entity = f'{platform} · lap {int(lap):03d}{suffix}'
        if entity in counts:
            raise ValueError('Ambiguous GPS entity: '+entity)
        counts[entity] = len(rows)
        previous = -math.inf
        for number, row in enumerate(rows, 2):
            elapsed = (float(row[clock])-start)/1e6
            lat, lon, height = (float(row[k]) for k in (
                ('GPS_coord[0]', 'GPS_coord[1]', 'GPS_altitude') if platform == 'SpeedyBee' else ('lat', 'lon', 'alt')))
            if elapsed < previous or not all(math.isfinite(v) for v in [elapsed, lat, lon, height]) or not (-90 <= lat <= 90 and -180 <= lon <= 180) or (lat == 0 and lon == 0):
                raise ValueError(f'Invalid source GPS row: {file}:{number}')
            previous = elapsed
            attrs = {**row, 'elapsed_seconds':format(elapsed, '.6f'), 'time_basis':'Aligned elapsed flight time; artificial 2000-01-01 UTC anchor',
                     'altitude_note':'Reported metres; vertical datum unverified', 'value_unit':'m',
                     'platform':platform, 'archive_member':item['archive_member']}
            events.append(dict(entity=entity, time=ANCHOR+elapsed, end=None, lat=lat, lon=lon,
                               altitude=dict(meters=height, reference='reported'), value=height,
                               category=platform, label=entity, related_to='', tags=[], note='', attrs=attrs, source=item['archive_member'], source_row=number))
    assert len(events) == 399331 and len(counts) == 224 and len(empty) == 8
    events.sort(key=lambda e:(e['time'], e['entity'], e['source_row']))
    for number, event in enumerate(events, 1):
        event['id'] = number
    bounds = [min(e['lon'] for e in events), min(e['lat'] for e in events), max(e['lon'] for e in events), max(e['lat'] for e in events)]
    scene = dict(renderer='cesium', mode='globe', bounds=bounds, globe_altitude=True, globe_time=False,
                 render_budget=100000, inspector_tab='views', cesium_camera=camera(bounds, 300),
                 entity_colors={entity:['#b95c4c','#4583aa','#63976c','#9c6aab','#b59b58','#a66d8a'][i%6] for i, entity in enumerate(sorted(counts))},
                 display=dict(mode='points', spatial_culling=False, show_points=False, show_tracks=True,
                              show_trails=False, trail_pixels=0, trail_gap_minutes=0, track_opacity=.8, point_scale=.4, bloom=False))
    views=[]
    def saved(name, extra=None, filters=None):
        views.append(dict(name=name, scene={**scene, **(extra or {})}, mode='Map', filter={**FILTER, **(filters or {})}, selected=[], camera=CAMERA))
    saved('Reported altitude · all 224 GPS logs')
    saved('Time Height · aligned elapsed flight time', dict(globe_altitude=False, globe_time=True, globe_time_scale=1, cesium_camera=None))
    saved('Ground tracks · all GPS logs', dict(globe_altitude=False, globe_time=False, cesium_camera=camera(bounds, 0, 0)))
    saved('SpeedyBee · 103 nonempty GPS logs', filters=dict(hidden_categories=['Pixhawk']))
    saved('Pixhawk · 121 GPS logs', filters=dict(hidden_categories=['SpeedyBee']))
    project = dict(format='chronoscope.workspace', version=7, time_resolution='fractional_second', dataset=dict(name='IDF fixed-wing UAVs · aligned elapsed flight time', events=events),
                   mode='Map', scene=scene, filter=FILTER, selected=[], camera=CAMERA, views=views, groups=[], imports=[], provenance=[CREDIT])
    target = ROOT/'samples'/f'{STEM}.demo.zip'
    with zipfile.ZipFile(target, 'w') as archive:
        entry = zipfile.ZipInfo('manifest.json', (2026,10,31,0,0,0));entry.compress_type=zipfile.ZIP_DEFLATED
        with io.BufferedWriter(archive.open(entry, 'w', force_zip64=True), buffer_size=1048576) as stream:
            for chunk in json.JSONEncoder(ensure_ascii=False, separators=(',', ':'), allow_nan=False).iterencode(project):
                stream.write(chunk.encode())
    report = dict(records=len(events), logs=len(counts), platforms={p:sum(e['category']==p for e in events) for p in ['SpeedyBee','Pixhawk']},
                  platform_logs={p:sum(entity.startswith(p) for entity in counts) for p in ['SpeedyBee','Pixhawk']}, empty_gps_logs=empty,
                  altitude_range_m=[min(e['altitude']['meters'] for e in events), max(e['altitude']['meters'] for e in events)],
                  elapsed_range_seconds=[0, max(e['time'] for e in events)-ANCHOR], project_sha256=hashlib.sha256(target.read_bytes()).hexdigest(), project_bytes=target.stat().st_size)
    (ROOT/'samples/public/idf-provenance.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    (ROOT/'samples/public'/f'{STEM}.attribution.json').write_text(json.dumps([CREDIT], ensure_ascii=False, indent=2)+'\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('source', type=Path)
    generate(parser.parse_args().source)
