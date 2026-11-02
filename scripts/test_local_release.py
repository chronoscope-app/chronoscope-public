#!/usr/bin/env python3
"""Local release resume and artifact preservation regressions."""
import json
from pathlib import Path
import tempfile
import sys
import unittest
from unittest.mock import patch
import local_release as release


class LocalReleaseTests(unittest.TestCase):
    def test_fresh_checkout_builds_notice_resources_before_desktop_lint(self):
        with tempfile.TemporaryDirectory() as temporary:
            base=Path(temporary);root=base/'checkout';root.mkdir()
            (root/'frontend').mkdir();(root/'frontend/package-lock.json').write_text('{}')
            (root/'src-tauri').mkdir();(root/'src-tauri/tauri.conf.json').write_text('{"version":"0.16.14"}')
            source='a'*40;seen=[]
            def execute(command,cwd,env,log,timeout):
                seen.append(command);log.write_text('passed')
                if command[:3]==['npm','--prefix','frontend'] and command[3]=='ci':
                    (root/'frontend/node_modules').mkdir()
                elif command[:3]==['npm','--prefix','frontend']:
                    (root/'frontend/dist/third-party').mkdir(parents=True)
                    (root/'frontend/dist/index.html').write_text('built')
                    (root/'frontend/dist/third-party/LICENSE').write_text('notice')
                if command[:2]==['cargo','clippy']:
                    self.assertTrue((root/'frontend/dist/third-party/LICENSE').is_file(),
                                    'Tauri requires notice resources before desktop lint')
                if '--report' in command:
                    Path(command[command.index('--report')+1]).write_text('{"passed":true}')
                return {'exit_code':0,'elapsed_s':0,'timed_out':False}
            argv=['local_release.py','--target','macos-arm64','--expected-sha',source,
                  '--output',str(base/'output'),'--verify-only']
            with patch.object(release,'ROOT',root),patch.object(sys,'argv',argv), \
                    patch.object(release,'preflight',return_value={}), \
                    patch.object(release,'capture',side_effect=lambda cmd,env:source if cmd[-1]=='HEAD' else ''), \
                    patch.object(release.build_portable,'configured_flags_required',return_value=False), \
                    patch.object(release,'run_command',side_effect=execute):
                self.assertEqual(release.main(),0)
            self.assertTrue(any(command[:2]==['cargo','clippy'] for command in seen))
            self.assertTrue(json.loads((root/'.qa/local-release/macos-arm64/state.json').read_text())['passed'])

    def test_reuse_requires_exact_source_tools_and_untampered_outputs(self):
        with tempfile.TemporaryDirectory() as temporary:
            p=Path(temporary)/'source.json';p.write_text('verified')
            identity={'source':'reviewed','compiler':'pinned'}
            record={'identity':identity,'exit_code':0,'outputs':release.file_hashes([p])}
            self.assertTrue(release.reusable(record,identity))
            self.assertFalse(release.reusable(record,dict(identity,source='new')))
            self.assertFalse(release.reusable(record,dict(identity,compiler='new')))
            p.write_text('modified');self.assertFalse(release.reusable(record,identity))
            p.unlink();self.assertFalse(release.reusable(record,identity))

    def test_failed_or_outputless_phase_cannot_be_reused(self):
        identity={'source':'reviewed'}
        for code,outputs in [(1,{'missing':'hash'}),(0,{})]:
            self.assertFalse(release.reusable({'identity':identity,'exit_code':code,'outputs':outputs},identity))

    def test_stale_installer_is_preserved_without_moving_current_installer(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);folder=root/'target/release/bundle/nsis';folder.mkdir(parents=True)
            old=folder/'Chronoscope_0.16.9_x64-setup.exe';old.write_bytes(b'old')
            current=folder/'Chronoscope_0.16.14_x64-setup.exe';current.write_bytes(b'new')
            with patch.object(release,'ROOT',root):
                moved=release.stash_stale_bundles('windows-x86_64','0.16.14',root/'evidence')
            self.assertEqual(len(moved),1);self.assertEqual(Path(moved[0]).read_bytes(),b'old')
            self.assertEqual(current.read_bytes(),b'new');self.assertFalse(old.exists())

    def test_unknown_installer_is_not_moved(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);folder=root/'target/release/bundle/nsis';folder.mkdir(parents=True)
            unknown=folder/'OtherApp.exe';unknown.write_bytes(b'untouched')
            with patch.object(release,'ROOT',root),self.assertRaises(ValueError):
                release.stash_stale_bundles('windows-x86_64','0.16.14',root/'evidence')
            self.assertEqual(unknown.read_bytes(),b'untouched')

    def test_atomic_state_round_trip(self):
        with tempfile.TemporaryDirectory() as temporary:
            path=Path(temporary)/'nested/state.json';release.write_json(path,{'passed':False})
            release.write_json(path,{'passed':True});self.assertEqual(json.loads(path.read_text()),{'passed':True})
            self.assertFalse(path.with_suffix('.json.tmp').exists())


if __name__=='__main__':unittest.main()
