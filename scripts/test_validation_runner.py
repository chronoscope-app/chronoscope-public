#!/usr/bin/env python3
"""Regression coverage for selection, inventory, bounded execution and evidence."""
import os
import json
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest import mock
import validate_local
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


if __name__ == '__main__':
    unittest.main()
