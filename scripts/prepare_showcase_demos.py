#!/usr/bin/env python3
"""Add offline saved views to the existing website showcase projects; no data edits."""
import copy
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
for stem, modes in [
    ('usgs-global-earthquakes-2025-01', [('Pacific epicenters','globe','points'),('World epicenters','map','points'),('Global density','map','density')]),
    ('police-uk-london-theft-2025-01', [('Published reports · heat','map','heatmap'),('Published reports · count cells','map','density'),('Individual source reports','map','points')]),
]:
    path=ROOT/'samples'/f'{stem}.chronoscope'
    with zipfile.ZipFile(path) as archive:
        project=json.loads(archive.read('manifest.json'))
    base=project['scene']
    base.update(renderer='cesium',expanded=True)
    base['display'].update(show_tracks=False,show_trails=False,spatial_culling=False)
    if stem.startswith('usgs'):
        base['bounds']=[-180,-75,180,82]
    project['views']=[]
    for name,mode,display in modes:
        scene=copy.deepcopy(base);scene['mode']=mode
        scene['display'].update(mode=display,heat_weight='count')
        project['views'].append(dict(name=name,scene=scene,filter=project['filter'],
                                     selected=[],camera=project['camera'],mode='Map'))
    project['scene']=project['views'][0]['scene']
    with zipfile.ZipFile(path,'w') as archive:
        info=zipfile.ZipInfo('manifest.json',(2026,10,26,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED
        archive.writestr(info,json.dumps(project,ensure_ascii=False,separators=(',',':')))
    print(stem, len(project['dataset']['events']), 'original observations; three saved views')
