#!/usr/bin/env python3
"""Offline fixtures for fail-closed tester packaging; never run native apps."""
import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess
import tarfile
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
            binary = Path(args[3])
            self.assertTrue(binary == self.gui or binary.name == 'chronoscope-desktop.exe' and 'installer-extracted' in binary.parts)
            if binary != self.gui and self.mode == 'smoke_mutation':
                binary.write_bytes(binary.read_bytes() + b'changed during smoke')
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
            if self.mode == 'nsis_marker':
                data = data.replace(b'__TAURI_BUNDLE_TYPE_VAR_UNK', b'__TAURI_BUNDLE_TYPE_VAR_NSS', 1)
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
        self.assertEqual(self.runs.call_count, 3)  # Build smoke, extraction, actual installer smoke.

    def test_bad_installer_or_notices_reject_before_output(self):
        for mode in ['missing_gui', 'duplicate_gui', 'wrong_arch', 'changed_gui',
                     'missing_notice', 'bad_notices', 'smoke_mutation']:
            with self.subTest(mode=mode):
                self.mode = mode
                self.output = self.base / ('output-' + mode)
                with self.assertRaises(ValueError):
                    self.stage()
                self.assertEqual(list(self.output.iterdir()), [])

    def test_nsis_marker_change_tests_and_hashes_actual_installer_gui(self):
        self.gui.write_bytes(self.gui.read_bytes() + b'__TAURI_BUNDLE_TYPE_VAR_UNK')
        self.mode = 'nsis_marker'
        self.stage()
        evidence = json.loads((self.output / 'VALIDATION-windows-x86_64.json').read_text())
        self.assertNotEqual(evidence['build_tree_gui_sha256'], evidence['gui_sha256'])
        self.assertEqual(evidence['installer_gui_sha256'], evidence['gui_sha256'])
        self.assertEqual(evidence['installer_binary_difference'], 'Tauri NSIS bundle marker only')
        self.assertEqual(self.runs.call_count, 3)

    def test_nsis_marker_guard_rejects_other_differences(self):
        original = b'prefix__TAURI_BUNDLE_TYPE_VAR_UNKsuffix'
        patched = original.replace(b'_UNK', b'_NSS')
        self.assertEqual(tester.verify_nsis_gui(original, patched), 'Tauri NSIS bundle marker only')
        for altered in [patched + b'x', patched[:-1], patched.replace(b'prefix', b'Prefix'), original.replace(b'_UNK', b'_MSI')]:
            with self.subTest(altered=altered), self.assertRaises(ValueError):
                tester.verify_nsis_gui(original, altered)

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


class MacBundleStagingTests(unittest.TestCase):
    """Inert Mach-O fixtures; no codesign, otool, or native app is executed."""
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='chronoscope-mac-test-')
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.repo = self.base / 'repo'
        self.release = self.repo / 'target/release'
        self.gui = self.put(self.release / 'chronoscope-desktop', self.macho() + b'raw build')
        self.app = self.release / 'bundle/macos/Chronoscope.app'
        self.bundled = self.put(self.app / 'Contents/MacOS/chronoscope-desktop', self.macho() + b'bundler signed GUI')
        self.put(self.app / 'Contents/Resources/third-party/LICENSE', b'packaged fixture license')
        self.metadata = self.put(self.app / 'Contents/Resources/Metadata.appintents/extract.actionsdata', b'inert metadata')
        self.put(self.repo / 'frontend/dist/third-party/LICENSE', b'build fixture license')
        self.output = self.base / 'output'
        self.events = []
        self.mode = 'valid'
        self.copied_app = None
        self.start_patch(patch.object(tester, 'ROOT', self.repo))
        self.notices = self.start_patch(patch.object(tester, 'verify_notices', side_effect=self.verify_notices))
        self.runs = self.start_patch(patch.object(tester.subprocess, 'run', side_effect=self.run_subprocess))
        self.queries = self.start_patch(patch.object(tester.subprocess, 'check_output', side_effect=self.query_subprocess))

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
    def macho(machine=0x100000c):
        data = bytearray(64)
        data[:4] = b'\xcf\xfa\xed\xfe'
        struct.pack_into('<I', data, 4, machine)
        return bytes(data)

    def verify_notices(self, directory, repository):
        self.assertEqual(repository, self.repo)
        self.events.append(('notices', directory))
        if directory != self.repo / 'frontend/dist/third-party':
            self.assertEqual(directory, self.copied_app / 'Contents/Resources/third-party')
            self.assertTrue((directory / 'LICENSE').is_file())
            if self.mode == 'bad_final_notices' and sum(e[0] == 'notices' for e in self.events) == 3:
                raise ValueError('final copied notice refusal')
            if self.mode == 'bad_notices':
                raise ValueError('copied notice refusal')
        return {'files': []}

    def run_subprocess(self, args, **kwargs):
        self.assertTrue(kwargs['check'])
        if args[0] == 'codesign':
            self.assertEqual(args[1:4], ['--verify', '--deep', '--strict'])
            self.assertEqual(len(args), 5)
            self.copied_app = Path(args[4])
            self.assertNotEqual(self.copied_app, self.app)
            self.assertEqual(self.copied_app.name, self.app.name)
            self.assertEqual((self.copied_app / 'Contents/MacOS/chronoscope-desktop').read_bytes(), self.bundled.read_bytes())
            self.events.append(('codesign', self.copied_app))
            if self.mode == 'bad_final_codesign' and sum(e[0] == 'codesign' for e in self.events) == 2:
                raise subprocess.CalledProcessError(1, args)
            if self.mode == 'bad_codesign':
                raise subprocess.CalledProcessError(1, args)
            return
        self.assertEqual(args[:3], ['python', str(self.repo / 'scripts/test_desktop_cli.py'), '--binary'])
        self.assertEqual(len(args), 4)
        self.assertEqual(kwargs['timeout'], 180)
        binary = Path(args[3])
        if binary == self.gui:
            self.events.append(('build_smoke', binary))
        else:
            self.assertEqual(binary, self.copied_app / 'Contents/MacOS/chronoscope-desktop')
            self.assertEqual(binary.read_bytes(), self.bundled.read_bytes())
            self.events.append(('packaged_smoke', binary))
            if self.mode == 'mutate_smoke_gui':
                binary.write_bytes(binary.read_bytes() + b'changed during smoke')
            if self.mode in ('mutate_smoke_resource', 'empty_smoke_metadata'):
                metadata = self.copied_app / self.metadata.relative_to(self.app)
                metadata.write_bytes(b'' if self.mode == 'empty_smoke_metadata' else b'changed resource')
            if self.mode == 'mutate_smoke_mode':
                binary.chmod(binary.stat().st_mode ^ 0o100)
            if self.mode == 'bad_smoke':
                raise subprocess.CalledProcessError(1, args)

    def query_subprocess(self, args, **kwargs):
        if args == ['git', 'rev-parse', 'HEAD']:
            return 'fixture commit'
        self.assertEqual(args, ['otool', '-L', str(self.copied_app / 'Contents/MacOS/chronoscope-desktop')])
        self.events.append(('linkage', Path(args[-1])))
        if self.mode == 'mutate_linkage_gui':
            binary = Path(args[-1])
            binary.write_bytes(binary.read_bytes() + b'changed during linkage')
        return 'packaged GUI linkage fixture'

    def stage(self):
        with patch('builtins.print'):
            tester.stage('macos-arm64', self.output, 60 * 1024 * 1024)

    def test_actual_copied_gui_smoke_hash_linkage_and_archive(self):
        self.stage()
        evidence = json.loads((self.output / 'VALIDATION-macos-arm64.json').read_text())
        self.assertEqual(evidence['gui_sha256'], hashlib.sha256(self.bundled.read_bytes()).hexdigest())
        self.assertEqual(evidence['build_tree_gui_sha256'], hashlib.sha256(self.gui.read_bytes()).hexdigest())
        self.assertNotEqual(evidence['gui_sha256'], evidence['build_tree_gui_sha256'])
        self.assertEqual(evidence['linkage'], 'packaged GUI linkage fixture')
        self.assertFalse(evidence['real_device_tests'])
        self.assertIn('packaged desktop CLI/agent/MCP smoke', evidence['automated_tests'])
        self.assertEqual([e[0] for e in self.events], ['notices', 'build_smoke', 'codesign', 'notices', 'packaged_smoke', 'linkage', 'codesign', 'notices'])
        self.assertEqual(self.runs.call_count, 4)
        self.assertEqual(self.notices.call_count, 3)
        self.assertEqual(evidence['archived_gui_sha256'], evidence['gui_sha256'])
        package = self.output / evidence['package']
        with tarfile.open(package, 'r:xz') as archive:
            base = 'Chronoscope/Chronoscope.app/Contents/'
            data = archive.extractfile(base + 'MacOS/chronoscope-desktop').read()
            self.assertEqual(data, self.bundled.read_bytes())
            self.assertEqual(hashlib.sha256(data).hexdigest(), evidence['gui_sha256'])
            self.assertEqual(archive.extractfile(base + 'Resources/Metadata.appintents/extract.actionsdata').read(), self.metadata.read_bytes())
            self.assertEqual(archive.extractfile(base + 'Resources/third-party/LICENSE').read(), b'packaged fixture license')
            self.assertNotIn('Chronoscope/chronoscope-desktop', archive.getnames())
        self.assertEqual(evidence['package_sha256'], hashlib.sha256(package.read_bytes()).hexdigest())
        for line in (self.output / 'SHA256SUMS-macos-arm64.txt').read_text().splitlines():
            digest, name = line.split('  ', 1)
            self.assertEqual(digest, hashlib.sha256((self.output / name).read_bytes()).hexdigest())

    def test_codesign_refusal_fails_closed_before_packaged_smoke(self):
        self.mode = 'bad_codesign'
        with self.assertRaises(subprocess.CalledProcessError):
            self.stage()
        self.assertEqual([e[0] for e in self.events], ['notices', 'build_smoke', 'codesign'])
        self.assertEqual(list(self.output.iterdir()), [])

    def test_packaged_smoke_refusal_fails_closed(self):
        self.mode = 'bad_smoke'
        with self.assertRaises(subprocess.CalledProcessError):
            self.stage()
        self.assertEqual(self.events[-1][0], 'packaged_smoke')
        self.assertEqual(list(self.output.iterdir()), [])

    def test_copied_notice_refusal_fails_closed(self):
        self.mode = 'bad_notices'
        with self.assertRaisesRegex(ValueError, 'copied notice refusal'):
            self.stage()
        self.assertNotIn('packaged_smoke', [e[0] for e in self.events])
        self.assertEqual(list(self.output.iterdir()), [])

    def test_missing_metadata_fails_closed(self):
        self.metadata.unlink()
        self.metadata.parent.rmdir()
        with self.assertRaisesRegex(ValueError, 'App Intents metadata missing'):
            self.stage()
        self.assertNotIn('packaged_smoke', [e[0] for e in self.events])
        self.assertEqual(list(self.output.iterdir()), [])

    def test_empty_metadata_fails_closed(self):
        self.metadata.unlink()
        with self.assertRaisesRegex(ValueError, 'App Intents metadata missing'):
            self.stage()
        self.assertEqual(list(self.output.iterdir()), [])

    def test_metadata_checked_in_copy_not_source(self):
        real_copytree = tester.shutil.copytree
        def copytree(source, destination, *args, **kwargs):
            result = real_copytree(source, destination, *args, **kwargs)
            if Path(source) == self.app:
                copied_metadata = Path(destination) / self.metadata.relative_to(self.app)
                copied_metadata.unlink()
            return result
        with patch.object(tester.shutil, 'copytree', side_effect=copytree):
            with self.assertRaisesRegex(ValueError, 'App Intents metadata missing'):
                self.stage()
        self.assertTrue(self.metadata.is_file())
        self.assertEqual(list(self.output.iterdir()), [])

    def test_wrong_bundled_architecture_fails_closed(self):
        self.bundled.write_bytes(self.macho(0x1000007))
        with self.assertRaisesRegex(ValueError, 'Bundled GUI architecture mismatch'):
            self.stage()
        self.assertEqual(list(self.output.iterdir()), [])

    def assert_refused_empty(self, message):
        with self.assertRaisesRegex(ValueError, message):
            self.stage()
        self.assertEqual(list(self.output.iterdir()), [])

    def test_gui_mutated_during_smoke_rejected(self):
        self.mode = 'mutate_smoke_gui'
        self.assert_refused_empty('GUI changed during smoke')

    def test_gui_mutated_during_linkage_rejected(self):
        self.mode = 'mutate_linkage_gui'
        self.assert_refused_empty('GUI changed during linkage')

    def test_resource_mutated_after_initial_seal_rejected(self):
        self.mode = 'mutate_smoke_resource'
        self.assert_refused_empty('Sealed Mac app changed during validation')
        self.assertEqual(sum(e[0] == 'codesign' for e in self.events), 2)

    def test_metadata_emptied_after_initial_seal_rejected(self):
        self.mode = 'empty_smoke_metadata'
        self.assert_refused_empty('App Intents metadata missing or empty')
        self.assertEqual(sum(e[0] == 'codesign' for e in self.events), 2)

    @unittest.skipIf(os.name == 'nt', 'Windows does not implement POSIX executable permission bits')
    def test_gui_mode_mutated_after_initial_seal_rejected(self):
        self.mode = 'mutate_smoke_mode'
        self.assert_refused_empty('Sealed Mac app changed during validation')

    def test_final_strict_seal_refusal_rejected(self):
        self.mode = 'bad_final_codesign'
        with self.assertRaises(subprocess.CalledProcessError):
            self.stage()
        self.assertEqual(list(self.output.iterdir()), [])
        self.assertEqual(sum(e[0] == 'codesign' for e in self.events), 2)

    def test_final_notice_refusal_rejected(self):
        self.mode = 'bad_final_notices'
        self.assert_refused_empty('final copied notice refusal')

    def test_zero_byte_metadata_file_rejected(self):
        self.metadata.write_bytes(b'')
        self.assert_refused_empty('App Intents metadata missing or empty')

    def test_metadata_directory_entry_is_not_metadata(self):
        self.metadata.unlink()
        self.metadata.mkdir()
        self.assert_refused_empty('App Intents metadata missing or empty')

    def test_archive_write_boundary_gui_resource_mode_symlink_mutations(self):
        real_add = tarfile.TarFile.add
        for mode in ('gui', 'resource', 'mode', 'symlink'):
            with self.subTest(mode=mode):
                if mode == 'mode' and os.name == 'nt':
                    self.skipTest('Windows does not implement POSIX executable permission bits')
                self.output = self.base / ('archive-mutation-' + mode)
                def add(archive, name, *args, **kwargs):
                    # Inject after final checks, immediately before tar reads it.
                    if kwargs.get('arcname') == 'Chronoscope':
                        gui = self.copied_app / 'Contents/MacOS/chronoscope-desktop'
                        if mode == 'gui':
                            gui.write_bytes(gui.read_bytes() + b'archive boundary mutation')
                        elif mode == 'resource':
                            (self.copied_app / self.metadata.relative_to(self.app)).write_bytes(b'changed at archive')
                        elif mode == 'mode':
                            gui.chmod(gui.stat().st_mode ^ 0o100)
                        else:
                            (self.copied_app / 'Contents/Resources/new-link').symlink_to('third-party/LICENSE')
                    return real_add(archive, name, *args, **kwargs)
                with patch.object(tarfile.TarFile, 'add', new=add):
                    self.assert_refused_empty('Archived Mac GUI differs|Sealed Mac app changed at archive boundary|Mac app changed during inventory')

    def test_archived_only_gui_mutation_rejected_even_if_staged_copy_restored(self):
        real_add = tarfile.TarFile.add
        def add(archive, name, *args, **kwargs):
            if kwargs.get('arcname') != 'Chronoscope':
                return real_add(archive, name, *args, **kwargs)
            gui = self.copied_app / 'Contents/MacOS/chronoscope-desktop'
            original = gui.read_bytes()
            try:
                gui.write_bytes(original + b'archive only')
                return real_add(archive, name, *args, **kwargs)
            finally:
                gui.write_bytes(original)
        with patch.object(tarfile.TarFile, 'add', new=add):
            self.assert_refused_empty('Archived Mac GUI differs from smoked GUI')

    def test_symlink_and_mode_inventory_survive_archive(self):
        self.bundled.chmod(0o755)
        # Windows chmod cannot set execute bits. Verify preservation of the
        # host's actual mode; the macOS runner also exercises the 0755 fixture.
        expected_mode = self.bundled.stat().st_mode & 0o7777
        (self.app / 'Contents/Resources/license-link').symlink_to('third-party/LICENSE')
        self.stage()
        with tarfile.open(self.output / 'chronoscope-macos-arm64.tar.xz') as archive:
            prefix = 'Chronoscope/Chronoscope.app/Contents/'
            self.assertEqual(archive.getmember(prefix + 'MacOS/chronoscope-desktop').mode, expected_mode)
            link = archive.getmember(prefix + 'Resources/license-link')
            self.assertTrue(link.issym())
            self.assertEqual(link.linkname, 'third-party/LICENSE')

    def test_inventory_limits_fail_closed(self):
        with patch.object(tester, 'MAC_MAX_ENTRIES', 1):
            self.assert_refused_empty('inventory entry cap exceeded')
        self.output = self.base / 'byte-cap'
        with patch.object(tester, 'MAC_MAX_BYTES', 1):
            self.assert_refused_empty('inventory byte cap exceeded')

    def test_mac_config_changes_only_ad_hoc_identity(self):
        # Compare against the retained resource/target configuration, not a mock.
        config = json.loads((Path(__file__).resolve().parent.parent / 'src-tauri/tauri.macos.conf.json').read_text())
        self.assertEqual(config, {'bundle': {
            'targets': ['app', 'dmg'],
            'macOS': {'signingIdentity': '-'},
            'resources': {'../assets/terrain/': 'terrain/',
                          'resources/Metadata.appintents/': 'Metadata.appintents/',
                          '../frontend/dist/third-party/': 'third-party/'}}})


if __name__=='__main__': unittest.main()
