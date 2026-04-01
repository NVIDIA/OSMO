# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Integration tests for the testbot pipeline stages."""

import os
import tempfile
import unittest

from testbot.graph import route_done, route_review, route_validation
from testbot.lcov_parser import CoverageEntry
from testbot.nodes.analyze import select_targets
from testbot.nodes.review import review_test
from testbot.plugins.base import GeneratedTest
from testbot.state import TestbotState, TestTarget


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

    def test_format_bytes_megabytes(self):
        result = format_bytes(1048576)
        self.assertEqual(result, "1.0 MB")

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


class TestReviewInLoop(unittest.TestCase):
    """Integration: review_test node with good and bad test files."""

    def _make_state(self, test_path, test_content, **overrides):
        """Create state with a generated test file."""
        defaults: TestbotState = {
            "provider": "nemotron",
            "lcov_path": "bazel-out/_coverage/_coverage_report.dat",
            "targets": [
                TestTarget("src/a.py", [(1, 10)], 20.0, None, "python", "//src"),
            ],
            "current_index": 0,
            "generated_files": [],
            "last_generated": GeneratedTest(
                test_file_path=test_path,
                test_content=test_content,
                build_entry=None,
            ),
            "validation_passed": True,
            "validation_output": "",
            "review_passed": False,
            "retry_count": 0,
            "max_retries": 3,
            "max_targets": 3,
            "max_lines": 100,
            "min_coverage_delta": 0.5,
            "pr_url": None,
            "branch_name": "test",
            "dry_run": True,
            "ui_lcov_path": "src/ui/coverage/lcov.info",
            "coverage_source": "local",
            "codecov_token": "",
            "errors": [],
        }
        return {**defaults, **overrides}

    def test_review_passes_good_test(self):
        """Good test passes static review (LLM review skipped without client)."""
        with tempfile.TemporaryDirectory() as tmpdir:
            test_path = os.path.join(tmpdir, "test_good.py")
            with open(test_path, "w", encoding="utf-8") as file:
                file.write(GOOD_GENERATED_TEST)

            state = self._make_state(test_path, GOOD_GENERATED_TEST)
            result = review_test(state)
            self.assertTrue(result["review_passed"])
            self.assertIn(test_path, result["generated_files"])

    def test_review_warns_on_bad_test(self):
        """Bad test (loop in body) produces warnings but is not blocked by static review.

        Logic checks are advisory — the LLM review tier makes the final call.
        Since LLM client is unavailable in tests, LLM review is skipped and test passes.
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            test_path = os.path.join(tmpdir, "test_bad.py")
            with open(test_path, "w", encoding="utf-8") as file:
                file.write(BAD_GENERATED_TEST_WITH_LOOP)

            state = self._make_state(test_path, BAD_GENERATED_TEST_WITH_LOOP)
            result = review_test(state)
            self.assertTrue(result["review_passed"])

    def test_review_block_feeds_back_to_done_routing(self):
        """Blocked review on last target with exhausted retries → done → abort."""
        state = self._make_state(
            "test.py", BAD_GENERATED_TEST_WITH_LOOP,
            review_passed=False, retry_count=3, max_retries=3, current_index=0,
            targets=[TestTarget("src/a.py", [(1, 10)], 20.0, None, "python", "//src")],
        )
        self.assertEqual(route_review(state), "done")
        self.assertEqual(route_done(state), "abort")


class TestRoutingSequences(unittest.TestCase):
    """Test full routing sequences through validate → review → done."""

    def test_validate_pass_to_review(self):
        """Validation pass routes to review."""
        state = {"validation_passed": True, "targets": [None, None], "current_index": 0,
                 "retry_count": 0, "max_retries": 3}
        self.assertEqual(route_validation(state), "review")

    def test_review_pass_next_target(self):
        """Review pass routes to next target."""
        state = {"review_passed": True, "targets": [None, None], "current_index": 0,
                 "retry_count": 0, "max_retries": 3}
        self.assertEqual(route_review(state), "next")

    def test_review_fail_retry(self):
        """Review fail with retries left routes to retry."""
        state = {"review_passed": False, "targets": [None, None], "current_index": 0,
                 "retry_count": 1, "max_retries": 3}
        self.assertEqual(route_review(state), "retry")


class TestSelectTargetsIntegration(unittest.TestCase):
    """Integration: select_targets with mixed entry types."""

    def test_select_targets_with_real_entries(self):
        entries = [
            CoverageEntry("src/lib/utils/common.py", 100, 30, 30.0, [(31, 100)]),
            CoverageEntry("src/config.yaml", 50, 0, 0.0, [(1, 50)]),
            CoverageEntry("src/tiny.py", 5, 0, 0.0, [(1, 5)]),
            CoverageEntry("src/service/core/auth/auth_service.py", 200, 150, 75.0, [(151, 200)]),
        ]
        targets = select_targets(entries, max_targets=5, repo_root="/nonexistent")
        file_paths = [t.file_path for t in targets]
        self.assertIn("src/lib/utils/common.py", file_paths)
        self.assertIn("src/service/core/auth/auth_service.py", file_paths)
        self.assertNotIn("src/config.yaml", file_paths)
        self.assertNotIn("src/tiny.py", file_paths)


if __name__ == "__main__":
    unittest.main()
