"""
Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

import os
import tempfile
import unittest
from typing import Any, cast
from unittest.mock import MagicMock, patch

from src.lib.utils.osmo_errors import OSMOError
from test.oetf import reporter
from test.oetf.smoke_fixture import CliProbe, HttpProbe, SmokeFixture, WsProbe


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
        with patch("subprocess.run", return_value=completed) as run:
            CliProbe(stub, "echo hi").expect_exit(0)  # type: ignore[arg-type]
        run.assert_called_once_with(
            ["echo", "hi"],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        self.assertEqual(len(stub._recorder.steps), 1)  # pylint: disable=protected-access
        self.assertEqual(stub._recorder.steps[0]["name"], "echo hi")  # pylint: disable=protected-access
        self.assertEqual(stub._recorder.steps[0]["status"], "passed")  # pylint: disable=protected-access

    def test_argv_command_preserves_each_argument(self):
        stub = _Stub()
        completed = MagicMock(returncode=0, stdout="ok", stderr="")
        argv = ["osmo", "workflow", "list", "--filter", "name=a b;$(false)"]
        with patch("subprocess.run", return_value=completed) as run:
            CliProbe(stub, argv).expect_exit(0)  # type: ignore[arg-type]
        run.assert_called_once_with(
            argv,
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )

    def test_expect_json_parses_stdout(self):
        stub = _Stub()
        completed = MagicMock(
            returncode=0,
            stdout='{"profile": {"username": "user@example.com"}}',
            stderr="",
        )
        with patch("subprocess.run", return_value=completed):
            result = CliProbe(
                cast(Any, stub),
                ["osmo", "profile", "list"],
            ).expect_json()
        self.assertEqual(
            result,
            {"profile": {"username": "user@example.com"}},
        )

    def test_expect_json_failure_is_clear_and_bounded(self):
        stub = _Stub()
        completed = MagicMock(
            returncode=0,
            stdout="not-json" + ("x" * 10_000),
            stderr="",
        )
        with patch("subprocess.run", return_value=completed):
            with self.assertRaises(AssertionError) as raised:
                CliProbe(stub, ["osmo", "profile", "list"]).expect_json()  # type: ignore[arg-type]
        message = str(raised.exception)
        self.assertIn("returned invalid JSON", message)
        self.assertIn("stdout length: 10008 characters", message)
        self.assertLess(len(message), 700)


class SmokeFixtureCliTest(unittest.TestCase):
    def test_cli_replaces_literal_osmo_and_logs_in_once(self):
        stub = _Stub()
        completed = MagicMock(returncode=0, stdout="{}", stderr="")
        with (
            patch("test.oetf.smoke_fixture._CLI_LOGGED_IN", False),
            patch("test.oetf.smoke_fixture.login_cli_to") as login,
            patch(
                "test.oetf.smoke_fixture.resolve_osmo_cli",
                return_value="/path with spaces/osmo",
            ),
            patch("subprocess.run", return_value=completed) as run,
        ):
            SmokeFixture.cli(
                cast(Any, stub),
                ["osmo", "profile", "list", "--format-type", "json"],
            ).expect_exit(0)
            SmokeFixture.cli(
                cast(Any, stub),
                ["osmo", "credential", "--format-type", "json", "list"],
            ).expect_exit(0)

        login.assert_called_once_with(stub.config)
        self.assertEqual(
            [call.args[0] for call in run.call_args_list],
            [
                [
                    "/path with spaces/osmo",
                    "profile",
                    "list",
                    "--format-type",
                    "json",
                ],
                [
                    "/path with spaces/osmo",
                    "credential",
                    "--format-type",
                    "json",
                    "list",
                ],
            ],
        )

    def test_cli_does_not_replace_non_osmo_binary(self):
        stub = _Stub()
        with (
            patch("test.oetf.smoke_fixture._CLI_LOGGED_IN", False),
            patch("test.oetf.smoke_fixture.login_cli_to") as login,
            patch("test.oetf.smoke_fixture.resolve_osmo_cli") as resolve,
            patch(
                "subprocess.run",
                return_value=MagicMock(returncode=0, stdout="", stderr=""),
            ) as run,
        ):
            SmokeFixture.cli(
                cast(Any, stub),
                ["osmo-helper", "profile", "list"],
            ).expect_exit(0)

        login.assert_not_called()
        resolve.assert_not_called()
        self.assertEqual(
            run.call_args.args[0],
            ["osmo-helper", "profile", "list"],
        )


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
