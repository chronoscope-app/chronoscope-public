#!/usr/bin/env python3
"""Prepare an isolated Linux/Tauri build environment; never install system files.

Example: python3 scripts/prepare_linux_build.py --sdk /path/to/sdk \
  --state /absolute/persistent/state --python /path/to/python3.13 --node /usr/bin/node \
  --npm /usr/bin/npm --allow-sdk-runtime-version-skew --run npm run build
The generated environment is also available in STATE/environment.sh. Only a
repository-local target symlink pointing at STATE/target is created. --run adds
an available-memory watchdog and stops only its own child process group.
"""
import argparse
import datetime
import json
import os
from pathlib import Path
import platform
import shlex
import shutil
import signal
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parent.parent
GIB = 1024 ** 3


def memory_available(path=Path('/proc/meminfo')):
    for line in path.read_text().splitlines():
        if line.startswith('MemAvailable:'):
            return int(line.split()[1]) * 1024
    raise ValueError('MemAvailable is unavailable')


def safe_jobs(available, cpus):
    # Keep 3 GiB for the host, reserve 3.5 GiB for the largest compiler,
    # and allow a further GiB per parallel worker, up to four workers.
    if available < int(6.5 * GIB):
        raise ValueError('At least 6.5 GiB available memory is required to start')
    return max(1, min(4, cpus, 1 + int((available - 6.5 * GIB) / GIB)))


def run_checked(args, env=None):
    return subprocess.check_output(args, text=True, env=env, stderr=subprocess.PIPE).strip()


def prepare(sdk, state, python_path, node_path, npm_path, allow_skew=False):
    if sys.platform != 'linux' or platform.machine() not in ('x86_64', 'AMD64'):
        raise ValueError('Linux x86_64 is required')
    for name in ('pkg-config', 'pkgconf', 'cargo', 'rustc', 'readelf', 'dpkg-query'):
        if not shutil.which(name):
            raise ValueError('Required build tool missing: ' + name)
    python_path = python_path.resolve(strict=True)
    node_path = node_path.resolve(strict=True)
    npm_path = npm_path.resolve(strict=True)
    python_version = run_checked([str(python_path), '-c', 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")'])
    node_version = run_checked([str(node_path), '--version'])
    rust_version = run_checked(['rustc', '--version'])
    cargo_version = run_checked(['cargo', '--version'])
    if (python_version != '3.13' or not node_version.startswith('v22.') or
            not rust_version.startswith('rustc 1.98.0 ') or not cargo_version.startswith('cargo 1.98.0 ')):
        raise ValueError('Release requires Python 3.13, Node 22 and Rust/Cargo 1.98.0; found ' + python_version + ', ' + node_version + ', ' + rust_version + ', ' + cargo_version)
    sdk = sdk.resolve(strict=True)
    if not state.is_absolute() or state.is_symlink():
        raise ValueError('State must be an absolute, non-symlink directory')
    state.mkdir(parents=True, exist_ok=True)
    state = state.resolve(strict=True)
    marker = state / '.chronoscope-linux-build-state'
    if marker.is_symlink() or (any(state.iterdir()) and not marker.is_file()):
        raise ValueError('Refusing nonempty state directory without our marker')
    if marker.exists() and marker.read_text() != 'chronoscope-linux-build-state-v1\n':
        raise ValueError('State directory marker mismatch')
    if not marker.exists():
        marker.write_text('chronoscope-linux-build-state-v1\n')
    pc = [sdk / 'usr/lib/x86_64-linux-gnu/pkgconfig', sdk / 'usr/share/pkgconfig']
    if not all(p.is_dir() for p in pc):
        raise ValueError('SDK pkg-config directories missing')
    env = os.environ.copy()
    env['PKG_CONFIG_PATH'] = ':'.join(map(str, pc))
    libraries = {'gtk+-3.0': 'libgtk-3-0t64', 'webkit2gtk-4.1': 'libwebkit2gtk-4.1-0',
                 'javascriptcoregtk-4.1': 'libjavascriptcoregtk-4.1-0'}
    versions = {}
    for name, package in libraries.items():
        sdk_version = run_checked(['pkg-config', '--modversion', name], env)
        binary_version = run_checked(['dpkg-query', '-W', '-f=${Version}', package])
        runtime_version = binary_version.split(':')[-1].split('-')[0]
        versions[name] = {'sdk': sdk_version, 'runtime_package': package,
                          'runtime_debian_version': binary_version,
                          'same_upstream_version': sdk_version == runtime_version}
    mismatch = [k for k, v in versions.items() if not v['same_upstream_version']]
    if mismatch and not allow_skew:
        raise ValueError('SDK/runtime version skew requires explicit review: ' + ', '.join(mismatch))
    helper = Path('/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1')
    for item in ('WebKitNetworkProcess', 'WebKitWebProcess'):
        if not (helper / item).is_file():
            raise ValueError('Runtime helper missing: ' + str(helper / item))
    for package in ('libgles2', 'libwebkit2gtk-4.1-0', 'libjavascriptcoregtk-4.1-0'):
        if not (Path('/usr/share/doc') / package / 'copyright').is_file():
            raise ValueError('Runtime copyright record missing: ' + package)
    jobs = safe_jobs(memory_available(), len(os.sched_getaffinity(0)))
    target = state / 'target'
    if target.is_symlink():
        raise ValueError('Target directory must not be a symlink')
    target.mkdir(exist_ok=True)
    link = ROOT / 'target'
    if link.is_symlink():
        if link.resolve() != target.resolve():
            raise ValueError('Existing target symlink points elsewhere')
    elif link.exists():
        raise ValueError('Refusing to replace existing target directory')
    else:
        link.symlink_to(target, target_is_directory=True)
    bindir = state / 'bin'
    bindir.mkdir(exist_ok=True)
    wrapper = bindir / 'pkgconf'
    if bindir.is_symlink() or wrapper.is_symlink():
        raise ValueError('Refusing unsafe wrapper path')
    # Avoid sed interpolation: shell substitution handles even unusual SDK paths.
    prefix = shlex.quote(str(sdk / 'usr'))
    wrapper.write_text('#!/usr/bin/env bash\nset -o pipefail\n'
        'for arg in "$@"; do\n  if [[ "$arg" == --variable=* ]]; then\n'
        '    value=$(/usr/bin/pkgconf "$@") || exit $?\n'
        '    prefix=' + prefix + '\n'
        '    if [[ "$value" == "$prefix"* ]]; then value="/usr${value#"$prefix"}"; fi\n'
        '    printf "%s\\n" "$value"\n    exit 0\n  fi\ndone\n'
        'exec /usr/bin/pkgconf "$@"\n')
    wrapper.chmod(0o755)
    for name, target_path in (('python', python_path), ('python3', python_path), ('node', node_path), ('npm', npm_path)):
        link_path = bindir / name
        if link_path.exists() and not link_path.is_symlink():
            raise ValueError('Refusing to replace non-symlink runtime wrapper: ' + str(link_path))
        if link_path.is_symlink():
            link_path.unlink()
        link_path.symlink_to(target_path)
    exports = {'PATH': str(bindir) + ':' + os.environ.get('PATH', ''),
               'PKG_CONFIG_PATH': env['PKG_CONFIG_PATH'],
               'LIBRARY_PATH': str(sdk / 'usr/lib/x86_64-linux-gnu'),
               'CARGO_TARGET_DIR': str(target), 'CARGO_BUILD_JOBS': str(jobs),
               'CARGO_INCREMENTAL': '0', 'APPIMAGE_EXTRACT_AND_RUN': '1'}
    if 'CARGO_ENCODED_RUSTFLAGS' not in os.environ and 'RUSTFLAGS' not in os.environ:
        exports['CARGO_ENCODED_RUSTFLAGS'] = ''
    (state / 'environment.sh').write_text(''.join('export ' + k + '=' + shlex.quote(v) + '\n' for k, v in exports.items()))
    report = {'sdk': str(sdk), 'target': str(target), 'memory_available_bytes': memory_available(),
              'jobs': jobs, 'toolchains': {'python': python_version, 'node': node_version, 'rust': rust_version, 'cargo': cargo_version}, 'versions': versions, 'sdk_runtime_skew_acknowledged': bool(mismatch and allow_skew),
              'webkit_helpers': str(helper), 'environment_file': str(state / 'environment.sh')}
    (state / 'preflight.json').write_text(json.dumps(report, indent=2) + '\n')
    return exports, report


def guarded(command, env, state):
    start = time.monotonic()
    with (state / 'resource-samples.jsonl').open('a') as log:
        process = subprocess.Popen(command, cwd=ROOT, env=env, start_new_session=True)
        try:
            while process.poll() is None:
                available = memory_available()
                log.write(json.dumps({'epoch_s': time.time(), 'available_bytes': available}) + '\n')
                log.flush()
                if available < int(2.5 * GIB):
                    os.killpg(process.pid, signal.SIGTERM)
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        os.killpg(process.pid, signal.SIGKILL)
                        process.wait()
                    return {'exit': process.returncode, 'backoff': 'host available memory below 2.5 GiB', 'elapsed_s': time.monotonic() - start}
                time.sleep(1)
        except BaseException:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                process.wait()
            raise
    return {'exit': process.returncode, 'elapsed_s': time.monotonic() - start}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--sdk', required=True, type=Path)
    p.add_argument('--python', required=True, type=Path, help='Python 3.13 executable')
    p.add_argument('--node', required=True, type=Path, help='Node 22 executable')
    p.add_argument('--npm', required=True, type=Path, help='npm executable for Node 22')
    p.add_argument('--state', required=True, type=Path)
    p.add_argument('--allow-sdk-runtime-version-skew', action='store_true')
    p.add_argument('--run', nargs=argparse.REMAINDER)
    args = p.parse_args()
    started = time.monotonic()
    started_utc = datetime.datetime.now(datetime.timezone.utc).isoformat()
    def record_attempt(result):
        marker = args.state / '.chronoscope-linux-build-state'
        log = args.state / 'preflight-attempts.jsonl'
        if marker.is_file() and not marker.is_symlink() and not log.is_symlink():
            with log.open('a') as f:
                f.write(json.dumps({'started_utc': started_utc, 'elapsed_s': time.monotonic() - started, **result}) + '\n')
    try:
        exports, report = prepare(args.sdk, args.state, args.python, args.node, args.npm, args.allow_sdk_runtime_version_skew)
        report['preflight_elapsed_s'] = time.monotonic() - started
        (args.state / 'preflight.json').write_text(json.dumps(report, indent=2) + '\n')
        record_attempt({'status': 'passed', 'sdk_runtime_skew_acknowledged': report['sdk_runtime_skew_acknowledged']})
        if args.run:
            command = args.run[1:] if args.run[0] == '--' else args.run
            if not command:
                raise ValueError('Empty command')
            report['run'] = guarded(command, {**os.environ, **exports}, args.state)
            (args.state / 'run-result.json').write_text(json.dumps(report['run'], indent=2) + '\n')
        print(json.dumps(report, indent=2))
        return report.get('run', {}).get('exit', 0) or 0
    except (OSError, ValueError, subprocess.CalledProcessError) as e:
        record_attempt({'status': 'failed', 'error': str(e)})
        print('Linux preflight failed: ' + str(e), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
