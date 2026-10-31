from pathlib import Path
import subprocess,sys
base=Path(__file__).resolve().parent
for name,timeout,args in [
 ('upload-paging-committed','180',['node','frontend/scripts/upload-paging-qa.mjs']),
 ('upload-interactions-committed','300',['node','frontend/scripts/resident-interactions-qa.mjs']),
 ('upload-pixels-committed','300',['node','frontend/scripts/prepared-handoff-qa.mjs']),
 ('upload-references-committed','180',['node','frontend/scripts/resident-reference-qa.mjs']),
 ('upload-terrain-recovery-committed','180',['node','frontend/scripts/terrain-preparation-recovery-qa.mjs']),
]:
 r=subprocess.run([sys.executable,str(base/'windows_upload_check.py'),name,timeout,*args],cwd=base);assert r.returncode==0,name
print('COMMITTED UPLOAD REGRESSIONS PASS',flush=True)
