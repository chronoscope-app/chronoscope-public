from pathlib import Path
import hashlib,json,re,shutil
base=Path(__file__).resolve().parent;repo=base/'chronoscope-interactions-local';qa=repo/'.qa/interactions';app=base/'Chronoscope Interaction Lab'
receipt=json.loads((qa/'checks/interactions-windows.json').read_text());assert receipt['exit_code']==0 and not receipt['timed_out']
for name in ['interactions-qa','interactions-handoffs','interactions-references']:
 check=json.loads((qa/f'checks/{name}.json').read_text())
 assert check['exit_code']==0 and check['source_revision']==receipt['source_revision'],check
assert json.loads((qa/'browser/report.json').read_text())['passed']
assert json.loads((qa/'handoffs/handoffs.json').read_text())['passed']
binary=base/'chronoscope-next/target/release/chronoscope-desktop.exe'
asset=re.search(r'assets/main-[\w-]+\.js',(repo/'frontend/dist/index.html').read_text(encoding='utf-8')).group()
assert asset.encode() in binary.read_bytes()
app.mkdir(exist_ok=True);shutil.copy2(binary,app/binary.name)
for source,name in [(repo/'assets/terrain','terrain'),(repo/'frontend/dist/third-party','third-party')]:shutil.copytree(source,app/name,dirs_exist_ok=True)
build={'source_commit':receipt['source_revision'],'binary_sha256':hashlib.sha256(binary.read_bytes()).hexdigest(),'bytes':binary.stat().st_size,'embedded_main':asset,'product_name':'Chronoscope Interaction Lab','identifier':'org.chronoscope.interaction-lab','published':False}
(app/'Test datasets').mkdir(exist_ok=True)
shutil.copy2(base/'chronoscope-vfx-local/.qa/full-app-2026-10-30/browser/full-app-vfx.chronoscope',app/'Test datasets/Synthetic 100k control.chronoscope')
(app/'BUILD.json').write_text(json.dumps(build,indent=2)+'\n')
(app/'Launch Chronoscope Interaction Lab.cmd').write_text('@echo off\nsetlocal\nset "CHRONOSCOPE_DATA_DIR=%~dp0profile"\nset "WEBVIEW2_USER_DATA_FOLDER=%~dp0webview2-data"\nstart "" "%~dp0chronoscope-desktop.exe"\n')
(base/'Launch Chronoscope Interaction Lab.cmd').write_text('@echo off\ncall "%~dp0Chronoscope Interaction Lab\\Launch Chronoscope Interaction Lab.cmd"\n')
(app/'README.txt').write_text('''CHRONOSCOPE INTERACTION LAB - FULL LOCAL WINDOWS APP

Based on the completed Next VFX integration. This new work remains local on
codex/resident-interactions-local. It has not been pushed to Next or Public.

Use the included launcher for a separate profile. Open/import files normally.
Smooth graphics reuses prepared point/track data for paused navigation in all
three views, Map/Globe time-rail scrubbing, and compatible selections. Play and
pause reuse buffers where the display frame permits. Time view retains its
canonical vertical framing during manual scrubbing, using the normal refresh.
Globe time elevation restores its normal geographic height scale on pause and
completed scrubs. Physical heights that cannot be resolved remain omitted.

Mixed heatmap/bloom plus point/track layers can accelerate with spatial culling
off; weighted summary cells remain engine-calculated. Polygon selection updates
existing fill/outline colors, retaining geometry, holes, and source pick IDs.
The time shader retains high/low components for narrow intervals in long studies.

The governor remains active. Under pressure the prepared buffers are released
and the canonical renderer applies its normal limits. Unsupported rich records,
summary modes, or limited selections use standard rendering. Prepared point
studies retain the 100k-event/2048-entity experimental limits and existing VFX
track/fading differences. Large studies prepare once before repeated use.

See VALIDATION.json and PERFORMANCE.txt for evidence and limitations.
''',encoding='utf-8')
print(json.dumps(build,indent=2),flush=True)
