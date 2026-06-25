"""
Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# Unit tests for log_summary.summarize_lines.
#
# Samples are pasted from real OETF bazel test.log files — single-line
# AssertionError, multi-line AssertionError (workflow failure reason with
# an embedded bullet), multiple failures, setUp crash, ERROR log noise.

import textwrap
import unittest

from test.oetf.log_summary import summarize_lines


def _as_lines(text: str) -> list:
    """Render a triple-quoted string to `readlines()`-style list."""
    return [line + "\n" for line in textwrap.dedent(text).lstrip("\n").splitlines()]


class SummarizeLinesTest(unittest.TestCase):

    def test_single_line_assertion_error(self):
        """smoke:cli-checks — vanilla AssertionError from a CliProbe."""
        log = _as_lines("""\
            Executing tests from //test/smoke:cli-checks
            -----------------------------------------------------------------------------
            FF.F
            ======================================================================
            FAIL: test_pool_list (__main__.CliChecks.test_pool_list)
            ----------------------------------------------------------------------
            Traceback (most recent call last):
              File "<snip>", line 34, in test_pool_list
                self.cli("osmo pool list").expect_exit(0)
            AssertionError: `osmo pool list` exit=2, expected 0

            ----------------------------------------------------------------------
            Ran 4 tests in 12.0s

            FAILED (failures=1)
        """)
        self.assertEqual(
            summarize_lines(log),
            "test_pool_list: AssertionError: `osmo pool list` exit=2, expected 0",
        )

    def test_multi_line_assertion_message(self):
        """scenarios:serial — AssertionError with an embedded newline in the
        assertion text (workflow failure reason broken across two lines).
        """
        log = _as_lines("""\
            ..ERROR:root:Server responded with status code 400
            .F..
            ======================================================================
            FAIL: test_serial_workflow (__main__.SerialWorkflows.test_serial_workflow)
            ----------------------------------------------------------------------
            Traceback (most recent call last):
              File "<snip>", line 51, in test_serial_workflow
            AssertionError: Workflow serial-workflow-1842 (https://staging.example/workflows/serial-workflow-1842): expected outcome=completed (status in ['COMPLETED']), got FAILED. First failure: task1: Failure reason:
            - Exit code 510 due to Task osmo-init failure.

            ----------------------------------------------------------------------
            Ran 6 tests in 530.5s

            FAILED (failures=1)
        """)
        result = summarize_lines(log)
        self.assertIn("test_serial_workflow", result)
        self.assertIn("AssertionError", result)
        self.assertIn("Failure reason:", result)
        # The continuation line with the actual cause must be joined in.
        self.assertIn("Exit code 510", result)

    def test_multiple_failures_show_first_plus_count(self):
        """scenarios:exec-portforward style — 2 FAIL blocks, we show the
        first and hint at the rest."""
        log = _as_lines("""\
            EE
            ======================================================================
            ERROR: test_exec_workflow (__main__.ExecPortforwardWorkflows.test_exec_workflow)
            ----------------------------------------------------------------------
            Traceback (most recent call last):
              File "<snip>"
            src.lib.utils.osmo_errors.OSMOSubmissionError: There are no resources in platform ovx-a40 and pool default!

            ======================================================================
            ERROR: test_portforward_workflow (__main__.ExecPortforwardWorkflows.test_portforward_workflow)
            ----------------------------------------------------------------------
            Traceback (most recent call last):
              File "<snip>"
            src.lib.utils.osmo_errors.OSMOSubmissionError: There are no resources in platform ovx-a40 and pool default!

            ----------------------------------------------------------------------
            Ran 2 tests in 4.6s

            FAILED (errors=2)
        """)
        result = summarize_lines(log)
        self.assertTrue(result.startswith("test_exec_workflow: "))
        self.assertIn("OSMOSubmissionError", result)
        self.assertNotIn("src.lib.utils.osmo_errors", result)   # module prefix stripped
        self.assertTrue(result.endswith("(+1 more)"))

    def test_dotted_exception_class_is_stripped(self):
        """src.lib.utils.osmo_errors.OSMOError → OSMOError."""
        log = _as_lines("""\
            ======================================================================
            ERROR: test_x (__main__.T.test_x)
            ----------------------------------------------------------------------
            Traceback (most recent call last):
              File "<snip>"
            src.lib.utils.osmo_errors.OSMOCredentialError: Could not find the credential: omni_svc.

            ----------------------------------------------------------------------
            Ran 1 test in 0.1s

            FAILED (errors=1)
        """)
        self.assertEqual(
            summarize_lines(log),
            "test_x: OSMOCredentialError: Could not find the credential: omni_svc.",
        )

    def test_server_error_log_lines_are_ignored(self):
        """`ERROR:root:Server responded with status code 400` must NOT match
        the exception regex (it's the root logger, not a traceback)."""
        log = _as_lines("""\
            ERROR:root:Server responded with status code 400
            .
            ======================================================================
            FAIL: test_thing (__main__.T.test_thing)
            ----------------------------------------------------------------------
            Traceback (most recent call last):
            AssertionError: real failure here

            ----------------------------------------------------------------------
            Ran 1 test in 0.1s

            FAILED (failures=1)
        """)
        self.assertEqual(
            summarize_lines(log),
            "test_thing: AssertionError: real failure here",
        )

    def test_setup_crash_before_any_fail_block(self):
        """If setUp() raises, no FAIL: header is emitted — only a bare
        traceback. We should still surface the exception."""
        log = _as_lines("""\
            Executing tests from //test/smoke:api-checks
            Traceback (most recent call last):
              File "<snip>", line 43, in setUp
                self.service_client = create_service_client(self.config)
            ValueError: Failed to authenticate with token against https://staging.example

            ----------------------------------------------------------------------
            Ran 0 tests in 0.2s

            FAILED (errors=1)
        """)
        result = summarize_lines(log)
        self.assertIn("ValueError", result)
        self.assertIn("Failed to authenticate", result)

    def test_empty_log_returns_empty_string(self):
        self.assertEqual(summarize_lines([]), "")

    def test_passing_log_returns_empty_string(self):
        """OK run — no FAIL/ERROR block, no exception anywhere."""
        log = _as_lines("""\
            Executing tests from //test/smoke:api-checks
            ....
            ----------------------------------------------------------------------
            Ran 4 tests in 3.0s

            OK
        """)
        self.assertEqual(summarize_lines(log), "")

    def test_traceback_frame_lines_do_not_match(self):
        """`  File "..."` / `    raise X()` / `  ~~~` are not exception lines.
        Only `ClassName: msg` at column 0 should match."""
        log = _as_lines("""\
            ======================================================================
            FAIL: test_x (__main__.T.test_x)
            ----------------------------------------------------------------------
            Traceback (most recent call last):
              File "<snip>", line 51, in test_x
                raise ValueError("inner")
                ~~~~~~~~~~~~~~~~~~~~~~~~^
            AssertionError: outer

            ----------------------------------------------------------------------
            Ran 1 test in 0.1s

            FAILED (failures=1)
        """)
        # The actual exception is the last `ClassName:` line in the block:
        # unittest always prints AssertionError (the uncaught one) as the
        # final block line, so we should catch that — not the `raise` line
        # from the traceback body.
        self.assertEqual(
            summarize_lines(log),
            "test_x: AssertionError: outer",
        )

    def test_message_is_truncated_to_400_chars(self):
        long_message = "x" * 1000
        log = _as_lines(f"""\
            ======================================================================
            FAIL: test_big (__main__.T.test_big)
            ----------------------------------------------------------------------
            AssertionError: {long_message}

            ----------------------------------------------------------------------
            Ran 1 test in 0.1s

            FAILED (failures=1)
        """)
        result = summarize_lines(log)
        self.assertLessEqual(len(result), 400)
        self.assertTrue(result.startswith("test_big: AssertionError: "))


if __name__ == "__main__":
    unittest.main()
