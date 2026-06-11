"""
Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# Smoke-test framework: SmokeFixture + HttpProbe / CliProbe / WsProbe builders.
#
# A smoke test file subclasses SmokeFixture and uses self.http / self.cli /
# self.ws to build probes against the configured OSMO instance. Probes are
# chainable; a terminal .expect_* method runs the probe and asserts.

from __future__ import annotations

import asyncio
import json
import shlex
import subprocess
import time
from typing import Any, Dict, Optional
from urllib.parse import urlparse

from src.lib.utils.client import RequestMethod
from src.lib.utils.osmo_errors import OSMOError
from test.oetf import reporter
from test.oetf.fixture_base import OetfFixture
from test.oetf.osmo_cli import login_cli_to


# --- HttpProbe ---


class HttpProbe:
    """Chainable builder for HTTP probes against the OSMO API.

    Terminals:
      - send() -> dict — non-asserting, returns response body.
      - expect_ok() — asserts service_client.request succeeds (no OSMOError).
      - expect_body_contains(key) — asserts ok + response dict contains key.
      - expect_body(**match) — asserts ok + response contains each key=value.
    """

    def __init__(self, fixture: SmokeFixture, method: str, endpoint: str) -> None:
        self._fixture = fixture
        self._method = method.upper()
        self._endpoint = endpoint.lstrip("/")
        self._params: Dict[str, str] = {}
        self._payload: Optional[Any] = None

    def params(self, **kwargs: Any) -> "HttpProbe":
        self._params.update({k: str(v) for k, v in kwargs.items()})
        return self

    def payload(self, body: Any) -> "HttpProbe":
        self._payload = body
        return self

    def send(self) -> Any:
        return self._fixture.service_client.request(
            method=RequestMethod(self._method),
            endpoint=self._endpoint,
            params=self._params or None,
            payload=self._payload,
        )

    def expect_ok(self) -> None:
        self._send_or_fail()

    def expect_body_contains(self, key: str) -> Any:
        response = self._send_or_fail()
        self._fixture.assertIsInstance(
            response, dict,
            f"{self._method} /{self._endpoint} returned non-dict: {type(response).__name__}",
        )
        self._fixture.assertIn(
            key, response,
            f"{self._method} /{self._endpoint} response missing key {key!r}: {response!r}",
        )
        return response

    def expect_body(self, **match: Any) -> Any:
        response = self._send_or_fail()
        self._fixture.assertIsInstance(response, dict)
        for key, expected in match.items():
            actual = response.get(key)
            self._fixture.assertEqual(
                actual, expected,
                f"{self._method} /{self._endpoint}: expected {key}={expected!r}, got {actual!r}",
            )
        return response

    def _send_or_fail(self) -> Any:
        """Run the HTTP request, record a step, and fail on error.

        Records the step timing and status regardless of outcome. On failure,
        also records request.json + error.txt attachments, then calls
        self._fixture.fail() so unittest records a FAILURE (AssertionError)
        rather than an ERROR — preserving the original expect_ok semantics.
        """
        start_ms = int(time.time() * 1000)
        try:
            response = self.send()
            stop_ms = int(time.time() * 1000)
            self._record_step(reporter.StepStatus.PASSED, start_ms, stop_ms, "", "")
            return response
        except OSMOError as error:
            stop_ms = int(time.time() * 1000)
            message = f"{type(error).__name__}: {error}"
            self._record_step(reporter.StepStatus.FAILED, start_ms, stop_ms, message, "")
            recorder = getattr(self._fixture, "_recorder", None)
            if recorder is not None:
                recorder.record_attachment(
                    "request.json", "application/json",
                    json.dumps({
                        "method": self._method,
                        "endpoint": self._endpoint,
                        "params": self._params,
                        "payload": self._payload,
                    }, indent=2).encode("utf-8"),
                )
                recorder.record_attachment(
                    "error.txt", "text/plain", str(error).encode("utf-8"),
                )
            # Preserve original semantics: wrap OSMOError in AssertionError so
            # unittest records a FAILURE (Allure: failed), not an ERROR (broken).
            self._fixture.fail(f"{self._method} {self._endpoint} failed: {error}")
            raise  # pragma: no cover

    def _record_step(
        self, status: reporter.StepStatus,
        start_ms: int, stop_ms: int, message: str, trace: str,
    ) -> None:
        recorder = getattr(self._fixture, "_recorder", None)
        if recorder is None:
            return
        recorder.record_step(
            name=f"{self._method} /{self._endpoint}",
            status=status,
            start_ms=start_ms,
            stop_ms=stop_ms,
            message=message,
            trace=trace,
        )


# --- CliProbe ---


class CliProbe:
    """Chainable builder for shell-command probes (osmo CLI or any binary)."""

    def __init__(self, fixture: SmokeFixture, command: str) -> None:
        self._fixture = fixture
        self._command = command
        self._timeout_seconds = 30

    def timeout(self, seconds: int) -> "CliProbe":
        self._timeout_seconds = seconds
        return self

    def run(self) -> subprocess.CompletedProcess:
        return subprocess.run(
            shlex.split(self._command),
            capture_output=True,
            text=True,
            timeout=self._timeout_seconds,
            check=False,
        )

    def expect_exit(self, code: int = 0) -> subprocess.CompletedProcess:
        start_ms = int(time.time() * 1000)
        try:
            result = self.run()
        except subprocess.TimeoutExpired:
            stop_ms = int(time.time() * 1000)
            recorder = getattr(self._fixture, "_recorder", None)
            if recorder is not None:
                recorder.record_step(
                    name=self._command,
                    status=reporter.StepStatus.FAILED,
                    start_ms=start_ms,
                    stop_ms=stop_ms,
                    message=f"timed out after {self._timeout_seconds}s",
                )
            self._fixture.fail(
                f"`{self._command}` timed out after {self._timeout_seconds}s"
            )
            raise  # unreachable
        stop_ms = int(time.time() * 1000)
        if result.returncode != code:
            recorder = getattr(self._fixture, "_recorder", None)
            if recorder is not None:
                recorder.record_step(
                    name=self._command,
                    status=reporter.StepStatus.FAILED,
                    start_ms=start_ms,
                    stop_ms=stop_ms,
                    message=f"exit={result.returncode}, expected {code}",
                )
            self._fixture.fail(
                f"`{self._command}` exit={result.returncode}, expected {code}\n"
                f"stdout: {result.stdout[:500]}\n"
                f"stderr: {result.stderr[:500]}"
            )
        recorder = getattr(self._fixture, "_recorder", None)
        if recorder is not None:
            recorder.record_step(
                name=self._command,
                status=reporter.StepStatus.PASSED,
                start_ms=start_ms,
                stop_ms=stop_ms,
            )
        return result

    def expect_stdout_contains(self, text: str) -> subprocess.CompletedProcess:
        result = self.expect_exit(0)
        self._fixture.assertIn(text, result.stdout)
        return result


# --- WsProbe ---


async def _ws_connect(service_client: Any, ws_address: str, endpoint: str, timeout: int) -> None:
    """Open a WebSocket connection and immediately close it.

    Module-level so tests can patch ``test.oetf.smoke_fixture._ws_connect``
    without needing to spin up a real server.
    """
    websocket = await service_client.create_websocket(
        address=ws_address,
        endpoint=endpoint,
        timeout=timeout,
    )
    await websocket.close()


class WsProbe:
    """Probe for WebSocket handshakes via ServiceClient.create_websocket."""

    def __init__(self, fixture: SmokeFixture, endpoint: str) -> None:
        self._fixture = fixture
        self._endpoint = endpoint.lstrip("/")
        self._timeout_seconds = 10

    def timeout(self, seconds: int) -> "WsProbe":
        self._timeout_seconds = seconds
        return self

    def expect_connect(self) -> None:
        parsed = urlparse(self._fixture.config.url)
        ws_scheme = "wss" if parsed.scheme == "https" else "ws"
        ws_address = f"{ws_scheme}://{parsed.netloc}"
        start_ms = int(time.time() * 1000)
        try:
            asyncio.run(_ws_connect(
                self._fixture.service_client,
                ws_address,
                self._endpoint,
                self._timeout_seconds,
            ))
            stop_ms = int(time.time() * 1000)
            recorder = getattr(self._fixture, "_recorder", None)
            if recorder is not None:
                recorder.record_step(
                    name=f"WS /{self._endpoint}",
                    status=reporter.StepStatus.PASSED,
                    start_ms=start_ms,
                    stop_ms=stop_ms,
                )
        except Exception as error:  # pylint: disable=broad-except
            stop_ms = int(time.time() * 1000)
            recorder = getattr(self._fixture, "_recorder", None)
            if recorder is not None:
                recorder.record_step(
                    name=f"WS /{self._endpoint}",
                    status=reporter.StepStatus.FAILED,
                    start_ms=start_ms,
                    stop_ms=stop_ms,
                    message=f"{type(error).__name__}: {error}",
                )
            self._fixture.fail(
                f"WebSocket connect to /{self._endpoint} failed: {error}"
            )


# --- SmokeFixture ---


# osmo CLI login is a process-level resource (cached under ~/.local/state/osmo).
# Track it once per test process so repeat test methods don't re-login.
_CLI_LOGGED_IN = False


class SmokeFixture(OetfFixture):
    """Base class for smoke test files. Provides self.http / self.cli / self.ws.

    Each method returns a chainable probe builder; terminate with .expect_* to
    run + assert.
    """

    def http(self, method: str, endpoint: str) -> HttpProbe:
        return HttpProbe(self, method, endpoint)

    def cli(self, command: str) -> CliProbe:
        # Fresh sandboxes (e.g. Jenkins) have no cached login, so the first
        # `osmo <subcommand>` errors with "Must login first". Auto-login once.
        global _CLI_LOGGED_IN
        if not _CLI_LOGGED_IN and (command == "osmo" or command.startswith("osmo ")):
            login_cli_to(self.config)
            _CLI_LOGGED_IN = True
        return CliProbe(self, command)

    def ws(self, endpoint: str) -> WsProbe:
        return WsProbe(self, endpoint)
