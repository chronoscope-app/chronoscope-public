"""Inert all-file Windows packaging fixtures; no native code or network runs."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import windows_release as release


class CoverageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'source'
        self.installed = Path(self.temp.name) / 'installed'
        self.payloads = {
            '$PLUGINSDIR/System.dll': b'MZ inert system plugin',
            '$PLUGINSDIR/modern-wizard.bmp': b'BM inert non-executable bitmap',
        }
        info = {'payloads': {name: {'sha256': [release.digest(data)], 'source_group': 'nsis-source'}
                             for name, data in self.payloads.items()}, 'source_groups': {'nsis-source': 'pinned fixture source'}}
        self.put(self.root, release.PROVENANCE, json.dumps(info).encode())
        for name, data in self.payloads.items():
            self.put(self.installed, name, data)
        for name in ['chronoscope-desktop.exe', 'uninstall.exe']:
            self.put(self.installed, name, b'MZ inert generated executable')
        for name, data in [('balanced.cterrain', b'non-executable terrain'), ('balanced.json', b'{}'), ('README.md', b'fixture credit')]:
            self.put(self.installed, 'terrain/' + name, data)
            if name != 'balanced.cterrain':
                self.put(self.root, 'assets/terrain/' + name, data)
        self.put(self.root, 'assets/data-assets.json', json.dumps({'terrain': {
            'sha256': release.digest(b'non-executable terrain'), 'bytes': len(b'non-executable terrain')}}).encode())
        self.put(self.installed, 'third-party/LICENSE', b'fixture license')
        self.put(self.installed, 'third-party/NOTICE-MANIFEST.json', b'{}')
        notice = {'files': [{'path': 'LICENSE', 'sha256': release.digest(b'fixture license')}]}
        self.notice = patch.object(release, 'verify_notices', return_value=notice).start()
        self.addCleanup(patch.stopall)

    @staticmethod
    def put(root, name, data):
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return path

    def test_all_files_including_bitmap_terrain_and_notices_have_source_groups(self):
        result = release.installer_inventory(self.installed, self.root)
        files = {r['path']: r for r in result['files']}
        self.assertEqual(set(files), set(release.regular_files(self.installed)))
        self.assertEqual(files['$PLUGINSDIR/modern-wizard.bmp']['source_group'], 'nsis-source')
        self.assertEqual(files['terrain/balanced.cterrain']['source_group'], 'terrain-source-and-data')
        self.assertFalse((self.root / 'assets/terrain/balanced.cterrain').exists())

    def test_unknown_non_executable_and_changed_bitmap_fail_closed(self):
        unknown = self.put(self.installed, 'unreviewed-data.json', b'{}')
        with self.assertRaisesRegex(ValueError, 'non-executable'):
            release.installer_inventory(self.installed, self.root)
        unknown.unlink()
        self.put(self.installed, '$PLUGINSDIR/modern-wizard.bmp', b'BM changed bitmap')
        with self.assertRaisesRegex(ValueError, 'component bytes'):
            release.installer_inventory(self.installed, self.root)

    def test_missing_resource_and_modified_terrain_are_rejected(self):
        path = self.installed / 'terrain/balanced.cterrain'
        path.write_bytes(b'wrong data')
        with self.assertRaisesRegex(ValueError, 'terrain'):
            release.installer_inventory(self.installed, self.root)
        path.unlink()
        with self.assertRaisesRegex(ValueError, 'Incomplete'):
            release.installer_inventory(self.installed, self.root)

    def test_wrapper_rejects_uncovered_non_executable_files(self):
        wrapper = Path(self.temp.name) / 'wrapper'
        for name in ['setup.exe', 'INSTALL.txt', 'SOURCE-ACCESS.txt']:
            self.put(wrapper, name, b'fixture')
        release.download_inventory(wrapper, 'setup.exe', self.root)
        self.put(wrapper, 'uncovered.bmp', b'BM fixture')
        with self.assertRaisesRegex(ValueError, 'non-executable'):
            release.download_inventory(wrapper, 'setup.exe', self.root)

    def test_embedded_font_is_matched_to_actual_source_bytes(self):
        self.put(self.root, 'frontend/src/font.woff2', b'fixture font')
        self.put(self.root, 'frontend/dist/assets/font-hash.woff2', b'fixture font')
        with patch.object(release.subprocess, 'check_output', return_value=b'frontend/src/font.woff2\0'):
            result = release.frontend_inventory(self.root)
            self.assertEqual(result['files'][0]['source'], 'frontend/src/font.woff2')
            self.put(self.root, 'frontend/dist/assets/unknown.bin', b'unreviewed')
            with self.assertRaisesRegex(ValueError, 'non-executable'):
                release.frontend_inventory(self.root)

    def test_changed_cached_upstream_source_never_becomes_verified(self):
        data = b'original immutable source'
        record = {'url': 'https://codeload.github.com/fixture', 'sha256': release.digest(data), 'bytes': len(data)}
        cache = Path(self.temp.name) / 'cache'
        path = self.put(cache, record['sha256'] + '.download', data)
        with patch.object(release.urllib.request, 'urlopen') as network:
            self.assertEqual(release.checked_download(record, cache), data)
            path.write_bytes(b'changed cache')
            with self.assertRaisesRegex(ValueError, 'preserved'):
                release.checked_download(record, cache)
            network.assert_not_called()
        self.assertEqual(path.read_bytes(), b'changed cache')

    def test_local_checks_cannot_claim_native_windows_capability(self):
        with patch.object(release.sys, 'platform', 'darwin'):
            with self.assertRaisesRegex(ValueError, 'require Windows'):
                release.native_identity()


if __name__ == '__main__':
    unittest.main()
