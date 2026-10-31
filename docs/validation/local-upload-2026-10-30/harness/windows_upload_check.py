"""Run a bounded Windows build/test step and retain its output and receipt."""
import datetime
import json
import os
from pathlib import Path
import subprocess
import sys

WORKSPACE = Path(__file__).resolve().parent
ROOT = WORKSPACE / 'chronoscope-upload-local'
sys.path.insert(0, str(ROOT / 'scripts'))
from validation_runtime import run_command

OUT = ROOT / '.qa/uploads/checks'
OUT.mkdir(parents=True, exist_ok=True)
name, timeout, *command = sys.argv[1:]
env = os.environ.copy()
runtime = Path.home() / '.cache/codex-runtimes/codex-primary-runtime/dependencies'
env['PATH'] = os.pathsep.join([
    str(WORKSPACE / '.tools/node-v26.13.0-win-x64'),
    r'C:\Program Files\nodejs', str(Path.home() / '.cargo/bin'),
    str(runtime / 'python'), str(WORKSPACE / '.tools/7zip'), r'C:\Program Files\7-Zip',
    str(Path.home() / '.rustup/toolchains/1.98.0-x86_64-pc-windows-msvc/lib/rustlib/x86_64-pc-windows-msvc/bin'),
    str(runtime / 'native/git/mingw64/bin'), env['PATH'],
])
env['CHRONOSCOPE_PYTHON'] = sys.executable
env['CARGO_BUILD_JOBS'] = '1'
env['RUSTUP_TOOLCHAIN'] = '1.98.0'
env['RUST_TEST_THREADS'] = '1'
env['PYTHONUNBUFFERED'] = '1'
env['PYTHONDONTWRITEBYTECODE'] = '1'
env['CHRONOSCOPE_QA_PUBLIC_WMTS'] = '0'
env['CHRONOSCOPE_CLI'] = str(WORKSPACE / 'chronoscope-next/.qa/next-vfx-integration/bin/chronoscope.exe')
env['CARGO_TARGET_DIR'] = str(WORKSPACE / 'chronoscope-next/target')
env['CARGO_ENCODED_RUSTFLAGS'] = '\x1f'.join([f'--remap-path-prefix={Path.home()}=/build-home', f'--remap-path-prefix={Path.home() / ".cargo"}=/cargo', f'--remap-path-prefix={WORKSPACE / "chronoscope-next"}=/chronoscope'])
env['CHRONOSCOPE_QA_RUST_PROFILE'] = 'release'
env['CHRONOSCOPE_QA_HARDWARE'] = '1'

env['CHRONOSCOPE_CHROMIUM'] = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
if command[:2] == ['cargo', 'test']:
    env.pop('CARGO_ENCODED_RUSTFLAGS', None)
    env.pop('RUSTFLAGS', None)

revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
env['CHRONOSCOPE_QA_SOURCE_REVISION'] = revision
started = datetime.datetime.now(datetime.timezone.utc).isoformat()
print(f'{name}: running; log {OUT / (name + ".log")}', flush=True)
result = run_command(command, ROOT, env, OUT / (name + '.log'), int(timeout))
receipt = dict(name=name, command=command, source_revision=revision,
               started_utc=started, finished_utc=datetime.datetime.now(datetime.timezone.utc).isoformat(),
               platform=sys.platform, **result)
(OUT / (name + '.json')).write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(receipt, indent=2), flush=True)
if result['exit_code']:
    print((OUT / (name + '.log')).read_text(errors='replace')[-12000:], flush=True)
raise SystemExit(result['exit_code'])
