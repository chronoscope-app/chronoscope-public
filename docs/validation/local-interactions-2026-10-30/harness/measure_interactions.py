"""Fresh-process native comparison with per-process CPU/RAM/GPU sampling."""
from pathlib import Path
import datetime,hashlib,json,math,os,shutil,socket,subprocess,sys,time
import native_interaction_helpers as h
base=Path(__file__).resolve().parent;repo=base/'chronoscope-interactions-local';out=h.OUT
sys.path.insert(0,str(repo/'scripts'));from native_mcp import NativeMcp
baseline=base/'chronoscope-next/.qa/next-vfx-integration/windows-app/chronoscope-desktop.exe'
improved=base/'Chronoscope Interaction Lab/chronoscope-desktop.exe'
report={'complete':False,'cases':[],'started_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),
 'binaries':{k:{'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for k,p in [('next-main',baseline),('interaction-lab',improved)]},
 'method':'Fresh native Tauri/WebView2 process and private profile per case; same dataset/styles/governor; 20% visible time window. 8s idle, 20s paused pan/zoom/tilt, 20s time-rail scrubbing (real pointer capture followed by RAF pointer-move events), then 15s selected playback after 5s warm-up. CPU/private RAM and Windows-attributed GPU counters sampled at 1Hz. CPU normalized over all logical processors. FPS is postRender cadence, not presentation latency. Background saving is disabled during the comparison. Basemap and terrain are off to isolate event/effect rendering; separate reference checks cover terrain and altitude correctness.',
 'machine':{'logical_processors':h.psutil.cpu_count(),'ram_bytes':h.psutil.virtual_memory().total,'gpu':str(h.pynvml.nvmlDeviceGetName(h.GPU))},
 'limitations':['Short single trials per phase and case; hardware/process scheduling can vary.','Windows GPU memory is attributed allocation accounting, not unique physical VRAM residency.','Prepared point/track styling and fading retain existing experimental differences.','Baseline viewport culling can return a subset of the exact engine window; candidate retains the complete prepared window.']}
if (out/'report.json').exists():
 previous=json.loads((out/'report.json').read_text())
 if previous.get('binaries',{}).get('next-main')==report['binaries']['next-main']:
  report['cases']=[c for c in previous.get('cases',[]) if c['binary_sha256']==report['binaries']['interaction-lab' if c['improved'] else 'next-main']['sha256']]
  report['started_utc']=previous['started_utc']
if os.environ.get('CHRONOSCOPE_DIAGNOSE_GLOBAL'):
 report['cases']=[c for c in report['cases'] if not (c['dataset']['id']=='global-altitude' and c['improved'])]
def save():
 p=out/'report.tmp';p.write_text(json.dumps(report,indent=2)+'\n');p.replace(out/'report.json')
save()
def run(config,new):
 binary=improved if new else baseline
 name=config['id']+('-improved' if new else '-next');folder=out/name/datetime.datetime.now(datetime.timezone.utc).strftime('%H%M%S-%f');profile=folder/'profile';exchange=profile/'agent-files';exchange.mkdir(parents=True,exist_ok=True)
 source=base/config['file'];shutil.copy2(source,exchange/'study.chronoscope')
 with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
 env=dict(os.environ,CHRONOSCOPE_DATA_DIR=str(profile),WEBVIEW2_USER_DATA_FOLDER=str(folder/'webview2'),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=f'--remote-debugging-port={port} --remote-debugging-address=127.0.0.1')
 subprocess.run([str(binary),'--data-dir',str(profile),'agent','enable'],check=True,capture_output=True,timeout=20)
 log=(folder/'app.log').open('w');app=subprocess.Popen([str(binary)],env=env,stdout=log,stderr=log,creationflags=subprocess.CREATE_NO_WINDOW)
 (folder/'launch.json').write_text(json.dumps({'pid':app.pid,'port':port,'profile':str(profile)}))
 client=driver=monitor=None;row={'name':name,'artifact_folder':str(folder),'improved':new,'dataset':config,'binary_sha256':hashlib.sha256(binary.read_bytes()).hexdigest(),'phases':{}}
 try:
  client=NativeMcp(binary,profile,folder)
  for i in range(45):
   try:client.call('view_status');break
   except RuntimeError as e:
    if 'UNAVAILABLE' not in str(e) or i==44:raise
    time.sleep(1)
  prefs=client.call('preferences');client.call('preferences',{'preferences':{**prefs,'auto_save_unsaved':False,'basemap':'none','map_layers':[],'map':{**prefs['map'],'enabled':False},'terrain_builtin':False,'terrain_path':None,'theme':'dark'}})
  client.call('open',{'path':str(exchange/'study.chronoscope')});client.call('select',{'ids':[]})
  client.call('view_set',{'mode':config['mode'],'fit':True,'globe_time':False,'globe_altitude':config.get('altitude',False),'display':{'mode':'points','spatial_culling':True,'show_points':True,'show_tracks':True,'show_trails':False,'point_scale':.65,'track_opacity':.55,'trail_gap_minutes':config.get('gap',0),'trail_pixels':0,'bloom':False,**config.get('display',{})}})
  snap=client.call('snapshot',{'compact':True});lo,hi=snap['time_bounds'];assert snap['count']==config['count']
  client.call('filter',{'filter':{'start':lo,'end':lo+(hi-lo)*.2}})
  speed,increment=min(((s,i) for s in [.25,.5,.75,1,1.25,1.5,1.75,2] for i in [.001,1,60,3600,86400,604800]),key=lambda p:abs(math.log(p[0]*p[1]/(max(1,hi-lo)/100))))
  client.call('view_playback',{'action':'configure','speed':speed,'increment_seconds':increment,'fade_amount':50})
  driver=h.Driver(port,folder);driver.call('ready',{'improved':new and not config.get('rich',False)})
  h.COUNTERS=h.Counters();monitor=h.Monitor(app.pid,folder);time.sleep(3)
  def phase(name,seconds,motion=None):
   data=driver.call('measure',{'milliseconds':seconds*1000,'motion':motion});time.sleep(1.2)
   stats=monitor.summary(data['started_unix_ms'],data['started_unix_ms']+data['elapsed_ms'])
   frames=sorted(data['intervals_ms']);fps=data['rendered_frames']/(data['elapsed_ms']/1000)
   assert data['final']['diagnostics']['renderErrorCount']==0
   if new and not config.get('rich',False) and not data['final']['diagnostics']['experimentalPlayback']['active']:print('FALLBACK',name,json.dumps(data['final']['diagnostics']['resourceGovernor']),flush=True)
   result={'fps':fps,'frame_p95_ms':(frames[min(len(frames)-1,math.floor(len(frames)*.95))] if frames else None),'gaps_over_50ms':sum(x>50 for x in frames),'driver':data,'resources':stats}
   row['phases'][name]=result
   print('PHASE',row['name'],name,'FPS',round(fps,1),'CPU',round(stats['cpu_total_machine_percent']['mean'],2),'RAM MiB',round(stats['ram_private_resident_bytes']['mean']/1024**2),'GPU3D',round(stats['app_gpu_3d_percent']['mean'],1),flush=True)
  phase('idle',8)
  if config.get('rich',False):
   phase('polygon-selection-stress',20,'geometry-selection')
   driver.call('screenshot',{'path':str(folder/'geometry.png')});report['cases'].append(row);save();return
  phase('paused-navigation',20,'navigation')
  driver.call('window');driver.call('settled');phase('scrubbing',20,'scrub')
  exact=driver.call('exact');assert exact['subset'];assert not new or exact['equal'];row['exact_after_scrub']=exact
  row['selected_count']=driver.call('select');client.call('view_playback',{'action':'play'});driver.call('measure',{'milliseconds':5000})
  phase('selected-playback',15)
  driver.call('screenshot',{'path':str(folder/'selected-playback.png')});client.call('view_playback',{'action':'pause'})
  exact=driver.call('exact');assert exact['subset'];assert not new or exact['equal'];row['exact_after_pause']=exact
  row['monitor_errors']=monitor.errors;report['cases'].append(row);save()
 finally:
  if monitor:monitor.close()
  if h.COUNTERS:h.COUNTERS.close();h.COUNTERS=None
  if client:
   try:client.close()
   except Exception:pass
  if driver:
   try:driver.close()
   except Exception:pass
  subprocess.run([str(binary),'--data-dir',str(profile),'agent','disable'],capture_output=True,timeout=20)
  if app.poll() is None:subprocess.run(['taskkill','/PID',str(app.pid),'/T','/F'],capture_output=True,timeout=20);app.wait(timeout=20)
  log.close()
configs=[{'id':'100k-map','count':100000,'mode':'map','file':'chronoscope-vfx-local/.qa/full-app-2026-10-30/browser/full-app-vfx.chronoscope'},
 {'id':'global-altitude','count':46208,'mode':'globe','altitude':True,'gap':2,'file':'chronoscope-interactions-local/samples/starlink-128-predicted-orbits-2024.chronoscope'},
 {'id':'mixed-heatmap','count':50713,'mode':'map','file':'chronoscope-interactions-local/samples/nasa-firms-south-america-2026-10.chronoscope','display':{'mode':'heatmap','heat_weight':'value','heat_max':300,'heat_radius':18,'show_tracks':False,'spatial_culling':False,'bloom':True}},
 {'id':'polygons','count':200,'mode':'map','rich':True,'file':'chronoscope-interactions-local/.qa/interactions/browser/polygons.chronoscope','display':{'show_centroids':False,'show_points':False,'show_tracks':False,'spatial_culling':False}}]
try:
 for config in configs:
  for new in [False,True]:
   if not any(c['dataset']['id']==config['id'] and c['improved']==new for c in report['cases']):run(config,new)
 report['complete']=True
except Exception as e:report['error']=str(e);raise
finally:report['finished_utc']=datetime.datetime.now(datetime.timezone.utc).isoformat();save();h.pynvml.nvmlShutdown()
