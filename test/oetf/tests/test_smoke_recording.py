"""
Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

import os
import tempfile
import unittest
from typing import Any
from unittest.mock import MagicMock, patch

from src.lib.utils.osmo_errors import OSMOError
from test.oetf import reporter
from test.oetf.smoke_fixture import CliProbe, HttpProbe, WsProbe


class _Stub:
    """Minimal stand-in for OetfFixture used by smoke-recording tests."""

    config: Any

    def __init__(self) -> None:
        self._recorder = reporter.Recorder()
        self.service_client = MagicMock()
        self.service_client.request.return_value = {"ok": True}
        self.config = MagicMock()
        self.config.url = "https://example.osmo.ai"

    def fail(self, msg: str) -> None:
        raise AssertionError(msg)


class HttpProbeRecordingTest(unittest.TestCase):
    def test_expect_ok_records_step(self):
        stub = _Stub()
        HttpProbe(stub, "GET", "/health").expect_ok()  # type: ignore[arg-type]
        self.assertEqual(len(stub._recorder.steps), 1)  # pylint: disable=protected-access
        self.assertEqual(stub._recorder.steps[0]["name"], "GET /health")  # pylint: disable=protected-access
        self.assertEqual(stub._recorder.steps[0]["status"], "passed")  # pylint: disable=protected-access

    def test_failed_request_records_failed_step(self):
        stub = _Stub()
        stub.service_client.request.side_effect = OSMOError("boom")
        with self.assertRaises(AssertionError):
            HttpProbe(stub, "GET", "/health").expect_ok()  # type: ignore[arg-type]
        self.assertEqual(len(stub._recorder.steps), 1)  # pylint: disable=protected-access
        self.assertEqual(stub._recorder.steps[0]["status"], "failed")  # pylint: disable=protected-access
        steps = stub._recorder.steps  # pylint: disable=protected-access
        self.assertIn("boom", steps[0]["statusDetails"]["message"])


class CliProbeRecordingTest(unittest.TestCase):
    def test_expect_exit_records_step(self):
        stub = _Stub()
        completed = MagicMock(returncode=0, stdout="ok", stderr="")
        with patch("subprocess.run", return_value=completed):
            CliProbe(stub, "echo hi").expect_exit(0)  # type: ignore[arg-type]
        self.assertEqual(len(stub._recorder.steps), 1)  # pylint: disable=protected-access
        self.assertEqual(stub._recorder.steps[0]["name"], "echo hi")  # pylint: disable=protected-access
        self.assertEqual(stub._recorder.steps[0]["status"], "passed")  # pylint: disable=protected-access


class WsProbeRecordingTest(unittest.TestCase):
    def test_expect_connect_records_step(self):
        async def _noop(*_args: object, **_kwargs: object) -> None:
            return None

        stub = _Stub()
        with patch("test.oetf.smoke_fixture._ws_connect", side_effect=_noop):
            WsProbe(stub, "/api/x").expect_connect()  # type: ignore[arg-type]
        self.assertEqual(len(stub._recorder.steps), 1)  # pylint: disable=protected-access
        self.assertEqual(stub._recorder.steps[0]["status"], "passed")  # pylint: disable=protected-access


class HttpProbeAttachmentTest(unittest.TestCase):
    def test_failed_records_request_and_response_attachments(self):
        with tempfile.TemporaryDirectory() as tmp:
            stub = _Stub()
            stub._recorder.set_outputs_dir(tmp)  # pylint: disable=protected-access
            stub.service_client.request.side_effect = OSMOError("500 server error")
            with self.assertRaises(AssertionError):
                HttpProbe(stub, "POST", "/api/x").payload(  # type: ignore[arg-type]
                    {"k": "v"}
                ).expect_ok()
            names = [a["name"] for a in stub._recorder.attachments]  # pylint: disable=protected-access
            self.assertIn("request.json", names)
            attachments = stub._recorder.attachments  # pylint: disable=protected-access
            self.assertEqual(len(os.listdir(tmp)), len(attachments))


if __name__ == "__main__":
    unittest.main()
