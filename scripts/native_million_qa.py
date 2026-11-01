#!/usr/bin/env python3
"""Opt-in native million-event comparison on an unlocked Mac, with private profiles."""
import argparse,base64,hashlib,json,os,signal,sqlite3,subprocess,sys,tempfile,time
from pathlib import Path
from native_mcp import NativeMcp
from guarded_run import memory_available
ROOT=Path(__file__).resolve().parents[1]

def processes():
    result={}
    for line in subprocess.check_output(['/bin/ps','-axo','pid=,ppid=,rss=,pcpu=,comm='],text=True,timeout=5).splitlines():
        row=line.split(None,4)
        if len(row)==5:result[int(row[0])]={'parent':int(row[1]),'rss_mib':int(row[2])/1024,'cpu_percent':float(row[3]),'command':row[4]}
    return result

def main():
    p=argparse.ArgumentParser(description=__doc__)
    for key in ['app','dataset','output']:p.add_argument('--'+key,type=Path,required=True)
    p.add_argument('--soak-seconds',type=int,default=600)
    p.add_argument('--source-commit',required=True)
    a=p.parse_args();assert 0<=a.soak_seconds<=600
    out=a.output.resolve();out.mkdir(parents=True,exist_ok=True)
    binary=a.app.resolve()/'Contents/MacOS/chronoscope-desktop'
    profile=Path(tempfile.mkdtemp(prefix='profile-',dir=out))
    report={'passed':False,'runtime':'native macOS WKWebView','source_commit':a.source_commit,'binary_sha256':hashlib.sha256(binary.read_bytes()).hexdigest(),'cases':[],'memory':[],'limitations':['MCP mutation-to-ready timings include command transport and a 100 ms stability requirement.','Frame telemetry is CPU submission/callback timing, not physical GPU presentation.','RSS includes the isolated app and newly observed WebKit processes; unrelated newly launched WebKit clients would confound attribution.']}
    def publish(): (out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    report['profile_path']=str(profile)
    publish()
    before=processes();owned=set();pid=None;client=None;high_cpu=None
    def sample():
        nonlocal high_cpu
        current=processes()
        if pid:owned.add(pid)
        for process,value in current.items():
            if process not in before and ('WebKit' in value['command'] or value['parent'] in owned):owned.add(process)
        rss=sum(current[x]['rss_mib'] for x in owned if x in current)
        cpu=sum(current[x]['cpu_percent'] for x in owned if x in current)
        free=memory_available()
        high_cpu=(high_cpu or time.monotonic()) if cpu>250 else None
        row={'unix':time.time(),'rss_mib':rss,'cpu_percent':cpu,'memory_available_percent':free}
        report['memory'].append(row)
        report['processes']={str(x):current[x]['command'] for x in owned if x in current}
        publish()
        if rss>5120 or free<25 or (high_cpu and time.monotonic()-high_cpu>15):raise RuntimeError(f'Native owned-work resource limit: {row}')
        return row
    def settle():
        for attempt in range(6):
            try:return client.call('view_wait',{'timeout_ms':10000,'stable_ms':100,'imagery':False,'terrain':False})
            except RuntimeError as error:
                if 'UNAVAILABLE' not in str(error) or attempt==5:raise
                report.setdefault('readiness_delays',[]).append({'unix':time.time(),'error':str(error)})
                sample()
    def mutation(label,command,args):
        started=time.monotonic();epoch=time.time();reply=client.call(command,args);ready=settle()
        case={'label':label,'command':command,'started_unix':epoch,'elapsed_ms':(time.monotonic()-started)*1000,'ready':ready}
        assert ready['status']['diagnostics']['renderErrorCount']==0,ready
        report['cases'].append(case);sample();return reply
    try:
        subprocess.run([str(binary),'--data-dir',str(profile),'agent','enable'],capture_output=True,check=True,timeout=15)
        subprocess.run(['/usr/bin/open','-n','--env','CHRONOSCOPE_DATA_DIR='+str(profile),str(a.app.resolve())],check=True)
        for _ in range(100):
            current=processes();new=[x for x,v in current.items() if x not in before and v['command']==str(binary)]
            if len(new)==1:pid=new[0];break
            time.sleep(.2)
        assert pid,'Private-profile app PID unavailable'
        (out/'launched.json').write_text(json.dumps({'pid':pid,'profile':str(profile),'app':str(a.app.resolve())}))
        client=NativeMcp(binary,profile,out)
        for attempt in range(3):
            try:report['initial']=client.call('view_status');break
            except RuntimeError:
                if attempt==2:raise
                time.sleep(1)
        prefs=client.call('preferences')
        client.call('preferences',{'preferences':{**prefs,'auto_save_unsaved':False,'basemap':'none','map_layers':[],'terrain_builtin':False,'terrain_path':None,'theme':'dark','map':{**prefs['map'],'enabled':False}}})
        # Keep the input inside the private agent root rather than broadening
        # MCP filesystem access. SQLite backup also preserves any committed WAL.
        exchange=profile/'agent-files';exchange.mkdir(exist_ok=True)
        fixture=exchange/'million.chronoscope'
        with sqlite3.connect(a.dataset.resolve().as_uri()+'?mode=ro',uri=True) as source, sqlite3.connect(fixture) as destination:
            source.backup(destination)
        start=time.monotonic();client.call('open',{'path':str(fixture)});settle()
        report['open_to_ready_ms']=(time.monotonic()-start)*1000
        snapshot=client.call('snapshot',{'compact':True});assert snapshot['count']==1_000_000
        lo,hi=snapshot['time_bounds'];report['dataset_count']=snapshot['count']
        mutation('scene-ready','view_set',{'mode':'space-time','fit':True,'render_budget':20000,'display':{'mode':'points','bloom':True,'show_tracks':True,'show_trails':True,'trail_gap_minutes':0}})
        mutation('fixed-camera','view_navigate',{'action':'look_at','center':[-45,48,0],'distance_m':12_000_000,'heading_degrees':0,'tilt_degrees':45})
        report['fixed_camera']=client.call('view_status');sample();publish()
        (out/'ready.json').write_text(json.dumps({'pid':pid,'profile':str(profile),'app':str(a.app.resolve())}))
        trace=client.call('view_profile',{'action':'start','max_seconds':120})
        for i in range(6):
            start=round(lo+(hi-lo)*i/20)
            mutation('filter-'+str(i),'filter',{'filter':{'start':start,'end':round(start+(hi-lo)/4)}})
        for i in [2,3]*3:
            start=round(lo+(hi-lo)*i/20)
            mutation('adjacent-'+str(i),'filter',{'filter':{'start':start,'end':round(start+(hi-lo)/4)}})
        for i,longitude in enumerate([-55,-35,-45]):
            mutation('pan-'+str(i),'view_navigate',{'action':'look_at','center':[longitude,48,0],'distance_m':12_000_000,'heading_degrees':0,'tilt_degrees':45})
        for i,factor in enumerate([1.2,1/1.2]):mutation('zoom-'+str(i),'view_navigate',{'action':'zoom','factor':factor})
        mutation('overview-after-navigation','filter',{'filter':{}})
        report['interaction_trace']=client.call('view_profile',{'action':'stop','id':trace['id']})
        capture=client.rpc('tools/call',{'name':'chronoscope_view_capture','arguments':{'target':'app','window':'main'}})
        if capture.get('isError'):report['capture_error']=capture
        else:
            item=next(c for c in capture['content'] if c['type']=='image');(out/'native.png').write_bytes(base64.b64decode(item['data']))
        started=time.monotonic();next_activity=started
        report['soak_started_unix']=time.time();report['soak_seconds_requested']=a.soak_seconds
        cycle=0
        while time.monotonic()-started<a.soak_seconds:
            if (out/'stop').exists():raise RuntimeError('Native QA stop marker requested')
            if time.monotonic()>=next_activity:
                offset=2+cycle%2;start=round(lo+(hi-lo)*offset/20)
                mutation('soak-filter-'+str(cycle),'filter',{'filter':{'start':start,'end':round(start+(hi-lo)/4)}})
                mutation('soak-zoom-'+str(cycle),'view_navigate',{'action':'zoom','factor':1.01 if cycle%2==0 else 1/1.01})
                next_activity=time.monotonic()+25;cycle+=1
            sample();time.sleep(min(5,max(0,a.soak_seconds-(time.monotonic()-started))))
        report['soak_elapsed_seconds']=time.monotonic()-started
        report['final']=client.call('view_status');assert report['final']['diagnostics']['renderErrorCount']==0
        assert client.call('snapshot',{'compact':True})['count']==1_000_000
        report['passed']=True;print(json.dumps({'passed':True,'source_commit':a.source_commit,'cases':len(report['cases']),'soak_seconds':report['soak_elapsed_seconds']}),flush=True)
    except Exception as error:report['error']=str(error);raise
    finally:
        publish()
        if client:client.close()
        if pid:
            try:os.kill(pid,signal.SIGTERM)
            except ProcessLookupError:pass

if __name__=='__main__':main()
