# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Tests for the analyze coverage node."""

import os
import tempfile
import unittest

from coverage_agent.lcov_parser import CoverageEntry
from coverage_agent.nodes.analyze import find_existing_test, select_targets, should_skip_file
from coverage_agent.plugins.base import TestType, detect_test_type


class TestDetectTestType(unittest.TestCase):
    """Tests for file-type detection based on path and extension."""

    def test_detect_python(self):
        self.assertEqual(detect_test_type("src/lib/utils/common.py"), TestType.PYTHON)

    def test_detect_go(self):
        self.assertEqual(detect_test_type("src/utils/roles/roles.go"), TestType.GO)

    def test_detect_ui_typescript(self):
        self.assertEqual(detect_test_type("src/ui/src/lib/utils.ts"), TestType.UI)

    def test_detect_ui_tsx(self):
        self.assertEqual(detect_test_type("src/ui/src/components/Button.tsx"), TestType.UI)

    def test_unknown_extension(self):
        self.assertIsNone(detect_test_type("src/data/config.yaml"))


class TestFindExistingTest(unittest.TestCase):
    """Tests for locating existing test files for a given source file."""

    def test_find_python_test(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            source = os.path.join(tmpdir, "src", "lib", "utils", "common.py")
            test_dir = os.path.join(tmpdir, "src", "lib", "utils", "tests")
            test_file = os.path.join(test_dir, "test_common.py")
            os.makedirs(os.path.dirname(source))
            os.makedirs(test_dir)
            with open(source, "w", encoding="utf-8") as file:
                file.close()
            with open(test_file, "w", encoding="utf-8") as file:
                file.close()

            result = find_existing_test(source, "python", repo_root=tmpdir)
            self.assertIsNotNone(result)
            self.assertIn("test_common.py", result)

    def test_find_go_test(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            source = os.path.join(tmpdir, "src", "utils", "roles", "roles.go")
            test_file = os.path.join(tmpdir, "src", "utils", "roles", "roles_test.go")
            os.makedirs(os.path.dirname(source))
            with open(source, "w", encoding="utf-8") as file:
                file.close()
            with open(test_file, "w", encoding="utf-8") as file:
                file.close()

            result = find_existing_test(source, "go", repo_root=tmpdir)
            self.assertIsNotNone(result)
            self.assertIn("roles_test.go", result)

    def test_no_existing_test(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            source = os.path.join(tmpdir, "src", "lib", "new_module.py")
            os.makedirs(os.path.dirname(source))
            with open(source, "w", encoding="utf-8") as file:
                file.close()

            result = find_existing_test(source, "python", repo_root=tmpdir)
            self.assertIsNone(result)


class TestShouldSkipFile(unittest.TestCase):
    """Tests for file-skip heuristics based on line count."""

    def test_skip_small_file(self):
        entry = CoverageEntry(
            "src/foo.py", total_lines=5, covered_lines=0,
            coverage_pct=0.0, uncovered_ranges=[(1, 5)],
        )
        self.assertIsNotNone(should_skip_file(entry, min_lines=10, max_lines=500))

    def test_skip_large_file(self):
        entry = CoverageEntry(
            "src/foo.py", total_lines=600, covered_lines=0,
            coverage_pct=0.0, uncovered_ranges=[(1, 600)],
        )
        self.assertIsNotNone(should_skip_file(entry, min_lines=10, max_lines=500))

    def test_keep_normal_file(self):
        entry = CoverageEntry(
            "src/foo.py", total_lines=100, covered_lines=50,
            coverage_pct=50.0, uncovered_ranges=[(51, 100)],
        )
        self.assertIsNone(should_skip_file(entry, min_lines=10, max_lines=500))


class TestSelectTargets(unittest.TestCase):
    """Tests for coverage target selection from LCOV entries."""

    def test_limit_max_targets(self):
        entries = [
            CoverageEntry(
                f"src/file{i}.py", total_lines=100,
                covered_lines=i * 10, coverage_pct=i * 10.0,
                uncovered_ranges=[],
            )
            for i in range(10)
        ]
        targets = select_targets(entries, max_targets=3, repo_root="/nonexistent")
        self.assertLessEqual(len(targets), 3)

    def test_skip_unknown_types(self):
        entries = [
            CoverageEntry(
                "src/config.yaml", total_lines=50, covered_lines=0,
                coverage_pct=0.0, uncovered_ranges=[(1, 50)],
            ),
        ]
        targets = select_targets(entries, max_targets=5, repo_root="/nonexistent")
        self.assertEqual(len(targets), 0)


if __name__ == "__main__":
    unittest.main()
