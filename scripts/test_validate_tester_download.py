#!/usr/bin/env python3
"""Offline inert archives and mocked processes only; never launch native apps."""
import io
import os
from pathlib import Path
import stat
import tarfile
import tempfile
import unittest
from unittest.mock import Mock, patch
import zipfile

import validate_tester_download as validator


class ValidatorTests(unittest.TestCase):
    def test_current_notice_count_is_exact_and_not_optional(self):
        manifest = {'files': [{} for _ in range(1499)]}
        sdk = {'retained_original_files': []}
        with (patch.object(validator, 'verify_notices', return_value=manifest),
              patch.object(validator, 'digest', return_value='fixture'),
              patch.object(Path, 'read_text', return_value=validator.json.dumps(sdk))):
            self.assertEqual(validator.notices(Path('notices'), Path('source'))['files'], 1499)
            for count in (1498, 1500):
                manifest['files'] = [{} for _ in range(count)]
                with self.subTest(count=count), self.assertRaisesRegex(ValueError, 'notice count'):
                    validator.notices(Path('notices'), Path('source'))

    def windows_fixture(self, *, portable=False, machine=0x8664):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        base = Path(temporary.name)
        root, installed = base / 'download', base / 'extracted'
        root.mkdir()
        installed.mkdir()
        # Inert PE header only: no executable sections, never executed.
        data = bytearray(128)
        data[:2] = b'MZ'
        validator.struct.pack_into('<I', data, 0x3c, 64)
        data[64:68] = b'PE\0\0'
        validator.struct.pack_into('<H', data, 68, machine)
        binary = installed / 'chronoscope-desktop.exe'
        binary.write_bytes(data)
        if portable:
            (root / binary.name).write_bytes(data)
            (root / 'chronoscope.exe').write_bytes(b'inert separate console, never select')
        gui_hash = validator.digest(binary)
        evidence = {'gui_sha256': gui_hash, 'installer_gui_sha256': gui_hash,
                    'architecture': 'x86_64'}
        return root, installed, binary, evidence

    def test_windows_installer_only_success(self):
        root, installed, binary, evidence = self.windows_fixture()
        with patch.object(validator.subprocess, 'Popen') as popen, patch.object(validator, 'command') as command:
            self.assertEqual(validator.windows_gui(installed, root, evidence), binary)
            command.assert_not_called()
            popen.assert_not_called()

    def test_windows_installer_only_hash_mismatches(self):
        for field in ('gui_sha256', 'installer_gui_sha256'):
            with self.subTest(field=field):
                root, installed, _, evidence = self.windows_fixture()
                evidence[field] = '0' * 64
                with self.assertRaisesRegex(ValueError, 'GUI'):
                    validator.windows_gui(installed, root, evidence)

    def test_windows_installer_only_requires_installer_hash(self):
        root, installed, _, evidence = self.windows_fixture()
        del evidence['installer_gui_sha256']
        with self.assertRaisesRegex(ValueError, 'receipt hash'):
            validator.windows_gui(installed, root, evidence)

    def test_windows_original_portable_optional_receipt(self):
        root, installed, binary, evidence = self.windows_fixture(portable=True)
        del evidence['installer_gui_sha256']  # Original portable+CLI+installer format.
        self.assertEqual(validator.windows_gui(installed, root, evidence), binary)
        self.assertNotEqual(binary, root / binary.name)

    def test_windows_portable_hash_mismatch(self):
        root, installed, binary, evidence = self.windows_fixture(portable=True)
        (root / binary.name).write_bytes(b'inert wrong GUI')
        with self.assertRaisesRegex(ValueError, 'byte-identical'):
            validator.windows_gui(installed, root, evidence)

    def test_windows_portable_does_not_waive_installer_receipt(self):
        root, installed, _, evidence = self.windows_fixture(portable=True)
        evidence['installer_gui_sha256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'receipt hash'):
            validator.windows_gui(installed, root, evidence)

    def test_windows_ambiguous_or_missing_installer_gui(self):
        root, installed, binary, evidence = self.windows_fixture()
        duplicate = installed / 'duplicate'
        duplicate.mkdir()
        other = duplicate / binary.name.upper()
        other.write_bytes(binary.read_bytes())
        with self.assertRaisesRegex(ValueError, 'missing/ambiguous'):
            validator.windows_gui(installed, root, evidence)
        binary.unlink()
        other.unlink()
        with self.assertRaisesRegex(ValueError, 'missing/ambiguous'):
            validator.windows_gui(installed, root, evidence)

    def test_windows_mixed_architecture_rejected(self):
        for machine, claimed in ((0xaa64, 'x86_64'), (0x8664, 'arm64')):
            with self.subTest(machine=machine, claimed=claimed):
                root, installed, _, evidence = self.windows_fixture(machine=machine)
                evidence['architecture'] = claimed
                with self.assertRaisesRegex(ValueError, 'architecture'):
                    validator.windows_gui(installed, root, evidence)

    def test_nsis_listing_roundtrip_and_directory(self):
        listing = 'archive header\n----------\nPath = folder\nFolder = +\nSize = 0\n\nPath = folder\\child\nSize = 7\n'
        self.assertEqual(validator.nsis_listing(listing),
                         [{'path': 'folder', 'bytes': 0}, {'path': 'folder/child', 'bytes': 7}])

    def test_nsis_unknown_solid_size_requires_trusted_resource(self):
        listing = '----------\nPath = third-party/last.txt\nSize = \nSolid = +\nAttributes = A'
        with self.assertRaisesRegex(ValueError, 'trusted size'):
            validator.nsis_listing(listing)
        self.assertEqual(validator.nsis_listing(listing, {'third-party/last.txt': 17}),
                         [{'path': 'third-party/last.txt', 'bytes': 17, 'requires_stream_check': True}])
        with self.assertRaisesRegex(ValueError, 'trusted size'):
            validator.nsis_listing(listing.replace('Solid = +', 'Solid = -'), {'third-party/last.txt': 17})
        with patch.object(validator, 'MAX_EXPANDED', 10), self.assertRaisesRegex(ValueError, 'expansion'):
            validator.nsis_listing(listing, {'third-party/last.txt': 17})
        self.assertEqual(validator.nsis_listing('----------\nPath = folder\nFolder = +\nSize = '),
                         [{'path': 'folder', 'bytes': 0}])

    def test_nsis_resource_stream_bounded_and_hash_checked(self):
        with tempfile.TemporaryDirectory() as temporary:
            expected = Path(temporary) / 'expected.txt'
            expected.write_bytes(b'trusted')
            for content in (b'trusted', b'changed', b'trusted-plus-one'):
                process = Mock(stdout=io.BytesIO(content))
                process.wait.return_value = 0
                process.poll.return_value = 0
                with self.subTest(content=content), patch.object(validator.subprocess, 'Popen', return_value=process):
                    if content == b'trusted':
                        validator.nsis_resource_stream('7z', 'installer', 'member', expected)
                    else:
                        with self.assertRaises(ValueError):
                            validator.nsis_resource_stream('7z', 'installer', 'member', expected)

    def test_nsis_stream_cap_and_failure_are_rejected(self):
        for content, status in ((b'oversize', 0), (b'ok', 2)):
            process = Mock(stdout=io.BytesIO(content))
            process.wait.return_value = status
            process.poll.return_value = 0
            with self.subTest(content=content), patch.object(validator.subprocess, 'Popen', return_value=process):
                with self.assertRaises(ValueError):
                    validator.nsis_read_stream('7z', 'installer', 'uninstall.exe', 2)

    def test_gui_launch_uses_environment_profile_and_no_cli_arguments(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            process = Mock()
            process.poll.return_value = None
            receipt = {}
            with patch.object(validator, 'hosted_guard'), \
                 patch.object(validator, 'command', return_value='{"connected":true}'), \
                 patch.object(validator, 'mcp_smoke') as smoke, \
                 patch.object(validator, 'cleanup_posix_group'), \
                 patch.object(validator, 'cleanup_windows_process'), \
                 patch.object(validator.subprocess, 'Popen', return_value=process) as launch:
                self.assertTrue(validator.gui_launch(base / 'desktop', base, {}, receipt))
            self.assertEqual(launch.call_args.args[0], [str(base / 'desktop')])
            self.assertEqual(launch.call_args.kwargs['env']['CHRONOSCOPE_DATA_DIR'],
                             str((base / 'isolated GUI profile').resolve()))
            self.assertTrue(receipt['gui']['attached_mcp_query'])
            smoke.assert_called_once()

    def test_nsis_file_parent_collision_both_orders(self):
        for entries in [('FILE', 'file/child'), ('file/child', 'FILE')]:
            listing = '----------\n' + '\n\n'.join('Path = ' + name + '\nSize = 1' for name in entries)
            with self.subTest(entries=entries), self.assertRaisesRegex(ValueError, 'collision'):
                validator.nsis_listing(listing)

    def test_nsis_negative_member_not_hidden_by_aggregate(self):
        listing = '----------\nPath = good\nSize = 10\n\nPath = bad\nSize = -1'
        with self.assertRaisesRegex(ValueError, 'member expansion'):
            validator.nsis_listing(listing)

    def test_nsis_member_and_total_expansion_bounds(self):
        with patch.object(validator, 'MAX_EXPANDED', 10):
            for sizes in ((11,), (6, 6)):
                listing = '----------\n' + '\n\n'.join(f'Path = file{i}\nSize = {size}' for i, size in enumerate(sizes))
                with self.subTest(sizes=sizes), self.assertRaisesRegex(ValueError, 'expansion'):
                    validator.nsis_listing(listing)

    def test_nsis_bad_paths_duplicates_links(self):
        for listing in ('----------\nPath = ../bad\nSize = 1',
                        '----------\nPath = file\nSize = 1\n\nPath = FILE\nSize = 1',
                        '----------\nPath = file\nSize = 1\nSymbolic Link = target'):
            with self.subTest(listing=listing), self.assertRaises(ValueError):
                validator.nsis_listing(listing)

    def test_windows_cleanup_reports_bounded_task_owned_attempt(self):
        process = Mock(pid=424242)
        process.poll.return_value = None
        with patch.object(validator.subprocess, 'run', return_value=Mock(returncode=0)) as run:
            result = validator.cleanup_windows_process(process, {})
        self.assertEqual(run.call_args.args[0], ['taskkill', '/PID', '424242', '/T', '/F'])
        self.assertEqual(run.call_args.kwargs['timeout'], 15)
        self.assertTrue(result['taskkill_attempted'])
        self.assertTrue(result['leader_reaped'])
        self.assertFalse(result['orphan_tree_verified'])
        process.wait.assert_called_once_with(timeout=8)
        process.kill.assert_not_called()

    def test_windows_cleanup_timeout_parent_fallback(self):
        process = Mock(pid=424242)
        process.poll.return_value = None
        process.wait.side_effect = [validator.subprocess.TimeoutExpired('fixture', 8), 0]
        with patch.object(validator.subprocess, 'run', side_effect=validator.subprocess.TimeoutExpired('fixture', 15)):
            result = validator.cleanup_windows_process(process, {})
        self.assertTrue(result['parent_kill_fallback'])
        self.assertEqual(result['taskkill_failure'], 'TimeoutExpired')
        self.assertFalse(result['orphan_tree_verified'])
        process.kill.assert_called_once_with()
        self.assertEqual([c.kwargs for c in process.wait.call_args_list], [{'timeout': 8}, {'timeout': 5}])

    def test_windows_cleanup_exited_leader_no_reused_pid_kill(self):
        process = Mock(pid=424242)
        process.poll.return_value = 0
        with patch.object(validator.subprocess, 'run') as run:
            result = validator.cleanup_windows_process(process, {})
        run.assert_not_called()
        process.kill.assert_not_called()
        process.wait.assert_called_once_with(timeout=5)
        self.assertFalse(result['taskkill_attempted'])
        self.assertFalse(result['orphan_tree_verified'])

    def test_posix_cleanup_after_leader_exit(self):
        import signal
        process = Mock(pid=424242)
        process.wait.return_value = 0
        with patch.object(signal, 'SIGKILL', 9, create=True), patch.object(validator.os, 'killpg', create=True) as killpg:
            validator.cleanup_posix_group(process)
        self.assertEqual([c.args for c in killpg.call_args_list],
                         [(424242, signal.SIGTERM), (424242, 9)])
        process.kill.assert_not_called()

    def test_posix_cleanup_escalates_surviving_group(self):
        import signal
        process = Mock(pid=424242)
        process.wait.side_effect = [validator.subprocess.TimeoutExpired('fixture', 8), 0]
        with patch.object(signal, 'SIGKILL', 9, create=True), patch.object(validator.os, 'killpg', create=True) as killpg:
            validator.cleanup_posix_group(process)
        self.assertEqual([c.args for c in killpg.call_args_list],
                         [(424242, signal.SIGTERM), (424242, 9)])
        process.kill.assert_not_called()

    def test_posix_cleanup_absent_group_is_harmless(self):
        process = Mock(pid=424242)
        with patch.object(validator.os, 'killpg', side_effect=ProcessLookupError, create=True):
            validator.cleanup_posix_group(process)
        process.wait.assert_called_once_with(timeout=5)

    def test_host_refusal_precedes_any_command(self):
        from types import SimpleNamespace
        with patch.dict(os.environ, {}, clear=True), patch.object(validator, 'command') as command:
            with self.assertRaisesRegex(ValueError, 'GitHub-hosted'):
                validator.validate(SimpleNamespace(platform='windows-x86_64'), {})
            command.assert_not_called()

    def test_host_os_not_just_environment(self):
        env = dict(GITHUB_ACTIONS='true', RUNNER_ENVIRONMENT='github-hosted',
                   GITHUB_REPOSITORY=validator.REPO, GITHUB_EVENT_NAME='workflow_dispatch',
                   GITHUB_REF='refs/heads/main', RUNNER_OS='Windows', RUNNER_ARCH='X64', RUNNER_TEMP='/tmp')
        with patch.dict(os.environ, env, clear=True), patch.object(validator.platform, 'system', return_value='Linux'):
            with self.assertRaisesRegex(ValueError, 'Host OS'):
                validator.hosted_guard('windows-x86_64')

    def test_bad_paths(self):
        for name in ('../x', '/x', 'C:/x', 'x\\y', 'x/../y', './x', 'x//y', 'NUL.txt', 'x./y', 'x /y', 'x\x00'):
            with self.subTest(name=name), self.assertRaises(ValueError):
                validator.safe_member(name)

    def zip_fixture(self, records, expected_error=None):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            archive = root / 'fixture.zip'
            with zipfile.ZipFile(archive, 'w') as out:
                for name, data in records:
                    out.writestr(name, data)
            if expected_error:
                with self.assertRaisesRegex(ValueError, expected_error):
                    validator.extract_archive(archive, root / 'output')
            else:
                validator.extract_archive(archive, root / 'output')
                self.assertEqual((root / 'output/Chronoscope/a.txt').read_bytes(), b'fixture')

    def test_zip_roundtrip(self):
        self.zip_fixture([('Chronoscope/', b''), ('Chronoscope/a.txt', b'fixture')])

    def test_zip_traversal(self):
        self.zip_fixture([('../escape', b'x')], 'Unsafe')

    def test_zip_case_collision(self):
        self.zip_fixture([('file', b'x'), ('FILE', b'y')], 'case-colliding')

    def test_zip_file_parent(self):
        self.zip_fixture([('file', b'x'), ('file/child', b'y')], 'collision')

    def test_zip_link(self):
        info = zipfile.ZipInfo('link')
        info.create_system = 3
        info.external_attr = (stat.S_IFLNK | 0o777) << 16
        self.zip_fixture([(info, b'../escape')], 'links/special')

    def test_zip_expansion(self):
        with patch.object(validator, 'MAX_EXPANDED', 1):
            self.zip_fixture([('file', b'too big')], 'expansion')

    def test_tar_executable_roundtrip(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            archive = root / 'fixture.tar.xz'
            with tarfile.open(archive, 'w:xz') as out:
                item = tarfile.TarInfo('Chronoscope/app')
                item.mode = 0o755
                item.size = 7
                out.addfile(item, io.BytesIO(b'fixture'))
            with tarfile.open(archive, 'r:xz') as source:
                self.assertEqual(source.getmember('Chronoscope/app').mode, 0o755)
            chmod = Path.chmod
            with patch.object(Path, 'chmod', autospec=True, side_effect=chmod) as apply_mode:
                validator.extract_archive(archive, root / 'output')
            extracted = root / 'output/Chronoscope/app'
            self.assertEqual(extracted.read_bytes(), b'fixture')
            if os.name == 'nt':
                # Windows has no Unix executable-bit contract; do not chmod it.
                apply_mode.assert_not_called()
            else:
                apply_mode.assert_called_once_with(extracted, 0o755)
                self.assertTrue(extracted.stat().st_mode & 0o111)

    def test_tar_windows_extraction_does_not_apply_posix_permissions(self):
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            archive = root / 'fixture.tar.xz'
            with tarfile.open(archive, 'w:xz') as out:
                item = tarfile.TarInfo('Chronoscope/app')
                item.mode = 0o755
                item.size = 7
                out.addfile(item, io.BytesIO(b'fixture'))
            # Replace only the extractor's OS view, not pathlib's host platform.
            with patch.object(validator, 'os', SimpleNamespace(name='nt')),                     patch.object(Path, 'chmod', autospec=True) as apply_mode:
                validator.extract_archive(archive, root / 'output')
            self.assertEqual((root / 'output/Chronoscope/app').read_bytes(), b'fixture')
            apply_mode.assert_not_called()

    def test_tar_link(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            archive = root / 'fixture.tar.xz'
            with tarfile.open(archive, 'w:xz') as out:
                item = tarfile.TarInfo('link')
                item.type = tarfile.SYMTYPE
                item.linkname = '../escape'
                out.addfile(item)
            with self.assertRaisesRegex(ValueError, 'links/special'):
                validator.extract_archive(archive, root / 'output')

    def test_generic_children_do_not_receive_actions_token(self):
        from types import SimpleNamespace
        with patch.dict(os.environ, {'GH_TOKEN': 'fixture-not-a-token', 'GITHUB_TOKEN': 'fixture'}), patch.object(validator.subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout='ok')) as run:
            self.assertEqual(validator.command(['inert-tool']), 'ok')
            self.assertNotIn('GH_TOKEN', run.call_args.kwargs['env'])
            self.assertNotIn('GITHUB_TOKEN', run.call_args.kwargs['env'])

    def test_wrong_run_refused_before_download(self):
        from types import SimpleNamespace
        run = dict(repository={'full_name': validator.REPO}, head_repository={'full_name': validator.REPO},
                   head_sha='a' * 40, head_branch='main', path='.github/workflows/build.yml',
                   event='workflow_dispatch', status='completed', conclusion='failure')
        with patch.object(validator, 'gh_json', return_value=run), patch.object(validator.subprocess, 'Popen') as popen:
            with self.assertRaisesRegex(ValueError, 'provenance/status'):
                validator.fetch_artifact(SimpleNamespace(build_run_id='123', build_sha='a' * 40), Path('/unused'), {}, {})
            popen.assert_not_called()


if __name__ == '__main__':
    unittest.main()
