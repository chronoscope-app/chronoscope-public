from pathlib import Path
import hashlib,json,re,shutil
base=Path(__file__).resolve().parent;repo=base/'chronoscope-upload-local';app=base/'Chronoscope Upload Lab'
receipt=json.loads((repo/'.qa/uploads/checks/upload-windows.json').read_text());assert receipt['exit_code']==0 and not receipt['timed_out']
binary=base/'chronoscope-next/target/release/chronoscope-desktop.exe'
asset=re.search(r'assets/main-[\w-]+\.js',(repo/'frontend/dist/index.html').read_text(encoding='utf-8')).group();assert asset.encode() in binary.read_bytes()
app.mkdir(exist_ok=True);shutil.copy2(binary,app/binary.name)
for source,name in [(repo/'assets/terrain','terrain'),(repo/'frontend/dist/third-party','third-party')]:shutil.copytree(source,app/name,dirs_exist_ok=True)
build={'source_commit':receipt['source_revision'],'binary_sha256':hashlib.sha256(binary.read_bytes()).hexdigest(),'bytes':binary.stat().st_size,'embedded_main':asset,'product_name':'Chronoscope Upload Lab','identifier':'org.chronoscope.upload-lab','published':False}
(app/'BUILD.json').write_text(json.dumps(build,indent=2)+'\n')
(app/'Launch Chronoscope Upload Lab.cmd').write_text('@echo off\nsetlocal\nset "CHRONOSCOPE_DATA_DIR=%~dp0profile"\nset "WEBVIEW2_USER_DATA_FOLDER=%~dp0webview2-data"\nstart "" "%~dp0chronoscope-desktop.exe"\n')
(base/'Launch Chronoscope Upload Lab.cmd').write_text('@echo off\ncall "%~dp0Chronoscope Upload Lab\\Launch Chronoscope Upload Lab.cmd"\n')
(app/'Test datasets').mkdir(exist_ok=True)
shutil.copy2(base/'chronoscope-vfx-local/.qa/full-app-2026-10-30/browser/full-app-vfx.chronoscope',app/'Test datasets/Synthetic 100k control.chronoscope')
print(json.dumps(build,indent=2),flush=True)
