#!/usr/bin/env python3
"""Local release resume and artifact preservation regressions."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import local_release as release


class LocalReleaseTests(unittest.TestCase):
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
