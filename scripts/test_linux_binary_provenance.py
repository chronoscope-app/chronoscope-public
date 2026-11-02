#!/usr/bin/env python3
"""Portable unit tests for native ELF provenance replay."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import verify_linux_binary_provenance as provenance

class BinaryProvenanceTest(unittest.TestCase):
    def test_replay_compares_bytes_and_records_exact_rpath(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); original = root / 'original'; packaged = root / 'packaged'; tool = root / 'tool'
            original.write_bytes(b'original'); packaged.write_bytes(b'packaged'); tool.write_bytes(b'tool')
            def patch(command, **kwargs):
                self.assertEqual(command[1:3], ['--set-rpath', '$ORIGIN'])
                Path(command[3]).write_bytes(b'packaged')
            with mock.patch.object(provenance.subprocess, 'check_output', return_value='$ORIGIN\n'), mock.patch.object(provenance.subprocess, 'run', side_effect=patch):
                result = provenance.replay(original, packaged, tool)
            self.assertTrue(result['exact'])
            self.assertEqual(result['operations'][-1]['value'], '$ORIGIN')
            self.assertEqual(original.read_bytes(), b'original')

    def test_changed_image_and_tool_hash_are_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); image = root / 'image'; image.write_bytes(b'image'); tool = root / 'tool'; tool.write_bytes(b'tool')
            inventory = root / 'inventory.json'; inventory.write_text(json.dumps({'appimage': str(image), 'appimage_sha256': '0' * 64, 'files': []}))
            with self.assertRaisesRegex(ValueError, 'AppImage changed'):
                provenance.verify(inventory, root / 'out', tool, hashlib.sha256(b'tool').hexdigest())
            inventory.write_text(json.dumps({'appimage': str(image), 'appimage_sha256': hashlib.sha256(b'image').hexdigest(), 'files': []}))
            with self.assertRaisesRegex(ValueError, 'patchelf hash mismatch'):
                provenance.verify(inventory, root / 'out', tool, '0' * 64)

if __name__ == '__main__':
    unittest.main()
