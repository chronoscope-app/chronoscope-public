"""Focused tests for Windows-specific preparation; no policy changes or builds."""
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from windows_build_probe import probe_symlinks, release_profile


class PreparationTests(unittest.TestCase):
    def test_missing_symlink_privilege_is_a_failure_with_original_error(self):
        with tempfile.TemporaryDirectory() as folder:
            error = OSError('fixture privilege unavailable')
            error.winerror = 1314
            with mock.patch.object(Path, 'symlink_to', side_effect=error):
                result = probe_symlinks(folder)
            self.assertFalse(result['passed'])
            self.assertEqual(result['winerror'], 1314)
            self.assertEqual(list(Path(folder).iterdir()), [])

    def test_release_profile_requires_thin_lto_and_one_codegen_unit(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for lto, units, expected in [('thin', 1, True), ('off', 1, False), ('thin', 8, False)]:
                (root / 'Cargo.toml').write_text(f'[profile.release]\nlto="{lto}"\ncodegen-units={units}\n')
                self.assertEqual(release_profile(root)['passed'], expected)

    def test_preparation_has_no_implicit_elevation_or_policy_bypass(self):
        script = (Path(__file__).parent / 'prepare_windows_build.ps1').read_text()
        self.assertNotIn('ExecutionPolicy Bypass', script)
        self.assertNotIn('Set-ExecutionPolicy', script)
        self.assertNotIn('Start-Process', script)
        self.assertIn('if (-not $admin)', script)
        self.assertIn('ShouldProcess', script)


if __name__ == '__main__':
    unittest.main()
