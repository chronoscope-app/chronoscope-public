import tempfile
#!/usr/bin/env python3
"""Fast offline source/fixture regressions; no native app or network."""
import importlib.util
import json
from pathlib import Path
import unittest
from unittest import mock
import zipfile

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("portable", ROOT/"scripts/build_portable.py")
portable = importlib.util.module_from_spec(spec)
spec.loader.exec_module(portable)

class PublicationCleanup(unittest.TestCase):
    def test_existing_effective_flags_survive(self):
        fixtures = [
            ({"RUSTFLAGS": r"-L C:\sdk\lib -C link-arg=C:\sdk\foo.lib"}, ["-L", r"C:\sdk\lib", "-C", r"link-arg=C:\sdk\foo.lib"]),
            ({"RUSTFLAGS": '-C "link-arg=path with spaces"'}, ["-C", '"link-arg=path', "with", 'spaces"']),
            ({"CARGO_ENCODED_RUSTFLAGS": "-C\x1f" + r"link-arg=C:\sdk folder\foo.lib", "RUSTFLAGS": "ignored"}, ["-C", r"link-arg=C:\sdk folder\foo.lib"]),
            ({"RUSTFLAGS": "  -C\ttarget-cpu=native\n"}, ["-C", "target-cpu=native"]),
            ({"CARGO_ENCODED_RUSTFLAGS": "-L\x1f\x1frelative"}, ["-L", "", "relative"]),
            ({"CARGO_ENCODED_RUSTFLAGS": "", "RUSTFLAGS": "ignored"}, []),
        ]
        for env, expected in fixtures:
            result = portable.build_environment(env)
            flags = result["CARGO_ENCODED_RUSTFLAGS"].split("\x1f")
            self.assertEqual(flags[:len(expected)], expected)
            self.assertEqual(len([f for f in flags if f.startswith("--remap-path-prefix=")]), 3)
            self.assertNotIn("RUSTFLAGS", result)
            self.assertTrue(flags[-1].endswith("=/chronoscope"))
            self.assertTrue(flags[-2].endswith("=/cargo"))
            self.assertTrue(flags[-3].endswith("=/build-home"))

    def test_windows_npm_launcher_uses_shared_native_argv_and_preserves_environment(self):
        command = ['npm', '--prefix', 'frontend', 'run', 'tauri', '--', 'build', '--', '--locked']
        environment = portable.build_environment({'PATH': r'C:\Program Files\nodejs',
            'CARGO_ENCODED_RUSTFLAGS': '-C\x1f' + r'link-arg=C:\sdk folder\foo.lib'})
        prepared = [r'C:\Program Files\nodejs\node.exe', r'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js', *command[1:]]
        with mock.patch.object(portable, 'prepare_command', return_value=prepared) as prepare, \
             mock.patch.object(portable.subprocess, 'run', return_value=mock.Mock(returncode=7)) as run:
            self.assertEqual(portable.run_command(command, environment), 7)
        prepare.assert_called_once_with(command, portable.root, environment)
        run.assert_called_once_with(prepared, cwd=portable.root, env=environment)
        self.assertEqual(command[0], 'npm')
        self.assertTrue(environment['CARGO_ENCODED_RUSTFLAGS'].startswith('-C\x1f' + r'link-arg=C:\sdk folder\foo.lib' + '\x1f'))

    def test_windows_cargo_launcher_preserves_locked_flags(self):
        command = ['cargo', 'build', '--locked', '--release', '-p', 'chronoscope']
        prepared = [r'C:\Rust tools\cargo.exe', *command[1:]]
        with mock.patch.object(portable, 'prepare_command', return_value=prepared) as prepare, \
             mock.patch.object(portable.subprocess, 'run', return_value=mock.Mock(returncode=0)) as run:
            self.assertEqual(portable.run_command(command, {}), 0)
        prepare.assert_called_once_with(command, portable.root, {})
        run.assert_called_once_with(prepared, cwd=portable.root, env={})

    def test_missing_windows_launcher_fails_before_subprocess(self):
        with mock.patch.object(portable, 'prepare_command', side_effect=FileNotFoundError), \
             mock.patch.object(portable.subprocess, 'run') as run:
            with self.assertRaises(FileNotFoundError):
                portable.run_command(['npm', 'run', 'build'], {'PATH': ''})
        run.assert_not_called()

    def test_posix_launcher_and_literal_arguments_are_unchanged(self):
        command = ['./tool with spaces', '--locked', 'literal & text', '%PATH%', '"quoted"']
        for platform in ['linux', 'darwin']:
            with self.subTest(platform=platform), \
                 mock.patch.object(portable.sys, 'platform', platform), \
                 mock.patch.object(portable.subprocess, 'run', return_value=mock.Mock(returncode=0)) as run:
                self.assertEqual(portable.run_command(command, {}), 0)
                run.assert_called_once_with(command, cwd=portable.root, env={})

    def test_jobs_only_workspace_config_does_not_block_portable_builds(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            config = root/'.cargo/config.toml'
            config.parent.mkdir()
            environment = {'CARGO_HOME': str(root/'private-cargo')}
            with mock.patch.object(portable, 'root', root), mock.patch.object(portable.Path, 'home', return_value=root/'home'):
                config.write_text('# Safe local worker limit\n[build]\njobs = 1\n')
                self.assertFalse(portable.configured_flags_required(environment, ['cargo', 'build', '--locked']))
                config.write_text('[build]\njobs = 1\nrustflags = ["-C", "target-cpu=native"]\n')
                self.assertTrue(portable.configured_flags_required(environment, ['cargo', 'build']))
                config.write_text('[build]\njobs = 1\n')
                self.assertTrue(portable.configured_flags_required(environment, ['cargo', '--config=custom.toml']))
                self.assertTrue(portable.configured_flags_required({**environment, 'CARGO_TARGET_AARCH64_APPLE_DARWIN_RUSTFLAGS': '-C target-cpu=native'}, ['cargo', 'build']))
                self.assertFalse(portable.configured_flags_required({**environment, 'CARGO_ENCODED_RUSTFLAGS': ''}, ['cargo', 'build']))

    def test_sample_credit_and_records(self):
        with zipfile.ZipFile(ROOT/"samples/animal-gps-black-rock-forest-2023-03.chronoscope") as archive:
            project = json.loads(archive.read("manifest.json"))
        credit = json.loads((ROOT/"samples/public/animal-gps-black-rock-forest-2023-03.csv.attribution.json").read_text())
        self.assertEqual(project["provenance"], credit)
        self.assertEqual(len(project["dataset"]["events"]), 3439)
        self.assertEqual(credit[0]["license"], "CC BY 4.0")

    def test_media_ledger_paths_and_current_object_hashes(self):
        import subprocess
        rows = json.loads((ROOT/"docs/MEDIA-RIGHTS.json").read_text())["rows"]
        self.assertGreaterEqual(len(rows), 257) # historical records remain evidence
        current = 0
        for row in rows:
            if row["current_path"]:
                self.assertTrue((ROOT/row["path"]).is_file(), row["path"])
            if row["current_blob"]:
                current += 1
                actual = subprocess.check_output(["git", "hash-object", "--", row["path"]], cwd=ROOT, text=True).strip()
                self.assertEqual(actual, row["oid"], row["path"])
        self.assertGreater(current, 20)
        for row in rows:
            if row["current_blob"]:
                self.assertNotIn("remaining_gap", row, row["path"])
                self.assertNotIn("NC-SA", row["license"], row["path"])
        self.assertFalse((ROOT/"frontend/src/assets/earth-blue-marble.jpg").exists())
        self.assertFalse((ROOT/"tests/fixtures/terrain/n43.dt0").exists())
        icons = [r for r in rows if r["path"] == "src-tauri/icons/128x128@2x.png"]
        self.assertEqual(len(icons), 4)

    def test_desktop_smoke_matches_empty_startup(self):
        text = (ROOT/"scripts/test_desktop_cli.py").read_text()
        self.assertIn("['count'] == 0", text)
        self.assertNotIn("== 192", text)

    def test_offline_graph_has_locked_cross_platform_prefetch(self):
        import re
        workflow = (ROOT/".github/workflows/build.yml").read_text()
        prefetch = re.search(
            r"(?ms)^      - name: Prefetch locked Cargo dependencies\n(.*?)(?=^      - )",
            workflow)
        self.assertIsNotNone(prefetch, "Cold runners need Cargo dependencies before offline guards")
        # Unconditional, fail-closed, root workspace; no --target restriction:
        # the Linux GLib graph must also resolve on Windows/macOS hosts.
        self.assertEqual(prefetch.group(1).strip(),
                         "run: cargo fetch --locked --manifest-path Cargo.toml")
        static = workflow.index("      - name: Shared source verification\n")
        self.assertLess(prefetch.start(), static)
        self.assertIn("python -B scripts/source_checks.py --packaging", workflow[static:])
        from source_checks import check_plan
        from validation_suites import load_suites
        shared = check_plan(load_suites())
        self.assertTrue(any(c['command'][-1] == 'scripts/test_glib_backport.py' for c in shared['prebuild']))
        self.assertIn('--contracts-only', workflow)
        guard = (ROOT/"scripts/test_glib_backport.py").read_text()
        self.assertIn("['cargo', 'tree', '--offline', '--locked', *args]", guard)

    def test_manual_workflow_is_pinned_and_bounded(self):
        import re
        text = (ROOT/".github/workflows/build.yml").read_text()
        self.assertIn("workflow_dispatch:", text)
        self.assertNotRegex(text, r"(?m)^\s+(push|pull_request|pull_request_target):")
        actions = re.findall(r"uses: ([^\s]+)", text)
        self.assertEqual(len(actions), 6)
        for action in actions: self.assertRegex(action, r"@[0-9a-f]{40}$")
        self.assertIn("timeout-minutes: 90", text)
        self.assertIn("retention-days: 1", text)
        self.assertNotIn("rust-cache", text)
        self.assertIn("expected_sha:", text)
        self.assertIn("contents: read", text)


    def test_source_diagnostics_upload_runs_after_failure_and_is_narrowly_scoped(self):
        text = (ROOT/".github/workflows/build.yml").read_text()
        marker = '      - name: Retain source validation diagnostics\n'
        self.assertEqual(text.count(marker), 1)
        step = text.split(marker)[1]
        self.assertIn('        if: always()\n', step)
        self.assertIn('uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02', step)
        paths = step.split('          path: |\n')[1].split('          if-no-files-found:')[0]
        expected = ['            ${{ runner.temp }}/'+group+'-validation/'+suffix
                    for group in ['source', 'contracts']
                    for suffix in ['report.json', 'runs/*/run.json', 'runs/*/logs/*.log']]
        self.assertEqual(paths.splitlines(), expected)
        self.assertIn('          retention-days: 1\n', step)

if __name__ == "__main__": unittest.main()
