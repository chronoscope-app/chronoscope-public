#!/usr/bin/env python3
"""Build licensed Starlink/Falcon 9 demos; optionally export the full stress CSVs.

Inputs and pinned checksums: docs/SPACE-DEMOS.md. Requires pyarrow, numpy,
astropy and astropy-iers-data. No network access occurs during generation.
"""
import argparse
import csv
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import re
import zipfile
from collections import Counter

from prepare_real_demos import FILTER, CAMERA

ROOT = Path(__file__).resolve().parents[1]
PARQUET = 'operational__starlink__ephemeris_state.parquet'
EXPECTED = {
    PARQUET: '669cda18d73666a5781fcbe29546b69eb8ea4b933056d905a030ae7cbec2ed5e',
    'launch.tsv': '6b1723ea3d429bfc687be41c4caa2fea37c93b4f0dac158dcc59a638bd0d56ef',
    'lp.tsv': 'd78a2617120e299136b00902a784707b345c8f8d9ce6259a26733758afe13b53',
}
STARLINK_CREDIT = dict(
    title='MAD-LEO v1 · Starlink operational ephemerides',
    creator='Zhixin Guo et al. (2026); original predicted ephemerides published by SpaceX',
    source_url='https://doi.org/10.6084/m9.figshare.33446503.v1',
    license='CC BY 4.0', license_url='https://creativecommons.org/licenses/by/4.0/',
    changes='Deterministic 128-satellite subset, six hours of original 60-second predicted states. NORAD IDs distinguish reused satellite names. MEME is interpreted as fixed J2000 equinox, following the source authors’ frame audit, then transformed to ITRS and WGS84 geodetic latitude/longitude/ellipsoid height with Astropy and bundled IERS data. The source does not specify the MEME equinox; this assumption and predicted positions are approximate, not measured telemetry or maneuver truth. Source below_surface states are excluded from this small demo. No extra time samples, orbit propagation or synthetic satellites are added.')
FALCON_CREDIT = dict(
    title='GCAT Falcon 9 launch list and launch-point table · 2026-10-27 snapshot',
    creator='Jonathan McDowell, https://planet4589.org',
    source_url='https://planet4589.org/space/gcat/',
    license='CC BY 4.0', license_url='https://creativecommons.org/licenses/by/4.0/',
    changes='Select LV_Type exactly Falcon 9, retaining all 700 launch records including failures and the Dragon in-flight abort test; exclude five Falcon 9R development hops. Place each launch at its published launch-pad location, not a vehicle trajectory. Preserve UTC dates and source precision; minute-only times become one-minute intervals and question-mark times retain an approximate flag. VSFBS/VS refer to the same Vandenberg SLC-4E launch point. No flight coordinates or physical altitude are inferred. All original launch columns are retained as attributes.')


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        while chunk := stream.read(4 * 1024 * 1024):
            h.update(chunk)
    return h.hexdigest()


def read_tsv(path):
    lines = path.read_text().splitlines()
    return [{k: (v or '').strip() for k, v in row.items() if k}
            for row in csv.DictReader([lines[0]] + [l for l in lines[1:] if not l.startswith('#')], delimiter='\t')]


def event(entity, epoch, lat, lon, altitude, source_row, *, category='', label='', attrs=None, end=None):
    return dict(entity=entity, time=float(epoch), end=end, lat=float(lat), lon=float(lon),
                altitude=altitude, value=altitude['meters'] / 1000 if altitude else 1.,
                category=category, label=label or entity, related_to='', tags=[], note='',
                attrs=attrs or {}, source='SpaceX / MAD-LEO predicted ephemerides' if altitude else 'GCAT Falcon 9 launch catalog',
                source_row=source_row)


def save_demo(stem, title, events, scene, views, credit, window_filter=None):
    events.sort(key=lambda e: (e['time'], e['entity'], e['source_row']))
    for i, row in enumerate(events, 1):
        row['id'] = i
    project = dict(format='chronoscope.workspace', version=7, time_resolution='fractional_second',
                   dataset=dict(name=title, events=events), mode='Map', scene=scene,
                   filter=window_filter or FILTER, selected=[], camera=CAMERA, views=views, groups=[], imports=[], provenance=[credit])
    target = ROOT/'samples'/f'{stem}.chronoscope'
    with zipfile.ZipFile(target, 'w') as archive:
        entry = zipfile.ZipInfo('manifest.json', (2026, 10, 28, 0, 0, 0))
        entry.compress_type = zipfile.ZIP_DEFLATED
        archive.writestr(entry, json.dumps(project, ensure_ascii=False, separators=(',', ':'), allow_nan=False))
    table = ROOT/'samples/public'/f'{stem}.csv'
    fields = ['entity', 'timestamp', 'end_timestamp', 'latitude', 'longitude', 'altitude_m', 'altitude_reference', 'category', 'label', 'value', 'source_row']
    attributes = sorted(set().union(*(row['attrs'] for row in events)))
    with table.open('w', newline='') as stream:
        writer = csv.writer(stream, lineterminator='\n')
        writer.writerow(fields + attributes)
        for row in events:
            writer.writerow([row['entity'], iso(row['time']), iso(row['end']) if row['end'] else '', row['lat'], row['lon'],
                             row['altitude']['meters'] if row['altitude'] else '', row['altitude']['reference'] if row['altitude'] else '',
                             row['category'], row['label'], row['value'], row['source_row']] + [row['attrs'].get(k, '') for k in attributes])
    Path(str(table)+'.attribution.json').write_text(json.dumps([credit], ensure_ascii=False, indent=2)+'\n')
    return dict(records=len(events), entities=len({e['entity'] for e in events}),
                start_utc=iso(events[0]['time']), end_utc=iso(events[-1]['time']),
                project_sha256=digest(target), csv_sha256=digest(table))


def iso(epoch):
    return dt.datetime.fromtimestamp(epoch, dt.timezone.utc).isoformat().replace('+00:00', 'Z')


def saved(name, scene, window_filter=None):
    return dict(name=name, scene=scene, mode='Map', filter=window_filter or FILTER, selected=[], camera=CAMERA)


def falcon(source):
    pads = {(r['#Site'], r['Code']): r for r in read_tsv(source/'lp.tsv')}
    rows = [r for r in read_tsv(source/'launch.tsv') if r['LV_Type'] == 'Falcon 9']
    assert len(rows) == 700
    events = []
    months = {name: i for i, name in enumerate(['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'], 1)}
    for n, row in enumerate(rows, 1):
        match = re.fullmatch(r'(\d{4}) (\w{3})\s+(\d+) (\d{2})(\d{2})(?::(\d{2}))?(\?)?', row['Launch_Date'])
        if not match:
            raise ValueError('Unresolved Falcon launch time: '+row['Launch_Date'])
        y, month, day, hour, minute, second, approximate = match.groups()
        epoch = dt.datetime(int(y), months[month], int(day), int(hour), int(minute), int(second or 0), tzinfo=dt.timezone.utc).timestamp()
        site = 'VS' if row['Launch_Site'] == 'VSFBS' else row['Launch_Site']
        pad = pads[(site, row['Launch_Pad'])]
        category = {'CC':'Cape Canaveral · SLC-40', 'KSC':'Kennedy · LC-39A', 'VS':'Vandenberg · SLC-4E'}[site]
        attrs = {k.removeprefix('#'): v for k, v in row.items()}
        attrs.update(position_kind='Launch-pad location, not flight trajectory', utc_precision='approximate' if approximate else 'second' if second else 'minute', pad_coordinate_error_degrees=pad['Error'])
        events.append(event(row['#Launch_Tag']+' · '+row['Flight'], epoch, float(pad['Latitude']), float(pad['Longitude']), None, n,
                            category=category, label=row['Mission']+' · '+row['Flight_ID'], attrs=attrs, end=epoch+60 if second is None else None))
    scene = dict(renderer='cesium', mode='globe', bounds=[-126, 22, -75, 40], globe_time=True, globe_time_scale=20., globe_altitude=False,
                 render_budget=100000, inspector_tab='views', display=dict(mode='points', show_points=True, show_tracks=False, show_trails=False, track_opacity=0., trail_opacity=0., point_scale=1.1, bloom=False))
    views = [saved('700 launches · original UTC dates · Time Height', scene),
             saved('Three launch pads · exact launch locations', {**scene, 'mode':'map', 'globe_time':False, 'display':{**scene['display'], 'mode':'density'}})]
    report = save_demo('falcon9-launch-history-2010-2026', '700 Falcon 9 launches · 2010–2026 · launch-pad locations', events, scene, views, FALCON_CREDIT)
    report.update(launch_pads={k:sum(e['category']==k for e in events) for k in sorted({e['category'] for e in events})}, minute_precision=sum(e['end'] is not None for e in events), approximate_times=sum(e['attrs']['utc_precision']=='approximate' for e in events))
    return report


def starlink(source, stress_output):
    import numpy as np
    import pyarrow.parquet as pq
    import astropy
    import astropy.units as u
    from astropy.coordinates import CartesianRepresentation, PrecessedGeocentric, ITRS, EarthLocation
    from astropy.time import Time
    from astropy.utils import iers
    iers.conf.auto_download = False
    epochs = np.arange(6420, dtype=np.int64)*60_000_000_000 + int(dt.datetime(2024,11,26,6,0,42,tzinfo=dt.timezone.utc).timestamp()*1e9)
    times = Time(epochs.astype('datetime64[ns]'), format='datetime64', scale='utc')
    matrices = np.empty((len(epochs),3,3))
    frame = PrecessedGeocentric(equinox=Time('J2000'), obstime=times)
    for axis in range(3):
        basis = np.zeros((3,len(epochs)));basis[axis] = 1
        transformed = frame.realize_frame(CartesianRepresentation(basis*u.m)).transform_to(ITRS(obstime=times))
        matrices[:,:,axis] = transformed.cartesian.xyz.to_value(u.m).T
    assert np.max(np.abs(np.linalg.det(matrices)-1)) < 1e-10
    # TLE records and operator ephemerides do not have identical membership.
    # Select from complete source trajectories, never manufacture absent states.
    coverage = Counter()
    for batch in pq.ParquetFile(source/PARQUET).iter_batches(batch_size=65536, columns=['sat_id','epoch','quality_flag'],use_threads=False):
        sat, epoch, quality = [batch.column(i).to_numpy(zero_copy_only=False) for i in range(3)]
        ns = epoch.astype('datetime64[ns]').astype(np.int64)
        good = (ns>=epochs[0])&(ns<=epochs[360])&(quality=='')
        names, counts = np.unique(sat[good],return_counts=True)
        coverage.update({int(name):int(count) for name,count in zip(names,counts)})
    candidates = sorted(sat for sat,count in coverage.items() if count==361 and sat not in {45364,55344,58620})
    ids = np.array([candidates[i] for i in np.linspace(0,len(candidates)-1,128,dtype=int)], dtype=np.int64)
    events, controls = [], []
    count = bad_count = 0
    stress_files = []
    stress_stream = stress_writer = None
    if stress_output:
        stress_output.mkdir(parents=True, exist_ok=False)
    for batch in pq.ParquetFile(source/PARQUET).iter_batches(batch_size=65536, columns=['sat_id','satellite_name','epoch','x_m','y_m','z_m','quality_flag'], use_threads=False):
        cols = {name:batch.column(i).to_numpy(zero_copy_only=False) for i,name in enumerate(batch.schema.names)}
        ns = cols['epoch'].astype('datetime64[ns]').astype(np.int64)
        index = (ns-epochs[0])//60_000_000_000
        assert np.all((index>=0)&(index<len(epochs))) and np.all(ns==epochs[index])
        selected = np.isin(cols['sat_id'], ids)&(index<=360)&(cols['quality_flag']=='')
        if stress_output:
            take = np.ones(len(ns),dtype=bool)
        else:
            take = selected
        if not np.any(take):
            count += len(ns);continue
        raw = np.column_stack([cols[k][take] for k in ['x_m','y_m','z_m']])
        xyz = np.einsum('nij,nj->ni',matrices[index[take]],raw)
        location = EarthLocation.from_geocentric(xyz[:,0]*u.m,xyz[:,1]*u.m,xyz[:,2]*u.m)
        lat, lon, height = location.lat.deg, location.lon.deg, location.height.to_value(u.m)
        assert np.isfinite(xyz).all() and np.isfinite(height).all()
        positions = np.flatnonzero(take)
        for j,i in enumerate(positions):
            row = count+int(i)+1
            quality = str(cols['quality_flag'][i])
            entity = f"{cols['satellite_name'][i]} [{cols['sat_id'][i]}]"
            valid_height = not quality and -12000<=height[j]<=100000000
            if selected[i]:
                assert valid_height and 100000<height[j]<1000000
                attrs = dict(norad_id=str(cols['sat_id'][i]), satellite_name=str(cols['satellite_name'][i]), position_kind='Operator prediction · MEME J2000 assumption', source_epoch=str(cols['epoch'][i]))
                events.append(event(entity,ns[i]/1e9,lat[j],lon[j],dict(meters=round(float(height[j]),3),reference='ellipsoid'),row,category='Predicted orbit',attrs=attrs))
                if len(controls)<8:
                    controls.append(dict(epoch=iso(ns[i]/1e9),source_meme_m=raw[j].tolist(),itrs_m=xyz[j].tolist(),lat=float(lat[j]),lon=float(lon[j]),height_m=float(height[j])))
            if stress_output:
                if stress_stream is None or (row-1)%1_000_000==0:
                    if stress_stream:stress_stream.close()
                    filename=f'starlink-{len(stress_files)+1:03}.csv';stress_files.append(dict(file=filename,rows=0));stress_stream=(stress_output/filename).open('w',newline='');stress_writer=csv.writer(stress_stream,lineterminator='\n')
                    stress_writer.writerow(['entity','timestamp','latitude','longitude','altitude_m','altitude_reference','quality_flag','position_kind'])
                stress_writer.writerow([entity,iso(ns[i]/1e9),f'{lat[j]:.7f}',f'{lon[j]:.7f}',f'{height[j]:.3f}' if valid_height else '', 'ellipsoid' if valid_height else '',quality,'predicted'])
                stress_files[-1]['rows']+=1
            bad_count += int(bool(quality))
        count += len(ns)
        if stress_output and count%1_000_000<len(ns):print(f'Converted {count:,} / 43,361,358 states',flush=True)
    if stress_stream:stress_stream.close()
    assert count==43_361_358
    counts = {e['entity']:0 for e in events}
    for e in events:counts[e['entity']]+=1
    assert len(counts)==128 and set(counts.values())=={361}, (len(counts),set(counts.values()))
    scene = dict(renderer='cesium',mode='globe',bounds=[-180,-82,180,82],globe_altitude=True,globe_time=False,render_budget=100000,inspector_tab='views',
                 display=dict(mode='points',show_points=False,show_tracks=True,show_trails=False,track_opacity=.55,trail_opacity=0.,trail_gap_minutes=2,point_scale=.4,spatial_culling=False,bloom=False))
    window_filter = {**FILTER,'end':epochs[90]/1e9}
    views = [saved('128 satellites · first 90 minutes · predicted altitude',scene,window_filter),saved('Six hours · Time Height', {**scene,'globe_altitude':False,'globe_time':True,'globe_time_scale':20.}),saved('Ground tracks', {**scene,'mode':'map','globe_altitude':False})]
    report = save_demo('starlink-128-predicted-orbits-2024', '128 Starlinks · six hours of predicted orbits',events,scene,views,STARLINK_CREDIT,window_filter)
    report.update(source_records=count,source_flagged_below_surface=5861,satellites=ids.tolist(),frame='MEME fixed J2000 assumption → ITRS → WGS84 geodetic',astropy=astropy.__version__,controls=controls,minimum_m=min(e['altitude']['meters'] for e in events),maximum_m=max(e['altitude']['meters'] for e in events))
    if stress_output:assert bad_count==5861
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source',type=Path)
    parser.add_argument('--stress-output',type=Path,help='Create all 43 million rows as <=1M-row CSV files outside Git')
    parser.add_argument('--reuse-stress',type=Path,help='Verify/finalize already exported stress shards without rewriting them')
    args = parser.parse_args()
    for name,sha in EXPECTED.items():
        if digest(args.source/name)!=sha:raise ValueError('Unexpected input SHA-256: '+name)
    report=dict(inputs_sha256=EXPECTED,starlink=starlink(args.source,args.stress_output),falcon9=falcon(args.source))
    if args.reuse_stress or args.stress_output:
        report['starlink']['stress_fixture'] = finalize_stress(args.reuse_stress or args.stress_output)
    (ROOT/'samples/public/space-provenance.json').write_text(json.dumps(report,indent=2,sort_keys=True)+'\n')
    print(json.dumps({k:{key:value for key,value in v.items() if key not in ['controls','satellites']} if isinstance(v,dict) else v for k,v in report.items()},indent=2),flush=True)


def finalize_stress(directory):
    files = sorted(directory.glob('starlink-*.csv'))
    if len(files)!=44:raise ValueError('Expected 44 full-source CSV shards')
    records=bad=0;entries=[]
    credit={**STARLINK_CREDIT,'changes':STARLINK_CREDIT['changes'].replace('Deterministic 128-satellite subset, six hours of original 60-second predicted states.','All 43,361,358 source states retained at original epochs.').replace('Source below_surface states are excluded from this small demo.','Source below_surface states retain their rows with missing altitude; source coordinates remain available in the pinned Parquet.')}
    for i,path in enumerate(files,1):
        assert path.name==f'starlink-{i:03}.csv'
        h=hashlib.sha256();rows=0
        with path.open('rb') as stream:
            header=stream.readline();h.update(header)
            assert header.startswith(b'entity,timestamp,latitude,longitude,altitude_m,altitude_reference,quality_flag,position_kind')
            for line in stream:
                h.update(line);rows+=1;bad+=int(line.endswith(b',below_surface,predicted\n'))
        assert rows==(1_000_000 if i<44 else 361358)
        records+=rows;entries.append(dict(file=path.name,rows=rows,bytes=path.stat().st_size,sha256=h.hexdigest()))
        Path(str(path)+'.attribution.json').write_text(json.dumps([credit],indent=2)+'\n')
    assert records==43361358 and bad==5861,(records,bad)
    manifest=dict(records=records,flagged_heights_omitted=bad,files=entries,provenance=[credit],source_sha256=EXPECTED[PARQUET])
    (directory/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    return dict(records=records,csv_files=len(files),bytes=sum(f['bytes'] for f in entries),flagged_heights_omitted=bad)


if __name__=='__main__':main()
