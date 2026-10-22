#!/usr/bin/env python3
"""Fast offline source/fixture regressions; no native app or network."""
import importlib.util
import json
from pathlib import Path
import unittest
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

    def test_manual_workflow_is_pinned_and_bounded(self):
        import re
        text = (ROOT/".github/workflows/build.yml").read_text()
        self.assertIn("workflow_dispatch:", text)
        self.assertNotRegex(text, r"(?m)^\s+(push|pull_request|pull_request_target):")
        actions = re.findall(r"uses: ([^\s]+)", text)
        self.assertEqual(len(actions), 6)
        for action in actions: self.assertRegex(action, r"@[0-9a-f]{40}$")
        self.assertIn("timeout-minutes: 60", text)
        self.assertIn("contents: read", text)

if __name__ == "__main__": unittest.main()
