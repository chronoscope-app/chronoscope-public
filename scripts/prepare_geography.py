#!/usr/bin/env python3
"""Normalize public-domain Natural Earth 10m coastlines for the offline viewer.
Usage: python3 scripts/prepare_geography.py path/to/ne_10m_coastline.geojson
"""
import json, sys
from pathlib import Path

def simplify(points, tolerance=0.005):
    if len(points)<3: return points
    keep={0,len(points)-1}; stack=[(0,len(points)-1)]
    while stack:
        lo,hi=stack.pop();a,b=points[lo],points[hi];dx,dy=b[0]-a[0],b[1]-a[1];norm=dx*dx+dy*dy
        best,index=tolerance*tolerance,-1
        for i in range(lo+1,hi):
            p=points[i];t=max(0,min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/norm)) if norm else 0
            distance=(p[0]-a[0]-t*dx)**2+(p[1]-a[1]-t*dy)**2
            if distance>best:best,index=distance,i
        if index!=-1:keep.add(index);stack.extend([(lo,index),(index,hi)])
    return [[round(points[i][0],5),round(points[i][1],5)] for i in sorted(keep)]

source=json.loads(Path(sys.argv[1]).read_text());lines=[]
for feature in source['features']:
    g=feature['geometry']
    if g['type']=='LineString':lines.append(simplify(g['coordinates']))
    elif g['type']=='MultiLineString':lines.extend(simplify(line) for line in g['coordinates'])
output=Path(__file__).resolve().parents[1]/'assets/coastlines.json'
output.write_text(json.dumps(lines,separators=(',',':')))
print(f'{len(lines)} lines / {sum(map(len,lines))} points / {output.stat().st_size} bytes')
