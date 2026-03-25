# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Tests for the quality gate checks."""

import unittest

from coverage_agent.nodes.quality_gate import QualityCheckResult, check_test_quality


GOOD_PYTHON_TEST = """\
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

NO_ASSERTIONS_TEST = """\
import unittest


class TestBad(unittest.TestCase):
    def test_something(self):
        x = 1 + 1

    def test_another(self):
        pass
"""

PRIVATE_METHOD_TEST = """\
import unittest

from src.lib.utils.common import _internal_helper


class TestBad(unittest.TestCase):
    def test_internal(self):
        result = _internal_helper()
        self.assertEqual(result, 42)
"""

LOGIC_IN_TEST = """\
import unittest

from src.lib.utils.common import process_items


class TestBad(unittest.TestCase):
    def test_process_all(self):
        items = [1, 2, 3, 4, 5]
        for item in items:
            result = process_items(item)
            self.assertIsNotNone(result)
"""

NONDETERMINISTIC_TEST = """\
import random
import unittest

from src.lib.utils.common import shuffle_list


class TestBad(unittest.TestCase):
    def test_shuffle(self):
        items = [1, 2, 3]
        result = shuffle_list(items, seed=random.random())
        self.assertIsNotNone(result)
"""

SLEEP_IN_TEST = """\
import time
import unittest

from src.lib.utils.common import delayed_action


class TestBad(unittest.TestCase):
    def test_delayed(self):
        delayed_action()
        time.sleep(2)
        self.assertTrue(True)
"""

TOO_MANY_ASSERTIONS_TEST = """\
import unittest

from src.lib.utils.common import get_config


class TestConfig(unittest.TestCase):
    def test_config_has_all_fields(self):
        config = get_config()
        self.assertIn("host", config)
        self.assertIn("port", config)
        self.assertIn("database", config)
        self.assertIn("username", config)
        self.assertIn("password", config)
        self.assertIn("timeout", config)
        self.assertIn("retry_count", config)
        self.assertIn("ssl_enabled", config)
"""

GENERIC_NAME_TEST = """\
import unittest

from src.lib.utils.common import parse_url


class TestParseUrl(unittest.TestCase):
    def test_method1(self):
        result = parse_url("https://example.com")
        self.assertEqual(result.host, "example.com")
"""


class TestCheckTestQuality(unittest.TestCase):
    def test_pass_good_test(self):
        result = check_test_quality(GOOD_PYTHON_TEST, "python")
        self.assertTrue(result.passed)
        self.assertEqual(len(result.blocking_issues), 0)

    def test_block_no_assertions(self):
        result = check_test_quality(NO_ASSERTIONS_TEST, "python")
        self.assertFalse(result.passed)
        self.assertTrue(any("assertion" in issue.lower() for issue in result.blocking_issues))

    def test_block_private_method_calls(self):
        result = check_test_quality(PRIVATE_METHOD_TEST, "python")
        self.assertFalse(result.passed)
        self.assertTrue(any(
            "private" in issue.lower() or "internal" in issue.lower()
            for issue in result.blocking_issues
        ))

    def test_block_logic_in_test(self):
        result = check_test_quality(LOGIC_IN_TEST, "python")
        self.assertFalse(result.passed)
        self.assertTrue(any(
            "logic" in issue.lower() or "loop" in issue.lower()
            for issue in result.blocking_issues
        ))

    def test_block_nondeterministic_random(self):
        result = check_test_quality(NONDETERMINISTIC_TEST, "python")
        self.assertFalse(result.passed)
        self.assertTrue(any(
            "deterministic" in issue.lower() or "random" in issue.lower()
            for issue in result.blocking_issues
        ))

    def test_block_nondeterministic_sleep(self):
        result = check_test_quality(SLEEP_IN_TEST, "python")
        self.assertFalse(result.passed)
        self.assertTrue(any(
            "deterministic" in issue.lower() or "sleep" in issue.lower()
            for issue in result.blocking_issues
        ))

    def test_warn_too_many_assertions(self):
        result = check_test_quality(TOO_MANY_ASSERTIONS_TEST, "python")
        # Should pass (warnings don't block) but have warnings
        self.assertTrue(result.passed)
        self.assertTrue(len(result.warnings) > 0)
        self.assertTrue(any(
            "assertion" in w.lower() or "behavior" in w.lower()
            for w in result.warnings
        ))

    def test_warn_generic_name(self):
        result = check_test_quality(GENERIC_NAME_TEST, "python")
        self.assertTrue(result.passed)
        self.assertTrue(len(result.warnings) > 0)
        self.assertTrue(any("name" in w.lower() or "generic" in w.lower() for w in result.warnings))


if __name__ == "__main__":
    unittest.main()
