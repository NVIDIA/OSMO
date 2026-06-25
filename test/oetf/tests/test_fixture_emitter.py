"""
Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

import io
import json
import os
import tempfile
import unittest
from test.oetf import fixture_base, reporter
from test.oetf.fixture_base import _exc_message


class ExcMessageTest(unittest.TestCase):
    def test_extracts_last_exception_line(self):
        formatted = (
            "Traceback (most recent call last):\n"
            "  File \"foo.py\", line 1, in test_x\n"
            "    self.fail('oops')\n"
            "  File \"bar.py\", line 7, in fail\n"
            "    raise OSMOSubmissionError('Platform cpu-x86 does not exist in pool cpu-pool!')\n"
            "src.lib.utils.osmo_errors.OSMOSubmissionError: Platform cpu-x86 does not exist in pool cpu-pool!\n"  # pylint: disable=line-too-long
        )
        expected = (
            "src.lib.utils.osmo_errors.OSMOSubmissionError:"
            " Platform cpu-x86 does not exist in pool cpu-pool!"
        )
        self.assertEqual(_exc_message(formatted), expected)

    def test_handles_chained_exception(self):
        formatted = (
            "Traceback (most recent call last):\n"
            "  File 'a.py', line 1\n"
            "ValueError: original\n"
            "\n"
            "During handling of the above exception, another exception occurred:\n"
            "\n"
            "Traceback (most recent call last):\n"
            "  File 'b.py', line 5\n"
            "RuntimeError: wrapper\n"
        )
        # Should pick the LAST exception (the wrapping one)
        self.assertEqual(_exc_message(formatted), "RuntimeError: wrapper")

    def test_returns_only_header_for_multi_line_message(self):
        """Multi-line exception messages: return only the header line.
        The continuation lines stay in the trace (Show trace view).
        """
        formatted = (
            "Traceback (most recent call last):\n"
            "  File 'x.py', line 1\n"
            "AssertionError: First line of message\nSecond line\nThird line\n"
        )
        self.assertEqual(
            _exc_message(formatted),
            "AssertionError: First line of message",
        )

    def test_empty_returns_empty(self):
        self.assertEqual(_exc_message(""), "")
        self.assertEqual(_exc_message(None), "")

    def test_falls_back_to_text_if_no_exception_block(self):
        self.assertEqual(_exc_message("just some text"), "just some text")

    def test_returns_only_header_skipping_indented_diagnostic_block(self):
        """Multi-line ValueError where continuation lines start with 2-4 spaces.

        Regression: an earlier walker either skipped 4-space-prefixed lines
        as 'source context' (cutting off in the middle of the diagnostic
        block) OR included the entire block (overflowing the Reason cell).
        Now we return JUST the column-0 header — the full block stays in
        the trace.
        """
        formatted = (
            "Traceback (most recent call last):\n"
            "  File \"x.py\", line 1, in test_workflow_cli\n"
            "    .expect_completed()\n"
            "  File \"y.py\", line 2, in expect_completed\n"
            "    self.submit().expect_outcome(\"completed\")\n"
            "ValueError: Workflow workflow-cli-1099"
            " (https://staging.example/workflows/workflow-cli-1099)"
            " did not reach terminal status within 600s (last status: RUNNING)\n"
            "  workflow message: \n"
            "  tasks: workflow-cli=RUNNING\n"
            "  recent events (last 5):\n"
            "    - 2026-04-30 02:14:21+00:00 [workflow-cli] Pulling: ...\n"
            "    - 2026-04-30 02:14:22+00:00 [workflow-cli] Initialized: True\n"
        )
        message = _exc_message(formatted)
        self.assertEqual(
            message,
            "ValueError: Workflow workflow-cli-1099"
            " (https://staging.example/workflows/workflow-cli-1099)"
            " did not reach terminal status within 600s (last status: RUNNING)",
        )
        # Diagnostic context lines must NOT be in the message.
        self.assertNotIn("recent events", message)
        self.assertNotIn("Pulling:", message)


class _DummyFixture(fixture_base.OetfFixture):
    # Skip super().setUp's network/login.
    def setUp(self):  # type: ignore[override]
        self._recorder = reporter.Recorder()

    def test_pass(self):
        self.assertTrue(True)

    def test_fail(self):
        self.assertEqual(1, 2)


class FixtureEmitterTest(unittest.TestCase):
    def _run_one(self, method, tmp):
        os.environ["TEST_UNDECLARED_OUTPUTS_DIR"] = tmp
        os.environ["OETF_ENV"] = "staging"
        os.environ["OETF_TARGET"] = "//x:test_y"
        os.environ["OETF_ACTOR"] = "testuser"
        suite = unittest.TestSuite()
        suite.addTest(_DummyFixture(method))
        runner = unittest.TextTestRunner(stream=io.StringIO(), verbosity=0)
        runner.run(suite)

    def test_pass_writes_result_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._run_one("test_pass", tmp)
            results_dir = os.path.join(tmp, "allure-results")
            files = [f for f in os.listdir(results_dir) if f.endswith("-result.json")]
            self.assertEqual(len(files), 1)
            with open(os.path.join(results_dir, files[0]), encoding="utf-8") as fh:
                payload = json.load(fh)
            self.assertEqual(payload["status"], "passed")
            self.assertEqual(payload["name"], "test_pass")

    def test_fail_writes_failed_status_and_message(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._run_one("test_fail", tmp)
            results_dir = os.path.join(tmp, "allure-results")
            files = [f for f in os.listdir(results_dir) if f.endswith("-result.json")]
            self.assertEqual(len(files), 1)
            with open(os.path.join(results_dir, files[0]), encoding="utf-8") as fh:
                payload = json.load(fh)
            self.assertEqual(payload["status"], "failed")
            self.assertIn("1 != 2", payload["statusDetails"]["message"])

    def test_no_outputs_dir_is_noop(self):
        os.environ.pop("TEST_UNDECLARED_OUTPUTS_DIR", None)
        # Should not raise
        suite = unittest.TestSuite()
        suite.addTest(_DummyFixture("test_pass"))
        runner = unittest.TextTestRunner(stream=io.StringIO(), verbosity=0)
        runner.run(suite)
