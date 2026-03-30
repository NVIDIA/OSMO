# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Tests for the plugin base types and registry."""

import unittest
from coverage_agent.plugins import _instances, get_writer, register_plugin
from coverage_agent.plugins.base import (
    GeneratedTest,
    TestType,
    ValidationResult,
    WriterPlugin,
    detect_test_type,
    determine_test_path,
)


class TestWriterPluginABC(unittest.TestCase):
    """Tests that WriterPlugin enforces its abstract interface contract."""

    def test_writer_plugin_is_abstract(self):
        with self.assertRaises(TypeError):
            WriterPlugin()  # pylint: disable=abstract-class-instantiated


class TestGeneratedTest(unittest.TestCase):
    """Tests for the GeneratedTest data class fields."""

    def test_generated_test_fields(self):
        test = GeneratedTest(
            test_file_path="src/lib/utils/tests/test_common.py",
            test_content="import unittest\n\nclass TestCommon(unittest.TestCase):\n    pass\n",
            build_entry="osmo_py_test(name = \"test_common\", srcs = [\"test_common.py\"])",
        )
        self.assertEqual(test.test_file_path, "src/lib/utils/tests/test_common.py")
        self.assertIn("unittest", test.test_content)
        self.assertIn("osmo_py_test", test.build_entry)

    def test_generated_test_no_build_entry(self):
        test = GeneratedTest(
            test_file_path="src/utils/roles/roles_new_test.go",
            test_content="package roles\n",
            build_entry=None,
        )
        self.assertIsNone(test.build_entry)


class TestValidationResult(unittest.TestCase):
    """Tests for the ValidationResult data class fields."""

    def test_validation_result_passed(self):
        result = ValidationResult(passed=True, output="PASSED", retry_hint=None)
        self.assertTrue(result.passed)
        self.assertIsNone(result.retry_hint)

    def test_validation_result_failed(self):
        result = ValidationResult(
            passed=False,
            output="ImportError: No module named 'foo'",  # pylint: disable=inconsistent-quotes
            retry_hint="Fix import: 'foo' does not exist",  # pylint: disable=inconsistent-quotes
        )
        self.assertFalse(result.passed)
        self.assertIn("ImportError", result.output)
        self.assertIn("Fix import", result.retry_hint)


class _DummyWriter(WriterPlugin):
    """Minimal concrete plugin for testing the registry."""

    def __init__(self, provider: str = "dummy"):
        self.provider = provider
        self.call_count = 0

    def generate_test(self, source_path, uncovered_ranges, existing_test_path=None,
                      test_type=TestType.PYTHON, build_package="", retry_context=None):
        self.call_count += 1
        return GeneratedTest(test_file_path="test.py", test_content="", build_entry=None)

    def validate_test(self, test):
        return ValidationResult(passed=True, output="", retry_hint=None)


class TestPluginRegistry(unittest.TestCase):
    """Would have caught: get_writer() creating new instances on every call,
    breaking ClaudeCodeWriter session resumption."""

    def setUp(self):
        _instances.clear()
        register_plugin("dummy", _DummyWriter)

    def tearDown(self):
        _instances.pop("dummy", None)

    def test_get_writer_returns_same_instance(self):
        writer1 = get_writer("dummy")
        writer2 = get_writer("dummy")
        self.assertIs(writer1, writer2)

    def test_get_writer_preserves_state_across_calls(self):
        writer = get_writer("dummy")
        writer.generate_test("foo.py", [])
        self.assertEqual(writer.call_count, 1)

        same_writer = get_writer("dummy")
        self.assertEqual(same_writer.call_count, 1)

    def test_get_writer_unknown_raises(self):
        with self.assertRaises(KeyError):
            get_writer("nonexistent")


class TestDetermineTestPath(unittest.TestCase):
    """Would have caught: _determine_test_path duplicated in two plugins
    with potential divergence."""

    def test_python_test_path(self):
        path = determine_test_path("src/lib/utils/common.py", TestType.PYTHON)
        self.assertEqual(path, "src/lib/utils/tests/test_common.py")

    def test_go_test_path(self):
        path = determine_test_path("src/utils/roles/roles.go", TestType.GO)
        self.assertEqual(path, "src/utils/roles/roles_test.go")

    def test_ui_test_path(self):
        path = determine_test_path("src/ui/src/lib/utils.ts", TestType.UI)
        self.assertEqual(path, "src/ui/src/lib/utils.test.ts")


class TestDetectTestTypeCentralized(unittest.TestCase):
    """Would have caught: test-type detection duplicated in 3 places
    with inconsistent behavior (one defaulting to 'python', one returning None)."""

    def test_python_file(self):
        self.assertEqual(detect_test_type("src/lib/foo.py"), TestType.PYTHON)

    def test_go_file(self):
        self.assertEqual(detect_test_type("src/utils/bar.go"), TestType.GO)

    def test_ui_ts_file(self):
        self.assertEqual(detect_test_type("src/ui/src/lib/baz.ts"), TestType.UI)

    def test_non_ui_ts_file_returns_none(self):
        self.assertIsNone(detect_test_type("src/scripts/tool.ts"))

    def test_unknown_file_returns_none(self):
        self.assertIsNone(detect_test_type("src/config.yaml"))

    def test_go_test_file(self):
        self.assertEqual(detect_test_type("src/utils/roles/roles_test.go"), TestType.GO)


if __name__ == "__main__":
    unittest.main()
