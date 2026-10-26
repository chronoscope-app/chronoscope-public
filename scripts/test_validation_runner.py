#!/usr/bin/env python3
"""Regression coverage for selection, inventory, bounded execution and evidence."""
import os
import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest import mock
import validate_local
import source_checks
import validation_runtime
from validation_runtime import run_command, build_receipt, matches_build_receipt
from validation_suites import load_suites, select_browser
from source_checks import check_plan


class ValidationRunnerTests(unittest.TestCase):
    def setUp(self):
        self.manifest = load_suites()

    def test_fast_has_no_accidental_full_browser_run(self):
        self.assertEqual(select_browser(self.manifest, 'fast', False), [])
        self.assertEqual(set(select_browser(self.manifest, 'fast', True)), set(self.manifest['smoke']))

    def test_focused_selection_is_deduplicated_and_does_not_expand_to_full(self):
        selected = select_browser(self.manifest, 'fast', True, ['navigation', 'navigation-qa.mjs'], ['navigation'])
        self.assertEqual(set(selected), set(self.manifest['features']['navigation']['browser']))
        self.assertNotIn('chart-shortcuts-qa.mjs', selected)

    def test_full_retains_every_registered_browser_regression(self):
        self.assertEqual(select_browser(self.manifest, 'full', False), self.manifest['groups']['browser'])

    def test_unknown_or_path_like_selection_cannot_run_a_different_script(self):
        for value in ['../navigation', 'missing', '/tmp/navigation-qa.mjs']:
            with self.assertRaises(ValueError):
                select_browser(self.manifest, 'fast', False, [value])
        with self.assertRaises(ValueError):
            select_browser(self.manifest, 'fast', False, features=['missing'])

    def test_success_and_failure_logs_belong_to_this_invocation(self):
        with tempfile.TemporaryDirectory(prefix='validation paths with spaces ') as temporary:
            log = Path(temporary)/'output.log'
            log.write_text('old passed receipt')
            result = run_command([sys.executable, '-c', 'print("actual failure"); raise SystemExit(7)'], temporary, os.environ.copy(), log, 5)
            self.assertEqual(result['exit_code'], 7)
            self.assertFalse(result['timed_out'])
            self.assertEqual(log.read_text().strip(), 'actual failure')
            result = run_command([sys.executable, '-c', 'print("new success")'], temporary, os.environ.copy(), log, 5)
            self.assertEqual(result['exit_code'], 0)
            self.assertNotIn('failure', log.read_text())

    def test_timeout_also_stops_a_spawned_child(self):
        with tempfile.TemporaryDirectory() as temporary:
            marker = Path(temporary)/'orphan-wrote-after-timeout'
            child = f'import time; from pathlib import Path; time.sleep(2); Path({str(marker)!r}).write_text("orphan")'
            parent = f'import subprocess,sys,time; subprocess.Popen([sys.executable,"-c",{child!r}]); print("child started",flush=True); time.sleep(30)'
            result = run_command([sys.executable, '-c', parent], temporary, os.environ.copy(), Path(temporary)/'timeout.log', .6)
            self.assertEqual(result['exit_code'], 124)
            self.assertTrue(result['timed_out'])
            time.sleep(2.1)
            self.assertFalse(marker.exists(), 'Suite timeout left its child running')

    def test_missing_executable_is_a_recorded_failure(self):
        with tempfile.TemporaryDirectory() as temporary:
            result = run_command([str(Path(temporary)/'missing-binary')], temporary, os.environ.copy(), Path(temporary)/'missing.log', 2)
            self.assertEqual(result['exit_code'], 127)
            self.assertIn('FileNotFoundError', result['error'])
            self.assertNotIn(temporary, result['error'])
            self.assertIn('FileNotFoundError', (Path(temporary)/'missing.log').read_text())

    def test_reuse_rejects_changed_source_binary_frontend_and_stale_receipts(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            cli, frontend, receipt = [folder/name for name in ['cli', 'dist', 'receipt.json']]
            frontend.mkdir()
            (frontend/'index.html').write_bytes(b'current frontend')
            worker = frontend/'worker.js'
            worker.write_bytes(b'current worker')
            cli.write_bytes(b'current binary')
            receipt.write_text(json.dumps(build_receipt('source-a', cli, frontend)))
            self.assertTrue(matches_build_receipt(receipt, 'source-a', cli, frontend))
            self.assertFalse(matches_build_receipt(receipt, 'source-b', cli, frontend))
            cli.write_bytes(b'old binary')
            self.assertFalse(matches_build_receipt(receipt, 'source-a', cli, frontend))
            cli.write_bytes(b'current binary')
            # An unchanged index cannot make a stale worker bundle acceptable.
            worker.write_bytes(b'old worker')
            self.assertFalse(matches_build_receipt(receipt, 'source-a', cli, frontend))
            receipt.write_text('partial stale JSON')
            self.assertFalse(matches_build_receipt(receipt, 'source-a', cli, frontend))

    def test_dependency_patch_edits_invalidate_source_and_build_reuse(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name in ['Cargo.toml', 'Cargo.lock', 'build.rs',
                         'frontend/package-lock.json', 'frontend/package.json',
                         'frontend/vite.config.ts', 'frontend/tsconfig.json',
                         'frontend/index.html', 'frontend/scripts/prepare-cesium.mjs',
                         'assets/terrain/balanced.json']:
                path = root/name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('fixed build input')
            patch = root/'frontend/scripts/patches/terrain-picker.mjs'
            patch.parent.mkdir(parents=True)
            patch.write_text('reviewed patch version one')
            cli, frontend, receipt = root/'cli', root/'dist', root/'receipt.json'
            cli.write_bytes(b'current binary')
            frontend.mkdir()
            (frontend/'index.html').write_bytes(b'current frontend')
            with mock.patch.object(validate_local, 'ROOT', root):
                original = validate_local.source_digest()
                receipt.write_text(json.dumps(build_receipt(original, cli, frontend)))
                self.assertTrue(matches_build_receipt(receipt, original, cli, frontend))
                patch.write_text('reviewed patch version two')
                changed = validate_local.source_digest()
                self.assertNotEqual(original, changed)
                self.assertFalse(matches_build_receipt(receipt, changed, cli, frontend),
                                 'A dependency patch edit reused an older frontend')

    def test_release_cli_selects_the_optimized_binary_and_locked_build(self):
        debug, debug_path, debug_command = validate_local.cli_build_config(Path('target'))
        release, release_path, release_command = validate_local.cli_build_config(Path('target'), True)
        self.assertEqual((debug, release), ('debug', 'release'))
        self.assertEqual(debug_path.parent, Path('target/debug'))
        self.assertEqual(release_path.parent, Path('target/release'))
        self.assertNotIn('--release', debug_command)
        self.assertIn('--release', release_command)
        self.assertIn('--locked', release_command)

    def test_receipts_cannot_relabel_an_identical_binary_as_another_profile(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            cli, frontend, receipt = folder/'cli', folder/'dist', folder/'receipt.json'
            cli.write_bytes(b'the same bytes do not prove the build profile')
            frontend.mkdir()
            (frontend/'index.html').write_bytes(b'frontend')
            receipt.write_text(json.dumps(build_receipt('source', cli, frontend, 'debug')))
            self.assertTrue(matches_build_receipt(receipt, 'source', cli, frontend, 'debug'))
            self.assertFalse(matches_build_receipt(receipt, 'source', cli, frontend, 'release'))


    def test_shared_source_plan_covers_owned_python_checks_and_exact_contracts(self):
        plan = check_plan(self.manifest, ['playback_display', 'playback_display'], True)
        for group in ['unit', 'packaging']:
            self.assertEqual([Path(c['command'][-1]).name for c in plan[group]], self.manifest['python_suites'][group])
        self.assertEqual(plan['rust'][0]['command'].count('playback_display'), 1)
        self.assertEqual(plan['rust'][0]['command'][-2:], ['--', '--include-ignored'])
        self.assertIn('--check', plan['contracts'][0]['command'])
        names = [c['name'] for checks in plan.values() for c in checks]
        self.assertEqual(len(names), len(set(names)))


    def test_source_failure_keeps_exact_run_receipt_and_logs_without_echoing_output(self):
        with tempfile.TemporaryDirectory(prefix='source diagnostics ') as temporary:
            report = Path(temporary)/'report.json'
            for command, expected in [
                ([sys.executable, '-c', 'print("private fixture output"); raise SystemExit(7)'], 7),
                ([str(Path(temporary)/'missing-private-executable')], 127),
                ([sys.executable, '-c', 'print("new success")'], 0),
            ]:
                report.write_text('{"passed": true, "run_id": "stale"}')
                plan = {group: [] for group in ['unit', 'prebuild', 'rust', 'frontend']}
                plan['frontend'] = [{'name': 'frontend-unit-tests', 'command': command, 'timeout': 5}]
                stdout, stderr = io.StringIO(), io.StringIO()
                with mock.patch.object(sys, 'argv', ['source_checks.py', '--report', str(report)]), \
                     mock.patch.object(source_checks, 'check_plan', return_value=plan), \
                     contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                    self.assertEqual(source_checks.main(), int(expected != 0))
                result = json.loads(report.read_text())
                self.assertEqual(result['passed'], expected == 0)
                self.assertNotEqual(result['run_id'], 'stale')
                run = Path(result['evidence_directory'])
                self.assertEqual(json.loads((run/'run.json').read_text()), result)
                check = result['checks'][0]
                self.assertEqual(check['exit_code'], expected)
                log = Path(check['log'])
                self.assertEqual(log, run/'logs/frontend-unit-tests.log')
                self.assertTrue(log.is_file())
                self.assertNotIn('private fixture output', stdout.getvalue()+stderr.getvalue())
                if expected:
                    self.assertIn('FAILED frontend-unit-tests:', stderr.getvalue())
                    self.assertIn(str(report), stderr.getvalue())
                    self.assertIn(str(log), stderr.getvalue())
                if expected == 7:
                    self.assertIn('private fixture output', log.read_text())
                if expected == 127:
                    self.assertIn('FileNotFoundError', stderr.getvalue())
                    self.assertNotIn('missing-private-executable', stderr.getvalue())



class WindowsCommandTests(unittest.TestCase):
    """Logical Windows paths/mocked CreateProcess, not native Windows proof."""
    def setUp(self):
        self.env = {'PATH': r'C:\Other tools;"C:\Program Files\nodejs"', 'PATHEXT': '.EXE;.CMD;.BAT'}
        self.cwd = r'C:\checkout with spaces'

    def installation(self, directory, suffix='CMD'):
        return [directory+'\\npm.'+suffix, directory+'\\node.exe', directory+r'\node_modules\npm\bin\npm-cli.js']

    def prepare(self, command, files, env=None):
        with mock.patch.object(validation_runtime.os.path, 'isfile', side_effect=lambda p: p.casefold() in {f.casefold() for f in files}):
            return validation_runtime.prepare_command(command, self.cwd, self.env if env is None else env, windows=True)

    def test_bare_and_explicit_npm_cmd_bat_case_variants_keep_exact_literal_arguments(self):
        directory = r'C:\Program Files\nodejs'
        arguments = ['--prefix', 'frontend with spaces', 'test', '', '"quoted"', '%PATH%', '!NAME!', 'x&y|z<d>e^(f)', 'naïve λ', 'C:\\trailing dir\\']
        for name, suffix in [('npm', 'CMD'), ('npm.cmd', 'CMD'), ('NPM.BAT', 'BAT'), (directory+r'\npm.cmd', 'cmd')]:
            with self.subTest(name=name):
                command = [name, *arguments]
                original = command.copy()
                environment = self.env.copy()
                prepared = self.prepare(command, self.installation(directory, suffix))
                self.assertEqual(prepared, [directory+r'\node.exe', directory+r'\node_modules\npm\bin\npm-cli.js', *arguments])
                self.assertEqual(command, original)
                self.assertEqual(self.env, environment)

    def test_pathext_and_path_order_use_child_environment(self):
        first, second = r'C:\Other tools', r'C:\Program Files\nodejs'
        files = self.installation(first, 'BAT') + [first+r'\npm.EXE'] + self.installation(second)
        self.assertEqual(self.prepare(['npm'], files, {**self.env, 'PATHEXT': '.BAT;.EXE'}),
                         [first+r'\node.exe', first+r'\node_modules\npm\bin\npm-cli.js'])
        self.assertEqual(self.prepare(['npm'], files, {**self.env, 'PATHEXT': '.EXE;.BAT'}), [first+r'\npm.EXE'])
        self.assertEqual(self.prepare(['npm'], files, {'Path': second, 'PathExt': '.CMD'}),
                         [second+r'\node.exe', second+r'\node_modules\npm\bin\npm-cli.js'])

    def test_relative_paths_resolve_against_child_cwd_not_parent(self):
        directory = self.cwd+r'\tools'
        files = self.installation(directory)
        expected = [directory+r'\node.exe', directory+r'\node_modules\npm\bin\npm-cli.js', 'test']
        self.assertEqual(self.prepare([r'tools\npm.cmd', 'test'], files), expected)
        self.assertEqual(self.prepare(['npm', 'test'], files, {'PATH': 'tools', 'PATHEXT': '.CMD'}), expected)

    def test_native_executable_and_posix_arguments_are_unchanged(self):
        command = ['cargo', 'build', 'literal & text', '%PATH%', '"quoted"', '', 'trailing\\']
        self.assertEqual(self.prepare(command, [r'C:\Other tools\cargo.EXE']), [r'C:\Other tools\cargo.EXE', *command[1:]])
        with mock.patch.object(validation_runtime.os.path, 'isfile') as lookup:
            self.assertEqual(validation_runtime.prepare_command(command, '/tmp', {}, windows=False), command)
        lookup.assert_not_called()

    def test_missing_executable_and_incomplete_npm_do_not_select_another_installation(self):
        first, second = r'C:\Other tools', r'C:\Program Files\nodejs'
        with self.assertRaises(FileNotFoundError):
            self.prepare(['npm'], self.installation(self.cwd), {**self.env, 'PATH': ''})
        with self.assertRaises(FileNotFoundError):
            self.prepare(['missing'], [])
        for missing in [1, 2]:
            incomplete = self.installation(first)
            del incomplete[missing]
            with self.subTest(missing=missing), self.assertRaisesRegex(validation_runtime.CommandPreparationError, 'requires sibling'):
                self.prepare(['npm'], incomplete+self.installation(second))
        with self.assertRaisesRegex(validation_runtime.CommandPreparationError, 'Unsupported batch launcher'):
            self.prepare(['custom.cmd'], [first+r'\custom.cmd'])

    def test_windows_popen_gets_native_argv_and_owned_process_flags(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = r'C:\Other tools'
            files = {p.casefold() for p in self.installation(directory)}
            windows_os = mock.Mock()
            windows_os.name = 'nt'
            windows_os.path.isfile.side_effect = lambda p: p.casefold() in files
            child = mock.Mock()
            child.wait.return_value = 7
            arguments = ['--prefix', 'frontend with spaces', 'test', '%PATH%', '"& literal"']
            with mock.patch.object(sys, 'platform', 'win32'), \
                 mock.patch.object(validation_runtime, 'os', windows_os), \
                 mock.patch.object(validation_runtime.subprocess, 'CREATE_NEW_PROCESS_GROUP', 512, create=True), \
                 mock.patch.object(validation_runtime.subprocess, 'Popen', return_value=child) as launch, \
                 mock.patch.object(validation_runtime, 'stop_tree') as stop:
                result = run_command(['npm', *arguments], self.cwd, self.env, Path(temporary)/'suite.log', 9)
            self.assertEqual(result['exit_code'], 7)
            args, kwargs = launch.call_args
            self.assertEqual(args, ([directory+r'\node.exe', directory+r'\node_modules\npm\bin\npm-cli.js', *arguments],))
            self.assertEqual(kwargs['creationflags'], 512)
            self.assertFalse(kwargs['start_new_session'])
            self.assertNotIn('shell', kwargs)
            self.assertEqual(kwargs['cwd'], self.cwd)
            self.assertEqual(kwargs['env'], self.env)
            self.assertEqual(kwargs['stderr'], validation_runtime.subprocess.STDOUT)
            stop.assert_called_once_with(child)
            child.wait.assert_any_call(timeout=9)
            child.wait.assert_any_call(timeout=10)

    def test_missing_windows_launcher_is_logged_without_launching(self):
        with tempfile.TemporaryDirectory() as temporary:
            with mock.patch.object(sys, 'platform', 'win32'), \
                 mock.patch.object(validation_runtime.os.path, 'isfile', return_value=False), \
                 mock.patch.object(validation_runtime.subprocess, 'Popen') as launch:
                log = Path(temporary)/'failure.log'
                result = run_command(['npm'], self.cwd, self.env, log, 2)
            self.assertEqual(result['exit_code'], 127)
            self.assertIn('FileNotFoundError', result['error'])
            self.assertNotIn(self.cwd, log.read_text())
            launch.assert_not_called()


if __name__ == '__main__':
    unittest.main()
