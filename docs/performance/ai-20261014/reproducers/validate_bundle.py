#!/usr/bin/env python3
"""Light checks only. Usage: python3 PATH/validate_bundle.py FROZEN_GIT_REPO [ORIGINAL_ARTIFACT_ROOT]."""
import ast,hashlib,json,pathlib,re,subprocess,sys
B=pathlib.Path(__file__).resolve().parents[1];D=B.parent;P=D/'AI_PERFORMANCE_CHANGE_SPEC_2026-10-14.md';BASE='7400b55220c25da714df93be1157f1ad3b990427'
repo=pathlib.Path(sys.argv[1]);src=pathlib.Path(sys.argv[2]) if len(sys.argv)>2 else None
manifest=json.loads((B/'evidence/manifest.json').read_text());assert manifest['base_sha']==BASE
for e in manifest['entries']:
 assert hashlib.sha256((B/e['file']).read_bytes()).hexdigest()==e['sha256'],e['file']
 if src:assert hashlib.sha256((src/e['source']).read_bytes()).hexdigest()==e['source_sha256'],e['source']
for p in B.rglob('*.json'):json.loads(p.read_text())
for p in B.rglob('*.py'):ast.parse(p.read_text(),filename=str(p))
for p in B.rglob('*.mjs'):subprocess.run(['node','--check',str(p)],check=True,capture_output=True)
links=0
for p in [P,B/'README.md',B/'SOURCE_ANCHORS.md']:
 for u in re.findall(r'\]\(([^)]+)\)',p.read_text()):
  if '://' in u or u.startswith('#'):continue
  q=p.parent/u.split('#')[0];assert q.exists(),(p,u)
  if '#' in u:assert ('## '+u.split('#')[1].upper()) in q.read_text(),(p,u)
  links+=1
anchors=[]
for f,a,b in re.findall(r'/blob/'+BASE+r'/([^#)]+)#L(\d+)-L(\d+)',(P.read_text()+(B/'SOURCE_ANCHORS.md').read_text())):
 raw=subprocess.check_output(['git','-C',str(repo),'show',BASE+':'+f]);lines=raw.decode().splitlines();a=int(a);b=int(b);assert 1<=a<=b<=len(lines),(f,a,b,len(lines));anchors.append(dict(file=f,start=a,end=b,blob_sha256=hashlib.sha256(raw).hexdigest()))
heads=re.findall(r'^## (C\d\d) — .*?\((VALIDATED-NARROW|UNTESTED|EXPLORATORY)',P.read_text(),re.M);assert len(heads)==24 and len(set(x[0] for x in heads))==24
assert sum(s=='VALIDATED-NARROW' for _,s in heads)==6;assert sum(s=='EXPLORATORY' for _,s in heads)==1
for p in B.rglob('*'):
 if not p.is_file():continue
 assert p.stat().st_size<200000,p
 if p.suffix in ['.json','.log','.mjs','.rs','.patch']:
  t=p.read_text();assert not re.search(r'/home/[^/]+/', t),p
# Existing paired logs, not rerun by validation.
for n in ['correctness','prepared','indexed','serialized']:
 t=(B/f'evidence/engine/full-suite-{n}.log').read_text();counts=re.findall(r'test result: ok\. (\d+) passed;',t);assert sum(map(int,counts))==109,(n,counts)
for n in ['matched-'+v+'-r'+str(r) for v in ['baseline-instrumented','indexed','terrain-guard','static-terrain'] for r in [1,2,3]]:
 d=json.loads((B/'evidence/native'/f'{n}.json').read_text());assert d['complete'] and d['hardwareGate'];assert all(s['instances']==100000 for s in d['samples'])
# Check each independent patch against frozen blobs WITHOUT applying to any checkout.
for p in (B/'patches').glob('*.patch'):
 tmp=__import__('tempfile').TemporaryDirectory();idx=pathlib.Path(tmp.name)/'index';env=dict(__import__('os').environ,GIT_INDEX_FILE=str(idx))
 subprocess.run(['git','-C',str(repo),'read-tree',BASE],env=env,check=True,capture_output=True)
 subprocess.run(['git','-C',str(repo),'apply','--cached','--check',str(p)],env=env,check=True,capture_output=True)
 tmp.cleanup()
print(json.dumps(dict(status='PASS',entries=len(manifest['entries']),json=len(list(B.rglob('*.json'))),local_links=links,source_anchors=len(anchors),tickets=len(heads),patches=len(list((B/'patches').glob('*.patch'))),heavy_tests_run=False)))
(B/'evidence/source-anchors.json').write_text(json.dumps(dict(base_sha=BASE,anchors=anchors),indent=2)+'\n')
