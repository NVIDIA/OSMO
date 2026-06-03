"""
Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

import json
import os
import tempfile
import unittest
from unittest.mock import MagicMock

from src.lib.utils.osmo_errors import OSMOSubmissionError

from test.oetf import reporter
from test.oetf.models import WorkflowServerStatus
from test.oetf.runner_fixture import (
    WorkflowBuilder,
    WorkflowHandle,
    _record_step,
)


class RecordStepCmTest(unittest.TestCase):
    def test_cm_records_passed(self):
        recorder = reporter.Recorder()
        fixture = MagicMock(_recorder=recorder)
        with _record_step(fixture, "submit"):
            pass
        self.assertEqual(len(recorder.steps), 1)
        self.assertEqual(recorder.steps[0]["name"], "submit")
        self.assertEqual(recorder.steps[0]["status"], "passed")

    def test_cm_records_failed_and_propagates(self):
        recorder = reporter.Recorder()
        fixture = MagicMock(_recorder=recorder)
        with self.assertRaises(ValueError):
            with _record_step(fixture, "submit"):
                raise ValueError("nope")
        self.assertEqual(len(recorder.steps), 1)
        self.assertEqual(recorder.steps[0]["name"], "submit")
        self.assertEqual(recorder.steps[0]["status"], "failed")
        self.assertIn("nope", recorder.steps[0]["statusDetails"]["message"])

    def test_cm_no_recorder_is_noop(self):
        fixture = MagicMock(spec=[])
        with _record_step(fixture, "submit"):
            pass
        # No assertion — just shouldn't raise


class WorkflowAttachmentTest(unittest.TestCase):
    """Verify expect_outcome records failure attachments when the workflow ends
    in an unexpected state."""

    def _make_fixture(self, recorder: reporter.Recorder) -> MagicMock:
        fixture = MagicMock()
        fixture._recorder = recorder  # pylint: disable=protected-access
        # fail() must raise so _record_step can catch and record it
        fixture.fail.side_effect = AssertionError
        return fixture

    def test_failed_verify_outcome_attaches_workflow_url(self):
        with tempfile.TemporaryDirectory() as tmp:
            recorder = reporter.Recorder()
            recorder.set_outputs_dir(tmp)
            fixture = self._make_fixture(recorder)
            fixture.config.url = "https://staging.osmo.ai"
            handle = WorkflowHandle(fixture=fixture, workflow_id="wf-123", timeout_seconds=60)
            # Stub wait_for_terminal to return a FAILED status dict
            completed_wf = {"status": WorkflowServerStatus.FAILED.value, "groups": []}
            handle.wait_for_terminal = MagicMock(  # type: ignore[method-assign]
                return_value=completed_wf
            )
            with self.assertRaises((AssertionError, Exception)):
                handle.expect_outcome("completed")
            attachment_names = [a["name"] for a in recorder.attachments]
            self.assertIn("workflow_url.txt", attachment_names)
            self.assertIn("failure_messages.txt", attachment_names)
            self.assertIn("server_status_timeline.json", attachment_names)
            # Verify workflow_url content
            url_attach = next(a for a in recorder.attachments if a["name"] == "workflow_url.txt")
            with open(os.path.join(tmp, url_attach["source"]), "rb") as fh:
                url_bytes = fh.read()
            self.assertIn(b"wf-123", url_bytes)
            # Verify timeline is valid JSON
            tl_attach = next(
                a for a in recorder.attachments if a["name"] == "server_status_timeline.json"
            )
            with open(os.path.join(tmp, tl_attach["source"]), "rb") as fh:
                tl_bytes = fh.read()
            self.assertIsInstance(json.loads(tl_bytes), list)


class ExpectFailedSubmissionTest(unittest.TestCase):
    """expect_failed_submission should flip the recorded 'submit' step from
    failed to passed because the failure was the expected behavior."""

    def test_flips_submit_step_to_passed_on_expected_failure(self):
        recorder = reporter.Recorder()
        fixture = MagicMock()
        fixture._recorder = recorder  # pylint: disable=protected-access
        builder = WorkflowBuilder.__new__(WorkflowBuilder)
        builder._fixture = fixture  # pylint: disable=protected-access
        builder._spec_path = "test/workflow/serial_workflow.yaml"  # pylint: disable=protected-access
        # Stub submit() to raise the expected error AFTER recording the step
        # as failed (mirroring the real submit + _record_step interaction).
        def stub_submit():
            recorder.record_step(
                name="submit", status=reporter.StepStatus.FAILED,
                start_ms=0, stop_ms=10,
                message="OSMOSubmissionError: bad params",
                trace="...traceback...",
            )
            raise OSMOSubmissionError("bad params")
        builder.submit = stub_submit  # type: ignore[method-assign]
        builder.expect_failed_submission()  # should NOT raise
        self.assertEqual(len(recorder.steps), 1)
        self.assertEqual(recorder.steps[0]["name"], "submit")
        self.assertEqual(recorder.steps[0]["status"], "passed")
        self.assertIn("Expected failure",
                      recorder.steps[0]["statusDetails"]["message"])

    def test_no_recorder_is_noop(self):
        fixture = MagicMock(spec=[])  # no _recorder attribute
        builder = WorkflowBuilder.__new__(WorkflowBuilder)
        builder._fixture = fixture  # pylint: disable=protected-access
        builder._spec_path = "x.yaml"  # pylint: disable=protected-access
        def stub_submit():
            raise OSMOSubmissionError("bad")
        builder.submit = stub_submit  # type: ignore[method-assign]
        builder.expect_failed_submission()  # should not raise

    def test_raises_when_submission_unexpectedly_succeeds(self):
        recorder = reporter.Recorder()
        fixture = MagicMock()
        fixture._recorder = recorder  # pylint: disable=protected-access
        builder = WorkflowBuilder.__new__(WorkflowBuilder)
        builder._fixture = fixture  # pylint: disable=protected-access
        builder._spec_path = "x.yaml"  # pylint: disable=protected-access
        builder.submit = MagicMock(return_value=MagicMock())  # type: ignore[method-assign]
        with self.assertRaises(AssertionError):
            builder.expect_failed_submission()


if __name__ == "__main__":
    unittest.main()
