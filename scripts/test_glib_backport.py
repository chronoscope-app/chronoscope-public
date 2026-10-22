#!/usr/bin/env python3
"""Offline static integrity/graph guards; NOT a GLib runtime test."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tomllib
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
VENDOR = ROOT / 'vendor/glib'


class GlibBackport(unittest.TestCase):
    def test_exact_upstream_file_ledger_and_two_line_patch(self):
        ledger = json.loads((VENDOR / 'BACKPORT-FILES.json').read_text())
        self.assertEqual(ledger['archive_sha256'], '233daaf6e83ae6a12a52055f568f9d7cf4671dabb78ff9560ab6da230ce00ee5')
        self.assertEqual(ledger['upstream_fix'], '05dff0ee696f9bcd8617cd48c4b812d046d440cb')
        rows = ledger['files']
        canonical = json.dumps(rows, sort_keys=True, separators=(',', ':')).encode()
        self.assertEqual(hashlib.sha256(canonical).hexdigest(), 'b84b9920a3183d5a580a2b9baf46942bf5916134f2050ba0f04a2fa77c844339')
        self.assertEqual(len(rows), 121)
        expected = {row['path'] for row in rows} | {'BACKPORT.md', 'BACKPORT-FILES.json'}
        self.assertEqual({p.relative_to(VENDOR).as_posix() for p in VENDOR.rglob('*') if p.is_file()}, expected)
        changed = []
        for row in rows:
            content = (VENDOR / row['path']).read_bytes()
            self.assertEqual(len(content), row['local_bytes'], row['path'])
            self.assertEqual(hashlib.sha256(content).hexdigest(), row['local_sha256'], row['path'])
            if row['local_sha256'] != row['upstream_sha256']:
                changed.append(row['path'])
                restored = content.replace(b'let mut p: *mut libc::c_char = std::ptr::null_mut();', b'let p: *mut libc::c_char = std::ptr::null_mut();').replace(b'                &mut p,', b'                &p,')
                self.assertEqual(hashlib.sha256(restored).hexdigest(), row['upstream_sha256'])
                self.assertEqual(len(restored), row['upstream_bytes'])
        self.assertEqual(changed, ['src/variant_iter.rs'])

    def test_compatible_lock_and_excluded_harness(self):
        manifest = tomllib.loads((ROOT / 'Cargo.toml').read_text())
        self.assertEqual(manifest['patch']['crates-io']['glib']['path'], 'vendor/glib')
        self.assertIn('tests/glib-backport', manifest['workspace']['exclude'])
        self.assertEqual(manifest['workspace']['default-members'], ['.'])
        lock = tomllib.loads((ROOT / 'Cargo.lock').read_text())
        packages = [p for p in lock['package'] if p['name'] == 'glib']
        self.assertEqual(len(packages), 1)
        self.assertEqual(packages[0]['version'], '0.18.5')
        self.assertNotIn('source', packages[0])
        self.assertEqual(tomllib.loads((VENDOR / 'Cargo.toml').read_text())['package']['version'], '0.18.5')

    def test_offline_desktop_selects_patch_cli_excludes_glib(self):
        def tree(*args):
            return subprocess.check_output(['cargo', 'tree', '--offline', '--locked', *args], cwd=ROOT, text=True)
        # GTK/GLib is a Linux dependency, independent of the active build target.
        desktop = tree('--target', 'x86_64-unknown-linux-gnu', '-p', 'chronoscope-desktop', '-i', 'glib@0.18.5')
        self.assertTrue(desktop.startswith('glib v0.18.5 (' + str(VENDOR) + ')'))
        cli = tree('-p', 'chronoscope', '--prefix', 'none', '--format', '{p}')
        self.assertFalse(any(line.startswith('glib v') for line in cli.splitlines()))

    def test_linux_graph_target_is_explicit_with_foreign_target(self):
        with mock.patch.dict(os.environ, {'CARGO_BUILD_TARGET': 'x86_64-pc-windows-gnu'}):
            with mock.patch.object(subprocess, 'check_output', side_effect=[
                'glib v0.18.5 (' + str(VENDOR) + ')\n',
                'chronoscope v0.15.1\n',
            ]) as query:
                self.test_offline_desktop_selects_patch_cli_excludes_glib()
        desktop_args = query.call_args_list[0].args[0]
        self.assertEqual(desktop_args[desktop_args.index('--target') + 1], 'x86_64-unknown-linux-gnu')
        self.assertEqual(query.call_count, 2)

    def test_notice_paths_required_by_both_packagers(self):
        import package_notices
        js = (ROOT / 'scripts/package-notices.mjs').read_text()
        for name in ['vendor/glib/LICENSE', 'vendor/glib/COPYRIGHT', 'vendor/glib/BACKPORT.md']:
            self.assertIn(name, package_notices.REQUIRED_FILES)
            self.assertIn('"' + name + '"', js)


if __name__ == '__main__':
    unittest.main()
