#!/usr/bin/env python3
"""Bounded display CPU/transfer probe. No GPU/FPS claim, no network."""
import argparse,json,pathlib,subprocess,tempfile,time
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--rows',type=int,default=100000);p.add_argument('--output',type=pathlib.Path,required=True);a=p.parse_args();root=pathlib.Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='chronoscope-display-bench-') as d:
 d=pathlib.Path(d);csv=d/'synthetic.csv'
 with csv.open('w') as f:
  f.write('entity,timestamp,latitude,longitude,value\n')
  for i in range(a.rows):f.write(f'Track {i%16},2026-10-14T{(i//60)%24:02}:{i%60:02}Z,{43.2+(i*17%2000)/100000},{-79.99+(i*31%4000)/100000},{i%20}\n')
 proc=subprocess.Popen([str(root/'target/debug/chronoscope'),'--data-dir',str(d/'state'),'session'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
 records=[]
 def call(c,args={}):
  t=time.monotonic();proc.stdin.write(json.dumps({'id':1,'command':c,'args':args})+'\n');proc.stdin.flush();line=proc.stdout.readline();v=json.loads(line)
  if not v.get('ok'):raise RuntimeError(v)
  result=v['result'];records.append({'command':c,'elapsed_s':round(time.monotonic()-t,4),'response_bytes':len(line.encode()),'cache_hit':result.get('cache_hit')});print(records[-1],flush=True);return result
 try:
  preview=call('import_preview',{'path':str(csv)});call('import_commit',{'import_id':preview['import_id']});call('view_set',{'mode':'map','display':{'mode':'auto'}})
  grid=call('display_data',{'level':16,'flat':True});assert grid['count']==a.rows
  again=call('display_data',{'level':16,'flat':True});assert again['cache_hit']
  call('select_query',{'display_cells':[b['cell'] for b in grid['bins']]})
  selected=call('display_data',{'level':16,'flat':True});assert sum(b['selected_count'] for b in selected['bins'])==a.rows
  snap=call('view_snapshot_v1',{'version':1,'generation':'1','include_render':True,'display_level':16,'bounds':[-80,43.1,-79.8,43.4]})
  assert snap['display']['count']==a.rows and snap['render']['rendered_count']<=2000
  result={'rows':a.rows,'profile':'debug Rust, warm OS cache uncontrolled; single run, no tail/FPS inference','cells':len(grid['bins']),'displayed_raw_points':snap['render']['rendered_count'],'operations':records}
  a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(result,indent=2)+'\n')
 finally:
  proc.stdin.close();proc.wait(timeout=30)
