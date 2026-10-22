#!/usr/bin/env python3
"""Temporary fixture-only ZIP/notice/AppDir tests; no builds or AppImage plugin."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile
import unittest
import zipfile

import package_source as source
import package_notices as notices

ROOT = Path(__file__).resolve().parent.parent
NODE = shutil.which('node')


def put(root, name, content='fixture notice\n'):
    file = root / name
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(content)
    return file


class SourceArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='chronoscope-source-test-')
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.repo = self.base / 'repo'
        self.repo.mkdir()
        self.output = self.base / 'source.zip'
        self.git('init', '-q')
        put(self.repo, 'README.md', 'reviewed source\n')
        put(self.repo, 'scripts/run.sh', '#!/bin/sh\nexit 0\n').chmod(0o755)
        put(self.repo, '.env.example', 'EXAMPLE=\n')
        self.git('add', '.')
        self.git('-c', 'user.name=Packaging fixture', '-c', 'user.email=fixture@example.invalid',
                 'commit', '-qm', 'fixture')

    def git(self, *args):
        return subprocess.check_output(['git', '-c', 'core.hooksPath=/dev/null', '-C', str(self.repo), *args],
                                       stderr=subprocess.STDOUT)

    def test_allowlist_excludes_untracked_and_tracked_generated_secrets(self):
        put(self.repo, 'private-untracked.txt', 'do not export')
        for name in ['.env', '.env.local', 'nested/.env.prod', 'target/debug/file',
                     'frontend/node_modules/ignored', 'frontend/dist/index.html', 'nested/.git/secret']:
            put(self.repo, name, 'excluded')
            if '/.git/' not in name:
                self.git('add', '--force', name)
        put(self.repo, 'README.md', 'tracked local edit\n')
        source.package_source(self.repo, self.output)
        manifest = source.verify_archive(self.output)
        self.assertEqual({e['path'] for e in manifest['files']},
                         {'README.md', 'scripts/run.sh', '.env.example'})
        with zipfile.ZipFile(self.output) as archive:
            self.assertEqual(archive.read('chronoscope/README.md'), b'tracked local edit\n')
            self.assertEqual((archive.getinfo('chronoscope/scripts/run.sh').external_attr >> 16) & 0o777, 0o755)

    def test_archive_bytes_are_reproducible_for_same_inputs(self):
        source.package_source(self.repo, self.output)
        digest = hashlib.sha256(self.output.read_bytes()).digest()
        source.package_source(self.repo, self.output)
        self.assertEqual(digest, hashlib.sha256(self.output.read_bytes()).digest())

    def test_tracked_symlink_rejected(self):
        (self.repo / 'link').symlink_to(self.base / 'not-for-export')
        self.git('add', 'link')
        with self.assertRaises(ValueError):
            source.package_source(self.repo, self.output)
        self.assertFalse(self.output.exists())

    def test_worktree_symlink_cannot_replace_tracked_regular_file(self):
        outside = put(self.base, 'private.txt', 'private fixture')
        (self.repo / 'README.md').unlink()
        (self.repo / 'README.md').symlink_to(outside)
        self.output.write_bytes(b'previous output')
        with self.assertRaises(ValueError):
            source.package_source(self.repo, self.output)
        self.assertEqual(self.output.read_bytes(), b'previous output')
        self.assertEqual(list(self.base.glob('tmp*.zip')), [])

    def test_symlink_ancestor_rejected(self):
        shutil.rmtree(self.repo / 'scripts')
        put(self.base, 'elsewhere/run.sh', 'not source')
        (self.repo / 'scripts').symlink_to(self.base / 'elsewhere', target_is_directory=True)
        with self.assertRaises(ValueError):
            source.package_source(self.repo, self.output)

    def test_missing_tracked_file_rejected(self):
        (self.repo / 'README.md').unlink()
        with self.assertRaises(FileNotFoundError):
            source.package_source(self.repo, self.output)

    def test_unsafe_and_case_colliding_paths_rejected(self):
        for name in ['../escape', '/absolute', 'bad\\name', 'a//b', 'a/./b', 'C:drive', 'line\nname']:
            with self.subTest(name=name), self.assertRaises(ValueError):
                source.safe_name(name)
        # Construct the collision in Git's index: a case-insensitive filesystem
        # cannot materialize README.md and readme.md as distinct regular files.
        blob = self.git('rev-parse', 'HEAD:README.md').decode().strip()
        self.git('update-index', '--add', '--cacheinfo', '100644,' + blob + ',readme.md')
        with self.assertRaises(ValueError):
            source.package_source(self.repo, self.output)

    def test_unmerged_and_submodule_index_rejected(self):
        blob = self.git('rev-parse', 'HEAD:README.md').decode().strip()
        self.git('update-index', '--add', '--cacheinfo', '160000,' + self.git('rev-parse', 'HEAD').decode().strip() + ',submodule')
        with self.assertRaises(ValueError):
            source.tracked_files(self.repo)
        self.git('update-index', '--force-remove', 'submodule')
        subprocess.run(['git', '-C', str(self.repo), 'update-index', '--index-info'],
                       input=('100644 ' + blob + ' 1\tconflicted\n').encode(), check=True)
        with self.assertRaises(ValueError):
            source.tracked_files(self.repo)

    def test_output_cannot_overwrite_checkout_or_follow_links(self):
        with self.assertRaises(ValueError):
            source.package_source(self.repo, self.repo / 'untracked.zip')
        (self.base / 'alias').symlink_to(self.repo, target_is_directory=True)
        with self.assertRaises(ValueError):
            source.package_source(self.repo, self.base / 'alias/output.zip')
        self.output.symlink_to(self.base / 'external.zip')
        with self.assertRaises(ValueError):
            source.package_source(self.repo, self.output)

    def test_manifest_detects_tamper_extra_and_unsafe_entries(self):
        source.package_source(self.repo, self.output)
        with zipfile.ZipFile(self.output) as archive:
            original = {name: archive.read(name) for name in archive.namelist()}
        for mode in ['tamper', 'extra', 'unsafe', 'duplicate']:
            contents = dict(original)
            if mode == 'tamper':
                contents['chronoscope/README.md'] = b'changed'
            elif mode == 'extra':
                contents['chronoscope/unlisted'] = b'extra'
            elif mode == 'unsafe':
                manifest = json.loads(contents['chronoscope/SOURCE-MANIFEST.json'])
                manifest['files'][0]['path'] = '../escape'
                contents['chronoscope/SOURCE-MANIFEST.json'] = json.dumps(manifest).encode()
            elif mode == 'duplicate':
                manifest = json.loads(contents['chronoscope/SOURCE-MANIFEST.json'])
                manifest['files'].append(manifest['files'][0])
                contents['chronoscope/SOURCE-MANIFEST.json'] = json.dumps(manifest).encode()
            bad = self.base / (mode + '.zip')
            with zipfile.ZipFile(bad, 'w') as archive:
                for name, content in contents.items():
                    archive.writestr(name, content)
            with self.subTest(mode=mode), self.assertRaises(ValueError):
                source.verify_archive(bad)


@unittest.skipUnless(NODE, 'installed Node.js required')
class NoticePackagingTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='chronoscope-notice-test-')
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.repo = self.base / 'repo'
        self.repo.mkdir()
        for name in notices.REQUIRED_FILES:
            put(self.repo, name)
        put(self.repo, 'assets/licenses/example-LICENSE.txt')
        put(self.repo, 'frontend/public/licenses/MapLibre-LICENSE.txt')
        put(self.repo, 'NOTICE', 'root notice')
        put(self.repo, 'assets/provenance/example.md', 'provenance')
        self.bundle = self.repo / 'frontend/public/third-party'
        self.run_node('--prepare', self.repo)
        self.appdir = self.base / 'Fake.AppDir'
        self.appdir.mkdir()
        for name in notices.NATIVE_COPYRIGHTS:
            put(self.appdir, name, 'distribution copyright fixture\n')
        put(self.appdir, 'usr/share/doc/libextra/copyright', 'existing extra copyright\n')
        put(self.appdir, 'usr/bin/chronoscope-desktop', 'inert text, never executed')

    def run_node(self, *args, okay=True):
        result = subprocess.run([NODE, str(ROOT / 'scripts/package-notices.mjs'), *map(str, args)],
                                capture_output=True, text=True)
        if okay:
            self.assertEqual(result.returncode, 0, result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0)
        return result

    def stage(self):
        return notices.stage_appdir_notices(self.repo, self.appdir, self.bundle)

    def test_notice_payload_has_root_provenance_and_hashes(self):
        manifest = notices.verify_notices(self.bundle, self.repo)
        paths = {e['path'] for e in manifest['files']}
        self.assertTrue(notices.REQUIRED_FILES <= paths)
        self.assertTrue({'NOTICE', 'assets/provenance/example.md'} <= paths)
        self.run_node('--check', self.bundle)
        self.assertNotIn('usr/bin/chronoscope-desktop', paths)

    def test_missing_required_source_fails_without_replacing_bundle(self):
        before = (self.bundle / notices.MANIFEST).read_bytes()
        (self.repo / 'LICENSE').unlink()
        self.run_node('--prepare', self.repo, okay=False)
        self.assertEqual((self.bundle / notices.MANIFEST).read_bytes(), before)

    def test_symlink_input_and_destination_fail(self):
        (self.repo / 'LICENSE').unlink()
        (self.repo / 'LICENSE').symlink_to(self.base / 'private')
        self.run_node('--prepare', self.repo, okay=False)
        (self.repo / 'LICENSE').unlink()
        put(self.repo, 'LICENSE')
        shutil.rmtree(self.bundle)
        self.bundle.symlink_to(self.base / 'missing-target', target_is_directory=True)
        self.run_node('--prepare', self.repo, okay=False)
        self.assertFalse((self.base / 'missing-target').exists())

    def test_generated_payload_prunes_stale_files(self):
        put(self.bundle, 'stale.txt')
        self.run_node('--prepare', self.repo)
        self.assertFalse((self.bundle / 'stale.txt').exists())
        notices.verify_notices(self.bundle)

    def test_tampering_extra_missing_and_symlink_fail_both_verifiers(self):
        for mode in ['tamper', 'extra', 'missing', 'symlink']:
            fixture = self.base / mode
            shutil.copytree(self.bundle, fixture)
            if mode == 'tamper':
                put(fixture, 'LICENSE', 'modified')
            elif mode == 'extra':
                put(fixture, 'unlisted.txt')
            else:
                (fixture / 'LICENSE').unlink()
                if mode == 'symlink':
                    (fixture / 'LICENSE').symlink_to(self.repo / 'LICENSE')
            with self.subTest(mode=mode), self.assertRaises((ValueError, FileNotFoundError)):
                notices.verify_notices(fixture)
            self.run_node('--check', fixture, okay=False)

    def test_appdir_stages_and_preserves_existing_distro_copyrights(self):
        self.stage()
        manifest = notices.verify_appdir(self.appdir)
        paths = {entry['path'] for entry in manifest['files']}
        self.assertIn('usr/share/doc/libextra/copyright', paths)
        self.assertIn(notices.APP_NOTICES + '/LICENSE', paths)
        self.assertIn(notices.APP_NOTICES + '/' + notices.MANIFEST, paths)
        self.assertNotIn('usr/bin/chronoscope-desktop', paths)
        self.assertEqual((self.appdir / 'usr/share/doc/libextra/copyright').read_text(), 'existing extra copyright\n')

    def test_appdir_native_doc_tamper_and_missing_fail(self):
        self.stage()
        put(self.appdir, notices.NATIVE_COPYRIGHTS[0], 'modified copyright')
        with self.assertRaises(ValueError):
            notices.verify_appdir(self.appdir)
        (self.appdir / notices.NATIVE_COPYRIGHTS[0]).unlink()
        with self.assertRaises(FileNotFoundError):
            self.stage()

    def test_stale_built_notices_refuse_staging(self):
        put(self.repo, 'docs/DATA-ATTRIBUTION.md', 'changed after build')
        with self.assertRaises(ValueError):
            self.stage()
        self.assertFalse((self.appdir / notices.APP_NOTICES).exists())

    def test_new_license_or_optional_notice_requires_rebuild(self):
        for name in ['NOTICE.md', 'assets/licenses/new-LICENSE.txt', 'assets/provenance/new.md']:
            file = put(self.repo, name, 'new notice after build')
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.stage()
            file.unlink()

    def test_appdir_output_symlink_refused(self):
        parent = self.appdir / 'usr/share/chronoscope'
        parent.mkdir(parents=True)
        parent.joinpath('third-party').symlink_to(self.base / 'outside', target_is_directory=True)
        with self.assertRaises(ValueError):
            self.stage()
        self.assertFalse((self.base / 'outside').exists())

    def test_prepare_cesium_runs_with_tiny_fake_vendor_tree(self):
        # Run the actual entry point in isolation with fixture-local imports.
        for name in ['scripts/package-notices.mjs', 'frontend/scripts/prepare-cesium.mjs']:
            target = self.repo / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(ROOT / name, target)
        for name in ['Assets', 'ThirdParty', 'Workers', 'Widgets']:
            put(self.repo, 'frontend/node_modules/cesium/Build/Cesium/' + name + '/fixture.txt')
        put(self.repo, 'frontend/node_modules/cesium/LICENSE.md', 'fake vendor license')
        result = subprocess.run([NODE, str(self.repo / 'frontend/scripts/prepare-cesium.mjs')],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.repo / 'frontend/public/cesium/LICENSE.md').read_text(), 'fake vendor license')
        notices.verify_notices(self.bundle, self.repo)


if __name__ == '__main__':
    unittest.main(verbosity=2)
