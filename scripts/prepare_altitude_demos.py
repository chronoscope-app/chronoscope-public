#!/usr/bin/env python3
"""Reproduce offline altitude demos from downloaded public sources.

Usage: python3 scripts/prepare_altitude_demos.py INPUT_DIRECTORY [--download]
See docs/ALTITUDE-DEMOS.md for source URLs, checksums and interpretation.
Only source samples are retained; no added interpolation or duplicate entities.
"""
import argparse
import csv
import datetime as dt
import hashlib
import io
import json
import math
from pathlib import Path
import struct
import urllib.request
import zlib
import zipfile
from prepare_real_demos import FILTER, CAMERA

ROOT = Path(__file__).resolve().parents[1]
REPORT = {}
SOURCE_URL = 'https://zenodo.org/records/20534917/files/dataset.zip'
# Pinned byte ranges avoid downloading ~1 GB of modified/poison/model-ready data.
PARTS = {
    'dataset-directory.bin': (1084909633, 8303898, 'b424955a4dd5ec2419ccae5b7f02954e183f433ce0ed6e53089186e1bf4b05ba'),
    'raw-flights.bin': (895180013, 41319432, '1c13a9ae463cbce1470617d8c34a4cb16c354ec2748a2e55c90586dd7f950f44'),
}
STEM = 'flights-philippines-week-2026'
WEEK = dt.datetime(2026, 3, 1, tzinfo=dt.timezone.utc)
# Names follow the five route groups described by the source record.
ROUTES = {'data_ceb': ('RPVM', 'Cebu', '#65c4e8'),
          'data_dvo': ('RPMD', 'Davao', '#ffb3a7'),
          'data_ilo': ('RPVI', 'Iloilo', '#ffd166'),
          'data_mph': ('RPVE', 'Caticlan', '#ad9feb'),
          'data_pps': ('RPVP', 'Puerto Princesa', '#8bd6bc')}


def event(entity, seconds, lat, lon, meters, row, filename):
    return dict(entity=entity, time=seconds, lat=float(lat), lon=float(lon),
                altitude=dict(meters=float(meters), reference='reported'), value=None,
                end=None, category='', label=entity, related_to='', tags=[], note='',
                attrs={'source_file':filename, 'source_row':str(row)}, source=filename, source_row=row)


def overview_camera():
    """Oblique overview makes vertical paths visible in the saved scenes."""
    lon, lat = map(math.radians, (122.1, 10.7))
    sin_lat, cos_lat = math.sin(lat), math.cos(lat)
    sin_lon, cos_lon = math.sin(lon), math.cos(lon)
    eccentricity_squared = 6.6943799901413165e-3
    radius = 6378137/math.sqrt(1-eccentricity_squared*sin_lat*sin_lat)
    target = [radius*cos_lat*cos_lon, radius*cos_lat*sin_lon,
              radius*(1-eccentricity_squared)*sin_lat]
    north = [-sin_lat*cos_lon, -sin_lat*sin_lon, cos_lat]
    up = [cos_lat*cos_lon, cos_lat*sin_lon, sin_lat]
    tilt = math.radians(45)
    direction = [n*math.sin(tilt)-u*math.cos(tilt) for n,u in zip(north,up)]
    camera_up = [n*math.cos(tilt)+u*math.sin(tilt) for n,u in zip(north,up)]
    return dict(position=[t-d*1600000 for t,d in zip(target,direction)],
                direction=direction, up=camera_up)


def write(stem, title, events, provenance):
    events.sort(key=lambda e: (e['time'], e['entity'], e['source_row']))
    for i, e in enumerate(events, 1):
        e['id'] = i
    bounds = [min(e['lon'] for e in events), min(e['lat'] for e in events),
              max(e['lon'] for e in events), max(e['lat'] for e in events)]
    scene = dict(renderer='cesium', mode='globe', bounds=bounds, globe_time=False,
                 globe_altitude=True, render_budget=20000, inspector_tab='views',
                 cesium_camera=overview_camera(),
                 display=dict(mode='points', show_points=True, show_tracks=True,
                              show_trails=True, track_opacity=.55, trail_opacity=.12,
                              trail_gap_minutes=2, point_scale=.4, bloom=False),
                 entity_colors={e['entity']: next(color for airport, _, color in ROUTES.values()
                     if airport == e['attrs']['arrival_airport']) for e in events})
    views=[]
    for name, extra in [('Physical altitude · approximate reported heights', {}),
                        ('Time Height', dict(globe_altitude=False, globe_time=True, globe_time_scale=4)),
                        ('Ground tracks', dict(globe_altitude=False, globe_time=False))]:
        views.append(dict(name=name, scene={**scene, **extra}, mode='Map',
                          filter=FILTER, selected=[], camera=CAMERA))
    views.append(dict(name='Day 1 · 24-hour playback window', scene=scene, mode='Map',
                      filter={**FILTER, 'start': events[0]['time'],
                              'end': events[0]['time']+86400},
                      selected=[], camera=CAMERA))
    project=dict(format='chronoscope.workspace', version=7, time_resolution='fractional_second',
                 dataset=dict(name=title, events=events), mode='Map', scene=scene,
                 filter=FILTER, selected=[], camera=CAMERA, views=views, groups=[], imports=[],
                 provenance=provenance)
    target=ROOT/'samples'/f'{stem}.chronoscope'
    with zipfile.ZipFile(target, 'w') as z:
        entry=zipfile.ZipInfo('manifest.json', (2026,10,29,0,0,0));entry.compress_type=zipfile.ZIP_DEFLATED
        z.writestr(entry,json.dumps(project,ensure_ascii=False,separators=(',',':'),allow_nan=False))
    table=ROOT/'samples/public'/f'{stem}.csv'
    with table.open('w',newline='') as f:
        w=csv.writer(f,lineterminator='\n');w.writerow(['entity','timestamp','latitude','longitude','altitude_m','altitude_reference','departure_airport','arrival_airport','aircraft_type','route','flight_id','source_flight_id','source_file','source_row'])
        for e in events:
            w.writerow([e['entity'],dt.datetime.fromtimestamp(e['time'],dt.timezone.utc).isoformat(),e['lat'],e['lon'],e['altitude']['meters'],'reported',e['attrs']['departure_airport'],e['attrs']['arrival_airport'],e['attrs']['aircraft_type'],e['category'],e['attrs']['flight_id'],e['attrs']['source_flight_id'],e['attrs']['source_file'],e['source_row']])
    Path(str(table)+'.attribution.json').write_text(json.dumps(provenance,ensure_ascii=False,indent=2)+'\n')
    REPORT[stem]=dict(records=len(events),entities=len({e['entity'] for e in events}),
                      minimum_m=min(e['altitude']['meters'] for e in events),maximum_m=max(e['altitude']['meters'] for e in events),
                      project_sha256=hashlib.sha256(target.read_bytes()).hexdigest(),csv_sha256=hashlib.sha256(table.read_bytes()).hexdigest())


def verified_parts(source, download):
    source.mkdir(parents=True, exist_ok=True)
    parts = {}
    for name, (offset, size, digest) in PARTS.items():
        path = source/name
        if not path.exists() and download:
            request = urllib.request.Request(SOURCE_URL+'?part='+name,
                headers={'Range': f'bytes={offset}-{offset+size-1}'})
            temporary = path.with_suffix('.partial')
            try:
                with urllib.request.urlopen(request, timeout=90) as response, temporary.open('wb') as output:
                    expected_range = f'bytes {offset}-{offset+size-1}/1093213553'
                    if response.status != 206 or response.headers.get('Content-Range') != expected_range:
                        raise ValueError('Server did not return the pinned archive range')
                    remaining = size
                    while remaining:
                        chunk = response.read(min(1048576, remaining))
                        if not chunk:
                            raise ValueError('Truncated archive range')
                        output.write(chunk)
                        remaining -= len(chunk)
                if hashlib.sha256(temporary.read_bytes()).hexdigest() != digest:
                    raise ValueError(f'Unexpected source SHA-256: {name}')
                temporary.replace(path)
            finally:
                temporary.unlink(missing_ok=True)
        data = path.read_bytes()
        if len(data) != size or hashlib.sha256(data).hexdigest() != digest:
            raise ValueError(f'Unexpected source length or SHA-256: {name}')
        parts[name] = data
    return parts


def original_flights(parts):
    """Read only original CSV members, validating ZIP lengths and CRCs."""
    directory = parts['dataset-directory.bin']
    block = parts['raw-flights.bin']
    offset = 0
    while offset < len(directory):
        header = struct.unpack_from('<4s6H3L5H2L', directory, offset)
        if header[0] != b'PK\x01\x02':
            raise ValueError('Invalid ZIP directory')
        name = directory[offset+46:offset+46+header[10]].decode('utf-8')
        offset += 46+sum(header[10:13])
        pieces = name.split('/')
        if len(pieces) != 4 or pieces[:2] != ['dataset', 'raw'] or pieces[2] not in ROUTES or not name.endswith('.csv'):
            continue
        if header[4] != 8 or header[9] > 8*1024*1024:
            raise ValueError('Unexpected original-flight ZIP member')
        local_offset = header[16]-PARTS['raw-flights.bin'][0]
        local = struct.unpack_from('<4s5H3L2H', block, local_offset)
        if local[0] != b'PK\x03\x04':
            raise ValueError('Invalid local ZIP member')
        start = local_offset+30+local[-2]+local[-1]
        data = zlib.decompress(block[start:start+header[8]], -15)
        if len(data) != header[9] or zlib.crc32(data) != header[7]:
            raise ValueError(f'Original-flight length/CRC mismatch: {name}')
        yield name, data


def flights(source, download=False):
    parts = verified_parts(source, download)
    candidates = {}
    week_end = (WEEK+dt.timedelta(days=7)).timestamp()
    for name, data in original_flights(parts):
        reader = csv.DictReader(io.StringIO(data.decode('utf-8-sig')))
        first = next(reader)
        first_time = float(first['timestamp'])
        if not WEEK.timestamp() <= first_time < week_end:
            continue
        rows = [first, *reader]
        times = [float(row['timestamp']) for row in rows]
        if times != sorted(times) or times[-1] >= week_end:
            raise ValueError(f'Flight is unsorted or leaves the selected week: {name}')
        day = int((first_time-WEEK.timestamp())//86400)
        key = (day, name.split('/')[2])
        candidates.setdefault(key, []).append((first_time, name, rows, hashlib.sha256(data).hexdigest()))

    events, selected = [], []
    for day in range(7):
        for route, (airport, city, _) in ROUTES.items():
            choices = sorted(candidates[(day, route)], key=lambda item: item[:2])
            if len(choices) < 5:
                raise ValueError(f'Insufficient original flights for day {day+1}, {route}')
            # Spread departures across each day's available times, independently per route.
            for index in [round(i*(len(choices)-1)/4) for i in range(5)]:
                first_time, name, rows, digest = choices[index]
                # Some upstream cells parsed hex IDs such as 3e946461 as a
                # floating exponent ("inf"). The original filename retains it.
                flight_id = Path(name).stem.split('_')[1]
                if not Path(name).stem.endswith(f'_{flight_id}_RPLL_to_{airport}'):
                    raise ValueError(f'Unexpected route or flight identifier: {name}')
                retained = [0]
                for i in range(1, len(rows)-1):
                    if float(rows[i]['timestamp'])-float(rows[retained[-1]]['timestamp']) >= 45:
                        retained.append(i)
                if retained[-1] != len(rows)-1:
                    retained.append(len(rows)-1)
                for i in retained:
                    row = rows[i]
                    e = event(f'RPLL → {airport} · {flight_id}', float(row['timestamp']),
                              row['latitude'], row['longitude'], row['altitude_meters'], i+2, name)
                    if not (-90 <= e['lat'] <= 90 and -180 <= e['lon'] <= 180 and
                            0 <= e['altitude']['meters'] <= 15000):
                        raise ValueError(f'Invalid flight coordinates/altitude: {name}:{i+2}')
                    e['category'] = f'Manila → {city}'
                    e['attrs'].update(flight_id=flight_id, source_flight_id=row['flight_id'],
                        departure_airport='RPLL', arrival_airport=airport, aircraft_type=row['aircraft_type'])
                    e['attrs']['chronoscope_original_source'] = e['source']
                    e['source'] = 'Philippine flights · March 1–7, 2026'
                    events.append(e)
                selected.append(dict(source_file=name, sha256=digest, source_records=len(rows),
                    retained_records=len(retained), departure_utc=dt.datetime.fromtimestamp(first_time, dt.timezone.utc).isoformat()))

    provenance = [dict(title='Authentic and Modified ADS-B Flight Data of Major Philippine Domestic Routes',
        creator='Alexander Bañados, University of the Philippines Diliman; original-flight data collected via Flightradar24',
        source_url='https://doi.org/10.5281/zenodo.20534917',
        related_source_url='https://doi.org/10.17632/tjh279d4f7.1',
        license='CC BY 4.0', license_url='https://creativecommons.org/licenses/by/4.0/',
        changes='Only original dataset/raw flight CSVs; no modified-altitude, speed, position, poison or sequence-window data. March 1–7, 2026 UTC; five flights per route per day, spread across available departure times (175 flights; six airports). Retain first and last rows and original rows at least 45 seconds apart. Preserve original Unix timestamps, coordinates and altitude_meters without added interpolation or date shifts. Heights use reported/approximate metres: the physical datum and upstream processing are unspecified; zero is retained as reported, not certified ground elevation. Colors distinguish the five routes. Hexadecimal flight IDs come from original filenames; source_flight_id preserves upstream cells, some of which were corrupted to floating-point notation or inf. Source filenames, rows, aircraft type and airport codes retained. All files are grouped into one Event layer; original file paths remain in source_file and chronoscope_original_source. Archive regions verified by pinned SHA-256; original members verified by ZIP CRC/length and recorded SHA-256. No endorsement implied.')]
    write(STEM, 'A week of Philippine flights · 175 departures · 6 airports', events, provenance)
    REPORT[STEM].update(first_timestamp=dt.datetime.fromtimestamp(events[0]['time'], dt.timezone.utc).isoformat(),
        last_timestamp=dt.datetime.fromtimestamp(events[-1]['time'], dt.timezone.utc).isoformat(),
        flights_per_departure_day=25, flights_per_route_per_day=5,
        airports=['RPLL', *[airport for airport, _, _ in ROUTES.values()]], selected_original_files=selected)
    REPORT['source'] = dict(url=SOURCE_URL, archive_bytes=1093213553,
        published_archive_md5='4e10c93ea0a880ff75a1ecac57dc8fbc',
        archive_md5_verified=False,
        note='Only pinned byte ranges downloaded; the published whole-archive MD5 is informational.',
        parts={name: dict(offset=offset, bytes=size, sha256=digest) for name, (offset,size,digest) in PARTS.items()})
    (ROOT/'samples/public/altitude-provenance.json').write_text(json.dumps(REPORT,indent=2,sort_keys=True)+'\n')
    print(json.dumps({key: value for key,value in REPORT[STEM].items() if key != 'selected_original_files'},indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input_directory', type=Path)
    parser.add_argument('--download', action='store_true', help='Fetch only ~50 MB of pinned original-flight archive regions')
    args = parser.parse_args()
    flights(args.input_directory, args.download)
