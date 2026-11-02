#!/usr/bin/env python3
"""Focused tests for Linux build preparation and conservative source inventory."""
import hashlib
import gzip
import json
import os
from pathlib import Path
import struct
import tempfile
import unittest
from unittest import mock

import package_linux_sources as sources
import check_linux_replacement as replacement
import prepare_linux_build as prepare


class LinuxReleaseToolsTest(unittest.TestCase):
    def test_jobs_reserve_host_memory_and_are_capped(self):
        self.assertEqual(prepare.safe_jobs(int(6.5 * prepare.GIB), 12), 1)
        self.assertEqual(prepare.safe_jobs(int(8.5 * prepare.GIB), 12), 3)
        self.assertEqual(prepare.safe_jobs(30 * prepare.GIB, 12), 4)
        self.assertEqual(prepare.safe_jobs(30 * prepare.GIB, 2), 2)
        with self.assertRaises(ValueError):
            prepare.safe_jobs(6 * prepare.GIB, 12)

    def test_memory_available(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / 'meminfo'
            p.write_text('MemTotal: 9000 kB\nMemAvailable: 1234 kB\n')
            self.assertEqual(prepare.memory_available(p), 1234 * 1024)
            p.write_text('MemTotal: 9000 kB\n')
            with self.assertRaises(ValueError):
                prepare.memory_available(p)

    def test_wrong_release_toolchain_is_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            executable = Path(d)/'fake-tool'; executable.write_text('not executed')
            versions = ['3.14', 'v22.23.4', 'rustc 1.98.0 (example)', 'cargo 1.98.0 (example)']
            with mock.patch.object(prepare, 'run_checked', side_effect=versions), \
                    mock.patch.object(prepare.sys, 'platform', 'linux'), \
                    mock.patch.object(prepare.platform, 'machine', return_value='x86_64'), \
                    mock.patch.object(prepare.shutil, 'which', return_value=str(executable)):
                with self.assertRaisesRegex(ValueError, 'requires Python 3.13'):
                    prepare.prepare(Path(d), Path(d) / 'state', executable, executable, executable)

    def test_image_header_offset_and_magic(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / 'example'
            ident = b'\x7fELF\x02\x01\x01\x00AI\x02' + bytes(5)
            header = struct.pack('<16sHHIQQQIHHHHHH', ident, 2, 62, 1, 0, 0, 64, 0, 64, 0, 0, 64, 1, 0)
            p.write_bytes(header + bytes(64) + b'hsqs' + bytes(20))
            self.assertEqual(sources.image_offset(p), 128)
            p.write_bytes(header + bytes(64) + b'nope')
            with self.assertRaises(ValueError):
                sources.image_offset(p)

    def test_checksum_and_corrupt_image_rejected_before_extraction(self):
        with tempfile.TemporaryDirectory() as d:
            image = Path(d) / 'image'; image.write_bytes(b'not image')
            out = Path(d) / 'out'
            with mock.patch.object(sources.subprocess, 'run') as run:
                with self.assertRaisesRegex(ValueError, 'SHA-256'):
                    sources.inventory(image, out, '0' * 64)
                run.assert_not_called()
            self.assertFalse(out.exists())

    def test_existing_output_is_preserved(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d); image = p / 'image'; image.write_bytes(b'x')
            out = p / 'out'; out.mkdir(); (out / 'keep').write_text('safe')
            with self.assertRaisesRegex(ValueError, 'existing output'):
                sources.inventory(image, out, hashlib.sha256(b'x').hexdigest())
            self.assertEqual((out / 'keep').read_text(), 'safe')

    def test_dsc_valid_and_unsafe_names(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / 'x.dsc'; h = 'a' * 64
            p.write_text('Format: 3.0 (quilt)\nChecksums-Sha256:\n ' + h + ' 12 a.tar.xz\nFiles:\n')
            self.assertEqual(sources.dsc_checksums(p)['a.tar.xz'], {'sha256': h, 'bytes': 12})
            p.write_text('Checksums-Sha256:\n ' + h + ' 12 ../escape\n')
            with self.assertRaises(ValueError):
                sources.dsc_checksums(p)

    def test_inventory_keeps_unmatched_and_symlinks_without_following(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); (root / 'a').write_bytes(b'\x7fELFjunk'); (root / 'link').symlink_to('/etc/passwd')
            report = sources.inventory_tree(root, 'f' * 64, {})
            self.assertFalse(report['release_clearance'])
            records = {x['path']: x for x in report['files']}
            self.assertEqual(records['a']['source_status'], 'unresolved')
            self.assertEqual(records['link']['target'], '/etc/passwd')
            self.assertEqual(report['file_count'], 2)

    def test_exact_package_match_never_confers_clearance(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); tree = root / 'tree'; tree.mkdir(); host = root / 'host'; host.mkdir()
            (tree / 'lib.so').write_bytes(b'\x7fELF1234'); (host / 'lib.so').write_bytes(b'\x7fELF1234')
            meta = {'binary': 'pkg', 'binary_version': '1', 'source': 'src', 'source_version': '1'}
            with mock.patch.object(sources, 'package_metadata', return_value=meta):
                report = sources.inventory_tree(tree, 'a' * 64, {'lib.so': [('pkg', str(host / 'lib.so'))]})
            self.assertEqual(report['files'][0]['source_status'], 'exact-byte-match-needs-license-and-replacement-review')
            self.assertFalse(report['release_clearance'])

    def test_reject_unauthenticated_sources(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); inventory = root / 'inventory.json'
            inventory.write_text(json.dumps({'appimage_sha256': 'b' * 64, 'release_clearance': False, 'files': []}))
            config = root / 'bad.sources'; config.write_text('Types: deb-src\nTrusted: yes\n')
            with self.assertRaisesRegex(ValueError, 'Authenticated'):
                sources.collect_sources(inventory, root / 'out', config)
            self.assertFalse((root / 'out').exists())

    def test_debian_format_one_notice_is_read_without_applying_patch(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            with gzip.open(root / 'pkg.diff.gz', 'wb') as f:
                f.write(b'--- pkg/debian/copyright\n+++ pkg/debian/copyright\n@@ -0,0 +1,2 @@\n+License text\n+Copyright text\n')
            result = sources.retain_debian_copyright(root)
            self.assertEqual(result['status'], 'retained')
            self.assertEqual((root / 'DISTRO-COPYRIGHT').read_text(), 'License text\nCopyright text\n')

    def test_replacement_verifier_rejects_changed_and_escaping_files(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); (root / 'file').write_bytes(b'safe')
            manifest = {'files': [{'path': 'file', 'type': 'file', 'bytes': 4, 'sha256': hashlib.sha256(b'safe').hexdigest()}]}
            replacement.verify_tree(root, manifest)
            (root / 'file').write_bytes(b'evil')
            with self.assertRaisesRegex(ValueError, 'Changed'):
                replacement.verify_tree(root, manifest)
            (root / 'file').unlink(); (root / 'escape').symlink_to('/etc/passwd')
            with self.assertRaisesRegex(ValueError, 'Unsafe'):
                replacement.verify_tree(root, {'files': [{'path': 'escape', 'type': 'symlink', 'target': '/etc/passwd'}]})

    def test_modified_elf_fingerprint_is_not_exact_match(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); tree = root / 'tree'; tree.mkdir(); host = root / 'host'; host.mkdir()
            (tree / 'lib.so').write_bytes(b'\x7fELFnew'); (host / 'lib.so').write_bytes(b'\x7fELFold')
            meta = {'binary': 'pkg', 'binary_version': '1', 'source': 'src', 'source_version': '1'}
            with mock.patch.object(sources, 'package_metadata', return_value=meta), mock.patch.object(sources, 'elf_fingerprint', return_value={'build_id': 'aa', 'text_sha256': 'bb', 'text_bytes': 10}):
                report = sources.inventory_tree(tree, 'c' * 64, {'lib.so': [('pkg', str(host / 'lib.so'))]})
            record = report['files'][0]
            self.assertEqual(record['source_status'], 'unresolved')
            self.assertEqual(len(record['provisional_build_id_and_text_matches']), 1)
            self.assertFalse(report['release_clearance'])

if __name__ == '__main__':
    unittest.main()
