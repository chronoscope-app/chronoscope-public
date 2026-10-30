"""Open the validated full experimental app with the imported 100k test study."""
import base64,datetime,hashlib,json,os,subprocess,sys,time
from pathlib import Path
base=Path(__file__).resolve().parent
repo=base/'chronoscope-transitions-local'; appdir=base/'Chronoscope Transition Lab'
binary=appdir/'chronoscope-desktop.exe'; profile=appdir/'profile'; out=repo/'.qa/transitions/hands-on'
out.mkdir(parents=True,exist_ok=True)
assert json.loads((repo/'.qa/transitions/native-soak/report.json').read_text())['complete']
sys.path.insert(0,str(repo/'scripts'))
from native_mcp import NativeMcp
env=dict(os.environ,CHRONOSCOPE_DATA_DIR=str(profile),WEBVIEW2_USER_DATA_FOLDER=str(appdir/'webview2-data'))
subprocess.run([str(binary),'--data-dir',str(profile),'agent','enable'],check=True,capture_output=True,timeout=20)
log=(out/'app.log').open('w')
process=subprocess.Popen([str(binary)],env=env,stdout=log,stderr=log,creationflags=subprocess.CREATE_NO_WINDOW)
client=None
try:
 client=NativeMcp(binary,profile,out,ui=True)
 for attempt in range(45):
  try: client.call('view_status'); break
  except RuntimeError as error:
   if 'UNAVAILABLE' not in str(error) or attempt==44: raise
   time.sleep(1)
 prefs=client.call('preferences')
 client.call('preferences',{'preferences':{**prefs,'auto_save_unsaved':True,'basemap':'none','map_layers':[],'map':{**prefs['map'],'enabled':False},'terrain_builtin':False,'terrain_path':None,'theme':'dark'}})
 client.call('wmts_access',{'settings':{'offline':False}})
 project=profile/'agent-files/Satellite playback test.chronoscope'
 project.parent.mkdir(parents=True,exist_ok=True)
 project.write_bytes((repo/'samples/starlink-128-predicted-orbits-2024.chronoscope').read_bytes())
 client.call('open',{'path':str(project)})
 client.call('view_set',{'mode':'globe','fit':True,'globe_time':False,'globe_altitude':True,'display':{'mode':'points','spatial_culling':False,'show_points':False,'show_tracks':True,'track_opacity':.55,'show_trails':False,'trail_gap_minutes':0,'bloom':False}})
 snap=client.call('snapshot',{'compact':True}); lo,hi=snap['time_bounds']
 assert snap['count']==46208
 client.call('select',{'ids':[]})
 client.call('filter',{'filter':{'start':lo,'end':lo+(hi-lo)*.2}})
 client.call('view_playback',{'action':'configure','speed':1,'increment_seconds':60,'fade_amount':50})
 client.call('save',{'path':str(project),'overwrite':True})
 client.call('view_wait',{'timeout_ms':10000,'imagery':False,'terrain':False})
 state=client.call('view_status');assert state['diagnostics']['renderErrorCount']==0
 for _ in range(30):
  state=client.call('view_status')
  if state['diagnostics']['experimentalPlayback']['active']:break
  time.sleep(1)
 assert state['diagnostics']['experimentalPlayback']['active'],state['diagnostics']['experimentalPlayback']
 shot=client.rpc('tools/call',{'name':'chronoscope_view_capture','arguments':{'target':'app'}})
 assert not shot.get('isError')
 (out/'full-app-ready.png').write_bytes(base64.b64decode(next(item['data'] for item in shot['content'] if item['type']=='image')))
 receipt={'pid':process.pid,'binary':str(binary),'binary_sha256':hashlib.sha256(binary.read_bytes()).hexdigest(),'profile':str(profile),'branch':'codex/vfx-transitions-local','source_commit':json.loads((appdir/'BUILD.json').read_text())['source_commit'],'validation_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip(),'started_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'workspace_records':snap['count'],'mode':state['mode'],'playing':False,'synthetic_test_workspace':False,'dataset':'Bundled Starlink predicted orbits'}
 (appdir/'launch.json').write_text(json.dumps(receipt,indent=2)+'\n')
 print(json.dumps(receipt,indent=2),flush=True)
finally:
 if client:client.close()
 subprocess.run([str(binary),'--data-dir',str(profile),'agent','disable'],capture_output=True,timeout=20)
 log.close()
