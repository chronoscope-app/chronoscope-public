"""Paired preparation and sustained navigation in optimized native WebView2 apps."""
from pathlib import Path
import datetime,hashlib,json,os,shutil,socket,subprocess,sys,time
import transitions_native_helpers as h
base=Path(__file__).resolve().parent;repo=base/'chronoscope-upload-local';out=repo/'.qa/uploads/native';out.mkdir(parents=True,exist_ok=True);h.OUT=out
sys.path.insert(0,str(repo/'scripts'));from native_mcp import NativeMcp
# Reuse process counters/protocol, replacing only the CDP benchmark driver.
driver_source=h.Driver.__init__.__code__
import inspect
source=inspect.getsource(h.Driver).replace("BASE/'transition_driver.mjs'","BASE/'upload_driver.mjs'")
exec(source,h.__dict__)
variants=[('baseline',base/'chronoscope-ready-promotion/.qa/consolidated/windows-app/chronoscope-desktop.exe'),('paged',base/'Chronoscope Upload Lab/chronoscope-desktop.exe')]
configs=[dict(id='100k-map',mode='map',file=base/'chronoscope-vfx-local/.qa/full-app-2026-10-30/browser/full-app-vfx.chronoscope'),dict(id='satellites-altitude',mode='globe',altitude=True,file=repo/'samples/starlink-128-predicted-orbits-2024.chronoscope')]
report={'complete':False,'started_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'cases':[],'method':'Full native optimized Windows Tauri/WebView2, disposable profiles, governor enabled. Same full source re-prepared 3 times while navigating, then 120 seconds of continuous playback and pan/zoom/tilt. A normal UI off/on transition reestablishes the application-managed renderer after the direct cancellation test. Frame and RAF gaps include synchronous constructor and initial uploads; preparation duration includes GPU readiness. 1 Hz process CPU, private RAM and Windows attributed GPU counters. No forced GC. 20% time window. No terrain in these paired upload-isolation cases.'}
partial={};previous=out/'report.json'
if previous.exists():
 old=json.loads(previous.read_text());shutil.copy2(previous,out/('attempt-'+str(time.time_ns())+'.json'))
 wanted={name:hashlib.sha256(binary.read_bytes()).hexdigest() for name,binary in variants}
 report['cases']=[c for c in old['cases'] if c.get('complete') and c['binary_sha256']==wanted.get(c['variant'])]
 partial={(c['variant'],c['dataset'],c['binary_sha256']):c for c in old['cases'] if not c.get('complete') and len(c.get('preparations',[]))==3}
 report['earlier_attempt_note']='Retained completed measurements with matching binaries. Interrupted baseline satellite attempt used direct test instrumentation and returned to canonical playback; raw failed attempt retained separately. Retry fences that instrumentation with a normal UI off/on transition before sustained playback.'
def save():(out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
def stats(frames):
 s=sorted(frames);return {'frames':len(s),'p95_ms':s[min(len(s)-1,int(len(s)*.95))],'p99_ms':s[min(len(s)-1,int(len(s)*.99))],'max_ms':max(s),'gaps_over_50ms':sum(v>50 for v in s),'gaps_over_100ms':sum(v>100 for v in s)}
save()
for label,binary in variants:
 for config in configs:
  if any(c.get('complete') and c['variant']==label and c['dataset']==config['id'] and c['binary_sha256']==hashlib.sha256(binary.read_bytes()).hexdigest() for c in report['cases']):continue
  folder=out/(label+'-'+config['id']+'-'+str(time.time_ns()));folder.mkdir(exist_ok=True);profile=folder/'profile';exchange=profile/'agent-files';exchange.mkdir(parents=True,exist_ok=True);shutil.copy2(config['file'],exchange/'study.chronoscope')
  with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
  env=dict(os.environ,CHRONOSCOPE_DATA_DIR=str(profile),WEBVIEW2_USER_DATA_FOLDER=str(folder/'webview2'),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=f'--remote-debugging-port={port} --remote-debugging-address=127.0.0.1')
  subprocess.run([str(binary),'--data-dir',str(profile),'agent','enable'],check=True,capture_output=True,timeout=20)
  log=(folder/'app.log').open('w');app=subprocess.Popen([str(binary)],env=env,stdout=log,stderr=log,creationflags=subprocess.CREATE_NO_WINDOW)
  client=driver=monitor=None;row={'variant':label,'dataset':config['id'],'binary_sha256':hashlib.sha256(binary.read_bytes()).hexdigest(),'preparations':[]};report['cases'].append(row);save()
  try:
   client=NativeMcp(binary,profile,folder)
   for i in range(60):
    try:client.call('view_status');break
    except RuntimeError as e:
     if 'UNAVAILABLE' not in str(e) or i==59:raise
     time.sleep(1)
   driver=h.Driver(port,folder);driver.call('attach')
   client.call('open',{'path':str(exchange/'study.chronoscope')});client.call('select',{'ids':[]})
   prefs=client.call('preferences');client.call('preferences',{'preferences':{**prefs,'auto_save_unsaved':True,'basemap':'none','map_layers':[],'map':{**prefs['map'],'enabled':False},'terrain_builtin':False,'terrain_path':None,'theme':'dark'}})
   display={'mode':'points','spatial_culling':False,'show_points':True,'show_tracks':True,'show_trails':False,'point_scale':.65,'track_opacity':.55,'trail_gap_minutes':0,'bloom':False}
   client.call('view_set',{'mode':config['mode'],'fit':True,'globe_time':False,'globe_altitude':bool(config.get('altitude')),'display':display})
   snap=client.call('snapshot',{'compact':True});lo,hi=snap['time_bounds'];row['count']=snap['count'];client.call('filter',{'filter':{'start':lo+(hi-lo)*.2,'end':lo+(hi-lo)*.4}})
   client.call('view_playback',{'action':'configure','speed':1,'increment_seconds':60,'fade_amount':50})
   driver.call('ready');time.sleep(3);h.COUNTERS=h.Counters();monitor=h.Monitor(app.pid,folder);time.sleep(4)
   retained=partial.get((label,config['id'],row['binary_sha256']))
   if retained:
    row['preparations']=retained['preparations'];row['cancellation']=retained['cancellation'];row['preparation_note']='Retained successful three-rebuild/cancellation measurements on this exact binary from the preceding attempt; sustained playback runs in a fresh app process without direct renderer instrumentation.';save()
   else:
    for i in range(3):
     data=driver.call('rebuild');data['frames']=stats(data['intervals_ms']);data['raf']=stats(data['raf_intervals_ms']);row['preparations'].append(data);save()
     assert data['accepted'] and not data['missing'] and not data['unready'] and not data['oldLost'] and not data['renderErrors'],data
     if label=='paged':assert data['resident']['largestUploadVertices']<=8192,data['resident']
     print(label,config['id'],'rebuild',i+1,round(data['preparationMs']),data['frames'],flush=True);time.sleep(1)
    data=driver.call('cancel');row['cancellation']=data;save();assert not data['accepted'] and data['sameOld'] and data['before']==data['after'] and not data['pending'],data
   row['exact_before_play']=driver.call('exact');assert row['exact_before_play']['equal'] and row['exact_before_play']['unique']
   driver.call('reset');client.call('view_playback',{'action':'play'});driver.call('ready');driver.call('measure',{'milliseconds':5000})
   # Separate minute-long phases retain resource growth and frame tails.
   row['steady']=[]
   for minute in range(2):
    data=driver.call('measure',{'milliseconds':60000});data['frames']=stats(data['intervals_ms']);time.sleep(1.1);data['resources']=monitor.summary(data['started_unix_ms'],data['started_unix_ms']+data['elapsed_ms']);row['steady'].append(data);save()
    # A proper canonical fallback is not a missing drawing. Retain its actual
    # frame times/profile and transition traces, rather than abort the baseline.
    assert not data['unready'] and not data['final']['diagnostics']['renderErrorCount'],data['final']
    print(label,config['id'],'minute',minute+1,data['frames'],flush=True)
   client.call('view_playback',{'action':'pause'});row['exact_after_play']=driver.call('exact');assert row['exact_after_play']['equal'] and row['exact_after_play']['unique']
   driver.call('screenshot',{'path':str(folder/'full-native-app.png')});assert driver.call('health')==[];row['complete']=True;save()
  except Exception as e:row['error']=str(e);save();raise
  finally:
   if monitor:monitor.close()
   if h.COUNTERS:h.COUNTERS.close();h.COUNTERS=None
   if driver:driver.close()
   if client:client.close()
   subprocess.run([str(binary),'--data-dir',str(profile),'agent','disable'],capture_output=True,timeout=20)
   if app.poll() is None:subprocess.run(['taskkill','/PID',str(app.pid),'/T','/F'],capture_output=True,timeout=20)
   log.close()
report['complete']=True;report['finished_utc']=datetime.datetime.now(datetime.timezone.utc).isoformat();save();print('PAIRED NATIVE UPLOAD CHECKS PASS',flush=True)
