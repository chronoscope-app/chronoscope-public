import os,sys,json,subprocess,time,base64,ctypes,traceback,threading
from http.server import BaseHTTPRequestHandler,HTTPServer
from pathlib import Path
from PIL import ImageGrab
root=Path.cwd();out=root/'.qa/detachable-linux-2026-10-26/native';out.mkdir(parents=True,exist_ok=True)
exe=root/'target/debug/chronoscope-desktop';tools=root/'.qa/detachable-linux-2026-10-26/tools/root/usr'
env=dict(os.environ,DISPLAY=':141',GDK_BACKEND='x11',LIBGL_ALWAYS_SOFTWARE='1',GALLIUM_DRIVER='llvmpipe',WEBKIT_DISABLE_DMABUF_RENDERER='1',LD_LIBRARY_PATH=str(tools/'lib/x86_64-linux-gnu')+':'+os.environ.get('LD_LIBRARY_PATH',''))
for key,name in [('XDG_DATA_HOME','data'),('XDG_CONFIG_HOME','config'),('XDG_CACHE_HOME','cache'),('XDG_RUNTIME_DIR','runtime')]:
 p=out/name;p.mkdir(exist_ok=True);env[key]=str(p)
os.chmod(out/'runtime',0o700)
xdotool=tools/'bin/xdotool'
report={'passed':False,'checks':[],'platform':'Linux native Tauri GTK/WebKit; isolated Xvfb, software llvmpipe','source_revision':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),'commands':[],'screenshots':[]}
assert not Path('/dev/dri').exists(),'Native fixture requires no GPU device exposure'
report['gpu_devices_visible']=False
children=[];handles=[]
class Mock(BaseHTTPRequestHandler):
 def log_message(self,*args): pass
 def do_POST(self):
  self.rfile.read(int(self.headers.get('Content-Length',0)));report['service_calls']=report.get('service_calls',0)+1
  body=json.dumps({'choices':[{'message':{'role':'assistant','content':'Local native window fixture'}}]}).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(body)
mock=HTTPServer(('127.0.0.1',0),Mock);threading.Thread(target=mock.serve_forever,daemon=True).start();report['service_calls']=0
def save(): (out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
def run(args,timeout=40):
 p=subprocess.run(list(map(str,args)),cwd=root,env=env,text=True,capture_output=True,timeout=timeout)
 if p.returncode: raise RuntimeError(f'{args[0]} exit {p.returncode}: {p.stderr[-1200:]}')
 return p.stdout
def cli(args,attach=False):return json.loads(run([exe,*(['--attach'] if attach else []),*args]))
def call(name,args={},attach=True):return cli(['call',name,'--args',json.dumps(args)],attach)
def screen(name):
 p=out/(name+'.png');ImageGrab.grab(xdisplay=env['DISPLAY']).save(p);report['screenshots'].append(str(p));save();return str(p)
def close_native(wid):
 class Data(ctypes.Union):_fields_=[('b',ctypes.c_char*20),('s',ctypes.c_short*10),('l',ctypes.c_long*5)]
 class Msg(ctypes.Structure):_fields_=[('type',ctypes.c_int),('serial',ctypes.c_ulong),('send_event',ctypes.c_int),('display',ctypes.c_void_p),('window',ctypes.c_ulong),('message_type',ctypes.c_ulong),('format',ctypes.c_int),('data',Data)]
 class Event(ctypes.Union):_fields_=[('client',Msg),('pad',ctypes.c_long*24)]
 x=ctypes.CDLL('libX11.so.6');x.XOpenDisplay.argtypes=[ctypes.c_char_p];x.XOpenDisplay.restype=ctypes.c_void_p;x.XInternAtom.argtypes=[ctypes.c_void_p,ctypes.c_char_p,ctypes.c_int];x.XInternAtom.restype=ctypes.c_ulong;x.XSendEvent.argtypes=[ctypes.c_void_p,ctypes.c_ulong,ctypes.c_int,ctypes.c_long,ctypes.POINTER(Event)];x.XFlush.argtypes=[ctypes.c_void_p];x.XCloseDisplay.argtypes=[ctypes.c_void_p]
 wid=int(str(wid),0);d=x.XOpenDisplay(env['DISPLAY'].encode());e=Event();e.client.type=33;e.client.window=int(wid);e.client.message_type=x.XInternAtom(d,b'WM_PROTOCOLS',0);e.client.format=32;e.client.data.l[0]=x.XInternAtom(d,b'WM_DELETE_WINDOW',0);assert x.XSendEvent(d,int(wid),0,0,ctypes.byref(e));x.XFlush(d);x.XCloseDisplay(d)
try:
 prefs=call('preferences',attach=False);prefs.update(theme='dark',auto_save_unsaved=False,basemap='none',map_layers=[],terrain_builtin=False,terrain_path=None);prefs['map']={**prefs['map'],'enabled':False};call('preferences',{'preferences':prefs},False);call('wmts_access',{'settings':{'offline':True}},False);cli(['agent','enable','--root',str(root)]);call('si_configure',{'provider':'openai-compatible','url':'http://127.0.0.1:'+str(mock.server_port)+'/v1','model':'native-window-fixture','root':str(root)},False)
 for name,args in [('xvfb',['Xvfb',env['DISPLAY'],'-screen','0','1800x1100x24','-ac','-nolisten','tcp']),('gui',['dbus-run-session','--',exe])]:
  f=(out/(name+'.log')).open('w');handles.append(f);children.append(subprocess.Popen(list(map(str,args)),cwd=root,env=env,stdout=f,stderr=subprocess.STDOUT));time.sleep(1)
 deadline=time.monotonic()+50
 while time.monotonic()<deadline:
  assert children[-1].poll() is None,'GUI exited at startup'
  if cli(['agent','status'])['connected']:break
  time.sleep(.5)
 else:raise RuntimeError('Desktop did not connect')
 call('open',{'path':str(root/'samples/atlantic-hurricanes-2021-2025-tracks.chronoscope')});call('view_set',{'table_open':True,'mode':'space-time'});time.sleep(4)
 print(json.dumps({'ready':True,'screenshot':screen('initial'),'windows':run(['xwininfo','-root','-tree'])}),flush=True)
 for line in sys.stdin:
  try:
   a=json.loads(line);op=a['op'];result=None
   if op=='windows':result=run(['xwininfo','-root','-tree'])
   elif op=='screen':result=screen(a['name'])
   elif op=='click':run([xdotool,'mousemove','--window',str(a['window']),str(a['x']),str(a['y']),'click','1']);time.sleep(a.get('wait',1));result='clicked'
   elif op=='key':run([xdotool,'windowfocus',str(a['window']),'key',a['key']]);time.sleep(a.get('wait',1));result='sent'
   elif op=='type':run([xdotool,'type','--window',str(a['window']),'--clearmodifiers',a['text']]);time.sleep(.5);result='typed'
   elif op=='close':close_native(a['window']);time.sleep(1.5);result='WM_DELETE_WINDOW sent'
   elif op=='call':
    data=call(a['command'],a.get('args',{}));result=data if a.get('full') else {'returned':True,'selected_count':data.get('selected_count') if isinstance(data,dict) else None}
   elif op=='check':report['checks'].append({'name':a['name'],'evidence':a.get('evidence')});save();result='recorded'
   elif op=='finish':
    assert report['service_calls']==0,'Draft lifecycle unexpectedly sent a request'
    report['passed']=a['passed'];save();print(json.dumps({'finished':True}),flush=True);break
   else:raise ValueError(op)
   report['commands'].append({'operation':a,'result':result});save();print(json.dumps({'ok':True,'result':result}),flush=True)
  except Exception as e:print(json.dumps({'ok':False,'error':str(e)}),flush=True)
except Exception:
 report['failure']=traceback.format_exc();save();print(report['failure'],flush=True);sys.exit(1)
finally:
 for c in reversed(children):
  if c.poll() is None:
   c.terminate()
   try:c.wait(timeout=5)
   except subprocess.TimeoutExpired:c.kill();c.wait()
 mock.shutdown();mock.server_close()
 for f in handles:f.close()
