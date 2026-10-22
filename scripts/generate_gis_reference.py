#!/usr/bin/env python3
"""Regenerate independent GIS oracle fixtures. Requires pyproj, mgrs and rasterio.
Never imports Chronoscope or uses its conversion formulas for expected values.
"""
from pathlib import Path
import json, random, math, re
import pyproj, mgrs, rasterio
from pyproj import Transformer, Geod

root = Path(__file__).resolve().parent.parent
rng = random.Random(20261014)
m = mgrs.MGRS()
points = [(0., 0.), (-0., -0.), (0., 180.), (0., -180.), (0., 179.999999),
          (90., 0.), (-90., 0.), (84., 0.), (-80., 0.), (83.999999, 0.),
          (40.748333, -73.985278), (-33.8688, 151.2093), (60., 6.), (78., 20.),
          (85., 0.), (-82., 25.), (0.00000001, 3.), (-0.00000001, 3.)]
# Cover every UTM zone, every latitude band, both hemispheres, transition edges,
# dateline and polar cases. Projections are independently evaluated by PROJ.
points += [(lat, -177. + 6*z) for z in range(60) for lat in [-79.9, -48., -0.01, 0., 0.01, 7.999, 8.001, 48., 83.9]]
points += [(rng.uniform(-89.99, 89.99), rng.uniform(-180., 180.)) for _ in range(200)]
for lat in [56., 63.9999, 64., 72., 83.9999]:
    points += [(lat, lon) for lon in [0., 2.9999, 3., 5.9999, 6., 8.9999, 9., 11.9999, 12., 20.9999, 21., 32.9999, 33., 41.9999, 42.]]
records = []
for lat, lon in points:
    lon = -180. if lon == 180. else lon
    zone = int(math.floor((lon + 180.) / 6.)) + 1
    if not -80 <= lat < 84: zone = 0
    elif 56 <= lat < 64 and 3 <= lon < 12: zone = 32
    elif 72 <= lat < 84 and 0 <= lon < 42:
        zone = 31 if lon < 9 else 33 if lon < 21 else 35 if lon < 33 else 37
    epsg = (32600 if lat >= 0 else 32700) + zone if zone else 32661 if lat >= 0 else 32761
    x, y = Transformer.from_crs(4326, epsg, always_xy=True).transform(lon, lat)
    web = Transformer.from_crs(4326, 3857, always_xy=True).transform(lon, lat) if abs(lat) <= 85.0511287798066 else None
    ecef = Transformer.from_crs(4979, 4978, always_xy=True).transform(lon, lat, 0)
    # GeographicLib's standard switch uses UPS at exactly 84N; GEOTRANS uses
    # UTM there. Verify its grid numerics with PROJ rather than asserting strings.
    ref = None if lat == 84 else m.toMGRS(lat, lon, MGRSPrecision=5)
    records.append(dict(latitude=lat, longitude=lon, zone=zone, north=lat >= 0,
                        easting=x, northing=y, mgrs=ref, web_mercator=web, ecef=ecef))

mgrs_cells = []
for lat, lon in [(40.748333,-73.985278),(-33.8688,151.2093),(2.,32.),(-3.,-60.),(85.,0.),(-82.,25.)]:
    for precision in range(6):
        ref = m.toMGRS(lat, lon, MGRSPrecision=precision)
        swlat, swlon = m.toLatLon(ref)
        match = re.match(r'^(\d+)([A-Z])', ref)
        if match: epsg = (32600 if match[2] >= 'N' else 32700) + int(match[1])
        else: epsg = 32661 if ref[0] in 'YZ' else 32761
        forward = Transformer.from_crs(4326, epsg, always_xy=True)
        reverse = Transformer.from_crs(epsg, 4326, always_xy=True)
        x, y = forward.transform(swlon, swlat)
        cell = 10**(5-precision)
        # GEOTRANS reverse UPS differs from PROJ by a few millimetres. A grid
        # corner is an exact multiple of its cell size; restore that integer
        # grid boundary before asking PROJ for the half-cell centre.
        x, y = round(x/cell)*cell, round(y/cell)*cell
        half = cell / 2
        clon, clat = reverse.transform(x+half, y+half)
        mgrs_cells.append(dict(reference=ref, precision=precision, latitude=clat, longitude=clon))

terrain = []
with rasterio.open(root/'tests/fixtures/terrain/synthetic-n43.dt0') as d:
    array=d.read(1)
    for row, col in [(0,0),(0,120),(120,0),(120,120),(60,60)]+[(rng.randrange(121),rng.randrange(121)) for _ in range(100)]:
        lon,lat=d.xy(row,col)
        terrain.append(dict(latitude=lat,longitude=lon,height_m=int(array[row,col])))
    # Sub-post interpolation oracle from GDAL-decoded grid, point registration.
    for _ in range(100):
        x,y=rng.uniform(0,119),rng.uniform(0,119)
        col,row=int(x),int(y);fx,fy=x-col,y-row
        height=float(array[row,col])*(1-fx)*(1-fy)+float(array[row,col+1])*fx*(1-fy)+float(array[row+1,col])*(1-fx)*fy+float(array[row+1,col+1])*fx*fy
        terrain.append(dict(latitude=44-y/120,longitude=-80+x/120,height_m=height))

geod=Geod(ellps='WGS84')
distances=[]
for a,b in [((0,179),(0,-179)),((0,0),(0,180)),((90,0),(-90,0)),((0,0),(.001,0)),((60,0),(60,.001)),((40.6,-73.8),(51.6,-.5))]+[((rng.uniform(-90,90),rng.uniform(-180,180)),(rng.uniform(-90,90),rng.uniform(-180,180))) for _ in range(100)]:
    _,_,distance=geod.inv(a[1],a[0],b[1],b[0]);distances.append(dict(a=a,b=b,metres=distance))

out={'provenance':{'pyproj':pyproj.__version__,'proj':pyproj.proj_version_str,'gdal':rasterio.__gdal_version__,'mgrs':'GEOTRANS-backed Python mgrs','coordinate_convention':'always_xy=True: longitude/easting first; WGS84','terrain':'First-party synthetic polynomial bowl in synthetic-n43.dt0, AREA_OR_POINT=Point; source post centres, no half-pixel offset'},'coordinates':records,'mgrs_cells':mgrs_cells,'terrain_samples':terrain,'geodesic_distances':distances}
path=root/'tests/fixtures/gis-reference.json';path.write_text(json.dumps(out,indent=2,allow_nan=False)+'\n')
print('Independent fixtures:',len(records),'coordinate vectors,',len(mgrs_cells),'MGRS cells,',len(terrain),'terrain samples,',len(distances),'geodesics')
