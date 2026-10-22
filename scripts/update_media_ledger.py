#!/usr/bin/env python3
"""Refresh current media identities without clearing historical rights gaps."""
import json
from pathlib import Path
import subprocess
ROOT=Path(__file__).resolve().parent.parent
ledger=ROOT/'docs/MEDIA-RIGHTS.json'
x=json.loads(ledger.read_text())
for row in x['rows']:
    p=ROOT/row['path']; row['current_path']=p.is_file()
    row['current_blob']=p.is_file() and subprocess.check_output(['git','hash-object','--',str(p)],text=True).strip()==row['oid']
    if not row['current_blob']: row['status']='historical; not commercially cleared by removal'
known={(r['path'],r['oid']) for r in x['rows']}
media=[]
for base in ['docs','frontend/src/assets','src-tauri/icons','frontend/public','tests/fixtures']:
    for p in (ROOT/base).rglob('*'):
        if not p.is_file() or p.suffix.lower() not in {'.png','.jpg','.jpeg','.gif','.webp','.svg','.icns','.ico','.glb','.gltf','.bin','.dt0'}: continue
        if base=='frontend/public' and p.parent!=ROOT/base: continue # generated dependency trees carry upstream notices
        media.append(p)
for p in sorted(media):
    path=p.relative_to(ROOT).as_posix();oid=subprocess.check_output(['git','hash-object','--',str(p)],text=True).strip()
    if (path,oid) in known:continue
    if path == 'docs/screenshots/current/heatmap.png':
        source='Native Chronoscope UI; anonymised Police.uk London theft reports over credited OpenFreeMap Streets / OpenMapTiles / OpenStreetMap'
        license='MIT application UI; Police.uk OGL v3.0 with attribution; commercial map use allowed with provider attribution (OpenStreetMap ODbL)'
        evidence='docs/CRIME-HOTSPOTS.md; docs/screenshots/current/README.md; docs/screenshots/current/capture-report.json'
    elif path in {'docs/screenshots/current/chart-comparison.png', 'docs/screenshots/current/density.png'}:
        source='Native Chronoscope UI and credited '+('CC0 HG_OOSTENDE gull GPS sample' if path.endswith('/density.png') else 'public AIS sample')+' over OpenFreeMap Streets / OpenMapTiles / OpenStreetMap'
        license='MIT application UI; CC0/public data as credited per capture; commercial map use allowed with required provider/data attribution (OpenStreetMap ODbL)'
        evidence='docs/screenshots/current/README.md; https://openfreemap.org/ ; https://www.openstreetmap.org/copyright'
    elif path.startswith('docs/screenshots/current/'):
        source='Native Chronoscope 0.15.2 UI; Natural Earth public-domain map; identified demo or fixed public earthquake data'
        license='MIT application UI; public-domain geography; CC0/public-domain or CC BY 4.0 datasets as credited per capture'
        evidence='docs/screenshots/current/README.md; docs/screenshots/current/capture-report.json'
    elif 'natural-earth' in path:
        source='Natural Earth II shaded-relief artwork, public domain; downsampled without color alteration'
        license='Public-domain geographic artwork; MIT generator';evidence='assets/provenance/NATURAL-EARTH.md'
    elif 'synthetic' in path:
        source='First-party generated synthetic diagnostic fixture';license='MIT';evidence='scripts/generate_commercial_fixtures.py'
    elif 'gis/box' in path:
        source='Khronos Box / Cesium 2017';license='CC BY 4.0';evidence='tests/fixtures/gis/README.md'
    elif 'egm96' in path:
        source='NGA EGM96 via PROJ-datumgrid 1.8';license='Public domain';evidence='frontend/src/assets/egm96-15-NOTICE.txt'
    elif 'icon' in path:
        source='Chronoscope original branding';license='MIT';evidence='LICENSE'
    else:raise RuntimeError('Media requires explicit provenance: '+path)
    x['rows'].append(dict(path=path,oid=oid,current_path=True,current_blob=True,source=source,license=license,evidence=evidence,verification='Exact current Git object; source/provenance checked during commercial-media replacement'))
count=sum(r['current_blob'] for r in x['rows'])
x['scope']=f'Exact identities for {count} current media and {len(x["rows"])-count} historical object/path pairs. Historical rights gaps are retained; retired assets are excluded from HEAD, not retroactively cleared.'
x['credits']['natural_earth']='Natural Earth II public-domain shaded relief; https://www.naturalearthdata.com/about/terms-of-use/ ; downsampled without color alteration'
ledger.write_text(json.dumps(x,indent=2,ensure_ascii=False)+'\n')
print(x['scope'])
