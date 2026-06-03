"""
Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# Shared base class for OETF test fixtures (smoke + scenario).

import os
import sys
import time
import traceback
import unittest
from typing import Tuple

from src.lib.utils.client import ServiceClient
from test_infra.oetf import reporter
from test_infra.oetf.auth import create_service_client
from test_infra.oetf.models import OetfConfig


class OetfFixture(unittest.TestCase):
    """Base class: reads OETF_* env vars into self.config + creates a
    ServiceClient, and emits an Allure result JSON per test invocation.

    The Allure emit is unconditional and best-effort: writes go to
    $TEST_UNDECLARED_OUTPUTS_DIR/allure-results/ when the env var is set
    (Bazel sets it for every py_test). When unset (e.g. running from a
    plain `python` invocation) it's a no-op. Failure to write is caught
    and silenced — fixture state is the source of truth, the reporter is
    a side-effect.
    """

    config: OetfConfig
    service_client: ServiceClient
    _recorder: reporter.Recorder

    def setUp(self) -> None:
        super().setUp()
        self.config = OetfConfig.from_env()
        if not self.config.url:
            raise RuntimeError(
                "OETF_URL is not set. Run via `oetf:run --env <env>` or pass "
                "`--test_env=OETF_URL=https://...` to `bazel test`."
            )
        self.service_client = create_service_client(self.config)

    def run(self, result=None):  # type: ignore[override]
        start_ms = int(time.time() * 1000)
        # Always reset the recorder at the start of run(), even if setUp
        # has run. Prevents step/attachment accumulation if an instance
        # were ever invoked twice (defensive — unittest doesn't do this today).
        self._recorder = reporter.Recorder()
        outputs_dir = os.environ.get("TEST_UNDECLARED_OUTPUTS_DIR", "")
        if outputs_dir:
            self._recorder.set_outputs_dir(os.path.join(outputs_dir, "allure-results"))
        result_obj = super().run(result)
        stop_ms = int(time.time() * 1000)
        try:
            self._emit_allure_result(start_ms, stop_ms, result_obj or result)
        except Exception as exc:  # pylint: disable=broad-except
            # Emitter must never break the test pipeline, but surface the
            # cause to stderr so a missing/garbled Allure result is debuggable
            # rather than silently absent.
            print(f"[oetf-reporter] result emit skipped for "
                  f"{self.id()}: {type(exc).__name__}: {exc}",
                  file=sys.stderr)
        return result_obj

    def _emit_allure_result(
        self, start_ms: int, stop_ms: int, test_result
    ) -> None:
        # Use the recorder's outputs dir (set by run() from
        # TEST_UNDECLARED_OUTPUTS_DIR) so we don't re-read the env var
        # and risk diverging if anything mutated it mid-test.
        results_dir = self._recorder.outputs_dir
        if not results_dir:
            return

        status, message, trace = self._classify_outcome(test_result)
        env_name = os.environ.get("OETF_ENV", "unknown")
        target = os.environ.get("OETF_TARGET", self.id())
        actor = os.environ.get("OETF_ACTOR", "unknown")
        tags = [t for t in os.environ.get("OETF_TAGS", "").split(",") if t]
        params = self._gather_parameters()

        reporter.write_result(
            outputs_dir=results_dir,
            recorder=self._recorder,
            env_name=env_name,
            target=target,
            test_name=self._test_method_name(),
            unittest_status=status,
            start_ms=start_ms, stop_ms=stop_ms,
            parameters=params,
            tags=tags,
            actor=actor,
            message=message, trace=trace,
        )

    def _classify_outcome(
        self, test_result,
    ) -> Tuple[reporter.TestStatus, str, str]:
        """Read this test's outcome out of a TestResult object.

        Returns (status, message, trace).
        """
        if test_result is None:
            return reporter.TestStatus.PASSED, "", ""
        for case, exc_info in getattr(test_result, "errors", []):
            if case is self:
                return (reporter.TestStatus.ERROR,
                        _exc_message(exc_info), _exc_trace(exc_info))
        for case, exc_info in getattr(test_result, "failures", []):
            if case is self:
                return (reporter.TestStatus.FAILURE,
                        _exc_message(exc_info), _exc_trace(exc_info))
        for case, reason in getattr(test_result, "skipped", []):
            if case is self:
                return reporter.TestStatus.SKIPPED, str(reason), ""
        return reporter.TestStatus.PASSED, "", ""

    def _gather_parameters(self) -> dict:
        # The workflow URL also lands in recorder.links via
        # record_link("Workflow", ...) and shows in the Overview tab's
        # Links section, but Allure 3 moved it out of the header badge
        # location it had in Allure 2 — surfacing it as a parameter
        # ensures it's visible regardless of where the plugin chooses
        # to render link types in future versions. If a test submits
        # multiple workflows, only the first 'tms' link is shown here;
        # the full set lives in the Links section.
        # TODO: include the K8s node id + platform the workflow ran on
        # (~half day of work — fetch task status from the workflow
        # service post-scheduling, wire from runner_fixture).
        params = {}
        if hasattr(self, "config") and self.config:
            if self.config.pool:
                params["pool"] = self.config.pool
        recorder = getattr(self, "_recorder", None)
        if recorder is not None:
            for link in recorder.links:
                if link.get("type") == "tms" and link.get("url"):
                    params["workflow"] = link["url"]
                    break
        return params

    def _test_method_name(self) -> str:
        # 'TestFoo.test_bar' from `self.id()` -> 'test_bar'
        return self.id().rsplit(".", 1)[-1]


def _exc_message(exc_info) -> str:
    """Extract just the canonical 'ExceptionType: message' header line from
    a unittest error/failure entry.

    unittest stores formatted traceback STRINGS in `result.errors` /
    `result.failures` (via TestResult._exc_info_to_string). In Python's
    standard formatting, the exception line is anchored at COLUMN 0
    ('ValueError: ...', 'AssertionError: ...') and any continuation
    lines (multi-line messages) are indented. We return ONLY the
    column-0 header so Allure's top-level Reason shows a tight summary;
    the full multi-line content lives in the `trace` (Show trace view).

    For chained exceptions ('During handling of...'), return the LAST
    chained exception's header — that's the one that actually
    propagated out of the test.
    """
    if exc_info is None:
        return ""
    text = exc_info if isinstance(exc_info, str) else _format_tuple(exc_info)
    if not text.strip():
        return ""
    lines = text.rstrip().splitlines()
    for index in range(len(lines) - 1, -1, -1):
        line = lines[index]
        if not line:
            continue
        # Skip indented lines (frame, source context, continuation).
        if line[0] in (" ", "\t"):
            continue
        # Skip column-0 headers/chain markers.
        if line.startswith("Traceback "):
            continue
        if line.startswith("During handling of") or line.startswith("The above exception"):
            continue
        # Found the exception header — return it alone, no continuation.
        return line.strip()[:500]
    return text.strip().splitlines()[0][:500] if text.strip() else ""


def _exc_trace(exc_info) -> str:
    """Return the full formatted traceback for an error/failure entry."""
    if exc_info is None:
        return ""
    if isinstance(exc_info, str):
        return exc_info
    return _format_tuple(exc_info)


def _format_tuple(exc_info) -> str:
    if isinstance(exc_info, tuple) and len(exc_info) == 3:
        return "".join(traceback.format_exception(*exc_info))
    return str(exc_info)
