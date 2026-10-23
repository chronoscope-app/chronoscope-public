#!/usr/bin/env python3
"""Manual GitHub-hosted final-download checks. Never install or run on owner hosts.

Read-only Actions API/download; no uploads or publication. A receipt is not legal
clearance, a real-device result, or a claim that a window rendered correctly.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import shutil
import stat
import struct
import subprocess
import sys
import tarfile
import tempfile
import time
import zipfile

from package_notices import verify_notices
from package_tester import architecture

REPO = 'chronoscope-app/chronoscope-public'
ROOT = Path(__file__).resolve().parent.parent
MAX_ARCHIVE = 60 * 1024 * 1024
MAX_EXPANDED = 1024 * 1024 * 1024
# Reviewed GIS additions: bufrw, dbase, geozero (two licenses), scroll, shapefile.
NOTICE_COUNT = 1498


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def command(args, *, timeout=40, env=None, stdin=None):
    if env is None:
        env = {k: v for k, v in os.environ.items() if k not in
               ('GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN')}
    result = subprocess.run([str(x) for x in args], input=stdin, capture_output=True,
                            text=True, encoding='utf-8', errors='replace',
                            timeout=timeout, env=env)
    # Do not echo arbitrary subprocess output: app logs/descriptors may be private.
    require(result.returncode == 0, f'Command failed: {Path(str(args[0])).name} (exit {result.returncode})')
    return result.stdout


def hosted_guard(target):
    expected_os, expected_arch = ('Windows', 'X64') if target == 'windows-x86_64' else ('macOS', 'ARM64')
    require(os.environ.get('GITHUB_ACTIONS') == 'true' and
            os.environ.get('RUNNER_ENVIRONMENT') == 'github-hosted' and
            os.environ.get('GITHUB_REPOSITORY') == REPO and
            os.environ.get('GITHUB_EVENT_NAME') == 'workflow_dispatch' and
            os.environ.get('GITHUB_REF') == 'refs/heads/main' and
            os.environ.get('RUNNER_OS') == expected_os and
            os.environ.get('RUNNER_ARCH') == expected_arch,
            'Execution refused: exact manual GitHub-hosted runner required')
    require(platform.system() == ('Windows' if expected_os == 'Windows' else 'Darwin'), 'Host OS mismatch')
    actual = platform.machine().lower()
    require(actual in (('amd64', 'x86_64') if expected_arch == 'X64' else ('arm64', 'aarch64')), 'Host architecture mismatch')
    require(bool(os.environ.get('RUNNER_TEMP')), 'Missing hosted temporary directory')


def safe_member(name):
    path = PurePosixPath(name)
    require(bool(name) and not path.is_absolute() and str(path) == name and
            all(part not in ('', '.', '..') for part in name.split('/')) and
            not any(c in name for c in '\\:\x00') and
            not any(ord(c) < 32 for c in name), 'Unsafe archive path')
    for part in path.parts:
        require(not part.endswith((' ', '.')) and
                part.split('.')[0].upper() not in {'CON', 'PRN', 'AUX', 'NUL', *('COM' + str(i) for i in range(1, 10)), *('LPT' + str(i) for i in range(1, 10))},
                'Unsafe cross-platform archive name')
    return path


def extract_archive(archive, destination, zip_only=False):
    """No links/devices/hardlinks/overwrites; preflight paths and expansion budget."""
    destination.mkdir()
    seen = set()
    total = 0
    if zipfile.is_zipfile(archive):
        handle = zipfile.ZipFile(archive)
        entries = [(i, i.filename.rstrip('/') if i.is_dir() else i.filename,
                    i.is_dir(), i.file_size, (i.external_attr >> 16) & 0xffff) for i in handle.infolist()]
        opener = handle.open
    else:
        require(not zip_only, 'Actions artifact must be a ZIP')
        handle = tarfile.open(archive, 'r:xz')
        entries = []
        for i in handle.getmembers():
            require(i.isdir() or i.isfile(), 'Archive links/special files refused')
            entries.append((i, i.name.rstrip('/') if i.isdir() else i.name,
                            i.isdir(), i.size, i.mode | (stat.S_IFDIR if i.isdir() else stat.S_IFREG)))
        opener = handle.extractfile
    with handle:
        require(len(entries) <= 25000, 'Archive entry cap exceeded')
        for _, name, directory, size, mode in entries:
            safe_member(name)
            require(name.casefold() not in seen, 'Duplicate/case-colliding archive path')
            seen.add(name.casefold())
            require(stat.S_IFMT(mode) in (0, stat.S_IFREG, stat.S_IFDIR), 'Archive links/special files refused')
            total += size
            require(size >= 0 and total <= MAX_EXPANDED, 'Archive expansion cap exceeded')
        # Files cannot be ancestors of other entries (also reject case aliasing).
        files = {name.casefold() for _, name, directory, _, _ in entries if not directory}
        for _, name, _, _, _ in entries:
            require(not any(str(p).casefold() in files for p in PurePosixPath(name).parents if str(p) != '.'), 'Archive file/directory collision')
        for item, name, directory, size, mode in entries:
            output = destination.joinpath(*safe_member(name).parts)
            if directory:
                output.mkdir(parents=True, exist_ok=True)
                continue
            output.parent.mkdir(parents=True, exist_ok=True)
            with opener(item) as source, output.open('xb') as target:
                remaining = size
                while remaining:
                    block = source.read(min(1024 * 1024, remaining))
                    require(bool(block), 'Truncated archive member')
                    target.write(block)
                    remaining -= len(block)
                require(not source.read(1), 'Archive member exceeds declared size')
            if os.name != 'nt':
                output.chmod(0o755 if mode & 0o111 else 0o644)
    return destination


def gh_json(endpoint, token_env):
    return json.loads(command(['gh', 'api', '--method', 'GET', endpoint], env=token_env))


def fetch_artifact(args, temporary, token_env, receipt):
    base = f'repos/{REPO}/actions/runs/{args.build_run_id}'
    run = gh_json(base, token_env)
    require(run['repository']['full_name'] == REPO and run['head_repository']['full_name'] == REPO and
            run['head_sha'] == args.build_sha and run['head_branch'] == 'main' and
            run['path'] == '.github/workflows/build.yml' and run['event'] == 'workflow_dispatch' and
            run['status'] == 'completed' and run['conclusion'] == 'success',
            'Run provenance/status does not match reviewed successful manual build')
    records = gh_json(base + '/artifacts?per_page=100', token_env)
    require(records['total_count'] <= 100, 'Unexpected artifact count')
    name = f'{args.platform}-{args.build_sha}'
    matches = [a for a in records['artifacts'] if a['name'] == name]
    require(len(matches) == 1, 'Expected exactly one platform artifact')
    artifact = matches[0]
    require(not artifact['expired'] and 0 < artifact['size_in_bytes'] <= MAX_ARCHIVE,
            'Artifact expired/empty/over storage cap')
    require(artifact['workflow_run']['id'] == int(args.build_run_id) and
            artifact['workflow_run']['head_sha'] == args.build_sha, 'Artifact run mismatch')
    # gh is the only authenticated child. Its stdout is streamed into a size-checked
    # file, never parsed as shell or logged. Exact ID from exact run, not latest.
    archive = temporary / 'actions-artifact.zip'
    with archive.open('xb') as output:
        process = subprocess.Popen(['gh', 'api', '--method', 'GET',
                                    f'repos/{REPO}/actions/artifacts/{artifact["id"]}/zip'],
                                   stdout=output, stderr=subprocess.DEVNULL, env=token_env)
        try:
            require(process.wait(timeout=120) == 0, 'Actions artifact download failed')
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()
    require(0 < archive.stat().st_size <= MAX_ARCHIVE, 'Downloaded artifact size cap exceeded')
    outer_hash = digest(archive)
    if artifact.get('digest'):
        require(artifact['digest'] == 'sha256:' + outer_hash, 'Actions ZIP digest mismatch')
    receipt['artifact'] = {'id': artifact['id'], 'name': name, 'run_attempt': run['run_attempt'],
                           'actions_zip_sha256': outer_hash, 'actions_digest_verified': bool(artifact.get('digest'))}
    return extract_archive(archive, temporary / 'download', zip_only=True)


def notices(directory, source):
    manifest = verify_notices(directory, source)
    require(len(manifest['files']) == NOTICE_COUNT, 'Unexpected notice count; review validator for new build inputs')
    provenance = json.loads((source / 'assets/licenses/webview2-sdk/PROVENANCE.json').read_text())
    for record in provenance['retained_original_files']:
        require(digest(directory / 'assets/licenses/webview2-sdk' / record['path']) == record['sha256'],
                'Exact WebView2 SDK notice mismatch')
    return {'path': directory.name, 'files': len(manifest['files']),
            'manifest_sha256': digest(directory / 'NOTICE-MANIFEST.json'),
            'trusted_build_checkout_match': True, 'webview2_sdk_original_texts': True}


def native_inventory(root, windows=False):
    result = []
    for path in sorted(root.rglob('*')):
        require(not path.is_symlink(), 'Extracted payload link refused')
        if not path.is_file():
            continue
        if windows and path.suffix.lower() not in ('.exe', '.dll'):
            continue
        if not windows:
            with path.open('rb') as stream:
                if stream.read(4) != b'\xcf\xfa\xed\xfe':
                    continue
        entry = {'path': path.relative_to(root).as_posix(), 'bytes': path.stat().st_size, 'sha256': digest(path)}
        if windows:
            # NSIS plugins may be x86 even for an x64 application.
            try:
                entry['architecture'] = architecture(path)
            except KeyError:
                data = path.read_bytes()
                offset = struct.unpack_from('<I', data, 0x3c)[0]
                require(data[offset:offset + 4] == b'PE\0\0' and struct.unpack_from('<H', data, offset + 4)[0] == 0x14c,
                        'Unrecognized PE architecture')
                entry['architecture'] = 'x86'
            tool = shutil.which('llvm-objdump') or 'C:/Program Files/LLVM/bin/llvm-objdump.exe'
            linkage = command([tool, '-p', path])
            entry['imports'] = sorted(set(re.findall(r'DLL Name:\s*(\S+)', linkage)))
            require(bool(entry['imports']), 'PE import inspection returned no DLL records')
        else:
            entry['architecture'] = architecture(path)
            entry['imports'] = command(['otool', '-L', path]).splitlines()[1:]
        result.append(entry)
    require(bool(result), 'No native payload inventoried')
    return result


def mcp_smoke(binary, profile, env):
    hosted_guard('windows-x86_64' if os.name == 'nt' else 'macos-arm64')
    requests = [
        {'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {'protocolVersion': '2024-11-05', 'capabilities': {}, 'clientInfo': {'name': 'final-package-check', 'version': '1'}}},
        {'jsonrpc': '2.0', 'method': 'notifications/initialized'},
        {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list'},
        {'jsonrpc': '2.0', 'id': 3, 'method': 'tools/call', 'params': {'name': 'chronoscope_snapshot', 'arguments': {'compact': True}}},
    ]
    output = command([binary, '--data-dir', profile, 'mcp', '--attach'],
                     stdin=''.join(json.dumps(r) + '\n' for r in requests), env=env, timeout=25)
    replies = {m.get('id'): m for m in (json.loads(line) for line in output.splitlines()) if 'id' in m}
    require(replies[1]['result']['serverInfo']['name'] == 'chronoscope' and
            bool(replies[2]['result']['tools']) and
            replies[3]['result']['structuredContent']['count'] == 0,
            'Attached packaged GUI MCP readiness/query failed')


def cleanup_posix_group(process):
    """Bounded cleanup of the session group retained at GUI launch."""
    import signal
    group = process.pid  # start_new_session=True; remains valid after leader exit.
    try:
        os.killpg(group, signal.SIGTERM)
    except ProcessLookupError:
        process.wait(timeout=5)
        return
    try:
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        pass
    # Reap/wait of the leader says nothing about surviving WebKit descendants.
    try:
        os.killpg(group, signal.SIGKILL)
    except ProcessLookupError:
        pass
    process.wait(timeout=5)


def cleanup_windows_process(process, env):
    """Bounded task-owned PID/tree attempt; no orphan-tree termination proof."""
    result = {'scope': 'task-owned launch PID and taskkill /T while leader alive',
              'orphan_tree_verified': False, 'leader_reaped': False,
              'taskkill_attempted': False, 'parent_kill_fallback': False}
    if process.poll() is None:
        result['taskkill_attempted'] = True
        try:
            killed = subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'],
                                    capture_output=True, timeout=15, env=env)
            result['taskkill_returncode'] = killed.returncode
        except (subprocess.TimeoutExpired, OSError) as error:
            result['taskkill_failure'] = type(error).__name__
        try:
            process.wait(timeout=8)
        except subprocess.TimeoutExpired:
            result['parent_kill_fallback'] = True
            process.kill()
            process.wait(timeout=5)
    else:
        # Do not act on a potentially reused PID after the launch leader exited.
        process.wait(timeout=5)
    result['leader_reaped'] = True
    return result


def nsis_listing(listing, trusted_sizes=None):
    """Preflight member names, file ancestors and per-member expansion bounds."""
    require('----------' in listing, 'Cannot inspect NSIS member listing')
    seen, files, payload = set(), set(), []
    expanded = 0
    for block in listing.split('----------', 1)[1].strip().split('\n\n'):
        fields = dict(line.split(' = ', 1) for line in block.splitlines() if ' = ' in line)
        if 'Path' not in fields:
            continue
        name = fields['Path'].replace('\\', '/')
        safe_member(name)
        require(name.casefold() not in seen, 'Duplicate NSIS path')
        seen.add(name.casefold())
        require(not any('link' in key.lower() for key in fields), 'NSIS link refused')
        directory = fields.get('Folder') == '+' or fields.get('Attributes', '').startswith('D')
        raw_size = fields.get('Size', '')
        missing_size = not raw_size and not directory
        if missing_size:
            # 7-Zip cannot report the final solid NSIS member's size. Only a
            # previously verified resource can supply it; stream-check below.
            require(fields.get('Solid') == '+' and name in (trusted_sizes or {}),
                    'NSIS member missing trusted size')
            size = trusted_sizes[name]
        else:
            size = int(raw_size or '0')
        require(0 <= size <= MAX_EXPANDED, 'NSIS member expansion cap exceeded')
        expanded += size
        require(len(seen) <= 25000 and expanded <= MAX_EXPANDED, 'NSIS expansion cap exceeded')
        if not directory:
            files.add(name.casefold())
        payload.append({'path': name, 'bytes': size})
        if missing_size:
            payload[-1]['requires_stream_check'] = True
    require(bool(seen), 'NSIS expansion cap exceeded')
    for entry in payload:
        require(not any(str(p).casefold() in files for p in PurePosixPath(entry['path']).parents
                        if str(p) != '.'), 'NSIS file/directory collision')
    return payload



def nsis_read_stream(tool, installer, member, limit):
    """Read one solid NSIS member with bounded memory and execution time."""
    require(0 <= limit <= 16 * 1024 * 1024, 'Unknown-size NSIS resource too large')
    clean_env = {k: v for k, v in os.environ.items() if k not in
                 ('GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN')}
    process = subprocess.Popen([str(tool), 'x', '-so', '-bd', '-y', str(installer), member],
                               stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=clean_env)
    with ThreadPoolExecutor(max_workers=1) as pool:
        reader = pool.submit(process.stdout.read, limit + 1)
        try:
            data = reader.result(timeout=90)
            require(len(data) <= limit, 'Unknown-size NSIS stream exceeds byte cap')
            require(process.wait(timeout=10) == 0, 'NSIS resource stream failed')
            return data
        except FutureTimeout as error:
            raise ValueError('NSIS resource stream timed out') from error
        finally:
            if process.poll() is None:
                process.kill()
            process.wait()
            process.stdout.close()


def nsis_resource_stream(tool, installer, member, expected):
    data = nsis_read_stream(tool, installer, member, expected.stat().st_size)
    require(len(data) == expected.stat().st_size and hashlib.sha256(data).hexdigest() == digest(expected),
            'Unknown-size NSIS resource differs from trusted resource')


def windows_gui(installed, root, evidence):
    """Select only the unique extracted GUI, accepting both reviewed formats."""
    binaries = [p for p in installed.rglob('*')
                if p.name.casefold() == 'chronoscope-desktop.exe' and p.is_file()]
    require(len(binaries) == 1, 'Extracted installer GUI missing/ambiguous')
    binary = binaries[0]
    gui_hash = digest(binary)
    require(gui_hash == evidence['gui_sha256'], 'Installer GUI differs from tested build GUI')
    portable = root / 'chronoscope-desktop.exe'
    if portable.exists():
        require(portable.is_file() and digest(portable) == gui_hash,
                'Installer/portable/tested GUI are not byte-identical')
    else:
        require(evidence.get('installer_gui_sha256') == gui_hash,
                'Installer-only GUI receipt hash mismatch')
    if 'installer_gui_sha256' in evidence:
        require(evidence['installer_gui_sha256'] == gui_hash, 'Installer GUI receipt hash mismatch')
    require(architecture(binary) == 'x86_64' and evidence['architecture'] == 'x86_64',
            'GUI architecture mismatch')
    return binary


def gui_launch(binary, temporary, env, receipt):
    hosted_guard('windows-x86_64' if os.name == 'nt' else 'macos-arm64')
    profile = temporary / 'isolated GUI profile'
    result = {'attempted': False, 'isolated_profile': True, 'real_device': False,
              'window_rendering_verified': False, 'interaction_tested': False,
              'startup_engine_ready': False, 'attached_mcp_query': False,
              'extent': 'launch-not-started',
              'limitations': 'Hosted desktop/privacy/WebView availability; no visual or interaction assertion.'}
    receipt['gui'] = result
    command([binary, '--data-dir', profile, 'agent', 'enable'], env=env)
    log = temporary / 'gui-private.log'
    with log.open('wb') as output:
        result['attempted'] = True
        process = subprocess.Popen([str(binary), '--data-dir', str(profile)], stdout=output,
                                   stderr=output, env=env, start_new_session=os.name != 'nt')
        result['extent'] = 'launch-attempt-only-not-GUI-pass'
        try:
            deadline = time.monotonic() + 45
            while time.monotonic() < deadline and process.poll() is None:
                try:
                    status = json.loads(command([binary, '--data-dir', profile, 'agent', 'status'], env=env, timeout=5))
                    if status.get('connected'):
                        result['startup_engine_ready'] = True
                        mcp_smoke(binary, profile, env)
                        result['attached_mcp_query'] = True
                        break
                except (ValueError, KeyError, subprocess.TimeoutExpired):
                    pass
                time.sleep(1)
            result['process_alive_at_end'] = process.poll() is None
            result['exit_code_before_cleanup'] = process.poll()
            result['extent'] = 'engine-ready-and-attached-MCP' if result['attached_mcp_query'] else 'launch-attempt-only-not-GUI-pass'
        finally:
            if os.name != 'nt':
                cleanup_posix_group(process)
            else:
                result['cleanup'] = cleanup_windows_process(process, env)
    # A missing desktop is recorded as incomplete, never silently green.
    return result['attached_mcp_query']


def validate(args, receipt):
    hosted_guard(args.platform)  # Before artifact access or app execution.
    require(re.fullmatch(r'[1-9][0-9]{0,19}', args.build_run_id), 'Invalid run ID')
    for value, length in ((args.build_sha, 40), (args.reviewed_validation_sha, 40), (args.expected_package_sha256, 64)):
        require(re.fullmatch('[0-9a-f]{' + str(length) + '}', value), 'Invalid reviewed digest')
    require(os.environ.get('GITHUB_SHA') == args.reviewed_validation_sha, 'Dispatch/validator revision mismatch')
    clean_env = {k: v for k, v in os.environ.items() if k not in ('GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN')}
    require(command(['git', '-C', ROOT, 'rev-parse', 'HEAD'], env=clean_env).strip() == args.reviewed_validation_sha, 'Validator checkout mismatch')
    require(command(['git', '-C', args.source_root, 'rev-parse', 'HEAD'], env=clean_env).strip() == args.build_sha, 'Build source checkout mismatch')
    require(not command(['git', '-C', args.source_root, 'status', '--porcelain'], env=clean_env).strip(), 'Build source checkout is dirty')
    require(not command(['git', '-C', ROOT, 'status', '--porcelain'], env=clean_env).strip(), 'Validator checkout is dirty')
    require(bool(os.environ.get('GH_TOKEN')), 'Missing read-only Actions token')
    token_env = dict(clean_env, GH_TOKEN=os.environ['GH_TOKEN'], GH_PROMPT_DISABLED='1')
    receipt.update(build_run_id=args.build_run_id, build_sha=args.build_sha,
                   reviewed_validation_sha=args.reviewed_validation_sha, target=args.platform,
                   host={'system': platform.system(), 'architecture': platform.machine(),
                         'runner_os': os.environ['RUNNER_OS'], 'image': os.environ.get('ImageOS'),
                         'image_version': os.environ.get('ImageVersion')}, real_device_tests=False)
    with tempfile.TemporaryDirectory(prefix='final-package-', dir=os.environ['RUNNER_TEMP']) as temp:
        temporary = Path(temp)
        download = fetch_artifact(args, temporary, token_env, receipt)
        suffix = '.zip' if args.platform == 'windows-x86_64' else '.tar.xz'
        package_name = f'chronoscope-{args.platform}{suffix}'
        require({p.name for p in download.iterdir()} == {package_name, f'VALIDATION-{args.platform}.json', f'SHA256SUMS-{args.platform}.txt'}, 'Unexpected artifact payload')
        package = download / package_name
        package_hash = digest(package)
        receipt['package'] = {'name': package_name, 'bytes': package.stat().st_size, 'sha256': package_hash}
        require(package_hash == args.expected_package_sha256, 'Independent expected package hash mismatch')
        evidence = json.loads((download / f'VALIDATION-{args.platform}.json').read_text())
        require(evidence['target'] == args.platform and evidence['commit'] == args.build_sha and
                evidence['package'] == package_name and evidence['package_sha256'] == package_hash and
                evidence['package_bytes'] == package.stat().st_size, 'Packager validation metadata mismatch')
        sums = (download / f'SHA256SUMS-{args.platform}.txt').read_text().splitlines()
        wanted = {package_name, f'VALIDATION-{args.platform}.json'}
        records = {}
        for line in sums:
            checksum, name = line.split('  ', 1)
            require(name in wanted and name not in records and checksum == digest(download / name), 'SHA256SUMS mismatch')
            records[name] = checksum
        require(set(records) == wanted, 'Incomplete SHA256SUMS')
        extracted = extract_archive(package, temporary / 'package')
        require([p.name for p in extracted.iterdir()] == ['Chronoscope'], 'Unexpected package root')
        root = extracted / 'Chronoscope'
        receipt['notices'] = [notices(root / 'third-party', args.source_root)]
        source_text = (root / 'SOURCE-ACCESS.txt').read_text()
        require('chronoscope-source.zip' in source_text and 'chronoscope-dependency-sources.tar.xz' in source_text, 'Missing source-access companion instructions')
        receipt['source_access'] = {'instructions_present': True, 'companion_archives_tested': False,
                                    'release_access_verified': False,
                                    'limit': 'Build artifact has no source companions; coordinator must verify exact companion archives and anonymous recipient access before publication.'}
        if args.platform == 'windows-x86_64':
            installers = [p for p in root.glob('*.exe') if p.name not in ('chronoscope-desktop.exe', 'chronoscope.exe')]
            require(len(installers) == 1, 'Expected one NSIS installer')
            tool = shutil.which('7z') or 'C:/Program Files/7-Zip/7z.exe'
            # Preflight installed 7-Zip listing before extraction of known-hash NSIS.
            listing = command([tool, 'l', '-slt', installers[0]])
            trusted_resources = {'third-party/' + p.relative_to(root / 'third-party').as_posix(): p
                                 for p in (root / 'third-party').rglob('*') if p.is_file()}
            # Newer 7-Zip versions also expose NSIS's generated uninstaller,
            # with no listed size. Measure only that literal member through a
            # capped pipe before any filesystem extraction. Never execute it.
            generated_uninstaller = None
            for block in listing.split('----------', 1)[-1].strip().split('\n\n'):
                fields = dict(line.split(' = ', 1) for line in block.splitlines() if ' = ' in line)
                if fields.get('Path') == 'uninstall.exe' and not fields.get('Size'):
                    require(generated_uninstaller is None and fields.get('Solid') == '+', 'Invalid NSIS uninstaller record')
                    data = nsis_read_stream(tool, installers[0], 'uninstall.exe', 16 * 1024 * 1024)
                    require(bool(data), 'Empty generated NSIS uninstaller')
                    generated_uninstaller = temporary / 'reviewed-uninstaller.exe'
                    generated_uninstaller.write_bytes(data)
                    trusted_resources['uninstall.exe'] = generated_uninstaller
                    receipt['generated_uninstaller'] = {'bytes': len(data), 'sha256': digest(generated_uninstaller), 'bounded_stream_verified': True}
            receipt['installer_payload_listing'] = nsis_listing(listing, {name: p.stat().st_size for name, p in trusted_resources.items()})
            for member in receipt['installer_payload_listing']:
                if member.get('requires_stream_check'):
                    nsis_resource_stream(tool, installers[0], member['path'], trusted_resources[member['path']])
                    member['trusted_resource_stream_verified'] = True
            installed = temporary / 'NSIS extracted'
            command([tool, 'x', '-y', '-o' + str(installed), installers[0]], timeout=90)
            if generated_uninstaller is not None:
                require((installed / 'uninstall.exe').is_file() and digest(installed / 'uninstall.exe') == digest(generated_uninstaller),
                        'Extracted NSIS uninstaller differs from bounded stream')
            binary = windows_gui(installed, root, evidence)
            manifests = list(installed.rglob('NOTICE-MANIFEST.json'))
            require(bool(manifests), 'Installer physical notices missing')
            receipt['notices'] += [notices(m.parent, args.source_root) for m in manifests]
            receipt['native_payloads'] = {'download': native_inventory(root, True), 'NSIS_extracted': native_inventory(installed, True)}
        else:
            apps = list(root.glob('*.app'))
            require(len(apps) == 1, 'Expected one bundled macOS app')
            app = apps[0]
            binary = app / 'Contents/MacOS/chronoscope-desktop'
            require(digest(binary) == evidence['gui_sha256'], 'Bundled GUI differs from tested build GUI')
            receipt['notices'].append(notices(app / 'Contents/Resources/third-party', args.source_root))
            command(['codesign', '--verify', '--deep', '--strict', app])
            metadata = app / 'Contents/Resources/Metadata.appintents'
            require(metadata.is_dir() and any(p.is_file() and p.stat().st_size > 0 for p in metadata.rglob('*')), 'App Intents metadata missing/empty')
            loads = command(['otool', '-l', binary])
            weak = []
            for block in loads.split('Load command ')[1:]:
                match = re.search(r'\bname (.+?) \(offset', block)
                if match and 'cmd LC_LOAD_WEAK_DYLIB' in block:
                    weak.append(match[1])
            for framework in ('AppIntents', '_AppIntents_AppKit'):
                require(any(f'/{framework}.framework/' in name for name in weak), f'{framework} is not weak linked')
            receipt['macos'] = {'codesign_verified': True, 'appintents_metadata_present': True, 'weak_dylibs': weak}
            receipt['native_payloads'] = native_inventory(root)
        expected = 'x86_64' if args.platform == 'windows-x86_64' else 'arm64'
        require(architecture(binary) == expected and evidence['architecture'] == expected, 'GUI architecture mismatch')
        receipt['executable'] = {'sha256': digest(binary), 'architecture': architecture(binary),
                                 'path': binary.relative_to(temporary).as_posix()}
        # Existing smoke runs the ACTUAL extracted GUI (never a source-tree build).
        receipt['desktop_cli_smoke'] = {'passed': False, 'windows_stdout_caveat': os.name == 'nt'}
        try:
            command([sys.executable, ROOT / 'scripts/test_desktop_cli.py', '--binary', binary], timeout=180, env=clean_env)
            receipt['desktop_cli_smoke']['passed'] = True
        except (ValueError, subprocess.TimeoutExpired) as error:
            receipt['desktop_cli_smoke']['failure'] = type(error).__name__
            receipt['desktop_cli_smoke']['limit'] = 'Failure is not a pass; Windows GUI-subsystem stdout may be unavailable. No separate console binary substituted.'
        try:
            attached = gui_launch(binary, temporary, clean_env, receipt)
        except (ValueError, subprocess.TimeoutExpired, OSError) as error:
            receipt.setdefault('gui', {})['failure'] = type(error).__name__
            attached = False
        receipt['status'] = 'passed-narrow' if attached and receipt['desktop_cli_smoke']['passed'] else 'incomplete-runtime-validation'
        receipt['publication_cleared'] = False
        return 0 if receipt['status'] == 'passed-narrow' else 2


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--build-run-id', required=True)
    parser.add_argument('--build-sha', required=True)
    parser.add_argument('--platform', choices=['windows-x86_64', 'macos-arm64'], required=True)
    parser.add_argument('--expected-package-sha256', required=True)
    parser.add_argument('--reviewed-validation-sha', required=True)
    parser.add_argument('--source-root', type=Path, required=True)
    args = parser.parse_args()
    receipt = {'format': 1, 'status': 'failed', 'publication_cleared': False}
    code = 1
    try:
        code = validate(args, receipt)
    except Exception as error:
        # Deliberately exclude arbitrary child output, tokens and connection files.
        receipt['failure'] = {'type': type(error).__name__, 'message': str(error)[:500] if isinstance(error, ValueError) else 'See failed gate; private subprocess output suppressed.'}
    finally:
        print('FINAL_PACKAGE_VALIDATION=' + json.dumps(receipt, sort_keys=True))
    return code


if __name__ == '__main__':
    sys.exit(main())
