#!/usr/bin/env python3
"""Bind reusable source verification and frontend bytes to one reviewed CI run."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import tempfile
import zipfile

ROOT=Path(__file__).resolve().parent.parent
MAX_BYTES=128*1024**2

def command(args):
    return subprocess.check_output(args,cwd=ROOT,text=True).strip()

def identity():
    sdk = command(['xcrun','--sdk','macosx','--show-sdk-version']) if os.sys.platform=='darwin' else ''
    return {'source':command(['git','rev-parse','HEAD']), 'platform':os.environ.get('PLATFORM',''),
            'rust':command(['rustc','-Vv']), 'node':command(['node','--version']),
            'python':os.sys.version.split()[0], 'sdk':sdk,
            'flags':os.environ.get('CARGO_ENCODED_RUSTFLAGS','').replace(str(ROOT),'<ROOT>').replace(str(Path.home()),'<HOME>')}

def hashes(folder):
    result={}
    for p in sorted(folder.rglob('*')):
        if p.is_symlink(): raise ValueError('Frontend symlink refused')
        if p.is_file(): result[p.relative_to(folder).as_posix()]=hashlib.sha256(p.read_bytes()).hexdigest()
    if 'index.html' not in result or not result: raise ValueError('Frontend output missing')
    return result

def validate(receipt,folder):
    if receipt['identity']!=identity(): raise ValueError('Verification source, platform or toolchain mismatch')
    if receipt['frontend']!=hashes(folder): raise ValueError('Verified frontend changed')

def seal(directory,source_report,contracts_report):
    from source_checks import check_plan
    from validation_suites import load_suites
    expected={c['name'] for group in ['unit','prebuild','rust','frontend','packaging'] for c in check_plan(load_suites())[group]}
    source=json.loads(source_report.read_text());contracts=json.loads(contracts_report.read_text())
    current=identity()
    for report,names in [(source,expected),(contracts,{'generated-contracts'})]:
        if not report['passed'] or report['dirty'] or report['source_revision']!=current['source']:
            raise ValueError('Unverified, dirty or wrong source report')
        if {c['name'] for c in report['checks']}!=names or any(c['exit_code'] for c in report['checks']):
            raise ValueError('Required verification checks missing or failed')
    if directory.exists(): shutil.rmtree(directory)
    directory.mkdir(parents=True)
    shutil.copytree(ROOT/'frontend/dist',directory/'frontend')
    for name,p in [('source-report.json',source_report),('contracts-report.json',contracts_report)]: shutil.copy2(p,directory/name)
    receipt={'format':1,'identity':current,'producer_run':os.environ.get('GITHUB_RUN_ID',''),
             'frontend':hashes(directory/'frontend'),'native_clippy':'passed earlier in the producing workflow'}
    (directory/'verification.json').write_text(json.dumps(receipt,indent=2)+'\n')
    if sum(p.stat().st_size for p in directory.rglob('*') if p.is_file())>MAX_BYTES:
        raise ValueError('Verification payload exceeds size cap')

def extract(archive,destination):
    with zipfile.ZipFile(archive) as z:
        entries=z.infolist()
        if len(entries)>30000 or sum(i.file_size for i in entries)>MAX_BYTES: raise ValueError('Verification archive too large')
        names=set()
        for i in entries:
            raw=i.orig_filename
            p=PurePosixPath(raw)
            key=p.as_posix().rstrip('/').casefold()
            if not key or any(ord(c)<32 for c in raw) or key in names or p.as_posix()!=raw.rstrip('/') or p.is_absolute() or '..' in p.parts or '\\' in raw or ':' in raw or (i.external_attr>>16)&0o170000==0o120000:
                raise ValueError('Unsafe verification archive')
            names.add(key)
        z.extractall(destination)

def reuse(run_id,directory):
    if not run_id.isdecimal(): raise ValueError('A numeric verification run ID is required')
    repo=os.environ.get('GITHUB_REPOSITORY','')
    if repo!='chronoscope-app/chronoscope-public': raise ValueError('Public workflow required')
    base=f'repos/{repo}/actions/runs/{run_id}'
    run=json.loads(command(['gh','api',base]))
    current=identity()
    if not (run['head_sha']==current['source'] and run['head_branch']=='main' and run['event']=='workflow_dispatch' and run['path']=='.github/workflows/build.yml' and run['status']=='completed' and run['head_repository']['full_name']==repo):
        raise ValueError('Verification run provenance mismatch')
    jobs=json.loads(command(['gh','api',base+'/jobs?per_page=100']))['jobs']
    if not any(all(any(s['name']==name and s['conclusion']=='success' for s in j['steps']) for name in ['Seal source verification','Upload source verification']) for j in jobs):
        raise ValueError('Run did not finish fresh source verification')
    artifacts=json.loads(command(['gh','api',base+'/artifacts?per_page=100']))['artifacts']
    name=f"source-verification-{current['platform']}-{current['source']}"
    matched=[a for a in artifacts if a['name']==name and not a['expired']]
    if len(matched)!=1 or not 0<matched[0]['size_in_bytes']<=MAX_BYTES: raise ValueError('Verification artifact missing or oversized')
    with tempfile.TemporaryDirectory() as temp:
        archive=Path(temp)/'verification.zip'
        with archive.open('wb') as out:
            subprocess.run(['gh','api',f"repos/{repo}/actions/artifacts/{matched[0]['id']}/zip"],stdout=out,check=True)
        unpacked=Path(temp)/'unpacked';unpacked.mkdir();extract(archive,unpacked)
        receipt=json.loads((unpacked/'verification.json').read_text())
        if receipt['producer_run']!=run_id: raise ValueError('Verification producer mismatch')
        validate(receipt,unpacked/'frontend')
        if directory.exists(): shutil.rmtree(directory)
        shutil.copytree(unpacked,directory)
    dist=ROOT/'frontend/dist'
    if dist.exists(): shutil.rmtree(dist)
    shutil.copytree(directory/'frontend',dist)
    print(f'Reused successful source verification from run {run_id}')

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('action',choices=['seal','verify-frontend','reuse'])
    p.add_argument('--directory',type=Path,default=Path(os.environ.get('CHRONOSCOPE_VERIFICATION_DIR','.qa/ci-verification')))
    p.add_argument('--source-report',type=Path)
    p.add_argument('--contracts-report',type=Path)
    p.add_argument('--run-id')
    a=p.parse_args()
    if a.action=='seal': seal(a.directory,a.source_report,a.contracts_report)
    elif a.action=='reuse': reuse(a.run_id,a.directory)
    else:
        receipt=json.loads((a.directory/'verification.json').read_text());validate(receipt,ROOT/'frontend/dist')
        print('Verified frontend source, toolchain and every bundled file; frontend rebuild unnecessary')
