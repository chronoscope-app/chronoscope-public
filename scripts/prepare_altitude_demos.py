#!/usr/bin/env python3
"""Reproduce offline altitude demos from downloaded public sources.

Usage: python3 scripts/prepare_altitude_demos.py INPUT_DIRECTORY
See docs/ALTITUDE-DEMOS.md for source URLs, checksums and interpretation.
Only source samples are retained; no added interpolation or duplicate entities.
"""
import csv
import datetime as dt
import hashlib
import io
import json
from pathlib import Path
import sys
import zipfile
from prepare_real_demos import FILTER, CAMERA

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(sys.argv[1])
REPORT = {}
EXPECTED = {'CSV.zip': 'f929a7a1bfbfef67e90b4ffa081dd447478472a54fcd0e84e94e53800a476838'}
for filename, digest in EXPECTED.items():
    if hashlib.sha256((SOURCE/filename).read_bytes()).hexdigest() != digest:
        raise ValueError(f"Unexpected source SHA-256: {filename}")


def epoch(text):
    return dt.datetime.fromisoformat(text.replace('Z', '+00:00')).timestamp()


def event(entity, seconds, lat, lon, meters, row, filename):
    return dict(entity=entity, time=seconds, lat=float(lat), lon=float(lon),
                altitude=dict(meters=float(meters), reference='reported'), value=None,
                end=None, category='', label=entity, related_to='', tags=[], note='',
                attrs={'source_file':filename, 'source_row':str(row)}, source=filename, source_row=row)


def write(stem, title, events, provenance):
    events.sort(key=lambda e: (e['time'], e['entity'], e['source_row']))
    for i, e in enumerate(events, 1):
        e['id'] = i
    bounds = [min(e['lon'] for e in events), min(e['lat'] for e in events),
              max(e['lon'] for e in events), max(e['lat'] for e in events)]
    scene = dict(renderer='cesium', mode='globe', bounds=bounds, globe_time=False,
                 globe_altitude=True, render_budget=100000, inspector_tab='views',
                 display=dict(mode='points', show_points=True, show_tracks=True,
                              show_trails=True, track_opacity=.55, trail_opacity=.12,
                              trail_gap_minutes=2, point_scale=.65, bloom=False))
    views=[]
    for name, extra in [('Physical altitude · approximate reported heights', {}),
                        ('Time Height', dict(globe_altitude=False, globe_time=True)),
                        ('Ground tracks', dict(globe_altitude=False, globe_time=False))]:
        views.append(dict(name=name, scene={**scene, **extra}, mode='Map',
                          filter=FILTER, selected=[], camera=CAMERA))
    project=dict(format='chronoscope.workspace', version=7, time_resolution='fractional_second',
                 dataset=dict(name=title, events=events), mode='Map', scene=scene,
                 filter=FILTER, selected=[], camera=CAMERA, views=views, groups=[], imports=[],
                 provenance=provenance)
    target=ROOT/'samples'/f'{stem}.chronoscope'
    with zipfile.ZipFile(target, 'w') as z:
        entry=zipfile.ZipInfo('manifest.json', (2026,10,28,0,0,0));entry.compress_type=zipfile.ZIP_DEFLATED
        z.writestr(entry,json.dumps(project,ensure_ascii=False,separators=(',',':'),allow_nan=False))
    table=ROOT/'samples/public'/f'{stem}.csv'
    with table.open('w',newline='') as f:
        w=csv.writer(f,lineterminator='\n');w.writerow(['entity','timestamp','latitude','longitude','altitude_m','altitude_reference','source_file','source_row'])
        for e in events:
            w.writerow([e['entity'],dt.datetime.fromtimestamp(e['time'],dt.timezone.utc).isoformat(),e['lat'],e['lon'],e['altitude']['meters'],'reported',e['source'],e['source_row']])
    Path(str(table)+'.attribution.json').write_text(json.dumps(provenance,ensure_ascii=False,indent=2)+'\n')
    REPORT[stem]=dict(records=len(events),entities=len({e['entity'] for e in events}),
                      minimum_m=min(e['altitude']['meters'] for e in events),maximum_m=max(e['altitude']['meters'] for e in events),
                      project_sha256=hashlib.sha256(target.read_bytes()).hexdigest(),csv_sha256=hashlib.sha256(table.read_bytes()).hexdigest())


def flights():
    archive=SOURCE/'CSV.zip'
    if hashlib.md5(archive.read_bytes()).hexdigest()!='c0e2531e7a887c7172f4a53f18a80ca4':
        raise ValueError('Flight archive checksum differs from Zenodo record')
    events=[]
    with zipfile.ZipFile(archive) as z:
        names=sorted(n for n in z.namelist() if n.endswith('.csv'))[:100]
        for name in names:
            rows=list(csv.DictReader(io.StringIO(z.read(name).decode('utf-8-sig'))))
            entity=Path(name).stem.removeprefix('TRAIN_')
            for i,r in enumerate(rows):
                if i%5 and i!=len(rows)-1:continue
                events.append(event(entity,float(r['TIME']),r['LAT'],r['LON'],r['GEOALTITUDE'],i+2,name))
    write('flights-lhr-zrh-100-2025','100 London–Zurich flights · reported altitude',events,[dict(
        title='Cleaned ADS-B Trajectories (LHR-ZRH 2025) for AI Training',
        creator='Khalid El Ouanbi; Issam Amellal; LAMSAD / Hassan First University; original telemetry OpenSky Network',
        source_url='https://doi.org/10.5281/zenodo.18916312',license='CC BY 4.0',license_url='https://creativecommons.org/licenses/by/4.0/',
        changes='First 100 CSV filenames in lexical order. Every fifth source row and final row retained. Upstream data already median-filtered, corrected and interpolated to 1 Hz. GEOALTITUDE is corrected barometric height according to the upstream README; represented as reported metres with unknown physical datum, not precise ellipsoid altitude. No further altitude correction or interpolation. Entity combines source date and callsign.')])



flights()
REPORT['inputs_sha256']={'CSV.zip':EXPECTED['CSV.zip']}
(ROOT/'samples/public/altitude-provenance.json').write_text(json.dumps(REPORT,indent=2,sort_keys=True)+'\n')
print(json.dumps(REPORT,indent=2))
