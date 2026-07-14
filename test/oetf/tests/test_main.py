"""
Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

import argparse
from contextlib import redirect_stdout
import io
from types import SimpleNamespace
import unittest
from unittest import mock

from test.oetf import main as oetf_main


class MainResultContractTest(unittest.TestCase):
    """The OETF wrapper fails closed when Bazel does not run its tests."""

    @staticmethod
    def _result(status: str = "pass") -> dict:
        return {
            "target": "//test:target",
            "classname": "",
            "name": "target",
            "time": 0.1,
            "status": status,
            "message": "",
        }

    @staticmethod
    def _run_main(
        bazel_exit: int,
        results: list[dict],
    ) -> tuple[int, str]:
        args = argparse.Namespace(
            env="staging",
            name="profile-round-trip",
            output_json="",
            tags="",
        )
        env = {
            "auth_token": "test-token",
            "url": "https://staging.example",
        }
        stdout = io.StringIO()
        with mock.patch.object(oetf_main, "parse_args", return_value=args), \
             mock.patch.object(oetf_main, "resolve_env", return_value=env), \
             mock.patch.object(oetf_main, "seed_data_credential"), \
             mock.patch.object(oetf_main, "_bep_path", return_value="/tmp/bep.json"), \
             mock.patch.object(
                 oetf_main,
                 "build_bazel_command",
                 return_value=["bazel", "test", "//test:target"],
             ), \
             mock.patch.object(
                 oetf_main.subprocess,
                 "run",
                 return_value=SimpleNamespace(returncode=bazel_exit),
             ), \
             mock.patch.object(
                 oetf_main,
                 "parse_bep_test_results",
                 return_value=results,
             ), \
             mock.patch.object(oetf_main, "maybe_publish_report"), \
             redirect_stdout(stdout):
            exit_code = oetf_main.main([])
        return exit_code, stdout.getvalue()

    def test_analysis_failure_with_no_results_reports_fail(self):
        exit_code, output = self._run_main(1, [])

        self.assertEqual(exit_code, 1)
        self.assertIn("Bazel exit code: 1", output)
        self.assertIn("(no test results reported by Bazel)", output)
        self.assertIn("RESULT: FAIL", output)
        self.assertNotIn("RESULT: PASS", output)

    def test_zero_results_fail_closed_when_bazel_exits_zero(self):
        exit_code, output = self._run_main(0, [])

        self.assertEqual(exit_code, 1)
        self.assertIn("RESULT: FAIL", output)

    def test_nonzero_bazel_exit_overrides_passing_test_result(self):
        exit_code, output = self._run_main(1, [self._result()])

        self.assertEqual(exit_code, 1)
        self.assertIn("Bazel exit code: 1", output)
        self.assertIn("RESULT: FAIL", output)

    def test_failed_or_errored_result_reports_fail(self):
        for status in ("fail", "error"):
            with self.subTest(status=status):
                exit_code, output = self._run_main(
                    0,
                    [self._result(status)],
                )

                self.assertEqual(exit_code, 1)
                self.assertIn("RESULT: FAIL", output)
                self.assertNotIn("RESULT: PASS", output)

    def test_successful_bazel_run_with_passing_result_reports_pass(self):
        exit_code, output = self._run_main(0, [self._result()])

        self.assertEqual(exit_code, 0)
        self.assertIn("RESULT: PASS", output)


if __name__ == "__main__":
    unittest.main()
