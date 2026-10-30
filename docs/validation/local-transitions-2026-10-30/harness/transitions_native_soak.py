"""Long native Windows interaction sessions, isolated profiles, no user-app control."""
from pathlib import Path
import datetime,hashlib,json,math,os,shutil,socket,subprocess,sys,time
import transitions_native_helpers as h
base=Path(__file__).resolve().parent;repo=base/'chronoscope-transitions-local';out=h.OUT
sys.path.insert(0,str(repo/'scripts'));from native_mcp import NativeMcp
binary=base/'Chronoscope Transition Lab/chronoscope-desktop.exe'
configs=[{'id':'100k-map','mode':'map','file':str(base/'chronoscope-vfx-local/.qa/full-app-2026-10-30/browser/full-app-vfx.chronoscope'),'steps':30},
 {'id':'flights-altitude','mode':'globe','altitude':True,'file':str(repo/'samples/flights-philippines-week-2026.chronoscope'),'steps':15},
 {'id':'satellites-altitude','mode':'globe','altitude':True,'file':str(repo/'samples/starlink-128-predicted-orbits-2024.chronoscope'),'steps':15},
 {'id':'terrain-gps','mode':'globe','terrain':True,'file':str(repo/'samples/animal-gps-black-rock-forest-2023-03.chronoscope'),'steps':15},
 {'id':'weighted-heatmap','mode':'map','heat':True,'file':str(repo/'samples/nasa-firms-south-america-2026-10.chronoscope'),'steps':15}]
report={'complete':False,'binary_sha256':hashlib.sha256(binary.read_bytes()).hexdigest(),'started_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'cases':[],
'method':'Native full optimized Windows app; private profile per dataset, autosave enabled; governor enabled; 1 Hz process CPU/private resident RAM and attributed GPU allocation/3D counters. 20-second active phases with repeated pause/play, real-pointer rail scrub, selection, style, supported/unsupported renderer and view transitions. Initial warmup is recorded separately. Frame intervals from postRender (not monitor presentation). Idle gaps between phases excluded. No explicit garbage collection. Retain every phase and raw OS sample.'}
report['source_commit']=json.loads((binary.parent/'BUILD.json').read_text())['source_commit']
report['machine']={'logical_processors':h.psutil.cpu_count(),'ram_bytes':h.psutil.virtual_memory().total,'gpu':str(h.pynvml.nvmlDeviceGetName(h.GPU))}
previous_file=out/'report.json'
if previous_file.exists():
 previous=json.loads(previous_file.read_text())
 if previous.get('binary_sha256')==report['binary_sha256']:
  # Preserve previous attempts and skip datasets already completed on this binary.
  report['cases']=previous.get('cases',[])
  report['started_utc']=previous.get('started_utc',report['started_utc'])
  if previous.get('retained_measurements'):report['retained_measurements']=previous['retained_measurements']
  report.pop('error',None)
 elif previous.get('source_commit')=='9f7154736eb3ab1071b6655fdf1a6e5d3fc5b43d':
  old_source=subprocess.check_output(['git','show','9f71547:frontend/src/main.ts'],cwd=repo).decode('utf-8')
  current_source=(repo/'frontend/src/main.ts').read_text(encoding='utf-8')
  added='''  if (view.resources.status.terrainProviderChanges !== previousTerrainProvider) {
    // A one-off failure against the previous/missing provider must not disable
    // preparation for an otherwise unchanged study after terrain becomes ready.
    interactionBlocked = "";
    scheduleInteraction();
  }
'''
  assert current_source.replace('  const previousTerrainProvider = view.resources.status.terrainProviderChanges;\n','',1).replace(added,'',1)==old_source,'Rendering code changed beyond the terrain-only recovery fix'
  report['retained_measurements']='100k, flight and satellite runs retain source 9f71547/binary '+previous['binary_sha256']+'. The only source change is inside successful terrain-provider installation, which these terrain-disabled cases do not execute. Terrain and heatmap use the final binary. Every case records its own hash.'
  for case in previous.get('cases',[]):
   if case.get('complete') and not case['dataset'].get('terrain'):
    case['binary_sha256']=previous['binary_sha256'];case['source_commit']=previous['source_commit'];report['cases'].append(case)
def save():
 (out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
save()
def run(config):
 folder=out/config['id'];folder.mkdir(exist_ok=True);profile=folder/'profile';exchange=profile/'agent-files';exchange.mkdir(parents=True,exist_ok=True)
 shutil.copy2(config['file'],exchange/'study.chronoscope')
 with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
 env=dict(os.environ,CHRONOSCOPE_DATA_DIR=str(profile),WEBVIEW2_USER_DATA_FOLDER=str(folder/'webview2'),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=f'--remote-debugging-port={port} --remote-debugging-address=127.0.0.1')
 subprocess.run([str(binary),'--data-dir',str(profile),'agent','enable'],check=True,capture_output=True,timeout=20)
 log=(folder/'app.log').open('w');app=subprocess.Popen([str(binary)],env=env,stdout=log,stderr=log,creationflags=subprocess.CREATE_NO_WINDOW)
 client=driver=monitor=None;row={'dataset':config,'phases':[],'binary_sha256':report['binary_sha256'],'source_commit':report['source_commit'],'started_unix_ms':time.time()*1000};report['cases'].append(row);save()
 try:
  client=NativeMcp(binary,profile,folder)
  for i in range(60):
   try:client.call('view_status');break
   except RuntimeError as e:
    if 'UNAVAILABLE' not in str(e) or i==59:raise
    time.sleep(1)
  if driver is None:driver=h.Driver(port,folder);driver.call('attach')
  prefs=client.call('preferences');client.call('preferences',{'preferences':{**prefs,'auto_save_unsaved':True,'basemap':'none','map_layers':[],'map':{**prefs['map'],'enabled':False},'terrain_builtin':bool(config.get('terrain')),'terrain_path':None,'theme':'dark'}})
  client.call('open',{'path':str(exchange/'study.chronoscope')});client.call('select',{'ids':[]})
  # Legacy fixtures without presentation metadata clear their live terrain on
  # open. Apply requested test settings after opening, not just before it.
  prefs=client.call('preferences');client.call('preferences',{'preferences':{**prefs,'auto_save_unsaved':True,'basemap':'none','map_layers':[],'map':{**prefs['map'],'enabled':False},'terrain_builtin':bool(config.get('terrain')),'terrain_path':None,'theme':'dark'}})
  display={'mode':'heatmap' if config.get('heat') else 'points','spatial_culling':False,'show_points':True,'show_tracks':not config.get('heat'),'show_trails':False,'point_scale':.65,'track_opacity':.55,'trail_gap_minutes':2 if config.get('altitude') else 0,'bloom':bool(config.get('heat')),'heat_weight':'value','heat_max':300,'heat_radius':18}
  client.call('view_set',{'mode':config['mode'],'fit':True,'globe_time':False,'globe_altitude':bool(config.get('altitude')),'display':display})
  snap=client.call('snapshot',{'compact':True});lo,hi=snap['time_bounds'];row['count']=snap['count']
  client.call('filter',{'filter':{'start':lo+(hi-lo)*.2,'end':lo+(hi-lo)*.4}})
  speed,increment=min(((s,i) for s in [.25,.5,.75,1,1.25,1.5,1.75,2] for i in [.001,1,60,3600,86400,604800]),key=lambda p:abs(math.log(p[0]*p[1]/(max(1,hi-lo)/240))))
  client.call('view_playback',{'action':'configure','speed':speed,'increment_seconds':increment,'fade_amount':50})
  ready_start=time.perf_counter();row['startup_state']=driver.call('state');save();driver.call('ready',{'improved':True});driver.call('idle');row['initial_ready_wait_ms']=(time.perf_counter()-ready_start)*1000
  if config['id']=='100k-map':
   client.call('view_set',{'display':{**display,'show_tracks':False}});driver.call('idle');driver.call('settled')
   row['native_pixels']=driver.call('pixels');assert row['native_pixels']['roi']['count']>30
   assert len(row['native_pixels']['frames'])>20
   assert all(f['count']>=10 for f in row['native_pixels']['frames']),row['native_pixels']
   client.call('view_set',{'display':display});driver.call('idle');driver.call('settled');save()
  h.COUNTERS=h.Counters();monitor=h.Monitor(app.pid,folder);time.sleep(3)
  if config.get('terrain'):
   row['paired_true_terrain']=[]
   for enabled in [False,True]:
    driver.call('toggle',{'enabled':enabled});driver.call('idle')
    if enabled:driver.call('settled')
    client.call('filter',{'filter':{'start':lo+(hi-lo)*.2,'end':lo+(hi-lo)*.4}});driver.call('idle')
    driver.call('play',{'action':'play'});driver.call('measure',{'milliseconds':5000})
    data=driver.call('measure',{'milliseconds':20000});time.sleep(1.1)
    diag=data['final']['diagnostics'];assert diag['terrain']['terrainActive'] and not diag['renderErrorCount']
    if enabled:assert diag['experimentalPlayback']['active']
    stats=monitor.summary(data['started_unix_ms'],data['started_unix_ms']+data['elapsed_ms'])
    frames=sorted(data['intervals_ms'])
    row['paired_true_terrain'].append({'smooth':enabled,'fps':data['rendered_frames']/(data['elapsed_ms']/1000),'p95_ms':frames[min(len(frames)-1,int(len(frames)*.95))],'gaps_over_50ms':sum(v>50 for v in frames),'driver':data,'resources':stats});save()
    driver.call('play',{'action':'pause'});exact=driver.call('exact');assert exact['subset'] and exact['unique'] and (exact['limited'] or exact['equal'] or exact.get('summaryOnly')),exact
   client.call('filter',{'filter':{'start':lo+(hi-lo)*.2,'end':lo+(hi-lo)*.4}});driver.call('idle')
  for step in range(config['steps']):
   kind=step%10;transition='none';motion='navigation'
   if kind==0:driver.call('play',{'action':'pause'});transition='pause'
   elif kind==1:driver.call('play',{'action':'play'});transition='play'
   elif kind==2:driver.call('select');transition='selection';motion=None
   elif kind==3:driver.call('play',{'action':'pause'});motion='scrub';transition='pause-to-scrub'
   elif kind==4:
    client.call('select',{'ids':[]});client.call('view_set',{'display':{**display,'mode':'clusters','bloom':False}});driver.call('idle');driver.call('measure',{'milliseconds':1500,'motion':None});client.call('view_set',{'display':{**display,'point_scale':.95,'track_opacity':.35}});driver.call('idle');transition='unsupported-clusters-to-style'
   elif kind==5:
    driver.call('toggle',{'enabled':False});transition='prepared-to-standard'
   elif kind==6:
    driver.call('toggle',{'enabled':True});transition='standard-to-prepared'
   elif kind==7:
    client.call('view_set',{'mode':'space-time','fit':True,'globe_altitude':False});driver.call('idle');transition='Time-view'
   elif kind==8:
    client.call('view_set',{'mode':config['mode'],'fit':True,'globe_time':False,'globe_altitude':bool(config.get('altitude')),'display':display});driver.call('idle');transition='return-view'
   elif kind==9:driver.call('window');driver.call('play',{'action':'play'});transition='window-to-play'
   data=driver.call('measure',{'milliseconds':20000,'motion':motion});time.sleep(1.1)
   stats=monitor.summary(data['started_unix_ms'],data['started_unix_ms']+data['elapsed_ms']);frames=sorted(data['intervals_ms']);diag=data['final']['diagnostics']
   assert diag['renderErrorCount']==0,diag['lastRenderError']
   if config.get('terrain'):assert diag['terrain']['terrainActive'],'Terrain test is not actually draped'
   phase={'step':step,'transition':transition,'motion':motion,'fps':data['rendered_frames']/(data['elapsed_ms']/1000),'p95_ms':frames[min(len(frames)-1,int(len(frames)*.95))] if frames else None,'p99_ms':frames[min(len(frames)-1,int(len(frames)*.99))] if frames else None,'gaps_over_50ms':sum(v>50 for v in frames),'max_interval_ms':max(frames,default=0),'resources':stats,'driver':data}
   row['phases'].append(phase);row['health']=driver.call('health');save()
   assert row['health']['unreadyFrames']==0 and not row['health']['browserErrors'],row['health']
   # Exact IDs on every stop, also under governor limits (subset permitted only
   # when the documented resource cap requires representative rendering).
   if not data['final']['playing'] if 'playing' in data['final'] else kind in [0,3,4,5,6,7,8]:
    exact=driver.call('exact');assert exact['subset'] and exact['unique'] and (exact['limited'] or exact['equal'] or exact.get('summaryOnly')),exact;phase['exact']=exact
    if config.get('heat'):
     weighted=driver.call('heat');assert weighted['equal'] and not weighted['error'],weighted;phase['weighted_cells']=weighted
   print('SOAK',config['id'],step+1,'/',config['steps'],transition,'FPS',round(phase['fps'],1),'p99',round(phase['p99_ms'] or 0,1),'gaps50',phase['gaps_over_50ms'],'RAM',round(stats['ram_private_resident_bytes']['mean']/1024**2),'profile',diag['resourceGovernor']['profile'],flush=True)
  driver.call('play',{'action':'pause'});row['final_exact']=driver.call('exact');assert row['final_exact']['subset'] and row['final_exact']['unique'] and (row['final_exact']['limited'] or row['final_exact']['equal'] or row['final_exact'].get('summaryOnly'))
  row['dataset_switches']=[]
  alternate=repo/'samples/usgs-global-earthquakes-2025-01.chronoscope'
  shutil.copy2(alternate,exchange/'alternate.chronoscope')
  for file in [exchange/'alternate.chronoscope',exchange/'study.chronoscope']:
   client.call('open',{'path':str(file)});driver.call('idle')
   current=client.call('snapshot',{'compact':True});exact=driver.call('exact');assert exact['subset'] and exact['unique'] and (exact['limited'] or exact['equal'] or exact.get('summaryOnly')),exact
   if exact.get('summaryOnly'):
    parity=driver.call('heat');assert parity['equal'] and not parity['error'],parity;exact['weighted_cells']=parity
   status=driver.call('state');assert status['diag']['renderErrorCount']==0
   row['dataset_switches'].append({'count':current['count'],'exact':exact,'diagnostics':status['diag']})
  assert row['dataset_switches'][-1]['count']==row['count']
  row['health']=driver.call('health');row['finished_unix_ms']=time.time()*1000;row['monitor_errors']=monitor.errors;row['complete']=True;driver.call('screenshot',{'path':str(folder/'final.png')});save()
 except Exception as error:
  row['error']=str(error)
  if driver:
   try:
    row['failure_state']=driver.call('state');row['failure_health']=driver.call('health');driver.call('screenshot',{'path':str(folder/'failure.png')})
   except Exception as capture_error:row['capture_error']=str(capture_error)
  save();raise
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
try:
 for config in configs:
  if not any(c.get('complete') and c['dataset']['id']==config['id'] for c in report['cases']):run(config)
 report['complete']=True
except Exception as e:report['error']=str(e);raise
finally:report['finished_utc']=datetime.datetime.now(datetime.timezone.utc).isoformat();save();h.pynvml.nvmlShutdown()
