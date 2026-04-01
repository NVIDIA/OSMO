# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Tests for PR title, body, and description validation compliance."""

import unittest

from testbot.nodes.create_pr import build_pr_body, build_pr_title
from testbot.state import TestTarget


def _make_state(targets, generated_files):
    """Create minimal state for PR building."""
    return {
        "targets": targets,
        "generated_files": generated_files,
        "provider": "claude",
    }


class TestBuildPrTitle(unittest.TestCase):
    """Tests for PR title generation."""

    def test_single_target(self):
        state = _make_state(
            [TestTarget("src/cli/access_token.py", [], 0.0, None, "python", "//src/cli")],
            ["src/cli/tests/test_access_token.py"],
        )
        title = build_pr_title(state)
        self.assertEqual(title, "[testbot] Add tests for src/cli/access_token.py")

    def test_multiple_targets(self):
        state = _make_state(
            [
                TestTarget("src/cli/app.py", [], 0.0, None, "python", "//src/cli"),
                TestTarget("src/cli/bucket.py", [], 0.0, None, "python", "//src/cli"),
            ],
            ["src/cli/tests/test_app.py", "src/cli/tests/test_bucket.py"],
        )
        title = build_pr_title(state)
        self.assertIn("src/cli/app.py", title)
        self.assertIn("src/cli/bucket.py", title)


class TestBuildPrBody(unittest.TestCase):
    """Tests for PR body generation — must pass validate-pr-description CI check."""

    def test_contains_issue_reference(self):
        state = _make_state(
            [TestTarget("src/foo.py", [], 0.0, None, "python", "//src")],
            ["src/tests/test_foo.py"],
        )
        body = build_pr_body(state)
        self.assertRegex(body, r"Issue (#\d+|#None|- None)")

    def test_contains_checklist_section(self):
        state = _make_state(
            [TestTarget("src/foo.py", [], 0.0, None, "python", "//src")],
            ["src/tests/test_foo.py"],
        )
        body = build_pr_body(state)
        self.assertIn("## Checklist", body)

    def test_all_checklist_items_checked(self):
        state = _make_state(
            [TestTarget("src/foo.py", [], 0.0, None, "python", "//src")],
            ["src/tests/test_foo.py"],
        )
        body = build_pr_body(state)
        # No unchecked boxes
        self.assertNotIn("- [ ]", body)
        # At least one checked box
        self.assertIn("- [x]", body)

    def test_lists_generated_files(self):
        state = _make_state(
            [TestTarget("src/foo.py", [], 0.0, None, "python", "//src")],
            ["src/tests/test_foo.py", "src/tests/test_bar.py"],
        )
        body = build_pr_body(state)
        self.assertIn("src/tests/test_foo.py", body)
        self.assertIn("src/tests/test_bar.py", body)


if __name__ == "__main__":
    unittest.main()
