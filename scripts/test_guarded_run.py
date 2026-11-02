#!/usr/bin/env python3
"""Resource guard locking, ownership and conservative profile retention."""
import datetime
import json
import os
import signal
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
import guarded_run
from clean_local_artifacts import plan
from validation_runtime import run_command, stop_tree


class GuardTests(unittest.TestCase):
    def test_guard_uses_shared_command_preparation_with_actual_cwd_and_environment(self):
        command = ['npm', 'test', 'literal & text', '%PATH%']
        prepared = ['node.exe', 'npm-cli.js', *command[1:]]
        with mock.patch.object(guarded_run, 'prepare_command', return_value=prepared) as prepare:
            self.assertEqual(guarded_run.launch_command(command), prepared)
        prepare.assert_called_once_with(command, Path.cwd(), os.environ)

    @staticmethod
    def hosted_environment(repository='chronoscope-app/chronoscope-public'):
        return {'GITHUB_ACTIONS': 'true', 'RUNNER_ENVIRONMENT': 'github-hosted',
                'GITHUB_REPOSITORY': repository, 'GITHUB_EVENT_NAME': 'workflow_dispatch',
                'GITHUB_REF': 'refs/heads/main',
                'GITHUB_WORKFLOW_REF': f'{repository}/.github/workflows/build.yml@refs/heads/main'}

    def test_hosted_policy_requires_every_trusted_context_field(self):
        for repository in ['chronoscope-app/chronoscope-public', 'chronoscope-app/chronoscope-next']:
            environment = self.hosted_environment(repository)
            self.assertTrue(guarded_run.trusted_hosted(environment))
            for key in environment:
                for value in [None, 'wrong']:
                    altered = dict(environment)
                    if value is None:
                        altered.pop(key)
                    else:
                        altered[key] = value
                    with self.subTest(repository=repository, key=key, value=value):
                        self.assertFalse(guarded_run.trusted_hosted(altered))
        for variables in [{'CI': 'true'}, {'GITHUB_ACTIONS': 'true'},
                          {**self.hosted_environment(), 'RUNNER_ENVIRONMENT': 'self-hosted'},
                          self.hosted_environment('other-owner/chronoscope-public')]:
            self.assertFalse(guarded_run.trusted_hosted(variables))

    def test_platform_launch_policy_and_explicit_environment_precedence(self):
        # Exercise a live monitor iteration too: hosted Mac must never query
        # local CPU/RSS/pressure, not merely skip the initial admission check.
        contexts = [({}, True), ({'CI': 'true'}, True),
                    ({**self.hosted_environment(), 'RUNNER_ENVIRONMENT': 'self-hosted'}, True),
                    (self.hosted_environment(), False)]
        for platform in ['darwin', 'win32', 'linux']:
            for variables, needs_mac in contexts:
                for explicit in [{}, {'CARGO_BUILD_JOBS': '6', 'RUST_TEST_THREADS': '3'}]:
                    local_mac = platform == 'darwin' and needs_mac
                    child = mock.Mock(pid=123, returncode=7)
                    child.poll.side_effect = [None, None, 7, 7]
                    with (self.subTest(platform=platform, variables=variables, explicit=explicit),
                          tempfile.TemporaryDirectory() as temporary,
                          mock.patch.dict(os.environ, {**variables, **explicit}, clear=True),
                          mock.patch.object(guarded_run.sys, 'platform', platform),
                          mock.patch.object(guarded_run, 'launch_command', side_effect=lambda c: c),
                          mock.patch.object(guarded_run, 'memory_available', return_value=80) as memory,
                          mock.patch.object(guarded_run.shutil, 'disk_usage', return_value=mock.Mock(free=10*1024**3)) as disk,
                          mock.patch.object(guarded_run, 'usage', return_value=(100, 100)) as usage,
                          mock.patch.object(guarded_run.time, 'sleep'),
                          mock.patch.object(guarded_run.subprocess, 'Popen', return_value=child) as launch):
                        root = Path(temporary)
                        self.assertEqual(guarded_run.run_guarded(['cargo', 'test', '-j', '4'], root), 7)
                        command = launch.call_args.args[0]
                        env = launch.call_args.kwargs['env']
                        self.assertTrue(env[guarded_run.MARKER])
                        self.assertEqual(command[-4:], ['cargo', 'test', '-j', '4'])
                        if local_mac:
                            self.assertEqual(command[:5], ['/usr/bin/caffeinate', '-i', '/usr/bin/nice', '-n', '10'])
                            self.assertEqual(env['CARGO_BUILD_JOBS'], '1')
                            self.assertEqual(env['RUST_TEST_THREADS'], '1')
                            self.assertEqual(memory.call_count, 2)
                            disk.assert_called_once()
                            usage.assert_called_once_with(child.pid)
                        else:
                            self.assertEqual(command, ['cargo', 'test', '-j', '4'])
                            for key in ['CARGO_BUILD_JOBS', 'RUST_TEST_THREADS']:
                                self.assertEqual(env.get(key), explicit.get(key))
                            memory.assert_not_called()
                            disk.assert_not_called()
                            usage.assert_not_called()
                        self.assertFalse((root/'.qa/heavy-work-owner.json').exists())
                        with guarded_run.workspace_lock(root):
                            pass

    def test_local_mac_pressure_still_stops_owned_tree(self):
        for rss, cpu, available in [(5121, 100, 80), (100, 100, 24), (100, 251, 80)]:
            child = mock.Mock(pid=123, returncode=None)
            child.poll.return_value = None
            with (self.subTest(rss=rss, cpu=cpu, available=available),
                  tempfile.TemporaryDirectory() as temporary,
                  mock.patch.dict(os.environ, {}, clear=True),
                  mock.patch.object(guarded_run.sys, 'platform', 'darwin'),
                  mock.patch.object(guarded_run, 'memory_available', side_effect=[80, available]),
                  mock.patch.object(guarded_run.shutil, 'disk_usage', return_value=mock.Mock(free=10*1024**3)),
                  mock.patch.object(guarded_run, 'usage', return_value=(rss, cpu)),
                  mock.patch.object(guarded_run.time, 'sleep'),
                  mock.patch.object(guarded_run.time, 'monotonic', side_effect=[1, 20]),
                  mock.patch.object(guarded_run.subprocess, 'Popen', return_value=child),
                  mock.patch('validation_runtime.stop_tree') as stop):
                root = Path(temporary)
                with self.assertRaisesRegex(RuntimeError, 'Stopping owned work'):
                    guarded_run.run_guarded(['cargo', 'test'], root)
                stop.assert_called_once_with(child)
                child.wait.assert_called_once_with(timeout=10)
                with guarded_run.workspace_lock(root):
                    pass

    def test_hosted_policy_does_not_bypass_workspace_contention(self):
        with (tempfile.TemporaryDirectory() as temporary,
              mock.patch.dict(os.environ, self.hosted_environment(), clear=True),
              mock.patch.object(guarded_run.subprocess, 'Popen') as launch):
            root = Path(temporary)
            with guarded_run.workspace_lock(root):
                with self.assertRaisesRegex(RuntimeError, 'Another guarded'):
                    guarded_run.run_guarded([sys.executable, '-c', 'pass'], root)
            launch.assert_not_called()

    def test_nested_hosted_hooks_reuse_only_a_live_owner(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with guarded_run.workspace_lock(root) as token:
                with (mock.patch.dict(os.environ, {**self.hosted_environment(), guarded_run.MARKER: token}, clear=True),
                      mock.patch.object(guarded_run.subprocess, 'call', return_value=9) as call,
                      mock.patch.object(guarded_run.subprocess, 'Popen') as launch):
                    self.assertEqual(guarded_run.run_guarded(['cargo', 'test'], root), 9)
                    call.assert_called_once_with(['cargo', 'test'])
                    launch.assert_not_called()

    def test_personal_mac_still_refuses_low_disk_before_launch(self):
        with (tempfile.TemporaryDirectory() as temporary,
              mock.patch.dict(os.environ, {}, clear=True),
              mock.patch.object(guarded_run.sys, 'platform', 'darwin'),
              mock.patch.object(guarded_run, 'memory_available', return_value=80),
              mock.patch.object(guarded_run.shutil, 'disk_usage', return_value=mock.Mock(free=4*1024**3)),
              mock.patch.object(guarded_run.subprocess, 'Popen') as launch):
            root = Path(temporary)
            with self.assertRaisesRegex(RuntimeError, 'Less than 5 GiB'):
                guarded_run.run_guarded(['cargo', 'test'], root)
            launch.assert_not_called()
            with guarded_run.workspace_lock(root):
                pass

    def test_interrupted_hosted_work_still_cleans_up_its_owned_tree(self):
        child = mock.Mock(pid=123)
        child.poll.return_value = None
        with (tempfile.TemporaryDirectory() as temporary,
              mock.patch.dict(os.environ, self.hosted_environment(), clear=True),
              mock.patch.object(guarded_run.sys, 'platform', 'darwin'),
              mock.patch.object(guarded_run.subprocess, 'Popen', return_value=child),
              mock.patch.object(guarded_run.time, 'sleep', side_effect=KeyboardInterrupt),
              mock.patch('validation_runtime.stop_tree') as stop):
            root = Path(temporary)
            with self.assertRaises(KeyboardInterrupt):
                guarded_run.run_guarded(['cargo', 'test'], root)
            stop.assert_called_once_with(child)
            child.wait.assert_called_once_with(timeout=10)
            with guarded_run.workspace_lock(root):
                pass

    def test_shared_cargo_config_cannot_reintroduce_a_worker_override(self):
        import tomllib
        config = tomllib.loads((guarded_run.ROOT/'.cargo/config.toml').read_text())
        self.assertEqual(config, {})

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

    @unittest.skipIf(os.name == 'nt', 'POSIX process-group signaling')
    def test_exited_zombie_groups_may_reject_the_second_signal(self):
        process = mock.Mock(pid=111)
        error = PermissionError(1, 'fixture EPERM')
        def signal_group(group, sig):
            if sig == signal.SIGKILL:
                raise error
        with (mock.patch('validation_runtime.subprocess.check_output',
                         side_effect=['111 1 111\n222 111 222\n', '111 Z\n222 Z+\n', '111 Z\n222 Z+\n']),
              mock.patch('validation_runtime.os.getpgrp', return_value=999),
              mock.patch('validation_runtime.os.killpg', side_effect=signal_group) as kill):
            stop_tree(process)
        self.assertEqual(kill.call_count, 4)

    @unittest.skipIf(os.name == 'nt', 'POSIX process-group signaling')
    def test_live_or_unverifiable_groups_still_report_permission_errors(self):
        process = mock.Mock(pid=111)
        for listing in ['111 S\n', '', 'invalid process listing\n']:
            with (self.subTest(listing=listing),
                  mock.patch('validation_runtime.subprocess.check_output',
                             side_effect=['111 1 111\n', listing]),
                  mock.patch('validation_runtime.os.getpgrp', return_value=999),
                  mock.patch('validation_runtime.os.killpg', side_effect=PermissionError(1, 'fixture EPERM')),
                  self.assertRaises(PermissionError)):
                stop_tree(process)

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
