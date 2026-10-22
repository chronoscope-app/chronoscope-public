import os,sys,time,json,pathlib,subprocess,base64,signal
ROOT=pathlib.Path(os.environ.get('CHRONOSCOPE_PERF_ROOT','/tmp/openclaw/chronoscope-perf-20261014'))
REPO=pathlib.Path(os.environ.get('CHRONOSCOPE_PERF_REPO',str(pathlib.Path(__file__).resolve().parents[3])))
SCRIPTS=pathlib.Path(__file__).resolve().parent
ROOT.mkdir(parents=True,exist_ok=True)
label=sys.argv[1] if len(sys.argv)>1 else 'native-full'
out=ROOT/label;out.mkdir(exist_ok=True)
(out/'events.ndjson').write_text('')
env=os.environ.copy();env.update(DRI_PRIME='pci-0000_3a_00_0',LIBGL_DEBUG='verbose',GDK_BACKEND=os.environ.get('GDK_BACKEND','x11'),XDG_DATA_HOME=str(out/'data'),XDG_CACHE_HOME=str(ROOT/os.environ.get('CHRONOSCOPE_PERF_CACHE','shared-native-cache')),XDG_CONFIG_HOME=str(out/'config'),CHRONOSCOPE_PERF_SCRIPT=str(out/'native-script.js'),CHRONOSCOPE_PERF_OUTPUT=str(out/'events.ndjson'))
# Only task-local preferences: never touch the regular user's Chronoscope workspace.
prefs=out/'data'/'chronoscope';prefs.mkdir(parents=True,exist_ok=True)
(prefs/'preferences.json').write_text(json.dumps({'theme':'dark','coordinates':'dd','map':{'url':'','layer':'','matrix_set':'','style':'','format':'','time':'','enabled':False},'terrain_path':None,'terrain_exaggeration':1.0}))
config='window.__perfRepo = '+json.dumps(str(REPO))+';window.__perfAllowIntegrated = '+str(os.environ.get('CHRONOSCOPE_PERF_ALLOW_INTEGRATED')=='1').lower()+';window.__perfWorkflowOnly = '+str(os.environ.get('CHRONOSCOPE_PERF_WORKFLOW_ONLY')=='1').lower()+';'
(out/'native-script.js').write_text(config+pathlib.Path(os.environ.get('CHRONOSCOPE_PERF_SCRIPT_SOURCE',str(SCRIPTS/'native-harness.js'))).read_text())
log=open(out/'stderr.log','w');start=time.monotonic();p=subprocess.Popen([str(ROOT/'chronoscope-desktop-instrumented')],env=env,stdout=log,stderr=log,start_new_session=True)
readpos=0;phase='startup';ready=None;rows=[];events=[];ticks={};clk=os.sysconf('SC_CLK_TCK');last=time.monotonic();deadline=start+int(os.environ.get('CHRONOSCOPE_PERF_TIMEOUT','420'))
try:
 while time.monotonic()<deadline and p.poll() is None:
  file=out/'events.ndjson'
  if file.exists():
   with file.open() as f:
    f.seek(readpos)
    while True:
     pos=f.tell();line=f.readline()
     if not line or not line.endswith(chr(10)):f.seek(pos);break
     e=json.loads(line);events.append(e)
     if e['event']=='phase':phase=e['label']
     if e['event']=='ready':ready=time.monotonic()-start;print(label,'ready',ready,e['proof']['renderer'],flush=True)
     if e['event']=='capture':
      (out/(e['label']+'.png')).write_bytes(base64.b64decode(e.pop('png').split(',')[1]))
     if e['event'] in ['sample','construction','idle','timeline','terrain','error','complete']:print(label,e['event'],e.get('label',e.get('message','')),flush=True)
    readpos=f.tell()
  now=time.monotonic();procs={};rss=0;cpu_ticks=0
  for d in pathlib.Path('/proc').iterdir():
   if not d.name.isdigit():continue
   try:
    s=(d/'stat').read_text();parts=s[s.rfind(')')+2:].split();pid=int(d.name);ppid=int(parts[1]);procs[pid]=(ppid,int(parts[11])+int(parts[12]),int(parts[21])*os.sysconf('SC_PAGE_SIZE'))
   except (OSError,ValueError,IndexError):pass
  children={p.pid}
  for _ in range(5):children.update(pid for pid,(parent,*_) in procs.items() if parent in children)
  current={pid:procs[pid][1] for pid in children if pid in procs};delta=sum(max(0,ticks_now-ticks.get(pid,ticks_now)) for pid,ticks_now in current.items());ticks=current
  rss=sum(procs[pid][2] for pid in children if pid in procs)
  drm=[]
  for pid in children:
   try:
    for fd in pathlib.Path('/proc',str(pid),'fd').iterdir():
     try:
      link=os.readlink(fd)
      if '/dev/dri/' in link:drm.append({'pid':pid,'node':link,'fdinfo':pathlib.Path('/proc',str(pid),'fdinfo',fd.name).read_text()})
     except OSError:pass
   except OSError:pass
  metrics={}
  for name in ['gpu_busy_percent','mem_info_vram_used','mem_info_gtt_used']:
   try:metrics[name]=int(pathlib.Path('/sys/bus/pci/devices/0000:3a:00.0',name).read_text())
   except OSError:metrics[name]=None
  rows.append({'seconds':now-start,'phase':phase,'cpuPercent':100*delta/clk/(now-last),'rssBytesSum':rss,'pids':sorted(children),'drm':drm,**metrics});last=now
  if events and events[-1]['event'] in ['complete','error']:break
  time.sleep(.25)
finally:
 # Only the session launched above and its own child processes.
 if p.poll() is None:os.killpg(p.pid,signal.SIGTERM)
 try:p.wait(timeout=10)
 except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);p.wait()
 log.close()
(out/'events.json').write_text(json.dumps(events,indent=2))
(out/'resources.json').write_text(json.dumps(rows,indent=2))
(out/'run.json').write_text(json.dumps({'label':label,'pid':p.pid,'startupProcessToReadySeconds':ready,'elapsedSeconds':time.monotonic()-start,'exitCode':p.returncode,'complete':bool(events and events[-1]['event']=='complete'),'environment':{k:env[k] for k in ['DRI_PRIME','GDK_BACKEND','XDG_DATA_HOME','XDG_CACHE_HOME','XDG_CONFIG_HOME']}} ,indent=2))
if not(events and events[-1]['event']=='complete'):sys.exit(1)
