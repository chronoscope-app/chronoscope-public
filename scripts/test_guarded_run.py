#!/usr/bin/env python3
"""Resource guard locking, ownership and conservative profile retention."""
import datetime
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
import guarded_run
from clean_local_artifacts import plan
from validation_runtime import run_command


class GuardTests(unittest.TestCase):
    def test_contention_refuses_a_second_worker_and_releases_after_exception(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            with self.assertRaisesRegex(ValueError, 'test unwind'):
                with guarded_run.workspace_lock(root):
                    with self.assertRaisesRegex(RuntimeError, 'Another guarded'):
                        with guarded_run.workspace_lock(root):
                            self.fail('second worker acquired the lock')
                    raise ValueError('test unwind')
            with guarded_run.workspace_lock(root):
                pass

    def test_nested_token_must_match_a_live_owner_and_cannot_reuse_stale_lock(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            with guarded_run.workspace_lock(root) as token:
                self.assertTrue((root/'.qa/heavy-work-owner.json').is_file())
                self.assertEqual(json.loads((root/'.qa/heavy-work-owner.json').read_text())['token'], token)
                with mock.patch.dict(os.environ, {guarded_run.MARKER: token}):
                    self.assertTrue(guarded_run.is_guarded(root))
                with mock.patch.dict(os.environ, {guarded_run.MARKER: 'wrong-token'}):
                    self.assertFalse(guarded_run.is_guarded(root))
            with mock.patch.dict(os.environ, {guarded_run.MARKER: token}):
                self.assertFalse(guarded_run.is_guarded(root))

    def test_low_memory_refuses_before_launch_and_releases_lock(self):
        with tempfile.TemporaryDirectory() as temporary:
            with mock.patch.object(guarded_run.sys, 'platform', 'darwin'), mock.patch.object(guarded_run, 'memory_available', return_value=20), mock.patch.object(guarded_run.subprocess, 'Popen') as launch:
                with self.assertRaisesRegex(RuntimeError, 'start threshold'):
                    guarded_run.run_guarded([sys.executable, '-c', 'pass'], Path(temporary))
                launch.assert_not_called()
            with guarded_run.workspace_lock(Path(temporary)):
                pass

    @unittest.skipIf(os.name == 'nt', 'POSIX detached process-group regression')
    def test_timeout_stops_a_child_that_created_its_own_session(self):
        with tempfile.TemporaryDirectory() as temporary:
            marker = Path(temporary)/'escaped'
            child = 'import time; from pathlib import Path; time.sleep(2); Path('+repr(str(marker))+').write_text("escaped")'
            parent = 'import subprocess,sys,time; subprocess.Popen([sys.executable,"-c",'+repr(child)+'],start_new_session=True); time.sleep(20)'
            result = run_command([sys.executable, '-c', parent], temporary, os.environ.copy(), Path(temporary)/'out.log', .5)
            self.assertTrue(result['timed_out'])
            import time
            time.sleep(2.1)
            self.assertFalse(marker.exists())

    def test_cleanup_preserves_recent_unfinished_native_and_evidence_paths(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            now = datetime.datetime(2026, 10, 26, tzinfo=datetime.timezone.utc)
            runs = root/'.qa/local-validation/runs'
            for name, days, complete in [('old',30,True),('newest',20,True),('unfinished',40,False),('recent',0,True)]:
                run = runs/name
                for folder in ['profiles', 'native-profile', 'artifacts', 'logs']:
                    (run/folder).mkdir(parents=True)
                receipt = {'finished_utc': (now-datetime.timedelta(days=days)).isoformat()} if complete else {}
                (run/'run.json').write_text(json.dumps(receipt))
            self.assertEqual(plan(root, days=7, keep=1, now=now), [runs/'newest/profiles', runs/'old/profiles'])
            # A symlink is never an invitation to delete source elsewhere.
            (runs/'old/profiles').rmdir()
            (runs/'old/profiles').symlink_to(root, target_is_directory=True)
            self.assertEqual(plan(root, days=7, keep=1, now=now), [runs/'newest/profiles'])


if __name__ == '__main__':
    unittest.main()
