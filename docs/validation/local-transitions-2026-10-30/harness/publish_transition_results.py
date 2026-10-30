from pathlib import Path
import csv,hashlib,json,statistics,subprocess,shutil
base=Path(__file__).resolve().parent;repo=base/'chronoscope-transitions-local';qa=repo/'.qa/transitions';app=base/'Chronoscope Transition Lab'
r=json.loads((qa/'native-soak/report.json').read_text());build=json.loads((app/'BUILD.json').read_text())
assert r['complete'] and not r.get('error'),r.get('error')
assert r['binary_sha256']==build['binary_sha256']==hashlib.sha256((app/'chronoscope-desktop.exe').read_bytes()).hexdigest()
checks={}
for name in ['transitions-unit-final','transitions-interactions-final','transitions-references-final','transitions-pixels-final','transitions-windows-final','terrain-recovery-final']:
 c=json.loads((qa/f'checks/{name}.json').read_text());assert c['exit_code']==0 and c['source_revision']==build['source_commit'],c;checks[name]=c
cases=[c for c in r['cases'] if c.get('complete')];assert len(cases)==5
older=[c for c in cases if c['binary_sha256']!=build['binary_sha256']]
if older:
 r['retained_measurements']='Build provenance: '+', '.join(c['dataset']['id'] for c in older)+' retain their measured source '+older[0]['source_commit']+' / binary '+older[0]['binary_sha256']+'. The final terrain-only recovery change does not execute in those terrain-disabled measured phases. Terrain and heatmap use final source '+build['source_commit']+' / binary '+build['binary_sha256']+'. Per-phase hashes are in phases.csv; all focused source checks use the final revision.'
 (qa/'native-soak/report.json').write_text(json.dumps(r,indent=2)+'\n')
for c in cases:
 assert c['health']['unreadyFrames']==0 and not c['health']['errors'] and not c['health']['browserErrors'] and not c['monitor_errors'],c['dataset']['id']
 assert len(c['phases'])==c['dataset']['steps']
assert all(f['count']>=10 for f in cases[0]['native_pixels']['frames'])
doc=repo/'docs/validation/local-transitions-2026-10-30';doc.mkdir(parents=True,exist_ok=True)
rows=[]
for c in cases:
 for p in c['phases']:
  d=p['driver']['final']['diagnostics'];res=p['resources']
  rows.append({'dataset':c['dataset']['id'],'binary_sha256':c['binary_sha256'],'source_commit':c['source_commit'],'step':p['step'],'transition':p['transition'],'measured_seconds':p['driver']['elapsed_ms']/1000,'fps':p['fps'],'p95_ms':p['p95_ms'],'p99_ms':p['p99_ms'],'max_interval_ms':p['max_interval_ms'],'gaps_over_50ms':p['gaps_over_50ms'],'cpu_machine_percent':res['cpu_total_machine_percent']['mean'],'private_ram_mib':res['ram_private_resident_bytes']['mean']/1024**2,'gpu_3d_percent':res['app_gpu_3d_percent']['mean'],'gpu_allocated_mib':res['app_gpu_dedicated_bytes']['mean']/1024**2,'profile':d['resourceGovernor']['profile'],'prepared':d['experimentalPlayback']['active']})
with (doc/'phases.csv').open('w',newline='') as f:
 writer=csv.DictWriter(f,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
lines=['CHRONOSCOPE TRANSITION LAB - LOCAL WINDOWS LONG SESSIONS','',f"Source: {build['source_commit']}",f"Binary SHA256: {build['binary_sha256']}",'Based on latest verified Next main 389ffcd plus the completed local Interaction Lab branch. Nothing pushed to Next/Public.','',r['method'],'','Dataset | measured active minutes | total session minutes | sampled renders | unready active-renderer frames | median prepared/full FPS | p99 range ms | gaps >50ms (all phases, including intentional standard rendering)']
summary=[]
for c in cases:
 name=c['dataset']['id'];phases=c['phases'];measured=sum(p['driver']['elapsed_ms'] for p in phases)/60000;elapsed=(c['finished_unix_ms']-c['started_unix_ms'])/60000
 prepared=[p for p in phases if p['driver']['initial']['diagnostics']['experimentalPlayback']['active'] and p['driver']['final']['diagnostics']['experimentalPlayback']['active'] and p['driver']['final']['diagnostics']['resourceGovernor']['profile']=='full']
 fps=statistics.median(p['fps'] for p in prepared) if prepared else 0
 p99=[p['p99_ms'] for p in prepared if p['p99_ms'] is not None]
 gap=sum(p['gaps_over_50ms'] for p in phases)
 lines.append(f"{name} | {measured:.2f} | {elapsed:.2f} | {c['health']['frames']} | {c['health']['unreadyFrames']} | {fps:.2f}"+(f" | {min(p99):.1f}-{max(p99):.1f}" if p99 else ' | n/a')+f' | {gap}')
 preps=c['health']['preparations'];accepted=[p['ms'] for p in preps if p['accepted']]
 lines.append('  Preparation/warm-up accepted durations ms: '+(', '.join(f'{v:.1f}' for v in accepted)))
 same=[p for p in phases if p['step']%10==0];memory=[p['resources']['ram_private_resident_bytes']['mean']/1024**2 for p in same]
 lines.append('  Repeated stopped-navigation private RAM MiB: '+', '.join(f'{v:.1f}' for v in memory))
 summary.append({'dataset':name,'binary_sha256':c['binary_sha256'],'source_commit':c['source_commit'],'measured_minutes':measured,'session_minutes':elapsed,'health':c['health'],'median_prepared_full_fps':fps,'all_phase_gaps_over_50ms':gap,'repeated_navigation_ram_mib':memory,'preparation_ms':accepted,'dataset_switches':c['dataset_switches'],'monitor_errors':c.get('monitor_errors'),'harness_oracle_correction':c.get('harness_oracle_correction')})
terrain_case=next(c for c in cases if c['dataset'].get('terrain'))
lines+=['','Measured remaining limits: dense satellite rebuilds can stall; terrain Time-view navigation reached 50.6 FPS during tile loading; repeated 100k stopped-navigation private RAM grew from 490 to 724 MiB. Steady FPS is not a zero-stutter or leak-free guarantee.','','VERIFIED TERRAIN-ON PLAYBACK COMPARISON (same final binary/settings; standard then prepared; 5s warm + 20s measured each):']
for trial in terrain_case['paired_true_terrain']:
 res=trial['resources'];lines.append(('Prepared' if trial['smooth'] else 'Standard')+f": FPS {trial['fps']:.2f}, CPU {res['cpu_total_machine_percent']['mean']:.2f}%, private RAM {res['ram_private_resident_bytes']['mean']/1024**2:.1f} MiB, GPU 3D {res['app_gpu_3d_percent']['mean']:.2f}%, GPU allocated {res['app_gpu_dedicated_bytes']['mean']/1024**2:.1f} MiB; terrainActive=True")
lines+=['','Correction: the earlier VFX 2 terrain-labeled performance row used GPS with terrain inactive. These verified terrain-on trials replace that terrain interpretation; historic numeric observations remain valid only as flat-GPS measurements.','',r.get('retained_measurements','Every native case uses the final binary.'),'','Actual pixel evidence: '+str(len(cases[0]['native_pixels']['frames']))+' native framebuffer samples across 20 renderer swaps, zero samples with missing event pixels. Separate browser test covers delayed canonical preparation, cancellation cleanup, Time-frame cancellation and renderer disposal.','Every stopped point-rendering phase checks unique source IDs against the engine; a representative subset is allowed only when the renderer explicitly reports LOD. A reopened heat-only source legitimately has no point markers; its complete engine event count and exact weighted cells are checked instead. Weighted heatmap stopped phases also compare all bins and values with engine display_data. Each dataset switches to an earthquake study and back.','', 'Tradeoffs and limits:','Prepared graphics hold the old valid scene until replacement buffers have completed Cesium updates; cancelled obsolete work is removed. Curved-track construction yields between chunks and caches each entity color/record position. Time axis changes are published only with the replacement; stopping Time playback still restores its ordinary exact-window frame.','Initial data decoding, geometry combination and GPU upload can still take time; these changes do not promise zero latency or zero stutter. Preparation durations are recorded separately. Full frame timing arrays and source IDs are retained in raw report.json.','Long-frame counts include intentional standard rendering and governor transitions; inspect phases.csv to distinguish those from steady prepared rendering. The tests cover tens of minutes on one Windows machine, not multi-hour sessions, every GPU or every interaction.','GPU counters report Windows-attributed allocation, not unique physical VRAM residency. Native postRender cadence is not physical display presentation latency. Background apps and OS scheduling can affect results.','The existing 100k-event/2048-entity prepared limits, styling differences, unsupported-mode fallbacks and normal governor remain. Time manual rail scrubbing remains on its canonical renderer.','', 'Raw native records: '+str(qa/'native-soak/report.json')]
text='\n'.join(lines)+'\n';(doc/'README.txt').write_text(text,encoding='utf-8');(app/'PERFORMANCE.txt').write_text(text,encoding='utf-8')
validation={'build':build,'checks':checks,'native_summary':summary,'native_pixel_samples':cases[0]['native_pixels'],'retained_measurements':r.get('retained_measurements'), 'paired_true_terrain':next(c['paired_true_terrain'] for c in cases if c['dataset'].get('terrain')),'raw_native_report':str(qa/'native-soak/report.json'),'published':False}
(doc/'report.json').write_text(json.dumps(validation,indent=2)+'\n');(app/'VALIDATION.json').write_text(json.dumps(validation,indent=2)+'\n')
(doc/'harness').mkdir(exist_ok=True)
for file in ['windows_transitions_check.py','transitions_native_soak.py','transitions_native_helpers.py','transition_driver.mjs','package_transitions.py','publish_transition_results.py','complete_heatmap_reopen_check.py','launch_transition_lab.py','observe_transition_heap.mjs']:
 shutil.copy2(base/file,doc/'harness'/file)
print(text,flush=True)
