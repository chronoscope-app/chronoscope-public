#!/usr/bin/env python3
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock
import release_preflight
from release_preflight import check_metadata, check_frozen_revision, version_plan, MANIFESTS


class ReleaseMetadataTests(unittest.TestCase):
    def fixture(self, root):
        for name in MANIFESTS:
            path = root/name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('[package]\nname = "fixture"\nversion = "0.15.3"\n' if path.suffix == '.toml' else json.dumps({'version':'0.15.3'}))
        (root/'frontend/package-lock.json').write_text(json.dumps({'version':'0.15.3','packages':{'':{'version':'0.15.3'}}}))
        (root/'Cargo.lock').write_text('[[package]]\nname = "chronoscope"\nversion = "0.15.3"\n\n[[package]]\nname = "chronoscope-desktop"\nversion = "0.15.3"\n')
        (root/'CHANGELOG.md').write_text('# Changelog\n\n## Unreleased\n\n## 0.15.3 — experimental preview\n\n- A tested change.\n')

    def test_current_source_versions_are_consistent(self):
        metadata = check_metadata()
        self.assertEqual(len(metadata['versions']), 9)
        self.assertEqual(set(metadata['versions'].values()), {metadata['version']})

    def test_manifest_and_lock_mismatches_are_detected(self):
        for name in ['frontend/package.json', 'frontend/package-lock.json', 'Cargo.lock']:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                self.fixture(root)
                path = root/name
                path.write_text(path.read_text().replace('0.15.3', '0.99.0', 1))
                with self.assertRaisesRegex(ValueError, 'Version mismatch'):
                    check_metadata(root)

    def test_release_requires_versioned_notes_and_an_empty_unreleased_section(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.fixture(root)
            self.assertTrue(check_metadata(root, for_release=True)['release_candidate_notes_ready'])
            path = root/'CHANGELOG.md'
            path.write_text(path.read_text().replace('## Unreleased\n', '## Unreleased\n\n- Not shipped yet.\n'))
            with self.assertRaisesRegex(ValueError, 'Move Unreleased'):
                check_metadata(root, for_release=True)
            path.write_text('## Unreleased\n\n## 0.15.2\n\nOld notes.\n')
            with self.assertRaisesRegex(ValueError, 'missing notes'):
                check_metadata(root, for_release=True)

    def test_version_plan_is_read_only_and_refuses_reusing_a_version(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.fixture(root)
            metadata = check_metadata(root)
            before = {str(p):p.read_bytes() for p in root.rglob('*') if p.is_file()}
            plan = version_plan(metadata, '0.15.4')
            self.assertFalse(plan['edits_performed'])
            self.assertFalse(plan['publication_performed'])
            self.assertEqual(before, {str(p):p.read_bytes() for p in root.rglob('*') if p.is_file()})
            with self.assertRaises(ValueError):
                version_plan(metadata, metadata['version'])


    def test_frozen_source_rejects_dirty_wrong_or_previously_tagged_candidates(self):
        sha = 'a'*40
        with mock.patch.object(release_preflight.subprocess, 'check_output', side_effect=[sha+'\n', b'']), mock.patch.object(release_preflight.subprocess, 'run', return_value=mock.Mock(returncode=1)):
            check_frozen_revision(Path('/reviewed/source'), '0.15.3', sha)
        for actual, dirty, tag_exists in [('b'*40, b'', False), (sha, b' M changed', False), (sha, b'', True)]:
            with self.subTest(actual=actual, dirty=dirty, tag_exists=tag_exists), mock.patch.object(release_preflight.subprocess, 'check_output', side_effect=[actual+'\n', dirty]), mock.patch.object(release_preflight.subprocess, 'run', return_value=mock.Mock(returncode=0 if tag_exists else 1)):
                with self.assertRaises(ValueError):
                    check_frozen_revision(Path('/reviewed/source'), '0.15.3', sha)


if __name__ == '__main__':
    unittest.main()
