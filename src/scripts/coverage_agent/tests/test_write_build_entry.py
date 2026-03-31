# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Tests for BUILD entry application and validation false-positive detection."""

import os
import tempfile
import unittest
from unittest.mock import patch

from coverage_agent.nodes.write import _apply_build_entry, _generate_default_build_entry
from coverage_agent.tools.test_runner import _run_bazel_test


EXISTING_BUILD = """\
py_test(
    name = "test_cli",
    srcs = ["test_cli.py"],
    deps = ["//src/cli:cli_lib"],
)
"""


class TestApplyBuildEntry(unittest.TestCase):
    """Tests for BUILD entry application logic."""

    def test_generates_entry_from_existing_deps(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            build_path = os.path.join(tmpdir, "BUILD")
            with open(build_path, "w", encoding="utf-8") as build_file:
                build_file.write(EXISTING_BUILD)

            test_file = os.path.join(tmpdir, "test_access_token.py")
            with open(test_file, "w", encoding="utf-8") as test_f:
                test_f.write("# test")

            _apply_build_entry(test_file, "src/cli/access_token.py")

            with open(build_path, encoding="utf-8") as build_file:
                content = build_file.read()
            self.assertIn("test_access_token", content)
            self.assertIn("//src/cli:cli_lib", content)

    def test_skips_duplicate_entry(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            build_path = os.path.join(tmpdir, "BUILD")
            with open(build_path, "w", encoding="utf-8") as build_file:
                build_file.write(EXISTING_BUILD + '\npy_test(name="test_x", srcs=["test_x.py"])\n')

            test_file = os.path.join(tmpdir, "test_x.py")
            with open(test_file, "w", encoding="utf-8") as test_f:
                test_f.write("# test")

            with open(build_path, encoding="utf-8") as build_file:
                before = build_file.read()

            _apply_build_entry(test_file, "src/cli/x.py")

            with open(build_path, encoding="utf-8") as build_file:
                after = build_file.read()
            self.assertEqual(before, after)

    def test_generates_default_entry_from_existing_deps(self):
        entry = _generate_default_build_entry(
            "test_bucket", "test_bucket.py", "src/cli/bucket.py", EXISTING_BUILD,
        )
        self.assertIn("test_bucket", entry)
        self.assertIn("//src/cli:cli_lib", entry)

    def test_generates_default_entry_with_package_fallback(self):
        entry = _generate_default_build_entry(
            "test_foo", "test_foo.py", "src/service/core/foo.py", "",
        )
        self.assertIn("test_foo", entry)
        self.assertIn("//src/service/core", entry)

    def test_no_build_file_logs_warning(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            test_file = os.path.join(tmpdir, "test_orphan.py")
            with open(test_file, "w", encoding="utf-8") as test_f:
                test_f.write("# test")
            # No BUILD file — should not raise, just log warning
            _apply_build_entry(test_file, "src/foo.py")


class TestValidationFalsePositive(unittest.TestCase):
    """Tests that validation fails when bazel has no target for the generated test."""

    def test_fails_when_no_bazel_target(self):
        with patch("coverage_agent.tools.test_runner._file_path_to_bazel_target", return_value=None):
            result = _run_bazel_test("src/cli/tests/test_access_token.py", timeout=60)
            self.assertFalse(result.passed)
            self.assertIn("No Bazel test target", result.output)
            self.assertIsNotNone(result.retry_hint)

    def test_proceeds_when_target_exists(self):
        with patch("coverage_agent.tools.test_runner._file_path_to_bazel_target",
                    return_value="//src/cli/tests:test_access_token"):
            with patch("coverage_agent.tools.test_runner.run_shell") as mock_shell:
                mock_shell.return_value = type(
                    "R", (), {"returncode": 0, "stdout": "PASSED", "stderr": ""},
                )()
                result = _run_bazel_test("src/cli/tests/test_access_token.py", timeout=60)
                self.assertTrue(result.passed)


if __name__ == "__main__":
    unittest.main()
