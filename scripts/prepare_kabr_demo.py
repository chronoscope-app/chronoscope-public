#!/usr/bin/env python3
"""Build a reproducible three-flight KABR demo from pinned original AirData CSVs.

Usage: python3 scripts/prepare_kabr_demo.py INPUT_DIRECTORY [--download]
Full downloaded logs stay in ignored local fixtures. See docs/KABR-UAV-DEMO.md.
"""
import argparse
import copy
import csv
import datetime as dt
import hashlib
import io
import json
import math
from pathlib import Path
import urllib.parse
import urllib.request
import zipfile
from prepare_real_demos import FILTER, CAMERA

ROOT = Path(__file__).resolve().parents[1]
STEM = 'kabr-uav-kenya-2023'
LAYER = 'KABR UAV flights · Kenya · January 2023'
SOURCE = 'https://huggingface.co/datasets/imageomics/kabr_airdata'
FILES = [
    ('Jan-11th-2023-10-45AM-Flight-Airdata.csv', '66bf7ea4e7dc4823833bdeebd47eb1a1418b5fde1c16fafee2e56e64b93f1e73', 6240),
    ('Jan-12th-2023-02-37PM-Flight-Airdata.csv', 'c4ca15f3c3a810daa890711d9e0a900a2ce11d31c70689034308ce64b679a753', 7189),
    ('Jan-20th-2023-02-30PM-Flight-Airdata.csv', '71220df59c165412be4960fd370aa6833631c077b109a4991487091cc235d96b', 12495),
]
CREDIT = dict(title='KABR AirData Drone Telemetry · three complete Kenyan wildlife-monitoring flights',
    creator='Imageomics Institute / KABR project; curated by Jenna Kline', source_url=SOURCE,
    license='CC0 1.0', license_url='https://creativecommons.org/publicdomain/zero/1.0/',
    changes='Three complete original AirData logs from January 11, 12 and 20, 2023; 25,924 records (25,918 located; six initial zero/zero GPS fixes retained as unlocated), no thinning, interpolation, date shifts or time alignment. Published datetime(utc) seconds are retained exactly, including repeated seconds; original time(millisecond) counters remain attributes. All original fields, filenames and source rows retained in one Event layer, with a distinct entity per flight. Canonical reported altitude and Value use height_above_takeoff(feet) converted by 0.3048 to metres, as an explicitly approximate takeoff-relative display offset above the map reference floor, not an absolute ellipsoid/sea-level altitude or terrain clearance. Source altitude_above_seaLevel(feet) is separately retained verbatim and converted to reported_amsl_m in attributes; no geoid/vertical-datum conversion or terrain-height reconstruction. Small negative source heights are retained. Opens on January 12 only; other flights are available through saved views and Full range. Flight-state categories are original controller states. No endorsement implied.')


def camera(bounds, height=22):
    w, s, e, n = bounds
    lat, lon = math.radians((s+n)/2), math.radians((w+e)/2)
    sn, cs, sl, cl = math.sin(lat), math.cos(lat), math.sin(lon), math.cos(lon)
    radius = 6378137 / math.sqrt(1 - 6.6943799901413165e-3 * sn*sn)
    target = [(radius+height)*cs*cl, (radius+height)*cs*sl,
              (radius*(1-6.6943799901413165e-3)+height)*sn]
    north, up = [-sn*cl, -sn*sl, cs], [cs*cl, cs*sl, sn]
    tilt = math.radians(57)
    direction = [v*math.sin(tilt)-u*math.cos(tilt) for v, u in zip(north, up)]
    camera_up = [v*math.cos(tilt)+u*math.sin(tilt) for v, u in zip(north, up)]
    distance = max((e-w)*math.cos(lat), n-s) * 111320 * 1.65
    return dict(position=[t-d*distance for t, d in zip(target, direction)], direction=direction, up=camera_up)


def time_camera(bounds):
    # Columbus view camera coordinates use the WGS84 geographic projection.
    # Frame this small field flight explicitly rather than the generic 1 km Fit.
    w, s, e, n = bounds
    extent = max((e-w)*111319.4908*math.cos(math.radians((s+n)/2)), (n-s)*111319.4908)
    tilt = math.radians(48)
    target = [6378137*math.radians((w+e)/2), 6378137*math.radians((s+n)/2), extent/2+2]
    direction = [0, math.sin(tilt), -math.cos(tilt)]
    up = [0, math.cos(tilt), math.sin(tilt)]
    return dict(position=[v-d*700 for v, d in zip(target, direction)], direction=direction, up=up)


def bounds(events):
    events = [e for e in events if e['lat'] is not None and e['lon'] is not None]
    return [min(e['lon'] for e in events), min(e['lat'] for e in events),
            max(e['lon'] for e in events), max(e['lat'] for e in events)]


def generate(folder, download=False):
    folder.mkdir(parents=True, exist_ok=True)
    events, flights = [], []
    for name, digest, count in FILES:
        path = folder/name
        if not path.exists() and download:
            url = SOURCE+'/resolve/main/'+urllib.parse.quote(name)
            with urllib.request.urlopen(url, timeout=60) as response:
                path.write_bytes(response.read())
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != digest:
            raise ValueError('Unexpected source SHA-256: '+name)
        reader = csv.DictReader(io.StringIO(data.decode('utf-8-sig')))
        # csv.line_num includes physical lines inside quoted messages.
        # source_row uses the original logical CSV record number instead.
        records = []
        previous = -math.inf
        for number, raw in enumerate(reader, 2):
            epoch = dt.datetime.strptime(raw['datetime(utc)'], '%Y-%m-%d %H:%M:%S').replace(tzinfo=dt.timezone.utc).timestamp()
            lat, lon = float(raw['latitude']), float(raw['longitude'])
            height = float(raw['height_above_takeoff(feet)'])*0.3048
            amsl = float(raw['altitude_above_seaLevel(feet)'])*0.3048
            if not all(math.isfinite(v) for v in [epoch, lat, lon, height, amsl]) or not -90<=lat<=90 or not -180<=lon<=180 or epoch<previous:
                raise ValueError(f'Invalid original telemetry row: {name}:{number}')
            previous = epoch
            entity = 'UAV · '+raw['datetime(utc)'][:10]
            state = raw['flycState']
            attrs = {**raw, 'source_file':name, 'chronoscope_original_source':name,
                     'height_above_takeoff_m':repr(height), 'reported_amsl_m':repr(amsl),
                     'altitude_basis':'Height above takeoff; approximate display above reference floor, not ellipsoid/AMSL/AGL',
                     'value_unit':'m above takeoff'}
            event = dict(entity=entity, time=epoch, end=None, lat=None if lat == lon == 0 else lat, lon=None if lat == lon == 0 else lon,
                altitude=dict(meters=height, reference='reported'), value=height,
                category=state, label=state.replace('_', ' '), related_to='', tags=[],
                note='Height above takeoff (reported). Globe uses a takeoff-relative map reference floor. Original sea-level altitude is separate in attributes; this is not terrain clearance.',
                attrs=attrs, source=LAYER, source_row=number)
            events.append(event); records.append(event)
        if len(records) != count or records[0]['value'] != 0 or records[-1]['value'] != 0:
            raise ValueError('Unexpected row count or takeoff/landing endpoints: '+name)
        flights.append(dict(file=name, sha256=digest, records=count, entity=records[0]['entity'],
            first=records[0]['time'], last=records[-1]['time'], bounds=bounds(records),
            maximum_height_m=max(e['value'] for e in records), located=sum(e['lat'] is not None for e in records)))
    events.sort(key=lambda e:(e['time'], e['entity'], e['source_row']))
    for i, event in enumerate(events, 1): event['id'] = i
    default = flights[1]
    display = dict(mode='points', spatial_culling=False, show_points=True, show_tracks=True,
        show_trails=False, trail_pixels=0, trail_gap_minutes=2, track_opacity=.9, point_scale=.4, bloom=False)
    measurement = dict(title='Height above takeoff · reported', minimum=0, maximum=60, unit=' m')
    def scene(flight, mode='globe'):
        return dict(renderer='cesium', mode=mode, bounds=flight['bounds'], render_budget=20000,
            globe_altitude=mode=='globe', globe_time=False, time_height=4,
            inspector_tab='views', display=copy.deepcopy(display), measurement=measurement,
            cesium_camera=camera(flight['bounds']) if mode=='globe' else time_camera(flight['bounds']) if mode=='space-time' else None)
    def view(name, flight, mode='globe'):
        return dict(name=name, scene=scene(flight, mode), mode='Map',
            filter={**copy.deepcopy(FILTER), 'start':flight['first'], 'end':flight['last']}, selected=[], camera=CAMERA)
    views = [view('January 12 · Time · takeoff to landing', default, 'space-time'),
             view('January 12 · Globe · height above takeoff', default),
             view('January 11 · Globe · 15 m wildlife observation', flights[0]),
             view('January 20 · Globe · 628 m route and return', flights[2])]
    overview = dict(name='All three flights · original dates · map', scene={**scene(default, 'map'), 'bounds':bounds(events)},
        mode='Map', filter=copy.deepcopy(FILTER), selected=[], camera=CAMERA)
    views.append(overview)
    project = dict(format='chronoscope.workspace', version=7, time_resolution='fractional_second',
        dataset=dict(name='KABR UAV flights · takeoff, wildlife survey and landing', events=events),
        mode='Map', scene=scene(default), filter=copy.deepcopy(views[1]['filter']), selected=[], camera=CAMERA,
        views=views, groups=[], imports=[], provenance=[CREDIT])
    target = ROOT/'samples'/f'{STEM}.chronoscope'
    with zipfile.ZipFile(target, 'w') as archive:
        info = zipfile.ZipInfo('manifest.json', (2026,10,31,0,0,0)); info.compress_type = zipfile.ZIP_DEFLATED
        archive.writestr(info, json.dumps(project,ensure_ascii=False,separators=(',',':'),allow_nan=False))
    (ROOT/'samples/public'/f'{STEM}.attribution.json').write_text(json.dumps([CREDIT],ensure_ascii=False,indent=2)+'\n')
    report = dict(records=len(events), flights=flights, source_url=SOURCE, license='CC0 1.0',
        layer=LAYER, default_visible=default['records'], project_sha256=hashlib.sha256(target.read_bytes()).hexdigest())
    (ROOT/'samples/public/kabr-uav-provenance.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(report,indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input_dir', type=Path)
    parser.add_argument('--download', action='store_true')
    args = parser.parse_args()
    generate(args.input_dir, args.download)
