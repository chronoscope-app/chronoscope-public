"""Local-only mTLS fixture. Trust/keys stay in a temporary directory, not OS stores."""
import http.server,json,pathlib,ssl,subprocess,sys,time
root=pathlib.Path(sys.argv[1])
def openssl(*args):
 subprocess.run(['openssl',*args],cwd=root,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
openssl('req','-x509','-newkey','rsa:2048','-nodes','-keyout','ca.key','-out','ca.pem','-days','1','-subj','/CN=Chronoscope SI fixture CA')
for name,usage in [('server','serverAuth'),('client','clientAuth')]:
 openssl('req','-newkey','rsa:2048','-nodes','-keyout',name+'.key','-out',name+'.csr','-subj','/CN='+name)
 (root/(name+'.ext')).write_text('basicConstraints=CA:FALSE\nextendedKeyUsage='+usage+'\n'+('subjectAltName=IP:127.0.0.1,DNS:localhost\n' if name=='server' else ''))
 openssl('x509','-req','-in',name+'.csr','-CA','ca.pem','-CAkey','ca.key','-CAcreateserial','-out',name+'.pem','-days','1','-extfile',name+'.ext')
class Handler(http.server.BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_POST(self):
  request=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
  self.server.requests+=1
  reply={'request':request,'authorization':self.headers.get('Authorization'),'content_type':self.headers.get('Content-Type'),'peer_certificate':bool(self.connection.getpeercert()),'requests':self.server.requests}
  status=200
  if self.path=='/slow':time.sleep(4)
  if self.path=='/redirect':status=307
  if self.path=='/denied':status=401
  if self.path=='/large':reply={'padding':'x'*(1024*1024+1)}
  data=json.dumps(reply).encode()
  self.send_response(status)
  self.send_header('Content-Type','application/json')
  if status==307:self.send_header('Location','https://127.0.0.1:1/never-forward')
  self.send_header('Content-Length',str(len(data)));self.end_headers()
  try:self.wfile.write(data)
  except (BrokenPipeError,ConnectionResetError,ssl.SSLError):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler);server.requests=0
context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);context.load_cert_chain(root/'server.pem',root/'server.key');context.load_verify_locations(root/'ca.pem');context.verify_mode=ssl.CERT_REQUIRED
server.socket=context.wrap_socket(server.socket,server_side=True)
print('https://127.0.0.1:'+str(server.server_port),flush=True)
server.serve_forever()
