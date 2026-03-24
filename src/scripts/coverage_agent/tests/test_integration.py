# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

import os
import tempfile
import unittest
from unittest.mock import MagicMock, patch

from coverage_agent.graph import route_quality, route_validation
from coverage_agent.lcov_parser import CoverageEntry
from coverage_agent.nodes.analyze import select_targets
from coverage_agent.nodes.quality_gate import quality_gate
from coverage_agent.plugins.base import GeneratedTest, ValidationResult, WriterPlugin
from coverage_agent.state import CoverageState, CoverageTarget


GOOD_GENERATED_TEST = """\
# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

import unittest

from src.lib.utils.common import format_bytes


class TestFormatBytes(unittest.TestCase):
    def test_format_bytes_zero(self):
        result = format_bytes(0)
        self.assertEqual(result, "0 B")

    def test_format_bytes_kilobytes(self):
        result = format_bytes(1024)
        self.assertEqual(result, "1.0 KB")

    def test_format_bytes_negative_raises_error(self):
        with self.assertRaises(ValueError):
            format_bytes(-1)
"""

BAD_GENERATED_TEST_WITH_LOOP = """\
import unittest

from src.lib.utils.common import process_items


class TestProcessItems(unittest.TestCase):
    def test_process_all_items(self):
        items = [1, 2, 3, 4, 5]
        for item in items:
            result = process_items(item)
            self.assertIsNotNone(result)
"""


class MockWriter(WriterPlugin):
    """A mock writer plugin for integration testing."""

    def __init__(self, test_content: str = GOOD_GENERATED_TEST, should_pass: bool = True):
        self.test_content = test_content
        self.should_pass = should_pass

    def generate_test(self, source_path, uncovered_ranges, existing_test_path=None,
                      test_type="python", build_package="", retry_context=None):
        test_file_path = os.path.join(
            os.path.dirname(source_path), "tests",
            f"test_{os.path.splitext(os.path.basename(source_path))[0]}.py",
        )
        return GeneratedTest(
            test_file_path=test_file_path,
            test_content=self.test_content,
            build_entry=None,
        )

    def validate_test(self, test):
        return ValidationResult(
            passed=self.should_pass,
            output="PASSED" if self.should_pass else "FAILED: ImportError",
            retry_hint=None if self.should_pass else "Fix import error",
        )


class TestAnalyzeToQualityGatePipeline(unittest.TestCase):
    """Integration test: analyze → select targets → quality gate (no LLM needed)."""

    def test_quality_gate_keeps_good_tests(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            # Write a good test file
            test_path = os.path.join(tmpdir, "test_good.py")
            with open(test_path, "w") as file:
                file.write(GOOD_GENERATED_TEST)

            state: CoverageState = {
                "provider": "nemotron",
                "targets": [],
                "current_index": 0,
                "generated_files": [test_path],
                "last_generated": None,
                "validation_passed": True,
                "validation_output": "",
                "retry_count": 0,
                "max_retries": 3,
                "max_targets": 3,
                "min_coverage_delta": 0.5,
                "pr_url": None,
                "branch_name": "test",
                "dry_run": True,
                "errors": [],
            }

            result = quality_gate(state)
            self.assertEqual(len(result["generated_files"]), 1)
            self.assertEqual(route_quality(result), "create_pr")

    def test_quality_gate_filters_bad_tests(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            # Write a bad test file (has loop)
            test_path = os.path.join(tmpdir, "test_bad.py")
            with open(test_path, "w") as file:
                file.write(BAD_GENERATED_TEST_WITH_LOOP)

            state: CoverageState = {
                "provider": "nemotron",
                "targets": [],
                "current_index": 0,
                "generated_files": [test_path],
                "last_generated": None,
                "validation_passed": True,
                "validation_output": "",
                "retry_count": 0,
                "max_retries": 3,
                "max_targets": 3,
                "min_coverage_delta": 0.5,
                "pr_url": None,
                "branch_name": "test",
                "dry_run": True,
                "errors": [],
            }

            result = quality_gate(state)
            self.assertEqual(len(result["generated_files"]), 0)
            self.assertEqual(route_quality(result), "abort")
            self.assertTrue(any("BLOCKED" in e for e in result["errors"]))

    def test_routing_retry_then_skip_then_done(self):
        """Test the full routing sequence: fail → retry → fail again → skip → next → done."""
        targets = [
            CoverageTarget("src/a.py", [(1, 10)], 20.0, None, "python", "//src"),
            CoverageTarget("src/b.py", [(1, 5)], 40.0, None, "python", "//src"),
        ]

        # Target 0: fails, retries left → retry
        state = {
            "targets": targets, "current_index": 0, "validation_passed": False,
            "retry_count": 0, "max_retries": 1, "generated_files": [],
        }
        self.assertEqual(route_validation(state), "retry")

        # Target 0: fails again, retries exhausted → skip
        state["retry_count"] = 1
        self.assertEqual(route_validation(state), "skip")

        # Target 1: passes, last target → done
        state["current_index"] = 1
        state["validation_passed"] = True
        self.assertEqual(route_validation(state), "done")


class TestSelectTargetsIntegration(unittest.TestCase):
    def test_select_targets_with_real_entries(self):
        entries = [
            CoverageEntry("src/lib/utils/common.py", 100, 30, 30.0, [(31, 100)]),
            CoverageEntry("src/config.yaml", 50, 0, 0.0, [(1, 50)]),  # Not a testable type
            CoverageEntry("src/tiny.py", 5, 0, 0.0, [(1, 5)]),  # Too small
            CoverageEntry("src/service/core/auth/auth_service.py", 200, 150, 75.0, [(151, 200)]),
        ]
        targets = select_targets(entries, max_targets=5, repo_root="/nonexistent")
        # Should include common.py (30%) and auth_service.py (75%), skip yaml and tiny
        file_paths = [t.file_path for t in targets]
        self.assertIn("src/lib/utils/common.py", file_paths)
        self.assertIn("src/service/core/auth/auth_service.py", file_paths)
        self.assertNotIn("src/config.yaml", file_paths)
        self.assertNotIn("src/tiny.py", file_paths)


if __name__ == "__main__":
    unittest.main()
