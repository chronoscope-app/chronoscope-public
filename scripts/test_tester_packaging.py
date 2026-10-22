#!/usr/bin/env python3
"""Offline fixtures for fail-closed tester packaging; never run native apps."""
import hashlib
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch
from package_tester import architecture
from package_dependency_sources import download

class TesterTests(unittest.TestCase):
    def header(self, data):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / 'fixture'; p.write_bytes(data); return architecture(p)
    def test_elf(self):
        a=bytearray(64); a[:4]=b'\x7fELF';struct.pack_into('<H',a,18,62);self.assertEqual(self.header(a),'x86_64')
    def test_macho(self):
        a=bytearray(64);a[:4]=b'\xcf\xfa\xed\xfe';struct.pack_into('<I',a,4,0x100000c);self.assertEqual(self.header(a),'arm64')
    def test_pe(self):
        a=bytearray(256);a[:2]=b'MZ';struct.pack_into('<I',a,0x3c,128);a[128:132]=b'PE\0\0';struct.pack_into('<H',a,132,0x8664);self.assertEqual(self.header(a),'x86_64')
    def test_unknown_fails(self):
        with self.assertRaises(ValueError): self.header(b'not an executable')
    def test_source_host_fails(self):
        with self.assertRaises(ValueError): download('https://example.com/no','sha256',b'')
    def test_source_checksum_fails(self):
        class Response:
            def __enter__(self): return self
            def __exit__(self,*args): pass
            def read(self,n): return b'changed'
        with patch('urllib.request.urlopen',return_value=Response()):
            with self.assertRaises(ValueError): download('https://static.crates.io/x','sha256',hashlib.sha256(b'original').digest())

if __name__=='__main__': unittest.main()
