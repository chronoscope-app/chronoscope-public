#!/usr/bin/env python3
"""Run one local build/test at low priority; stop its process group on Mac pressure."""
import argparse
import os
import signal
import subprocess
import sys
import time


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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    if not command:
        parser.error('Provide a build/test command after --')
    if sys.platform != 'darwin':
        return subprocess.call(command)
    available = memory_available()
    if available < 35:
        raise RuntimeError(f'Memory availability {available}% is below the 35% start threshold')
    print(f'Resource guard: {available}% memory available; one low-priority process group', flush=True)
    env = dict(os.environ, CARGO_BUILD_JOBS='1', RUST_TEST_THREADS='1')
    child = subprocess.Popen(['/usr/bin/nice', '-n', '10', *command], start_new_session=True, env=env)
    high_cpu_since = None
    peak_rss = peak_cpu = 0
    try:
        while child.poll() is None:
            time.sleep(3)
            if child.poll() is not None:
                break
            rss, cpu = usage(child.pid)
            peak_rss, peak_cpu = max(peak_rss, rss), max(peak_cpu, cpu)
            available = memory_available()
            high_cpu_since = (high_cpu_since or time.monotonic()) if cpu > 250 else None
            if rss > 5120 or available < 25 or (high_cpu_since and time.monotonic()-high_cpu_since > 15):
                raise RuntimeError(f'Stopping owned work: RSS={rss:.0f} MiB, CPU={cpu:.0f}%, memory available={available}%')
        print(f'Resource guard: peak owned RSS {peak_rss:.0f} MiB, CPU {peak_cpu:.0f}%', flush=True)
        return child.returncode
    finally:
        if child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait(timeout=5)


if __name__ == '__main__':
    sys.exit(main())
