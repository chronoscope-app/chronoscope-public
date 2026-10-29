#!/usr/bin/env python3
"""Load a chosen tier of the local full Starlink fixture through the real CLI.

The default only inspects the fixture. --rows N imports exactly N source rows,
checks exact counts, requests a bounded render packet, and saves a portable
workspace with dataset credit. Run under guarded_run.py. No GUI is opened.
"""
import argparse
import csv
import json
from pathlib import Path
import queue
import shutil
import subprocess
import threading
import time
from prepare_real_demos import FILTER, CAMERA

ROOT=Path(__file__).resolve().parents[1]


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixture',type=Path,default=ROOT/'.qa/starlink-full-stress')
    parser.add_argument('--cli',type=Path,default=ROOT/'target/debug/chronoscope')
    parser.add_argument('--rows',type=int,help='Explicit tier, up to 43,361,358 rows')
    parser.add_argument('--output',type=Path,help='New local result directory (must not exist)')
    args=parser.parse_args()
    manifest=json.loads((args.fixture/'manifest.json').read_text())
    if args.rows is None:
        print(json.dumps({k:manifest[k] for k in ['records','flagged_heights_omitted','source_sha256']},indent=2));return
    if not args.output or not 1<=args.rows<=manifest['records']:
        parser.error('--rows requires a new --output directory and a valid source row count')
    # A full indexed import carries payload, spatial/text/field indexes and
    # staging/portable copies. Keep a reserve; never fill the user's volume.
    available=shutil.disk_usage(args.output.parent.resolve()).free
    estimated=args.rows*4500+4*1024**3
    if available<estimated:
        raise SystemExit(f'RESOURCE_LIMIT: need an estimated {estimated/1024**3:.1f} GiB free including staging/reserve, have {available/1024**3:.1f} GiB. Choose a smaller --rows tier; full source CSVs remain available.')
    args.output.mkdir(exist_ok=False)
    report=dict(passed=False,requested_rows=args.rows,source_records=manifest['records'],timings_seconds={},render_cap=100000,source_sha256=manifest['source_sha256'])
    def publish():(args.output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    template=args.output/'credit-template.chronoscope'
    credits=[{**item,'changes':item['changes']+f' This locally built workspace contains the first {args.rows:,} source-file rows only.'} for item in manifest['provenance']]
    template.write_text(json.dumps(dict(format='chronoscope.workspace',version=7,time_resolution='fractional_second',dataset=dict(name='Starlink stress · operator predictions',events=[]),mode='Map',scene=dict(renderer='cesium',mode='globe',globe_altitude=True,render_budget=100000),filter=FILTER,selected=[],camera=CAMERA,views=[],groups=[],imports=[],provenance=credits)))
    stderr=(args.output/'cli-stderr.log').open('w')
    process=subprocess.Popen([str(args.cli.resolve()),'--data-dir',str((args.output/'profile').resolve()),'--project',str(template.resolve()),'session'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=stderr,text=True)
    incoming=queue.Queue()
    def read():
        for line in process.stdout:incoming.put(line)
        incoming.put(None)
    threading.Thread(target=read,daemon=True).start()
    sequence=0
    def call(command,arguments=None):
        nonlocal sequence
        sequence+=1;start=time.monotonic()
        process.stdin.write(json.dumps(dict(id=sequence,command=command,args=arguments or {}))+'\n');process.stdin.flush()
        line=incoming.get(timeout=1800)
        if line is None:raise RuntimeError('CLI session disconnected')
        response=json.loads(line)
        if not response.get('ok'):raise RuntimeError(response.get('error'))
        report['timings_seconds'][command]=report['timings_seconds'].get(command,0)+time.monotonic()-start
        return response['result']
    try:
        report['app_version']=call('capabilities')['version']
        remaining=args.rows
        for entry in manifest['files']:
            if remaining<=0:break
            source=args.fixture/entry['file'];take=min(remaining,entry['rows'])
            if take<entry['rows']:
                partial=args.output/'partial.csv'
                with source.open() as src,partial.open('w') as dst:
                    dst.write(next(src))
                    for _ in range(take):dst.write(next(src))
                source=partial
            preview=call('import_preview',{'path':str(source.resolve())})
            committed=call('import_commit',{'import_id':preview['import_id'],'append':True})
            assert committed['accepted']==take and not committed.get('rejected'),committed
            remaining-=take
            report['loaded_rows']=args.rows-remaining;publish()
            print(f'Imported {report["loaded_rows"]:,} / {args.rows:,}',flush=True)
        snapshot=call('snapshot',{'compact':True,'include_statistics':False})
        assert snapshot['count']==args.rows,snapshot['count']
        report['exact_count']=snapshot['count']
        query=call('query',{'fields':['id','entity','time','altitude_m','altitude_reference'],'limit':3})
        assert query['count']==args.rows
        packet=call('render_data',{'max_points':100000})
        report['render_packet']={k:packet[k] for k in ['count','located_count','limited','stride','max_points','budget'] if k in packet}
        assert packet['located_count']==args.rows
        report['altitude_statistics']=call('statistics',{'field':'altitude_m'})
        output=args.output/'starlink-stress.chronoscope'
        call('save',{'path':str(output.resolve())})
        report['workspace_bytes']=output.stat().st_size
        report['workspace']=str(output.resolve())
        report['passed']=True
        print(json.dumps(report),flush=True)
    finally:
        publish();process.stdin.close()
        try:process.wait(timeout=5)
        except subprocess.TimeoutExpired:process.kill();process.wait(timeout=5)
        stderr.close()


if __name__=='__main__':main()
