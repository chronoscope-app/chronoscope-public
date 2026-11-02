#!/usr/bin/env python3
"""Focused tests for Linux build preparation and conservative source inventory."""
import hashlib
import gzip
import json
import os
from pathlib import Path
import struct
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

import build_linux_apprun as apprun
import package_linux_sources as sources
import check_linux_replacement as replacement
import prepare_linux_build as prepare


class LinuxReleaseToolsTest(unittest.TestCase):
    def test_launcher_refuses_unpinned_source_without_replacing_existing(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); appdir = root / 'appdir'; appdir.mkdir()
            (appdir / 'AppRun').write_text('#!/bin/sh\nexec AppRun.wrapped\n')
            (appdir / 'AppRun.wrapped').write_bytes(b'old launcher')
            for name in apprun.PINNED:
                with self.subTest(name=name):
                    source = root / name.replace('.', '_'); shutil.copytree(apprun.SOURCE, source)
                    (source / name).write_text('tampered')
                    with self.assertRaisesRegex(ValueError, 'Pinned AppRun input differs'):
                        apprun.stage_launcher(appdir, source)
                    self.assertEqual((appdir / 'AppRun.wrapped').read_bytes(), b'old launcher')

    @unittest.skipUnless(sys.platform.startswith('linux'), 'Linux launcher build')
    def test_source_built_launcher_handles_long_installation_path(self):
        with tempfile.TemporaryDirectory() as d:
            appdir = Path(d) / ('a' * 80) / ('b' * 80) / ('c' * 80) / 'appdir'
            bindir = appdir / 'usr/bin'; bindir.mkdir(parents=True)
            (appdir / 'example.desktop').write_text('[Desktop Entry]\nType=Application\nName=Test\nExec=chronoscope-probe\n')
            wrapper = appdir / 'AppRun'
            wrapper.write_text('#!/bin/sh\nexec "$(dirname "$0")/AppRun.wrapped" "$@"\n'); wrapper.chmod(0o755)
            (appdir / 'AppRun.wrapped').write_bytes(b'old launcher')
            executable = bindir / 'chronoscope-probe'
            executable.write_text('#!/bin/sh\nprintf "launcher-ok %s\\n" "$1"\n'); executable.chmod(0o755)
            self.assertGreater(len(str(appdir / 'example.desktop')), 255)
            apprun.stage_launcher(appdir)
            result = subprocess.run([str(wrapper), '--probe'], capture_output=True, text=True, check=True)
            self.assertEqual(result.stdout.strip(), 'launcher-ok --probe')
            docs = appdir / 'usr/share/doc/chronoscope-apprun'
            for name in (*apprun.PINNED, 'README.md'):
                self.assertEqual((docs / name).read_bytes(), (apprun.SOURCE / name).read_bytes())

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

    @unittest.skipUnless(sys.platform.startswith('linux'), 'Linux pkg-config preparation')
    def test_prepared_pkg_config_is_used_by_cargo_and_preserves_sdk_flags(self):
        cargo = shutil.which('cargo')
        cargo_home = Path(os.environ.get('CARGO_HOME', str(Path.home() / '.cargo')))
        crates = list((cargo_home / 'registry/src').glob('*/pkg-config-0.3.34/Cargo.toml'))
        if not cargo or not Path('/usr/bin/pkgconf').is_file() or not crates:
            self.skipTest('Cargo, pkgconf and the locked pkg-config crate are required')
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); checkout = root / 'checkout'; checkout.mkdir()
            sdk = root / 'sdk'; pcdir = sdk / 'usr/lib/x86_64-linux-gnu/pkgconfig'
            pcdir.mkdir(parents=True); (sdk / 'usr/share/pkgconfig').mkdir(parents=True)
            (pcdir / 'chronoscope-probe.pc').write_text(
                f'prefix={sdk}/usr\nlibdir=${{prefix}}/lib/x86_64-linux-gnu\n'
                'includedir=${prefix}/include\nName: probe\nDescription: local fixture\n'
                'Version: 1.0\nLibs: -L${libdir} -lchronoscope_probe\nCflags: -I${includedir}\n')
            tool = root / 'tool'; tool.write_text('fixture')
            def checked(args, env=None):
                if args[0] == str(tool.resolve()):
                    return '3.13' if '-c' in args else 'v22.23.4'
                if args[0] == 'rustc': return 'rustc 1.98.0 (fixture)'
                if args[0] == 'cargo': return 'cargo 1.98.0 (fixture)'
                if args[0] == 'pkg-config': return '1.0'
                if args[0] == 'dpkg-query': return '1.0-1'
                raise AssertionError(args)
            real_is_file = Path.is_file
            def is_file(path):
                text = str(path)
                if text.startswith('/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/') or text.startswith('/usr/share/doc/'):
                    return True
                return real_is_file(path)
            clean = {k: v for k, v in os.environ.items() if not k.startswith(('PKG_CONFIG', 'HOST_PKG_CONFIG', 'TARGET_PKG_CONFIG'))}
            with mock.patch.dict(os.environ, clean, clear=True), \
                 mock.patch.object(prepare, 'ROOT', checkout), \
                 mock.patch.object(prepare, 'run_checked', side_effect=checked), \
                 mock.patch.object(prepare, 'memory_available', return_value=10 * prepare.GIB), \
                 mock.patch.object(Path, 'is_file', is_file):
                exports, _ = prepare.prepare(sdk, root / 'state', tool, tool, tool)
                wrapper = root / 'state/bin/pkgconf'
                self.assertEqual(exports['PKG_CONFIG'], str(wrapper))
                self.assertIn('export PKG_CONFIG=', (root / 'state/environment.sh').read_text())
                env = {**os.environ, **exports, 'CARGO_TARGET_DIR': str(root / 'cargo-target'), 'EXPECTED_SDK': str(sdk),
                       'PKG_CONFIG_ALLOW_SYSTEM_LIBS': '1', 'PKG_CONFIG_ALLOW_SYSTEM_CFLAGS': '1'}
                value = subprocess.check_output([str(wrapper), '--variable=libdir', 'chronoscope-probe'], env=env, text=True).strip()
                self.assertEqual(value, '/usr/lib/x86_64-linux-gnu')
                flags = subprocess.check_output([str(wrapper), '--cflags', '--libs', 'chronoscope-probe'], env=env, text=True)
                self.assertIn(f'-I{sdk}/usr/include', flags)
                self.assertIn(f'-L{sdk}/usr/lib/x86_64-linux-gnu', flags)
                project = root / 'probe'; (project / 'src').mkdir(parents=True)
                (project / 'Cargo.toml').write_text('[package]\nname="probe"\nversion="0.1.0"\nedition="2021"\n'
                    + '[build-dependencies]\npkg-config={path=' + json.dumps(str(crates[0].parent)) + '}\n')
                (project / 'src/main.rs').write_text('fn main() {}\n')
                (project / 'build.rs').write_text(r"""
use std::path::PathBuf;
fn main() {
    assert_eq!(pkg_config::get_variable("chronoscope-probe", "libdir").unwrap(), "/usr/lib/x86_64-linux-gnu");
    let sdk = PathBuf::from(std::env::var("EXPECTED_SDK").unwrap());
    let lib = pkg_config::Config::new().cargo_metadata(false).probe("chronoscope-probe").unwrap();
    assert!(lib.include_paths.contains(&sdk.join("usr/include")));
    assert!(lib.link_paths.contains(&sdk.join("usr/lib/x86_64-linux-gnu")));
}
""")
                subprocess.run([cargo, 'build', '--offline', '--manifest-path', str(project / 'Cargo.toml')],
                               env=env, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                for name in ('PKG_CONFIG_x86_64-unknown-linux-gnu',
                             'PKG_CONFIG_x86_64_unknown_linux_gnu', 'HOST_PKG_CONFIG'):
                    with self.subTest(override=name), mock.patch.dict(os.environ, {name: '/usr/bin/pkg-config'}):
                        with self.assertRaisesRegex(ValueError, 'Conflicting pkg-config override'):
                            prepare.prepare(sdk, root / 'state', tool, tool, tool)

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
            with self.assertRaisesRegex(ValueError, 'Unsafe|Symlink escapes'):
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
