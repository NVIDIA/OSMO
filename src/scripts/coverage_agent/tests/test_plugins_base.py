# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

import unittest

from coverage_agent.plugins.base import GeneratedTest, ValidationResult, WriterPlugin


class TestWriterPluginABC(unittest.TestCase):
    def test_writer_plugin_is_abstract(self):
        with self.assertRaises(TypeError):
            WriterPlugin()


class TestGeneratedTest(unittest.TestCase):
    def test_generated_test_fields(self):
        test = GeneratedTest(
            test_file_path="src/lib/utils/tests/test_common.py",
            test_content="import unittest\n\nclass TestCommon(unittest.TestCase):\n    pass\n",
            build_entry='osmo_py_test(name = "test_common", srcs = ["test_common.py"])',
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
    def test_validation_result_passed(self):
        result = ValidationResult(passed=True, output="PASSED", retry_hint=None)
        self.assertTrue(result.passed)
        self.assertIsNone(result.retry_hint)

    def test_validation_result_failed(self):
        result = ValidationResult(
            passed=False,
            output="ImportError: No module named 'foo'",
            retry_hint="Fix import: 'foo' does not exist",
        )
        self.assertFalse(result.passed)
        self.assertIn("ImportError", result.output)
        self.assertIn("Fix import", result.retry_hint)


if __name__ == "__main__":
    unittest.main()
