from pathlib import Path
import hashlib,json,re,shutil
base=Path(__file__).resolve().parent;repo=base/'chronoscope-transitions-local';qa=repo/'.qa/transitions';app=base/'Chronoscope Transition Lab'
receipt=json.loads((qa/'checks/transitions-windows-final.json').read_text());assert receipt['exit_code']==0 and not receipt['timed_out']
for name in ['transitions-interactions-final','transitions-pixels-final','transitions-references-final','terrain-recovery-final']:
 check=json.loads((qa/f'checks/{name}.json').read_text());assert check['exit_code']==0 and check['source_revision']==receipt['source_revision'],check
binary=base/'chronoscope-next/target/release/chronoscope-desktop.exe'
asset=re.search(r'assets/main-[\w-]+\.js',(repo/'frontend/dist/index.html').read_text(encoding='utf-8')).group();assert asset.encode() in binary.read_bytes()
app.mkdir(exist_ok=True);shutil.copy2(binary,app/binary.name)
for source,name in [(repo/'assets/terrain','terrain'),(repo/'frontend/dist/third-party','third-party')]:shutil.copytree(source,app/name,dirs_exist_ok=True)
build={'source_commit':receipt['source_revision'],'binary_sha256':hashlib.sha256(binary.read_bytes()).hexdigest(),'bytes':binary.stat().st_size,'embedded_main':asset,'product_name':'Chronoscope Transition Lab','identifier':'org.chronoscope.transition-lab','published':False}
(app/'BUILD.json').write_text(json.dumps(build,indent=2)+'\n')
launcher='@echo off\nsetlocal\nset "CHRONOSCOPE_DATA_DIR=%~dp0profile"\nset "WEBVIEW2_USER_DATA_FOLDER=%~dp0webview2-data"\nstart "" "%~dp0chronoscope-desktop.exe"\n'
(app/'Launch Chronoscope Transition Lab.cmd').write_text(launcher)
(base/'Launch Chronoscope Transition Lab.cmd').write_text('@echo off\ncall "%~dp0Chronoscope Transition Lab\\Launch Chronoscope Transition Lab.cmd"\n')
(app/'Test datasets').mkdir(exist_ok=True)
shutil.copy2(base/'chronoscope-vfx-local/.qa/full-app-2026-10-30/browser/full-app-vfx.chronoscope',app/'Test datasets/Synthetic 100k control.chronoscope')
(app/'README.txt').write_text('CHRONOSCOPE TRANSITION LAB - FULL LOCAL WINDOWS APP\n\nLaunch with the included command file to use its own profile. Normal Chronoscope tools, import/export and earlier governor/import/time-rail fixes are included. Smooth graphics retains the prepared-buffer extensions from Interaction Lab and adds guarded renderer handoffs, chunked curved-track preparation and cancellation cleanup. This branch is local and has not been pushed to Next/Public. See PERFORMANCE.txt and VALIDATION.json for final test evidence.\n',encoding='utf-8')
print(json.dumps(build,indent=2),flush=True)
