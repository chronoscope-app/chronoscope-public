from pathlib import Path
import json,os,psutil,pynvml,queue,re,statistics,subprocess,threading,time
BASE=Path(__file__).resolve().parent
OUT=BASE/'chronoscope-transitions-local/.qa/transitions/native-soak'
OUT.mkdir(parents=True,exist_ok=True)
NODE=BASE/'.tools/node-v26.13.0-win-x64/node.exe'
pynvml.nvmlInit();GPU=pynvml.nvmlDeviceGetHandleByIndex(0)
class Counters:
 def __init__(self):
  self.latest=None;self.errors=[];self.log=(OUT/'gpu-counter-stderr.log').open('w')
  self.p=subprocess.Popen([str(Path.home()/'.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe'),'-NoLogo','-NoProfile','-NonInteractive','-Command',(BASE/'vfx_resource_gpu_counters.ps1').read_text()],stdout=subprocess.PIPE,stderr=self.log,text=True,encoding='utf-8',creationflags=subprocess.CREATE_NO_WINDOW)
  def read():
   for line in self.p.stdout:
    try:self.latest=json.loads(line)
    except Exception as e:self.errors.append(str(e))
  self.thread=threading.Thread(target=read,daemon=True);self.thread.start()
 def close(self):
  self.p.terminate();self.p.wait(timeout=10);self.log.close()
COUNTERS=None
class Driver:
 def __init__(self,port,folder):
  self.log=(folder/'driver.log').open('w');self.q=queue.Queue();self.i=0
  self.p=subprocess.Popen([str(NODE),str(BASE/'transition_driver.mjs'),str(port)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=self.log,text=True,creationflags=subprocess.CREATE_NO_WINDOW)
  def read():
   for line in self.p.stdout:self.q.put(json.loads(line))
   self.q.put(None)
  threading.Thread(target=read,daemon=True).start();assert self.q.get(timeout=30).get('ready')
 def call(self,command,arguments=None):
  self.i+=1;self.p.stdin.write(json.dumps({'id':self.i,'command':command,'arguments':arguments or {}})+'\n');self.p.stdin.flush();r=self.q.get(timeout=90)
  assert r and r.get('id')==self.i,r
  if 'error' in r:raise RuntimeError(r['error'])
  return r['result']
 def close(self):
  try:self.call('close')
  finally:
   self.p.stdin.close()
   try:self.p.wait(timeout=10)
   except subprocess.TimeoutExpired:self.p.kill();self.p.wait(timeout=5)
   self.log.close()
class Monitor:
 def __init__(self,pid,folder):
  self.root=psutil.Process(pid);self.rows=[];self.errors=[];self.stop=threading.Event();self.folder=folder
  self.thread=threading.Thread(target=self.work,daemon=True);self.thread.start()
 def work(self):
  while not self.stop.is_set():
   try:
    row={'unix_ms':time.time()*1000,'processes':[]}
    for proc in [self.root,*self.root.children(recursive=True)]:
     try:
      with proc.oneshot():
       c=proc.cpu_times();m=proc.memory_full_info();row['processes'].append({'pid':proc.pid,'name':proc.name(),'cpu_seconds':c.user+c.system,'rss':m.rss,'uss':m.uss,'private_commit':m.private})
     except (psutil.NoSuchProcess,psutil.AccessDenied):pass
    ids={p['pid'] for p in row['processes']};latest=COUNTERS.latest
    if latest and abs(row['unix_ms']-latest['unix_ms'])<3000:
     selected=[];engines={};dedicated=shared=0
     for c in latest['counters']:
      match=re.match(r'pid_(\d+)_',c['n'])
      if not match or int(match[1]) not in ids:continue
      selected.append(c);path=c['p'].lower()
      if path.endswith('dedicated usage'):dedicated+=c['v']
      elif path.endswith('shared usage'):shared+=c['v']
      elif 'engtype_3d' in c['n'].lower():
       key=re.sub(r'^pid_\d+_','',c['n']);engines[key]=engines.get(key,0)+c['v']
     row['app_gpu']={'counter_unix_ms':latest['unix_ms'],'dedicated_bytes':dedicated,'shared_bytes':shared,'busiest_3d_engine_percent':min(100,max(engines.values(),default=0)),'matched_counters':selected}
    else:row['app_gpu']=None
    mem=pynvml.nvmlDeviceGetMemoryInfo(GPU);util=pynvml.nvmlDeviceGetUtilizationRates(GPU)
    row['device_gpu']={'used_bytes':mem.used,'utilization_percent':util.gpu,'temperature_c':pynvml.nvmlDeviceGetTemperature(GPU,0),'power_watts':pynvml.nvmlDeviceGetPowerUsage(GPU)/1000,'pstate':pynvml.nvmlDeviceGetPerformanceState(GPU)}
    row['machine_cpu_percent']=psutil.cpu_percent();row['available_ram_bytes']=psutil.virtual_memory().available
    self.rows.append(row)
    with (self.folder/'os-samples.jsonl').open('a') as f:f.write(json.dumps(row)+'\n')
   except Exception as e:self.errors.append(str(e))
   self.stop.wait(1)
 def close(self):self.stop.set();self.thread.join(timeout=10)
 def summary(self,start,end):
  rows=[r for r in self.rows if start<=r['unix_ms']<=end];assert len(rows)>=5,len(rows)
  cpu=[]
  for a,b in zip(rows,rows[1:]):
   old={p['pid']:p['cpu_seconds'] for p in a['processes']};delta=sum(max(0,p['cpu_seconds']-old.get(p['pid'],p['cpu_seconds'])) for p in b['processes']);cpu.append(delta/((b['unix_ms']-a['unix_ms'])/1000)*100)
  app=[r['app_gpu'] for r in rows if r['app_gpu'] is not None];assert len(app)>=5 and any(a['matched_counters'] for a in app),('No attributed process GPU counters',self.errors)
  stats=lambda values:{'mean':statistics.mean(values),'peak':max(values),'minimum':min(values)}
  return {'samples':len(rows),'cpu_total_machine_percent':stats([v/psutil.cpu_count() for v in cpu]),'cpu_one_core_equivalent_percent':stats(cpu),
   'ram_private_resident_bytes':stats([sum(p['uss'] for p in r['processes']) for r in rows]),'ram_private_commit_bytes':stats([sum(p['private_commit'] for p in r['processes']) for r in rows]),'ram_summed_rss_bytes':stats([sum(p['rss'] for p in r['processes']) for r in rows]),
   'app_gpu_3d_percent':stats([a['busiest_3d_engine_percent'] for a in app]),'app_gpu_dedicated_bytes':stats([a['dedicated_bytes'] for a in app]),'app_gpu_shared_bytes':stats([a['shared_bytes'] for a in app]),
   'device_gpu_percent':stats([r['device_gpu']['utilization_percent'] for r in rows]),'device_gpu_vram_bytes':stats([r['device_gpu']['used_bytes'] for r in rows]),'device_gpu_power_watts':stats([r['device_gpu']['power_watts'] for r in rows]),'device_gpu_temperature_c':stats([r['device_gpu']['temperature_c'] for r in rows]),'min_available_ram_bytes':min(r['available_ram_bytes'] for r in rows)}
