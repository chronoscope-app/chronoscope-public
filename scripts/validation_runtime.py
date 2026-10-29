"""Bounded local subprocesses shared by validation and its regression tests."""
import hashlib
import json
import errno
import ntpath
import os
from pathlib import Path
import signal
import subprocess
import sys
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
                except PermissionError as error:
                    # Darwin can retain an exited/zombie group after TERM and
                    # reject the later KILL with EPERM rather than ESRCH. Only
                    # accept that outcome after ps proves no live members remain.
                    try:
                        members = [line.split() for line in subprocess.check_output(
                            ['/bin/ps', '-axo', 'pgid=,stat='], text=True, timeout=3).splitlines()]
                        if not members or any(len(row) != 2 for row in members):
                            raise error
                        live = any(int(pgid) == group and not state.startswith('Z')
                                   for pgid, state in members)
                    except (OSError, subprocess.SubprocessError, ValueError):
                        raise error
                    if live:
                        raise
        send(signal.SIGTERM)
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            pass
        send(signal.SIGKILL)


class CommandPreparationError(OSError):
    """Only fixed, non-sensitive messages may be surfaced in CI diagnostics."""


def prepare_command(command, cwd, env, windows=None):
    """Resolve Windows launchers without enabling a general-purpose shell.

    Native executables retain argv semantics. Standard npm batch shims are
    replaced by their sibling Node executable and npm CLI; no cmd language.
    Never search the current directory unless PATH explicitly includes it.
    """
    if windows is None:
        windows = sys.platform == 'win32'
    if not windows:
        return command
    command = list(map(str, command))
    environment = {key.upper(): value for key, value in env.items()}
    if not command:
        raise CommandPreparationError(errno.EINVAL, 'Empty suite command')
    name = command[0]
    extensions = [ext for ext in environment.get('PATHEXT', '.COM;.EXE;.BAT;.CMD').split(';') if ext]
    names = [name] if ntpath.splitext(name)[1] else [name+ext for ext in extensions]
    path = environment.get('PATH', '')
    directories = [''] if ntpath.dirname(name) else path.split(';') if path else []
    executable = None
    for directory in directories:
        for candidate in names:
            path = ntpath.join(directory.strip('"'), candidate)
            if not ntpath.isabs(path):
                path = ntpath.join(str(cwd), path)
            if os.path.isfile(path):
                executable = path
                break
        if executable:
            break
    if executable is None:
        raise FileNotFoundError(errno.ENOENT, 'Suite executable not found on PATH')
    command[0] = executable
    if not executable.lower().endswith(('.cmd', '.bat')):
        return command
    if ntpath.basename(executable).lower() not in {'npm.cmd', 'npm.bat'}:
        raise CommandPreparationError(errno.EINVAL, 'Unsupported batch launcher; use a native executable entry point')
    directory = ntpath.dirname(executable)
    node = ntpath.join(directory, 'node.exe')
    cli = ntpath.join(directory, 'node_modules', 'npm', 'bin', 'npm-cli.js')
    if not os.path.isfile(node) or not os.path.isfile(cli):
        raise CommandPreparationError(errno.ENOENT, 'Standard npm shim requires sibling node.exe and node_modules/npm/bin/npm-cli.js')
    # Avoid cmd.exe and all batch expansion/quoting. In particular do not select
    # an unrelated Node/npm from PATH when this installation is incomplete.
    return [node, cli, *command[1:]]


def run_command(command, cwd, env, log, timeout):
    started = time.monotonic()
    process = None
    timed_out = False
    launch_error = None
    command = list(map(str, command))
    Path(log).parent.mkdir(parents=True, exist_ok=True)
    with Path(log).open('w') as output:
        try:
            command = prepare_command(command, cwd, env)
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
            # Exception text may include private paths/arguments. Retain the
            # root OS error category/numbers without copying those values.
            launch_error = type(error).__name__ + ' launching suite executable'
            if isinstance(error, CommandPreparationError):
                launch_error += ': '+error.strerror
            for key in ['errno', 'winerror']:
                value = getattr(error, key, None)
                if isinstance(value, int):
                    launch_error += f' ({key}={value})'
            output.write(launch_error+'\n')
            code = 127
        finally:
            if process:
                stop_tree(process)
                process.wait(timeout=10)
    result = {'exit_code': code, 'timed_out': timed_out,
              'elapsed_s': round(time.monotonic() - started, 3)}
    if launch_error:
        result['error'] = launch_error
    return result


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
