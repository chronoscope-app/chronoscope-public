#!/usr/bin/env python3
"""Interleave matched, prebuilt CPU storage variants. No network or GPU."""
import argparse, hashlib, json, subprocess, time, sys, os, tempfile
from types import SimpleNamespace
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--binary', action='append', required=True, help='NAME=/absolute/binary (at least two variants)')
p.add_argument('--rows',type=int,nargs='+',default=[100000])
p.add_argument('--repeats',type=int,default=3)
p.add_argument('--storage-only',action='store_true',help='Avoid extra copy/save databases for large ingest/query checks.')
p.add_argument('--measure-rss',action='store_true',help='Record peak child RSS with POSIX wait4 on Linux/macOS.')
p.add_argument('--output',type=Path,required=True)
a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
if a.measure_rss and (sys.platform not in ('linux','darwin') or not hasattr(os,'wait4')):p.error('--measure-rss requires Linux/macOS wait4')
variants=[item.split('=',1) for item in a.binary]
if len(variants)<2:p.error('Provide at least two prebuilt variants')
ledger={'driver':'baseline then each variant per repeat; OS page cache uncontrolled','gpu':False,'repeats':a.repeats,'binaries':{},'runs':[],'storage_only':a.storage_only,'peak_rss_method':'POSIX wait4 maximum resident set, normalized to KiB' if a.measure_rss else None,'operation_p95':None,'operation_p95_reason':'three repetitions do not establish tail latency'}
for name,binary in variants:
 binary=Path(binary).resolve();ledger['binaries'][name]={'path':str(binary),'sha256':hashlib.sha256(binary.read_bytes()).hexdigest()}
for rows in a.rows:
 for repeat in range(1,a.repeats+1):
  for name,binary in variants:
   print(f'{rows} rows repeat {repeat}: {name}',flush=True)
   command=[str(Path(binary).resolve()),str(rows),str(a.output/'fixtures')]+(['--storage-only'] if a.storage_only else [])
   start=time.monotonic();peak=None
   if a.measure_rss:
    with tempfile.TemporaryFile() as stdout,tempfile.TemporaryFile() as stderr:
     child=subprocess.Popen(command,stdout=stdout,stderr=stderr)
     _,status,usage=os.wait4(child.pid,0);child.returncode=os.waitstatus_to_exitcode(status)
     peak=int(usage.ru_maxrss/(1024 if sys.platform=='darwin' else 1))
     stdout.seek(0);stderr.seek(0)
     r=SimpleNamespace(returncode=child.returncode,stdout=stdout.read(16*1024*1024).decode('utf8'),stderr=stderr.read(4*1024*1024).decode('utf8'))
   else:r=subprocess.run(command,capture_output=True,text=True)
   record={'variant':name,'rows':rows,'repeat':repeat,'exit_code':r.returncode,'elapsed_s':time.monotonic()-start,'peak_process_rss_kib':peak}
   if r.returncode==0:record['metrics']=json.loads(r.stdout)
   else:record['error']=r.stderr[-4000:]
   ledger['runs'].append(record);(a.output/'report.json').write_text(json.dumps(ledger,indent=2)+'\n')
   if r.returncode:raise SystemExit(f'{name} failed; see report.json')
for file in (a.output/'fixtures').glob('*.csv'):
 ledger.setdefault('fixtures',{})[file.name]={'bytes':file.stat().st_size,'sha256':hashlib.file_digest(file.open('rb'),'sha256').hexdigest()}
(a.output/'report.json').write_text(json.dumps(ledger,indent=2)+'\n')
print(a.output/'report.json')
