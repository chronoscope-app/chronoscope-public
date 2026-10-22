#!/usr/bin/env python3
"""Capture the real native Mac app through its scoped CLI/agent interface.
Uses credited demos, fixed public earthquake and crime samples and an isolated profile. The local gull-density, crime and vessel scenes use credited OpenFreeMap Streets; other scenes use the bundled map. No SI service.
"""
import argparse
import hashlib
import json
import plistlib
import re
import shutil
from pathlib import Path
import subprocess
import time
from datetime import datetime, timezone

ROOT=Path(__file__).resolve().parent.parent
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--app',type=Path,required=True)
p.add_argument('--profile',type=Path,required=True)
p.add_argument('--application-source',required=True,help='Full Git commit used to build this app')
p.add_argument('--output',type=Path,default=ROOT/'docs/screenshots/current')
p.add_argument('--scene',help='Capture only one named scene (for arranging through the UI)')
p.add_argument('--current',action='store_true',help='Capture the current scene after normal UI framing; requires --scene')
a=p.parse_args()
assert not a.current or a.scene, "--current requires --scene"
assert a.profile.is_absolute() and a.app.is_absolute()
assert re.fullmatch(r'[0-9a-f]{40}',a.application_source), 'Use the full application build commit'
binary=a.app/'Contents/MacOS/chronoscope-desktop'
a.output.mkdir(parents=True,exist_ok=True)
def cli(*args,attach=True):
    cmd=[str(binary),'--data-dir',str(a.profile)]
    if attach:cmd+=['--attach']
    r=subprocess.run(cmd+list(args),capture_output=True,text=True,timeout=60)
    if r.returncode:raise RuntimeError(r.stderr[-3000:])
    return json.loads(r.stdout)
def api(name,args=None):return cli('call',name,'--args',json.dumps(args or {}))
def prefs(theme, streets=False):
    settings=api('preferences')
    settings.update(theme=theme,basemap='streets' if streets else 'none',auto_save_unsaved=False,map_layers=[],terrain_path=None)
    settings['map']={**settings['map'],'enabled':False}
    api('preferences',{'preferences':settings})
    api('wmts_access',{'settings':{'offline':not streets}})
def ready():
    deadline=time.monotonic()+45
    while time.monotonic()<deadline:
        state=cli('view','status')
        if not any(state.get('loading', {'unknown':True}).values()):
            time.sleep(1)
            return state
        time.sleep(.25)
    raise RuntimeError('Native view did not finish rendering: '+json.dumps(state)[:1500])

# Profile creation and enabling are deliberately limited to its default
# exchange folder. No --root grants access to the private source checkout.
if not cli('agent','status',attach=False)['connected']:
    cli('agent','enable',attach=False)
    subprocess.run(['/usr/bin/open','-n','--env','CHRONOSCOPE_DATA_DIR='+str(a.profile),str(a.app)],check=True)
    for _ in range(60):
        if cli('agent','status',attach=False)['connected']:break
        time.sleep(.5)

tracks={'mode':'points','show_points':True,'show_tracks':True,'show_trails':False,
        'point_scale':.5,'track_opacity':.9,'bloom':False,'spatial_culling':False}
scenes=[
 ('space-time','stork-migration','space-time','dark',{},dict(inspector_tab='views')),
 ('globe','usgs-global-earthquakes-2025-01','globe','dark',{'show_tracks':False,'show_trails':False,'point_scale':.8},dict(inspector_tab='views')),
 ('linked-workspace','elephant-seals','map','dark',{},dict(inspector_tab='charts',table_open=True,
    chart={'kind':'bar','x':'entity','y':'value','aggregate':'max','scope':'all',
           'title':'Deepest recorded dive by seal','x_label':'Seal','y_label':'Maximum dive depth (m)'})),
 ('hurricane-tracks','hurricanes','globe','dark',{'bloom':True,'bloom_strength':.3,'point_scale':.4},dict(inspector_tab='views')),
 ('density','animal-gps','map','dark',{'mode':'density','show_tracks':False,'show_points':False,'cluster_pixels':12},dict(inspector_tab='views')),
 ('heatmap','police-uk-london-theft-2025-01','map','dark',{'mode':'heatmap','show_tracks':False,'show_points':False,'heat_radius':28,'heat_weight':'count'},dict(inspector_tab='views')),
 ('repeating-patterns','stork-migration','map','light',{},dict(inspector_tab='charts',
    chart={'kind':'heatmap','x':'time','x_axis':'time','aggregate':'count','scope':'all','title':'Recorded events by UTC weekday and hour'})),
 ('chart-comparison','noaa-ais','map','light',{},dict(inspector_tab='charts',
    chart={'kind':'bar','x':'category','y':'value','aggregate':'mean','scope':'all','title':'Mean recorded vessel speed by type','y_label':'Speed (knots)'})),
]
report_path=a.output/'capture-report.json'
report=json.loads(report_path.read_text()) if a.scene and report_path.exists() else {}
for old in report.get('captures',[]):
    old.setdefault('application_source',report.get('application_source'))
report.update(application_source=a.application_source,
    application_source_note='Each capture records its application build commit and executable hash; the gallery can contain captures from more than one local build.',
    source=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
    captured=datetime.now(timezone.utc).isoformat(),renderer='Native macOS Tauri / WebKit / Cesium WebGL2',
    version=plistlib.loads((a.app/'Contents/Info.plist').read_bytes())['CFBundleShortVersionString'],
    executable_sha256=hashlib.sha256(binary.read_bytes()).hexdigest(),
    external_map_access=False,external_si_service=False,profile='Isolated disposable profile; default exchange-folder scope only')
report.setdefault('captures',[])
for old in report['captures']:
    old.setdefault('executable_sha256', report.get('executable_sha256'))
for name,demo,mode,theme,display,view in scenes:
    if a.scene and name!=a.scene:continue
    if not a.current:
        prefs(theme, streets=name in {'density','heatmap','chart-comparison'})
        if name in {'globe','heatmap'}:
            project=ROOT/'samples'/(demo+'.chronoscope')
            exchange=a.profile/'agent-files'
            exchange.mkdir(parents=True,exist_ok=True)
            target=exchange/project.name
            shutil.copyfile(project,target)
            api('open',{'path':str(target)})
        else:
            api('demo_open',{'id':demo})
        prefs(theme, streets=name in {'density','heatmap','chart-comparison'})
        api('view_set',{'chart':None,'table_open':False})
        api('view_set',{'mode':mode,'display':{**tracks,**display},**view})
        if name=='globe':
            cli('view','look-at','--longitude','135','--latitude','10','--distance','13000000')
        elif name=='heatmap':
            cli('view','look-at','--longitude','-.13','--latitude','51.515','--distance','8500')
        else:
            cli('view','fit')
    state=ready()
    file=a.output/(name+'.png')
    if file.exists():file.unlink() # only this generated capture output
    cli('view','capture','--output',str(file))
    data=file.read_bytes()
    import struct
    width,height=struct.unpack('>II',data[16:24])
    assert len(data)>10000 and width>1000 and height>600
    row=dict(file=file.name,demo=demo,mode=mode,theme=theme,application_source=a.application_source,external_map_access=name in {'density','heatmap','chart-comparison'},executable_sha256=hashlib.sha256(binary.read_bytes()).hexdigest(),display={**tracks,**display},
             ui_framing='Current normal UI framing' if a.current else 'Default scene framing',
             view=view,navigation='Western Pacific globe, longitude 135, latitude 10, distance 13000000 m' if name=='globe' else 'Central London, longitude -0.13, latitude 51.515, map width 8500 m' if name=='heatmap' else 'fit events',count=api('snapshot',{'compact':True})['count'],
             width=width,height=height,sha256=hashlib.sha256(data).hexdigest(),live_state=state)
    report['captures']=[r for r in report['captures'] if r['file']!=file.name]+[row]
    report['external_map_access']=any(r.get('external_map_access',False) for r in report['captures'])
    report['capture_set_complete']=len(report['captures'])==len(scenes)
    report['passed']=False
    report['review_status']='Pending visual review after recapture'
    report_path.write_text(json.dumps(report,indent=2)+'\n')
    print('Captured',file.name,row['count'],f'{width}x{height}',flush=True)
