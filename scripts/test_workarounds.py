#!/usr/bin/env python3
import copy
import unittest
from workarounds import load_registry, validate_registry


class WorkaroundTests(unittest.TestCase):
    def test_active_index_has_owners_sources_regressions_and_matching_versions(self):
        self.assertEqual(len(validate_registry(load_registry())), 4)

    def test_dependency_drift_requires_explicit_review(self):
        registry = copy.deepcopy(load_registry())
        registry['workarounds'][0]['constraints'][0]['expected'] = 'unreviewed-version'
        with self.assertRaisesRegex(ValueError, 'dependency changed'):
            validate_registry(registry)

    def test_missing_ownership_or_unsafe_regression_path_is_rejected(self):
        for field, value in [('owner', ''), ('regressions', ['../outside-repository'])]:
            registry = copy.deepcopy(load_registry())
            registry['workarounds'][0][field] = value
            with self.assertRaises(ValueError):
                validate_registry(registry)


if __name__ == '__main__':
    unittest.main()
