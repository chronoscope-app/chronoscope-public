#!/usr/bin/env python3
"""Offline checks for pinned downloads and archive restoration boundaries."""
import hashlib
import io
from pathlib import Path
import tempfile
import unittest
import zipfile

from fetch_data_assets import fetch, restore, safe_path


class DataAssets(unittest.TestCase):
    def test_verified_cache_is_offline_and_bad_download_preserves_existing_file(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'pack'
            entry = dict(url='https://example.invalid/pack', bytes=4, sha256=hashlib.sha256(b'data').hexdigest())
            def download(request, timeout):
                return io.BytesIO(b'data')
            fetch(entry, path, download)
            fetch(entry, path, lambda *a, **k: self.fail('verified cache made a network request'))
            path.write_bytes(b'old')
            with self.assertRaisesRegex(ValueError, 'checksum'):
                fetch(entry, path, lambda *a, **k: io.BytesIO(b'fail'))
            self.assertEqual(path.read_bytes(), b'old')
            self.assertEqual([p.name for p in Path(folder).iterdir()], ['pack'])
            path.unlink()
            with self.assertRaisesRegex(ValueError, 'mismatch'):
                fetch(entry, path, lambda *a, **k: io.BytesIO(b'fail'))
            self.assertFalse(path.exists())
            with self.assertRaisesRegex(ValueError, 'exceeds'):
                fetch(entry, path, lambda *a, **k: io.BytesIO(b'too large'))
            self.assertFalse(path.exists())

    def test_source_restore_never_overwrites_credits_or_changed_inputs(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            archive = root / 'source.zip'
            with zipfile.ZipFile(archive, 'w') as out:
                out.writestr('samples/public/demo.csv', 'a,b\n1,2\n')
                out.writestr('samples/public/demo.csv.attribution.json', 'archived credits')
            self.assertEqual(restore(archive, root, 'demo-source-inputs'), 1)
            self.assertFalse((root / 'samples/public/demo.csv.attribution.json').exists())
            (root / 'samples/public/demo.csv').write_text('local edits')
            with self.assertRaisesRegex(ValueError, 'overwrite'):
                restore(archive, root, 'demo-source-inputs')

    def test_traversal_and_symlinks_are_rejected_before_extraction(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            archive = root / 'bad.zip'
            with zipfile.ZipFile(archive, 'w') as out:
                out.writestr('samples/public/okay.csv', 'safe')
                out.writestr('../escaped', 'bad')
            with self.assertRaises(ValueError):
                restore(archive, root, 'demo-source-inputs')
            self.assertFalse((root / 'samples').exists())
            (root / 'link').symlink_to(root, target_is_directory=True)
            with self.assertRaises(ValueError):
                safe_path(root, 'link/file')


if __name__ == '__main__':
    unittest.main()
