"""
Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

import json
import pathlib
import tempfile
import unittest

from test.oetf.ci_summary import classify_oetf_run, render_markdown


class ClassifyOetfRunTest(unittest.TestCase):

    def _run_directory(self):
        temporary_directory = tempfile.TemporaryDirectory()  # pylint: disable=consider-using-with
        self.addCleanup(temporary_directory.cleanup)
        return pathlib.Path(temporary_directory.name)

    def _write_result(self, run_directory, *, failed=0, errored=0, results=None):
        if results is None:
            results = [{
                "status": "pass",
                "target": "//test/scenarios:smoke",
                "message": "",
                "time": 1,
            }]
        data = {
            "total": len(results),
            "passed": 1 if failed == 0 and errored == 0 else 0,
            "failed": failed,
            "errored": errored,
            "skipped": 0,
            "results": results,
        }
        (run_directory / "oetf-result.json").write_text(json.dumps(data))
        wrapper = {"overall": "fail" if failed or errored else "pass"}
        (run_directory / "deployment-test-result.json").write_text(
            json.dumps(wrapper)
        )

    def test_classifies_port_forward_failure_before_logger_assertion(self):
        run_directory = self._run_directory()
        self._write_result(
            run_directory,
            failed=1,
            results=[{
                "status": "fail",
                "target": "//test/scenarios:logger-connectivity",
                "message": "localhost:9100: Connection refused",
                "time": 40,
            }],
        )
        (run_directory / "oetf-pf.log").write_text(
            "error: lost connection to pod\n"
        )

        summary = classify_oetf_run(run_directory)

        self.assertEqual(summary.category, "transport/port-forward")
        self.assertEqual(
            summary.failed_target, "//test/scenarios:logger-connectivity",
        )
        self.assertIn("inconclusive", summary.summary)

    def test_classifies_ordinary_oetf_failure(self):
        run_directory = self._run_directory()
        self._write_result(
            run_directory,
            failed=1,
            results=[{
                "status": "fail",
                "target": "//test/scenarios:task-env",
                "message": "AssertionError: expected value",
            }],
        )

        summary = classify_oetf_run(run_directory)

        self.assertEqual(summary.category, "oetf-test")
        self.assertIn("expected value", summary.summary)

    def test_later_transport_failure_takes_precedence(self):
        run_directory = self._run_directory()
        self._write_result(
            run_directory,
            failed=2,
            results=[
                {
                    "status": "fail",
                    "target": "//test/scenarios:task-env",
                    "message": "AssertionError: expected value",
                },
                {
                    "status": "error",
                    "target": "//test/scenarios:logger-connectivity",
                    "message": "Failed to fetch logs via http://localhost:9100",
                },
            ],
        )

        summary = classify_oetf_run(run_directory)

        self.assertEqual(summary.category, "transport/port-forward")
        self.assertEqual(
            summary.failed_target, "//test/scenarios:logger-connectivity",
        )

    def test_remote_connection_refusal_is_not_a_port_forward_failure(self):
        run_directory = self._run_directory()
        self._write_result(
            run_directory,
            failed=1,
            results=[{
                "status": "fail",
                "target": "//test/scenarios:remote-service",
                "message": "service.example:443: Connection refused",
            }],
        )

        summary = classify_oetf_run(run_directory)

        self.assertEqual(summary.category, "oetf-test")

    def test_recovered_tunnel_does_not_mask_unrelated_failure(self):
        run_directory = self._run_directory()
        self._write_result(
            run_directory,
            failed=1,
            results=[{
                "status": "fail",
                "target": "//test/scenarios:task-env",
                "message": "AssertionError: expected value",
            }],
        )
        (run_directory / "oetf-pf.log").write_text(
            "error: lost connection to pod\nattempt=2/2 start\n"
        )
        (run_directory / "oetf-pf-status.txt").write_text(
            "supervisor_alive=true\nendpoint_healthy=true\nrestart_count=1\n"
        )

        summary = classify_oetf_run(run_directory)

        self.assertEqual(summary.category, "oetf-test")

    def test_empty_result_set_is_a_runner_failure(self):
        run_directory = self._run_directory()
        self._write_result(run_directory, results=[])

        summary = classify_oetf_run(run_directory)

        self.assertEqual(summary.category, "oetf-runner")

    def test_all_pass_results_with_failed_wrapper_is_a_runner_failure(self):
        run_directory = self._run_directory()
        self._write_result(run_directory)
        (run_directory / "deployment-test-result.json").write_text(
            json.dumps({"overall": "fail", "exit_code": 1})
        )

        summary = classify_oetf_run(run_directory)

        self.assertEqual(summary.category, "oetf-runner")
        self.assertIn("wrapper failed", summary.summary)

    def test_classifies_missing_result(self):
        summary = classify_oetf_run(self._run_directory())

        self.assertEqual(summary.category, "oetf-runner")

    def test_reports_recovered_port_forward_without_failing(self):
        run_directory = self._run_directory()
        self._write_result(run_directory)
        (run_directory / "oetf-pf.log").write_text(
            "attempt=1/2 exit rc=1\nattempt=2/2 start\n"
        )

        summary = classify_oetf_run(run_directory)

        self.assertEqual(summary.status, "pass")
        self.assertEqual(summary.category, "transport/recovered")
        self.assertTrue(summary.port_forward_restarted)

    def test_markdown_contains_action_and_target(self):
        run_directory = self._run_directory()
        self._write_result(
            run_directory,
            errored=1,
            results=[{
                "status": "error",
                "target": "//test/scenarios:logger-connectivity",
                "message": "RuntimeError: request failed",
                "time": 2.5,
            }],
        )
        summary = classify_oetf_run(run_directory)

        markdown = render_markdown(run_directory, summary)

        self.assertIn("next action", markdown)
        self.assertIn("//test/scenarios:logger-connectivity", markdown)


if __name__ == "__main__":
    unittest.main()
