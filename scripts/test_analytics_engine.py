#!/usr/bin/env python3
"""Independent offline SciPy/NumPy oracle; these are QA dependencies, not app dependencies."""
import json, math, os, subprocess, tempfile, time
from pathlib import Path
import numpy as np
from scipy import stats
from sklearn.decomposition import PCA
ROOT = Path(__file__).resolve().parent.parent
CLI = os.environ.get('CHRONOSCOPE_CLI', str(ROOT/'target/debug/chronoscope'))
OUT = Path(os.environ.get('CHRONOSCOPE_QA_OUT', str(ROOT/'.qa/analytics-engine')))
OUT.mkdir(parents=True, exist_ok=True)
PROJECT = ROOT/'samples/atlantic-hurricanes-2021-2025-tracks.chronoscope'
report = {'passed':False,'public_requests':0,'dataset':str(PROJECT.relative_to(ROOT)), 'oracle':'NumPy, SciPy and scikit-learn over complete projected source rows','checks':[]}
def near(a,b):
    assert np.allclose(a,b,rtol=1e-9,atol=1e-8), (a,b)
with tempfile.TemporaryDirectory(prefix='chronoscope-analytics-oracle-') as profile:
    base=[CLI,'--data-dir',profile,'--project',str(PROJECT)]
    process=subprocess.Popen(base+['session'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
    def call(command,args={}):
        process.stdin.write(json.dumps({'command':command,'args':args})+'\n');process.stdin.flush()
        response=json.loads(process.stdout.readline());assert response['ok'],response
        return response['result']
    def run(cap,params={},**extra):
        r=call('analytics_run',{'plan':{'capability':cap,'scope':'all','parameters':params,**extra}})
        assert r['sampled'] is False
        assert len(json.dumps(r))<5000, 'SI result envelope must stay compact'
        return call('analytics_result',{'result_id':r['result_id'],'section':'details'}), call('analytics_result',{'result_id':r['result_id'],'section':'rows','limit':200})['rows']
    try:
        rows=[];cursor=None
        while True:
            args={'apply_filter':False,'fields':['id','entity','category','time','attribute:max_wind_kt','attribute:min_pressure_mb'],'limit':1000}
            if cursor:args['cursor']=cursor
            page=call('query',args);rows.extend(page['events']);cursor=page.get('next_cursor')
            if cursor is None:break
        wind='attribute:max_wind_kt';pressure='attribute:min_pressure_mb'
        def numeric(r,f):
            try:return float(r[f])
            except (KeyError,ValueError,TypeError):return np.nan
        x=np.array([numeric(r,wind) for r in rows]);valid=np.isfinite(x);x=x[valid]
        r,values=run('quantiles',{'field':wind,'probabilities':[0,.1,.25,.5,.75,.9,1]})
        near([v['value'] for v in values], np.quantile(x,[0,.1,.25,.5,.75,.9,1],method='linear'))
        report['checks'].append('Exact quantiles match NumPy over all hurricane wind measurements')
        r,_=run('one_sample_t',{'field':wind,'expected_mean':50})
        oracle=stats.ttest_1samp(x,50);near(r['summary']['t'],oracle.statistic);near(r['summary']['p_two_sided'],oracle.pvalue)
        ci=oracle.confidence_interval();near(r['summary']['difference_interval'],[ci.low-50,ci.high-50])
        groups=sorted(set(r['category'] for r in rows),key=lambda g:-sum(r['category']==g for r in rows))[:2]
        cohorts=[np.array([numeric(r,wind) for r in rows if r['category']==g]) for g in groups]
        cohorts=[v[np.isfinite(v)] for v in cohorts]
        r,_=run('welch_t',{'field':wind,'group_by':'category','group_a':groups[0],'group_b':groups[1]})
        oracle=stats.ttest_ind(*cohorts,equal_var=False);near(r['summary']['t'],oracle.statistic);near(r['summary']['p_two_sided'],oracle.pvalue);near(r['summary']['degrees_of_freedom'],oracle.df)
        report['checks'].append('One-sample and Welch tests, confidence intervals and degrees of freedom match SciPy')
        data=np.array([[numeric(r,wind),numeric(r,pressure)] for r in rows]);data=data[np.isfinite(data).all(axis=1)]
        r,_=run('regression',{'fields':[wind],'target':pressure})
        oracle=stats.linregress(data[:,0],data[:,1]);near(r['summary']['coefficients'],[oracle.slope]);near(r['summary']['intercept'],oracle.intercept);near(r['summary']['r_squared'],oracle.rvalue**2)
        r,_=run('pca',{'fields':[wind,pressure],'dimensions':2,'standardize':True})
        scaled=(data-data.mean(axis=0))/data.std(axis=0);model=PCA(n_components=2).fit(scaled)
        near(r['summary']['explained_variance'],model.explained_variance_);near(r['summary']['explained_fraction_of_total'],model.explained_variance_ratio_)
        # Sign of eigenvectors is arbitrary. Compare their orthogonal projectors.
        components=np.array(r['summary']['components']);near(components.T@components,model.components_.T@model.components_)
        report['checks'].append('OLS coefficients/fit match SciPy; PCA variance and basis match scikit-learn')
        r,values=run('histogram',{'field':wind,'bins':12});counts,edges=np.histogram(x,bins=12);assert [v['count'] for v in values]==counts.tolist()
        r,values=run('time_series',{'bucket':'year'});assert sum(v['count'] for v in values)==len(rows)
        report['checks'].append('Histograms match NumPy and calendar bucket denominators cover every Event')
        r,values=run('quantiles',{'field':'peak','probabilities':[.5]},prepare={'group_by':['entity','year_utc'],'metrics':[{'alias':'peak','op':'max','field':wind}]})
        peaks={}
        from datetime import datetime,timezone
        for record in rows:
            value=numeric(record,wind)
            if np.isfinite(value):
                key=(record['entity'],datetime.fromtimestamp(record['time'],timezone.utc).year);peaks[key]=max(peaks.get(key,-math.inf),value)
        near(values[0]['value'],np.median(list(peaks.values())))
        report['checks'].append('Storm/year maximum preparation followed by exact median uses storm-level units, not track-position weighting')
        saved=OUT/'oracle-results.chronoscope';call('save',{'path':str(saved),'overwrite':True});assert saved.read_bytes()[:16]==b'SQLite format 3\x00'
        report['event_count']=len(rows);report['result_count']=len(call('analytics_list')['results'])
    finally:
        process.stdin.close();process.wait(timeout=30)
    mcp=subprocess.Popen(base+['mcp','--root',str(ROOT)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
    def rpc(i,method,params):
        mcp.stdin.write(json.dumps({'jsonrpc':'2.0','id':i,'method':method,'params':params})+'\n');mcp.stdin.flush()
        while True:
            reply=json.loads(mcp.stdout.readline())
            if reply.get('id')==i:return reply
    try:
        rpc(1,'initialize',{'protocolVersion':'2025-11-25','clientInfo':{'name':'analytics-oracle','version':'1'},'capabilities':{}})
        reply=rpc(2,'tools/call',{'name':'chronoscope_analytics_run','arguments':{'plan':{'capability':'quantiles','scope':'all','parameters':{'field':wind,'probabilities':[.5]}}}})
        assert not reply['result'].get('isError'),reply
        result=reply['result']['structuredContent'];reply=rpc(3,'tools/call',{'name':'chronoscope_analytics_result','arguments':{'result_id':result['result_id'],'section':'rows'}})
        near(reply['result']['structuredContent']['rows'][0]['value'],np.median(x))
        tools=rpc(4,'tools/list',{})['result']['tools'];run_tool=next(v for v in tools if v['name']=='chronoscope_analytics_run');assert not run_tool['annotations']['readOnlyHint']
        report['checks'].append('Actual stdio MCP discovery/run/result roundtrip matches CLI; persistence is correctly advertised as an effect')
    finally:
        mcp.stdin.close();mcp.wait(timeout=30)
report['passed']=True
(OUT/'oracle.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
