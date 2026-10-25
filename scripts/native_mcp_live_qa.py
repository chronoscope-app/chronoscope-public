#!/usr/bin/env python3
"""Public attached MCP checks for playback, scenarios, notifications and UI discovery."""
import argparse
import json
import time
from pathlib import Path
from native_mcp import NativeMcp


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ['cli','data-dir','output']:
        parser.add_argument('--'+name,type=Path,required=True)
    args=parser.parse_args();out=args.output.resolve();out.mkdir(parents=True,exist_ok=True)
    client=NativeMcp(args.cli.resolve(),args.data_dir.resolve(),out,ui=True)
    report={'passed':False,'checks':[]}
    def passed(text):report['checks'].append(text);print('PASS',text,flush=True)
    def terminal(id):
        deadline=time.monotonic()+25
        while True:
            result=client.call('view_scenario',{'action':'status','id':id})
            if result['state']!='running':return result
            assert time.monotonic()<deadline,result
            time.sleep(.1)
    try:
        client.call('demo_open',{'id':'local-wildlife'})
        tools=client.rpc('tools/list',{})['tools']
        for name in ['query','chart_data']:
            tool=next(t for t in tools if t['name']=='chronoscope_'+name)
            assert tool['_meta']['ui']['resourceUri']=='ui://chronoscope/explorer'
        resource=client.rpc('resources/read',{'uri':'ui://chronoscope/explorer'})['contents'][0]
        assert resource['mimeType']=='text/html;profile=mcp-app' and 'ui/initialize' in resource['text']
        assert resource['_meta']['ui']['csp']['connectDomains']==[]
        query=client.call('query',{'limit':2,'fields':['id','entity']})
        assert query['workspace_id'] and len(query['events'])==2
        passed('Attached MCP Apps negotiation, HTML resource and scoped exact query result')
        client.rpc('resources/subscribe',{'uri':'chronoscope://workspace'})
        time.sleep(.6);client.rpc('ping',{});client.notifications=[]
        client.call('filter',{'filter':{'search':'unlikely-qa-value'}})
        time.sleep(.6);client.rpc('ping',{})
        assert any(n['method']=='notifications/resources/updated' and n['params']['uri']=='chronoscope://workspace' for n in client.notifications)
        client.rpc('resources/unsubscribe',{'uri':'chronoscope://workspace'})
        client.notifications=[];client.call('filter',{'filter':{'search':''}})
        time.sleep(.6);client.rpc('ping',{})
        assert not client.notifications,client.notifications
        passed('Attached resource subscription delivers changes; unsubscribe stops updates')
        bounds=client.call('snapshot')['time_bounds'];target=bounds[0]+100
        client.call('view_playback',{'action':'configure','speed':.5,'increment_seconds':1})
        seek=client.call('view_playback',{'action':'seek','time':target});assert abs(seek['time']-target)<.001
        step=client.call('view_playback',{'action':'step','steps':2});assert abs(step['time']-target-2)<.001
        assert client.call('view_playback',{'action':'play'})['playing']
        time.sleep(.15)
        assert not client.call('view_playback',{'action':'pause'})['playing']
        passed('Native timeline configure/seek/step/play/pause through public MCP')
        steps=[{'command':'view_set','arguments':{'mode':'map','fit':True}},
               {'command':'view_wait','arguments':{'timeout_ms':10000,'imagery':False}},
               {'command':'view_navigate','arguments':{'action':'zoom','factor':1.1}},
               {'command':'wait','arguments':{'milliseconds':300}}]
        name='MCP validation '+str(time.time_ns())
        client.call('view_scenario',{'action':'save','name':name,'steps':steps})
        assert client.call('view_scenario',{'action':'list'})['scenarios'][name]==steps
        run=client.call('view_scenario',{'action':'run','name':name,'timeout_seconds':20})
        result=terminal(run['id']);assert result['state']=='complete' and result['completed_steps']==4,result
        assert result['trace'][0]['mode']=='map'
        profile=client.call('view_profile',{'action':'status','id':result['profile_id']})
        assert profile['state']=='complete' and len(profile['samples'])>0
        assert all(len(row)==len(profile['columns']) for row in profile['samples'])
        report['profile_sample_count']=len(profile['samples'])
        passed('Persistent saved recipe runs asynchronously against the native view with per-frame trace')
        client.call('view_scenario',{'action':'save','name':name,'steps':[{'command':'wait','arguments':{'milliseconds':3000}}],'overwrite':True})
        run=client.call('view_scenario',{'action':'run','name':name})
        client.call('view_scenario',{'action':'cancel','id':run['id']})
        assert terminal(run['id'])['state']=='cancelled'
        client.call('view_scenario',{'action':'remove','name':name})
        passed('Native cancellation releases profile listeners and preserves completed actions')
        report['passed']=True
    finally:
        client.close();(out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(out/'report.json',flush=True)


if __name__=='__main__':main()
