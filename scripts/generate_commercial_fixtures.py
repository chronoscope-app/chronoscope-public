#!/usr/bin/env python3
"""Generate first-party map artwork and synthetic GIS regression fixtures.
Requires Pillow. Checks the vendored public-domain relief map; accepts its exact upstream archive for regeneration.
"""
import argparse
import io
import zipfile
import hashlib
import json
import math
from pathlib import Path
import struct
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent

def terrain_height(x, y):
    # Fictional quadratic bowl. Every post is computed, never copied from a DEM.
    return 75 + ((x - 60) ** 2 + (y - 60) ** 2) // 30

def terrain():
    header = bytearray(b' ' * 3428)
    for offset, value in [(0,b'UHL1'),(4,b'0800000W'),(12,b'0430000N'),
        (20,b'0300'),(24,b'0300'),(28,b'NA  '),(32,b'U  '),
        (47,b'0121'),(51,b'0121'),(80,b'DSI'),(221,b'MSL'),
        (224,b'WGS84'),(728,b'ACC')]:
        header[offset:offset+len(value)] = value
    data = bytearray(header)
    for x in range(121):
        record = bytearray([0xaa]) + x.to_bytes(3,'big') + struct.pack('>HH',x,0)
        record += b''.join(struct.pack('>H', terrain_height(x,y)) for y in range(121))
        record += struct.pack('>I',sum(record))
        data += record
    (ROOT/'tests/fixtures/terrain/synthetic-n43.dt0').write_bytes(data)
    # Preserve the independent PROJ/GEOTRANS coordinate and distance oracles.
    # The synthetic terrain oracle is evaluated from its defining polynomial,
    # independently of the production DTED decoder.
    p=ROOT/'tests/fixtures/gis-reference.json'
    oracle=json.loads(p.read_text())
    for row in oracle['terrain_samples']:
        x=max(0,min(120,(row['longitude']+80)*120))
        y=max(0,min(120,(row['latitude']-43)*120))
        if abs(x-round(x)) < 1e-8: x=round(x)
        if abs(y-round(y)) < 1e-8: y=round(y)
        ix,iy=min(119,int(x)),min(119,int(y)); fx,fy=x-ix,y-iy
        row['height_m'] = (terrain_height(ix,iy)*(1-fx)*(1-fy)+
            terrain_height(ix+1,iy)*fx*(1-fy)+terrain_height(ix,iy+1)*(1-fx)*fy+
            terrain_height(ix+1,iy+1)*fx*fy)
    oracle['provenance']['terrain']='First-party synthetic polynomial bowl; bilinear oracle computed independently of DTED decoding; point registration'
    p.write_text(json.dumps(oracle,indent=2,allow_nan=False)+'\n')

def map_art(archive=None):
    provenance=json.loads((ROOT/'assets/provenance/natural-earth-relief.json').read_text())
    output=ROOT/'frontend/src/assets/earth-natural-earth.jpg'
    if archive is None:
        assert output.is_file(), 'Supply --relief-archive to regenerate the vendored map'
        assert hashlib.sha256(output.read_bytes()).hexdigest()==provenance['output_sha256']
        return
    data=Path(archive).read_bytes()
    assert hashlib.sha256(data).hexdigest()==provenance['archive_sha256'], 'Unexpected upstream archive'
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        raster=z.read(provenance['archive_member'])
    assert hashlib.sha256(raster).hexdigest()==provenance['source_sha256']
    im=Image.open(io.BytesIO(raster)).convert('RGB')
    im=im.resize((4096,2048),Image.Resampling.LANCZOS)
    im.save(output,quality=92,subsampling=0,optimize=True)
    provenance['output_sha256']=hashlib.sha256(output.read_bytes()).hexdigest()
    provenance['pillow_version']=Image.__version__ if hasattr(Image,'__version__') else None
    (ROOT/'assets/provenance/natural-earth-relief.json').write_text(json.dumps(provenance,indent=2)+'\n')

def tile():
    # Diagnostic checker/contour artwork: no geographic or satellite content.
    im=Image.new('RGB',(256,256),(40,110,62)); d=ImageDraw.Draw(im)
    for y in range(0,256,32):
        for x in range(0,256,32):
            if (x//32+y//32)%2: d.rectangle((x,y,x+31,y+31),fill=(55,142,78))
    for i in range(-128,384,32): d.line((i,0,i+128,256),fill=(115,180,105),width=2)
    path=ROOT/'tests/fixtures/cesium/synthetic-grid-z13.png'; im.save(path,optimize=True)
    metadata={'bounds':[-79.98046875,43.22919511396501,-79.9365234375,43.261206124799784],
        'col':2276,'row':3002,'level':13}
    metadata.update(url=None,attribution='Chronoscope synthetic test grid · MIT',
        sourceResolution='Synthetic diagnostic pattern; not an observation or geographic image',
        image_file=path.name,sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
        acquired_utc='2026-10-21',license_url='../../../LICENSE',
        purpose='Offline renderer/WMTS alignment test with first-party generated artwork')
    (path.with_suffix('.json')).write_text(json.dumps(metadata,indent=2)+'\n')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--relief-archive',type=Path)
    args=parser.parse_args()
    terrain(); map_art(args.relief_archive); tile()
