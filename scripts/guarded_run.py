#!/usr/bin/env python3
"""Serialize local heavy work; monitor Mac pressure and prevent idle sleep."""
import argparse
from contextlib import contextmanager
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time
import uuid
from validation_runtime import prepare_command

ROOT = Path(__file__).resolve().parent.parent
MARKER = 'CHRONOSCOPE_RESOURCE_GUARD'


def memory_available():
    probe = subprocess.run(['/usr/bin/memory_pressure', '-Q'], capture_output=True, text=True, timeout=3)
    import re
    match = re.search(r'System-wide memory free percentage:\s*(\d+)%', probe.stdout)
    if not match:
        raise RuntimeError('Could not determine Mac memory pressure; refusing heavy work')
    return int(match[1])


def usage(root):
    probe = subprocess.run(['/bin/ps', '-axo', 'pid=,ppid=,rss=,pcpu='], capture_output=True, text=True, timeout=3, check=True)
    entries = [line.split() for line in probe.stdout.splitlines() if len(line.split()) == 4]
    owned = {root}
    while True:
        more = {int(pid) for pid, parent, _, _ in entries if int(parent) in owned}
        if more <= owned:
            break
        owned |= more
    return sum(int(rss) for pid, _, rss, _ in entries if int(pid) in owned)/1024, sum(float(cpu) for pid, _, _, cpu in entries if int(pid) in owned)


def is_guarded(root=ROOT):
    """Nested build hooks inherit this lock's random token, not a global bypass."""
    token = os.environ.get(MARKER)
    if not token:
        return False
    try:
        owner = json.loads((Path(root)/'.qa/heavy-work-owner.json').read_text())
        if owner['token'] != token:
            return False
        os.kill(owner['pid'], 0)
        return True
    except (OSError, ValueError, KeyError):
        return False


@contextmanager
def workspace_lock(root=ROOT):
    path = Path(root)/'.qa/heavy-work.lock'
    owner = path.with_name('heavy-work-owner.json')
    path.parent.mkdir(parents=True, exist_ok=True)
    # Keep the inode after unlocking: unlinking it races a waiting opener.
    with path.open('a+') as lock:
        try:
            if os.name == 'nt':
                import msvcrt
                lock.seek(0)
                if not lock.read(1):
                    lock.write(' ')
                    lock.flush()
                lock.seek(0)
                msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            raise RuntimeError('Another guarded build/test is active in this workspace; let it finish first.') from error
        try:
            token = uuid.uuid4().hex
            # Windows byte locks deny reads through other handles, including
            # nested npm hooks. Keep the token in a separate readable file.
            owner.write_text(json.dumps({'pid': os.getpid(), 'token': token}))
            yield token
        finally:
            owner.unlink(missing_ok=True)
            if os.name == 'nt':
                import msvcrt
                lock.seek(0)
                msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(lock.fileno(), fcntl.LOCK_UN)


def launch_command(command):
    return prepare_command(command, Path.cwd(), os.environ)


def run_guarded(command, root=ROOT):
    command = launch_command(command)
    if is_guarded(root):
        return subprocess.call(command)
    with workspace_lock(root) as token:
        if sys.platform == 'darwin':
            available = memory_available()
            if available < 35:
                raise RuntimeError(f'Memory availability {available}% is below the 35% start threshold')
            if shutil.disk_usage(root).free < 5 * 1024**3:
                raise RuntimeError('Less than 5 GiB disk space available; clean old build/test artifacts first.')
            print(f'Resource guard: {available}% memory available; one low-priority process tree', flush=True)
        env = dict(os.environ, **{MARKER: token}, CARGO_BUILD_JOBS='1', RUST_TEST_THREADS='1')
        if sys.platform == 'darwin':
            # Prevent idle system sleep, including while locked; never unlock or
            # prevent display sleep. The assertion ends with the guarded work.
            command = ['/usr/bin/caffeinate', '-i', '/usr/bin/nice', '-n', '10', *command]
        child = subprocess.Popen(command, env=env, start_new_session=os.name != 'nt')
        high_cpu_since = None
        peak_rss = peak_cpu = 0
        try:
            while child.poll() is None:
                time.sleep(.5)
                if child.poll() is not None or sys.platform != 'darwin':
                    continue
                rss, cpu = usage(child.pid)
                peak_rss, peak_cpu = max(peak_rss, rss), max(peak_cpu, cpu)
                available = memory_available()
                high_cpu_since = (high_cpu_since or time.monotonic()) if cpu > 250 else None
                if rss > 5120 or available < 25 or (high_cpu_since and time.monotonic()-high_cpu_since > 15):
                    raise RuntimeError(f'Stopping owned work: RSS={rss:.0f} MiB, CPU={cpu:.0f}%, memory available={available}%')
            print(f'Resource guard: peak owned RSS {peak_rss:.0f} MiB, CPU {peak_cpu:.0f}%', flush=True)
            return child.returncode
        finally:
            # A build/validation step may create its own process groups. Walk
            # descendants via ps before terminating, including those sessions.
            if child.poll() is None:
                from validation_runtime import stop_tree
                stop_tree(child)
                child.wait(timeout=10)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    if not command:
        parser.error('Provide a build/test command after --')
    try:
        return run_guarded(command)
    except (RuntimeError, OSError) as error:
        print(f'Resource guard: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
