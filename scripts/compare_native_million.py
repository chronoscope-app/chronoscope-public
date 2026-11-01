#!/usr/bin/env python3
"""Summarize completed, matched private-profile native million-event runs."""
import argparse,json,statistics
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--directory',type=Path,required=True)
a=p.parse_args();root=a.directory
report={'runtime':'native macOS WKWebView','variants':{},'limitations':['One run per variant, sequential order and uncontrolled OS cache state.','Mutation-to-ready includes MCP transport and 100 ms stability; callback telemetry is not physical GPU presentation.','RSS covers the isolated app and newly observed WebKit processes; it is sampled, not an allocator or GPU-memory measurement.']}
for variant in ['baseline','candidate']:
 r=json.loads((root/variant/'report.json').read_text());assert r['passed'] and r['soak_elapsed_seconds']>=600 and r['dataset_count']==1_000_000
 cases=r['cases'];samples=r['memory'];started=r['soak_started_unix'];soak=[x for x in samples if x['unix']>=started];first=[x['rss_mib'] for x in soak if x['unix']<started+60];last=[x['rss_mib'] for x in soak if x['unix']>=started+540]
 def times(prefix):return [x['elapsed_ms'] for x in cases if x['label'].startswith(prefix)]
 trace=r['interaction_trace'];columns=trace['columns'];intervals=[row[columns.index('frame_interval_ms')] for row in trace['samples'] if row[columns.index('frame_interval_ms')]>0]
 assert r['final']['diagnostics']['renderErrorCount']==0
 report['variants'][variant]={'source_commit':r['source_commit'],'binary_sha256':r['binary_sha256'],'filter_ms':times('filter-'),'adjacent_ms':times('adjacent-'),'pan_ms':times('pan-'),'zoom_ms':times('zoom-'),'overview_after_navigation_ms':times('overview-after-navigation'),'open_to_ready_ms':r['open_to_ready_ms'],'startup_readiness_retries':len(r.get('readiness_delays',[])),'soak_elapsed_seconds':r['soak_elapsed_seconds'],'soak_first_minute_median_rss_mib':statistics.median(first),'soak_last_minute_median_rss_mib':statistics.median(last),'sampled_peak_rss_mib':max(x['rss_mib'] for x in samples),'frame_interval_p50_ms':statistics.median(intervals) if intervals else None,'frame_interval_p95_ms':sorted(intervals)[int(.95*len(intervals))] if intervals else None,'frame_interval_max_ms':max(intervals) if intervals else None,'trace_summary':trace['summary'],'graphics':r['fixed_camera']['diagnostics']['graphics'],'final_render_errors':r['final']['diagnostics']['renderErrorCount'],'final_context_recoveries':r['final']['diagnostics'].get('contextRecoveries')}
assert report['variants']['baseline']['graphics']['framebuffer']==report['variants']['candidate']['graphics']['framebuffer']
report['comparisons']={}
for kind in ['filter_ms','pan_ms','zoom_ms','adjacent_ms','overview_after_navigation_ms']:
 values={v:statistics.median(report['variants'][v][kind]) for v in ['baseline','candidate']}
 report['comparisons'][kind]={**values,'reduction_percent':100*(1-values['candidate']/values['baseline'])}
(root/'comparison.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
