#!/usr/bin/env python3
"""Reproduce priority demos from pinned, checksummed source snapshots (no network).

Requires shapely for the Natural Earth polygon conversion. No invented records,
interpolation, missing-value imputation or thinning of the declared subsets.
"""
import copy
import csv
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import zipfile
from prepare_real_demos import FILTER, CAMERA

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ROOT / 'samples/public/source-snapshots'
REPORT = {}


def epoch(text):
    return dt.datetime.fromisoformat(text.replace('Z', '+00:00')).timestamp()


def credit(title, creator, url, license, license_url, changes):
    return dict(title=title, creator=creator, source_url=url, license=license,
                license_url=license_url, changes=changes)


def event(entity, time, lat, lon, value, attrs, category, label):
    return dict(entity=entity, time=time, end=None, lat=lat, lon=lon,
                value=value, attrs={k: '' if v is None else str(v) for k, v in attrs.items()},
                category=category, label=label, related_to='', tags=[], note='')


def scene(mode, bounds, **extra):
    return dict(renderer='cesium', mode=mode, bounds=bounds, expanded=True,
                inspector_tab='views', render_budget=100000,
                display=dict(mode='points', show_points=True, show_tracks=False,
                             show_trails=False, show_centroids=False,
                             spatial_culling=False, point_scale=.65, bloom=False), **extra)


def bookmark(name, scene, filter=None):
    return dict(name=name, scene=copy.deepcopy(scene), mode='Map',
                filter=copy.deepcopy(filter or FILTER), selected=[], camera=CAMERA)


def write(stem, name, events, views, provenance):
    events.sort(key=lambda e: (e['time'], e['entity'], e['source_row']))
    for i, e in enumerate(events, 1):
        e['id'] = i
        e['source'] = stem + '.csv / source snapshot'
    project = dict(format='chronoscope.workspace', version=6, time_resolution='fractional_second',
                   dataset=dict(name=name, events=events), mode='Map',
                   scene=views[0]['scene'], filter=views[0]['filter'], selected=[], camera=CAMERA,
                   views=views, groups=[], imports=[], provenance=provenance,
                   field_roles={'value':'measurement', 'entity':'identifier', 'time':'timestamp'})
    path = ROOT/'samples'/f'{stem}.chronoscope'
    with zipfile.ZipFile(path, 'w') as z:
        info = zipfile.ZipInfo('manifest.json', (2026, 10, 26, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(info, json.dumps(project, ensure_ascii=False, separators=(',', ':'), allow_nan=False))
    table = ROOT/'samples/public'/f'{stem}.csv'
    fields = ['entity','timestamp','latitude','longitude','value','category','label','geometry_wkt']
    attrs = sorted({key for e in events for key in e['attrs']} - set(fields))
    with table.open('w') as f:
        w = csv.DictWriter(f, fieldnames=fields+attrs, lineterminator='\n'); w.writeheader()
        for e in events:
            w.writerow({**e['attrs'], **{k:e[k] for k in ('entity','value','category','label')},
                        'timestamp':dt.datetime.fromtimestamp(e['time'],dt.timezone.utc).isoformat(),
                        'latitude':e['lat'], 'longitude':e['lon'], 'geometry_wkt':e.get('geometry_wkt','')})
    Path(str(table)+'.attribution.json').write_text(json.dumps(provenance, indent=2)+'\n')
    REPORT[stem] = dict(records=len(events), entities=len({e['entity'] for e in events}),
                        missing_values=sum(e['value'] is None for e in events),
                        first_utc=dt.datetime.fromtimestamp(events[0]['time'],dt.timezone.utc).isoformat(),
                        last_utc=dt.datetime.fromtimestamp(events[-1]['time'],dt.timezone.utc).isoformat(),
                        project_sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                        csv_sha256=hashlib.sha256(table.read_bytes()).hexdigest())


def earthquakes():
    rows = list(csv.DictReader((SOURCES/'usgs-2025.csv').open()))
    events = []
    for n, r in enumerate(rows, 2):
        if any(r[k] != 'us' for k in ('net','locationSource','magSource')): continue
        e = event('Earthquakes',epoch(r['time']),float(r['latitude']),float(r['longitude']),float(r['mag']),
                  {**r,'value_unit':'reported magnitude','depth_unit':'km'},r['magType'],r['place'])
        e['source_row'] = n; events.append(e)
    assert len({e['attrs']['id'] for e in events}) == len(events)
    assert all(4.5 <= e['value'] < 10 and '2025-' in e['attrs']['time'] for e in events)
    globe = scene('globe',[-180,-75,180,82], measurement=dict(title='Earthquake magnitude',unit='',minimum=4.5,maximum=8.8))
    lat,lon=map(math.radians,(10,-160))
    radius=6378137+15000000
    globe['cesium_camera']=dict(position=[radius*math.cos(lat)*math.cos(lon),radius*math.cos(lat)*math.sin(lon),radius*math.sin(lat)],direction=[-math.cos(lat)*math.cos(lon),-math.cos(lat)*math.sin(lon),-math.sin(lat)],up=[-math.sin(lat)*math.cos(lon),-math.sin(lat)*math.sin(lon),math.cos(lat)])
    world = {**copy.deepcopy(globe),'mode':'map','bounds':[-180,-65,180,80]}
    world.pop('cesium_camera')
    pacific = {**copy.deepcopy(world),'bounds':[115,-50,179,60]}
    views=[bookmark('Global seismic belts · 2025',globe),bookmark('World epicenters',world),bookmark('Western Pacific',pacific)]
    write('usgs-global-earthquakes-2025','Global earthquakes · 2025 · M ≥4.5',events,views,
          [credit('USGS-authored earthquakes · 2025','U.S. Geological Survey',
                  'https://earthquake.usgs.gov/fdsnws/event/1/','US public domain',
                  'https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits',
                  f'2025 UTC, magnitude ≥4.5; {len(rows)} returned records, retained only USGS net/locationSource/magSource. Original time, coordinates, magnitude types and depth preserved. Surface epicenters; no tracks, depth is an attribute. Retrieved 2026-10-26.')])


def fires():
    events=[]
    for n,r in enumerate(csv.DictReader((SOURCES/'viirs-south-america-2026-10-19-25.csv').open()),2):
        clock=r['acq_time'].zfill(4)
        time=epoch(f"{r['acq_date']}T{clock[:2]}:{clock[2:]}:00Z")
        e=event('VIIRS detections',time,float(r['latitude']),float(r['longitude']),float(r['frp']),
                {**r,'value_unit':'MW','acquisition_time_precision':'minute'},r['confidence'],'VIIRS thermal detection')
        e['source_row']=n;events.append(e)
    heat=scene('map',[-82,-56,-34,13])
    heat['display'].update(mode='heatmap',heat_weight='value',heat_radius=18,heat_max=300,show_points=False)
    points=scene('map',[-82,-56,-34,13],entity_colors={'VIIRS detections':'#ff884f'})
    views=[bookmark('South America · radiative power',heat),bookmark('Original satellite detections',points),
           bookmark('A week of detections', {**copy.deepcopy(points),'mode':'space-time'})]
    write('nasa-firms-south-america-2026-10','NASA FIRMS · South America · 19–25 Oct 2026',events,views,
          [credit('VIIRS S-NPP 375 m active fire detections · Collection 2 NRT','NASA LANCE / FIRMS',
                  'https://firms.modaps.eosdis.nasa.gov/active_fire/#firms-txt',
                  'NASA Earth science data, open access', 'https://www.earthdata.nasa.gov/engage/open-data-services-and-software/data-and-information-policy',
                  'Frozen 7-day global CSV retrieved 2026-10-26. Retain every nominal/high-confidence record in longitude −82…−34, latitude −56…13; no deduplication, interpolation or thinning. A bounding-box subset, not a country boundary selection. Heat sums reported FRP in MW. Detections are not independent fires, burned area or fire severity. NRT records can be revised; cloud, overpass and sensor effects affect coverage. No tracks.')])


def electricity():
    from shapely.geometry import shape, MultiPolygon
    from shapely import set_precision, to_wkt
    wb=json.loads((SOURCES/'world-bank-electricity-1990-2023.json').read_text())
    countries={r['id']:r for r in json.loads((SOURCES/'world-bank-countries.json').read_text())[1] if r['region']['id']!='NA'}
    values={(r['countryiso3code'],int(r['date'])):r['value'] for r in wb[1] if r['countryiso3code'] in countries}
    features=json.loads((SOURCES/'natural-earth-countries.geojson').read_text())['features']
    joined={};excluded=[]
    def clamp_coords(value):
        if isinstance(value[0],(float,int)): return [max(-180,min(180,value[0])),max(-90,min(90,value[1]))]
        return [clamp_coords(v) for v in value]
    for f in features:
        props=f['properties']; code=props['WB_A3']
        if code not in countries: code=props['ISO_A3_EH']
        if code not in countries:
            excluded.append(props['ADMIN']);continue
        g=shape({**f['geometry'],'coordinates':clamp_coords(f['geometry']['coordinates'])})
        g=set_precision(g,0.000001)
        assert g.is_valid
        if code in joined: joined[code]=joined[code].union(g)
        else: joined[code]=g
    events=[]
    for code,g in sorted(joined.items()):
        # Natural Earth already splits polygons along ±180°. Verify no wrapping edge.
        polygons=[g] if g.geom_type=='Polygon' else list(g.geoms)
        assert all(abs(a[0]-b[0])<=180 for p in polygons for ring in [p.exterior,*p.interiors] for a,b in zip(ring.coords,list(ring.coords)[1:]))
        wkt=to_wkt(g,rounding_precision=6,trim=True)
        for year in range(1990,2024):
            v=values.get((code,year));assert v is None or 0<=v<=100
            e=event(countries[code]['name'],epoch(f'{year}-01-01T00:00:00Z'),None,None,v,
                    dict(iso3=code,year=year,indicator='EG.ELC.ACCS.ZS',value_unit='%',
                         observation_status='missing' if v is None else 'reported',
                         boundary_source='Natural Earth 1:110m; current boundaries reused for all years'),
                    countries[code]['region']['value'],countries[code]['name']+f' · {year}')
            e.update(geometry_wkt=wkt,source_row=len(events)+2);events.append(e)
    style=dict(title='Population with electricity access',unit='%',minimum=0,maximum=100,latest_per_entity=True)
    base=scene('map',[-180,-55,180,85],measurement=style)
    chart=dict(kind='bar',scope='visible',x='entity',y='value',aggregate='mean',limit=250,
               title='Electricity access by country',y_label='Population with access (%)')
    base.update(chart=chart,chart_presets=[dict(name='Compare visible countries (%)',config=chart)])
    def year_filter(year):return {**copy.deepcopy(FILTER),'start':epoch(f'{year}-01-01T00:00:00Z'),'end':epoch(f'{year}-12-31T23:59:59Z')}
    africa={**copy.deepcopy(base),'bounds':[-20,-36,55,38]}
    views=[bookmark('World · 2023',base,year_filter(2023)),bookmark('Africa · 2023',africa,year_filter(2023)),
           bookmark('Africa · 1990',africa,year_filter(1990)),bookmark('Africa · 2000',africa,year_filter(2000)),
           bookmark('World · 1990',base,year_filter(1990))]
    write('world-bank-electricity-1990-2023','Electricity access · 1990–2023',events,views,
          [credit('World Development Indicators · EG.ELC.ACCS.ZS','World Bank / ESMAP / Tracking SDG7',
                  'https://data.worldbank.org/indicator/EG.ELC.ACCS.ZS','CC BY 4.0',
                  'https://datacatalog.worldbank.org/public-licenses#cc-by',
                  'Annual percentages 1990–2023, retrieved 2026-10-26. Regional/income aggregates excluded. ISO3 join to Natural Earth; countries too small for these boundaries are omitted. Missing values stay null/gray. No forward filling or averaging over years; saved map views show one year. Current boundaries are reused across all years, not historical political boundaries.'),
           credit('Natural Earth · Admin 0 countries · 1:110m','Natural Earth contributors',
                  'https://www.naturalearthdata.com/downloads/110m-cultural-vectors/110m-admin-0-countries/',
                  'Public domain','https://www.naturalearthdata.com/about/terms-of-use/',
                  'WB_A3 join with ISO_A3_EH fallback. Coordinate rounding to 6 decimals; topology-preserving precision normalization. Cartographic boundaries are generalized and do not imply a position on disputed borders.')])
    REPORT['electricity_join']=dict(mapped_countries=len(joined),unmapped_boundaries=excluded,
                                    wb_economies_without_boundary=sorted(set(countries)-set(joined)))


def covid():
    events=[]
    for n,r in enumerate(csv.DictReader((SOURCES/'jhu-covid-confirmed-global.csv').open()),2):
        if not r['Lat'] or not r['Long']: continue
        lat,lon=float(r['Lat']),float(r['Long'])
        if (lat,lon)==(0,0) or not (-90<=lat<=90 and -180<=lon<=180):continue
        entity=r['Country/Region']+(' · '+r['Province/State'] if r['Province/State'] else '')
        for day,count in r.items():
            try:date=dt.datetime.strptime(day,'%m/%d/%y').replace(tzinfo=dt.timezone.utc)
            except ValueError:continue
            if not (2020==date.year and date.month<=6 and date.weekday()==6):continue
            e=event(entity,date.timestamp(),lat,lon,int(count),
                    dict(country=r['Country/Region'],province=r['Province/State'],source_date=day,
                         value_unit='cumulative confirmed cases',time_precision='date only',
                         position_method='source administrative reference; not case location'),
                    r['Country/Region'],entity+' · cumulative reported cases')
            e['source_row']=n;events.append(e)
    base=scene('map',[-180,-55,180,80],measurement=dict(title='Cumulative confirmed COVID-19 cases',unit='',minimum=0,maximum=2500000))
    def on_day(day):
        return {**copy.deepcopy(FILTER),'start':epoch(day+'T00:00:00Z'),'end':epoch(day+'T23:59:59Z')}
    views=[bookmark('Reported cases · 28 June 2020',base,on_day('2020-06-28')),
           bookmark('Reported cases · 5 April 2020',base,on_day('2020-04-05')),
           bookmark('Reported cases · 26 January 2020',{**copy.deepcopy(base),'mode':'globe'},on_day('2020-01-26'))]
    write('jhu-covid-weekly-2020','COVID-19 · weekly reference snapshots · Jan–Jun 2020',events,views,
          [credit('COVID-19 Data Repository by the Center for Systems Science and Engineering (CSSE) at Johns Hopkins University',
                  'Johns Hopkins University / CSSE','https://github.com/CSSEGISandData/COVID-19',
                  'CC BY 4.0','https://creativecommons.org/licenses/by/4.0/',
                  'Sunday columns January–June 2020 from the archived global cumulative confirmed-case table, retrieved 2026-10-26. Original source counts and administrative reference coordinates preserved. Rows without coordinates or at (0,0) excluded. No daily increments, interpolation or case locations inferred. Reporting/testing definitions differ by place and time. Weekly snapshots are cumulative totals, not new cases; dates are UTC display anchors, not diagnosis instants. No tracks.')])


if __name__=='__main__':
    hashes=json.loads((SOURCES/'SHA256.json').read_text())
    for filename,digest in hashes.items():
        if filename=='original_global_firms_sha256':continue
        assert hashlib.sha256((SOURCES/filename).read_bytes()).hexdigest()==digest,filename
    earthquakes();fires();electricity();covid()
    (ROOT/'samples/public/priority-demo-provenance.json').write_text(json.dumps(REPORT,indent=2)+'\n')
    print(json.dumps(REPORT,indent=2))
