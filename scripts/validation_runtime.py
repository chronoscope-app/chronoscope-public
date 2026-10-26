"""Bounded local subprocesses shared by validation and its regression tests."""
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import time


def stop_tree(process):
    if os.name == 'nt':
        subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
    else:
        # Guarded commands can create independently sessioned validation steps.
        # Capture their process groups before terminating the parent so those
        # steps cannot escape pressure/timeout cleanup by being reparented.
        groups = {process.pid}
        try:
            rows = [line.split() for line in subprocess.check_output(
                ['/bin/ps', '-axo', 'pid=,ppid=,pgid='], text=True, timeout=3).splitlines()]
            owned = {process.pid}
            while True:
                more = {int(pid) for pid, parent, _ in rows if int(parent) in owned}
                if more <= owned:
                    break
                owned |= more
            groups |= {int(group) for pid, _, group in rows
                       if int(pid) in owned and int(group) in owned}
        except (OSError, subprocess.SubprocessError, ValueError):
            pass
        def send(sig):
            for group in groups:
                if group == os.getpgrp():
                    continue
                try:
                    os.killpg(group, sig)
                except ProcessLookupError:
                    pass
        send(signal.SIGTERM)
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            pass
        send(signal.SIGKILL)


def run_command(command, cwd, env, log, timeout):
    started = time.monotonic()
    process = None
    timed_out = False
    command = list(map(str, command))
    if os.name == 'nt' and command[0].lower().endswith(('.cmd', '.bat')):
        command = ['cmd.exe', '/d', '/c', *command]
    Path(log).parent.mkdir(parents=True, exist_ok=True)
    with Path(log).open('w') as output:
        try:
            process = subprocess.Popen(command, cwd=cwd, env=env, stdout=output,
                                       stderr=subprocess.STDOUT, start_new_session=os.name != 'nt',
                                       creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0)
            try:
                code = process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                timed_out = True
                code = 124
                output.write(f'\nSuite exceeded {timeout} seconds. Stopping its process tree.\n')
        except OSError as error:
            output.write(str(error))
            code = 127
        finally:
            if process:
                stop_tree(process)
                process.wait(timeout=10)
    return {'exit_code': code, 'timed_out': timed_out,
            'elapsed_s': round(time.monotonic() - started, 3)}


def sha256(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def build_receipt(source, cli, frontend, profile=None):
    frontend = Path(frontend)
    if frontend.is_dir():
        digest = hashlib.sha256()
        for file in sorted(p for p in frontend.rglob('*') if p.is_file()):
            digest.update(str(file.relative_to(frontend)).encode())
            digest.update(sha256(file).encode())
        frontend_hash = digest.hexdigest()
    else:
        frontend_hash = sha256(frontend)
    result = {'source_digest': source, 'cli_sha256': sha256(cli), 'frontend_sha256': frontend_hash}
    if profile is not None:
        result['cli_build_profile'] = profile
    return result


def matches_build_receipt(receipt, source, cli, frontend, profile=None):
    try:
        return json.loads(Path(receipt).read_text()) == build_receipt(source, cli, frontend, profile)
    except (OSError, ValueError):
        return False
