#!/usr/bin/env python3
"""Offline fixtures for fail-closed tester packaging; never run native apps."""
import hashlib
import json
import os
from pathlib import Path
import struct
import tempfile
import unittest
import zipfile
import package_tester as tester
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

class WindowsInstallerStagingTests(unittest.TestCase):
    """Inert PE/NSIS fixtures; all native subprocesses and notice checks stubbed.

    The SDK-loader digest stub accepts only explicit fixture bytes. These tests
    check staging control flow, not Microsoft SDK provenance/license clearance.
    """
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='chronoscope-installer-test-')
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.repo = self.base / 'repo'
        self.release = self.repo / 'target/release'
        self.gui = self.put(self.release / 'chronoscope-desktop.exe', self.pe())
        self.installer = self.put(self.release / 'bundle/nsis/Chronoscope-setup.exe', b'inert NSIS fixture')
        self.put(self.repo / 'frontend/dist/third-party/LICENSE', b'fixture license')
        self.cargo = self.base / 'cargo'
        self.loader = self.put(self.cargo / 'registry/src/fixture/webview2-com-sys-0.39.1/x64/WebView2LoaderStatic.lib', b'fixture SDK loader')
        self.real_sha256 = hashlib.sha256
        self.mode = 'valid'
        self.output = self.base / 'output'
        self.start_patch(patch.object(tester, 'ROOT', self.repo))
        self.start_patch(patch.dict(os.environ, {'CARGO_HOME': str(self.cargo)}))
        self.notice_checks = self.start_patch(patch.object(tester, 'verify_notices', side_effect=self.verify_notices))
        self.runs = self.start_patch(patch.object(tester.subprocess, 'run', side_effect=self.run_subprocess))
        self.queries = self.start_patch(patch.object(tester.subprocess, 'check_output', return_value='fixture evidence'))
        self.start_patch(patch.object(tester.hashlib, 'sha256', side_effect=self.digest))

    def start_patch(self, item):
        result = item.start()
        self.addCleanup(item.stop)
        return result

    @staticmethod
    def put(path, content):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        return path

    @staticmethod
    def pe(machine=0x8664):
        data = bytearray(256)
        data[:2] = b'MZ'
        struct.pack_into('<I', data, 0x3c, 128)
        data[128:132] = b'PE\0\0'
        struct.pack_into('<H', data, 132, machine)
        return bytes(data)

    def digest(self, content):
        if content == b'fixture SDK loader':
            class FixtureDigest:
                def hexdigest(self):
                    return '89c6b872783b8f6c3cedbff618adb42082d455c615453ae10cfc753f1e8f25d8'
            return FixtureDigest()
        return self.real_sha256(content)

    def verify_notices(self, directory, repository):
        if self.mode == 'bad_notices' and directory.name == 'third-party-extracted':
            raise ValueError('fixture notice refusal')
        return {'files': []}

    def run_subprocess(self, args, **kwargs):
        if args[0] == 'python':
            self.assertEqual(args[1:3], [str(self.repo / 'scripts/test_desktop_cli.py'), '--binary'])
            self.assertEqual(args[3], str(self.gui))
            return
        # The only other process is 7-Zip extraction; never execute a fixture.
        self.assertEqual(args[1:3], ['x', '-y'])
        extracted = Path(args[3][2:])
        extracted.mkdir()
        if self.mode != 'missing_notice':
            self.put(extracted / 'third-party-extracted/NOTICE-MANIFEST.json', b'{}')
        if self.mode != 'missing_gui':
            data = self.pe(0xaa64) if self.mode == 'wrong_arch' else self.gui.read_bytes()
            if self.mode == 'changed_gui':
                data += b'not the tested executable'
            self.put(extracted / 'app/chronoscope-desktop.exe', data)
        if self.mode == 'duplicate_gui':
            self.put(extracted / 'other/chronoscope-desktop.exe', self.pe())

    def stage(self, cap=60 * 1024 * 1024):
        with patch('builtins.print'):
            tester.stage('windows-x86_64', self.output, cap)

    def test_installer_only_payload_matches_tested_gui_and_checksums(self):
        self.stage()
        evidence = json.loads((self.output / 'VALIDATION-windows-x86_64.json').read_text())
        self.assertEqual(evidence['gui_sha256'], self.real_sha256(self.gui.read_bytes()).hexdigest())
        self.assertEqual(evidence['installer_gui_sha256'], evidence['gui_sha256'])
        self.assertEqual(evidence['installer_notice_manifests'], 1)
        self.assertFalse(evidence['real_device_tests'])
        package = self.output / evidence['package']
        with zipfile.ZipFile(package) as archive:
            executables = [n for n in archive.namelist() if n.lower().endswith('.exe')]
            self.assertEqual(executables, ['Chronoscope/' + self.installer.name])
            self.assertEqual(archive.read(executables[0]), self.installer.read_bytes())
            self.assertIn('Chronoscope/third-party/LICENSE', archive.namelist())
            self.assertIn('Chronoscope/SOURCE-ACCESS.txt', archive.namelist())
            instructions = archive.read('Chronoscope/INSTALL.txt').decode()
            self.assertIn('included current-user installer', instructions)
            self.assertNotIn('or run chronoscope-desktop.exe', instructions)
        self.assertEqual(evidence['package_sha256'], self.real_sha256(package.read_bytes()).hexdigest())
        for line in (self.output / 'SHA256SUMS-windows-x86_64.txt').read_text().splitlines():
            digest, name = line.split('  ', 1)
            self.assertEqual(digest, self.real_sha256((self.output / name).read_bytes()).hexdigest())
        self.assertEqual(self.notice_checks.call_count, 2)
        self.assertEqual(self.runs.call_count, 2)  # Mandatory smoke + inert extraction.

    def test_bad_installer_or_notices_reject_before_output(self):
        for mode in ['missing_gui', 'duplicate_gui', 'wrong_arch', 'changed_gui',
                     'missing_notice', 'bad_notices']:
            with self.subTest(mode=mode):
                self.mode = mode
                self.output = self.base / ('output-' + mode)
                with self.assertRaises(ValueError):
                    self.stage()
                self.assertEqual(list(self.output.iterdir()), [])

    def test_changed_sdk_loader_rejected(self):
        self.loader.write_bytes(b'altered loader')
        with self.assertRaises(ValueError):
            self.stage()
        self.assertEqual(list(self.output.iterdir()), [])
        self.assertEqual(self.runs.call_count, 1)  # Smoke remains mandatory.

    def test_final_aggregate_cap_includes_evidence_checksums_and_headroom(self):
        self.stage()
        boundary = sum(p.stat().st_size for p in self.output.iterdir()) + 1024 * 1024
        self.output = self.base / 'exact-boundary'
        self.stage(boundary)
        self.output = self.base / 'under-boundary'
        with self.assertRaises(ValueError):
            self.stage(boundary - 1)
        self.assertEqual(len(list(self.output.iterdir())), 3)


if __name__=='__main__': unittest.main()
