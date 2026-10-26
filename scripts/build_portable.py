#!/usr/bin/env python3
"""Run Cargo with private source paths remapped; preserve target flags/config.
Usage: python3 scripts/build_portable.py build --locked --release -p chronoscope
Also: python3 scripts/build_portable.py -- npm run bundle
"""
import os
from pathlib import Path
import subprocess
import shutil
import sys

root = Path(__file__).resolve().parent.parent

def build_environment(environ, config_flags=()):
    env = dict(environ)
    # Cargo RUSTFLAGS splits by whitespace, not shell quoting; preserve backslashes.
    # Arguments containing spaces require unit-separated CARGO_ENCODED_RUSTFLAGS.
    flags = ((env["CARGO_ENCODED_RUSTFLAGS"].split("\x1f") if env["CARGO_ENCODED_RUSTFLAGS"] else [])
             if "CARGO_ENCODED_RUSTFLAGS" in env
             else env["RUSTFLAGS"].split() if "RUSTFLAGS" in env else list(config_flags))
    # rustc tests mappings in reverse order: most specific prefixes go last.
    for source, destination in [(str(Path.home()), "/build-home"),
                                (str(Path(env.get("CARGO_HOME", str(Path.home()/".cargo"))).resolve()), "/cargo"),
                                (str(root), "/chronoscope")]:
        flags.append(f"--remap-path-prefix={source}={destination}")
    env["CARGO_ENCODED_RUSTFLAGS"] = "\x1f".join(flags)
    env.pop("RUSTFLAGS", None)
    return env

def run_command(command, environment):
    # CreateProcess does not search PATHEXT for bare names such as npm.
    # Resolve the actual npm.cmd/cargo.exe launcher, retaining an argv list
    # instead of shell=True or manually quoted/concatenated build arguments.
    if sys.platform == "win32":
        executable = shutil.which(command[0], path=environment.get("PATH"))
        if executable is None:
            raise FileNotFoundError(f"Build executable not found on PATH: {command[0]}")
        command = [executable, *command[1:]]
    return subprocess.run(command, cwd=root, env=environment).returncode


def configured_flags_required(environ, command):
    """Accept only the reviewed jobs-only workspace config without guessing flags."""
    if 'RUSTFLAGS' in environ or 'CARGO_ENCODED_RUSTFLAGS' in environ:
        return False
    configs = [Path(environ.get('CARGO_HOME', str(Path.home()/'.cargo')))/'config.toml']
    configs += [directory/'.cargo'/'config.toml' for directory in [root, *root.parents]]
    configs += [path.with_name('config') for path in list(configs)]
    for path in configs:
        if not path.is_file():
            continue
        if path.resolve() == (root/'.cargo/config.toml').resolve():
            import re
            lines = [line.split('#', 1)[0].strip() for line in path.read_text().splitlines()]
            lines = [line for line in lines if line]
            if len(lines) == 2 and lines[0] == '[build]' and re.fullmatch(r'jobs\s*=\s*1', lines[1]):
                continue  # No rustflags can be overridden by the remapping env.
        return True
    return (any(key.startswith('CARGO_TARGET_') and key.endswith('_RUSTFLAGS') for key in environ)
            or any(arg == '--config' or arg.startswith('--config=') for arg in command))


if __name__ == "__main__":
    args = sys.argv[1:]
    command = args[1:] if args[:1] == ["--"] else ["cargo", *args]
    if not args or not command:
        raise SystemExit(__doc__)
    # Cargo environment flags override target-specific config. Fail closed rather
    # than silently discard unknown configured flags. Explicit environment flags
    # retain Cargo's normal precedence and need no config merge.
    configured = []
    if configured_flags_required(os.environ, command):
        raise SystemExit("Configured Cargo flags detected. Set CARGO_ENCODED_RUSTFLAGS to the effective target rustflags before remapping; no configuration was changed.")
    raise SystemExit(run_command(command, build_environment(os.environ, configured)))
