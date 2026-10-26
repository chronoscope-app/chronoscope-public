// All ordinary npm builds/tests share the Python resource guard, including
// nested Tauri beforeBuild hooks. Node stays portable across npm launchers.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const args = process.argv.slice(2);
if (args[0] === '--') args.shift();
if (!args.length) throw Error('Expected a command after --');
const python = process.env.CHRONOSCOPE_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const result = spawnSync(python, [fileURLToPath(new URL('./guarded_run.py', import.meta.url)), '--', ...args], { stdio: 'inherit', env: process.env });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
