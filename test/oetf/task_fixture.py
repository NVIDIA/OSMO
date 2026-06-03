"""
Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# TaskFixture base class for in-task assertions.
#
# Runs INSIDE workflow containers. Stdlib only — injected into containers
# via the OSMO workflow files field at submission time.
#
# External counterpart: RunnerFixture in runner_fixture.py, which runs on the
# caller machine with full Python env and router-side helpers.

import contextlib
import json
import os
import socket
import subprocess
import sys
import time
import urllib.request
from typing import Any, Dict


CHECKPOINT_PREFIX = "OETF_CHECKPOINT::"
# Injected by the runner at submit time (see _inject_task_files in
# runner_fixture.py). Contains the task's YAML `name` so each checkpoint
# can be attributed to a specific task in multi-task workflows.
TASK_NAME_FILE = "/tmp/oetf/task_name"


def _read_injected_task_name():
    """Return the task name injected at submit time, or "" if unavailable."""
    try:
        with open(TASK_NAME_FILE, "r", encoding="utf-8") as handle:
            return handle.read().strip()
    except OSError:
        return ""


class TaskFixture:
    """Base class for in-task checks that run inside OSMO workflow containers.

    Subclass and override `run_checks()`. Inside, record results via the
    high-level helpers (`check_dns`, `check_mounts_writable`, ...), or for
    custom logic use `record_check(name)` (context manager — PASS if the
    block completes, FAIL if it raises) or the explicit `record_pass(name,
    detail)` / `record_fail(name, detail)` pair.

    `execute()` prints the final result dict as JSON on stdout and exits
    with code 0 (all passed) or 1 (any failure). The caller-side
    `WorkflowHandle.assert_in_task_checks_passed()` reads that JSON back
    out of the task's logs.
    """

    def __init__(self):
        # Typed as Any so mypy doesn't infer Dict[str, object] from the
        # mixed list/int values — the counters need to be int-addable.
        self.results: Dict[str, Any] = {"checks": [], "passed": 0, "failed": 0}
        self._task_name = _read_injected_task_name()

    # --- Sync primitive ---------------------------------------------------

    def checkpoint(self, name, message=""):
        """Emit a sync marker the runner can block on.

        The caller-side `WorkflowHandle.wait_for_task_checkpoint(name)`
        returns once this marker surfaces in the workflow's log stream;
        durable, so an early emission still satisfies a later wait.

        `message` is a free-form string returned to the runner via the
        marker payload — useful for handing back runtime-computed values
        (bound port, chosen path, hostname).

        Each marker is stamped with the emitting task's YAML name; the
        runner's `task_name=` filter disambiguates when several tasks in
        the same workflow emit the same `name`.
        """
        payload = json.dumps({
            "task": self._task_name,
            "name": name,
            "message": message,
            "time": time.time(),
        })
        print(f"{CHECKPOINT_PREFIX}{payload}", flush=True)

    # --- Primitives -------------------------------------------------------

    def record_pass(self, name, detail=""):
        """Record a named check as PASSED. Use when you've already evaluated
        the condition yourself."""
        self._record(name, True, detail)

    def record_fail(self, name, detail=""):
        """Record a named check as FAILED. Use when you've already evaluated
        the condition yourself (or caught an exception)."""
        self._record(name, False, detail)

    @contextlib.contextmanager
    def record_check(self, name):
        """Context manager: record PASS if the block completes, FAIL with the
        exception message if it raises. Set `check.message = "..."` inside
        the block to attach a free-form PASS message (ignored on FAIL — the
        exception message is used there instead).

        Example:

            with self.record_check("wrote_config") as check:
                path = "/workspace/config.json"
                open(path, "w").write(CONFIG)
                check.message = path   # optional
        """
        result = _CheckResult()
        try:
            yield result
        except Exception as error:  # pylint: disable=broad-except
            self._record(name, False, f"{type(error).__name__}: {error}"[:200])
            return
        self._record(name, True, result.message)

    # --- Convenience helpers (declarative, each records one or more checks)

    def check_dns(self, hosts):
        """Check DNS resolution for a list of hostnames."""
        for host in hosts:
            with self.record_check(f"dns:{host}"):
                socket.getaddrinfo(host, 80)

    def check_http(self, urls):
        """Check HTTP endpoints return non-5xx responses."""
        for url in urls:
            try:
                with urllib.request.urlopen(url, timeout=10) as response:
                    status = response.status
                if status < 500:
                    self.record_pass(f"http:{url}", str(status))
                else:
                    self.record_fail(f"http:{url}", str(status))
            except Exception as error:  # pylint: disable=broad-except
                self.record_fail(f"http:{url}", str(error)[:80])

    def check_env_vars(self, names):
        """Check that environment variables are set (non-missing)."""
        for name in names:
            if name in os.environ:
                self.record_pass(f"env:{name}", os.environ[name][:50])
            else:
                self.record_fail(f"env:{name}", "MISSING")

    def check_mounts_writable(self, paths):
        """Check that filesystem paths exist and are writable."""
        for path in paths:
            if os.path.exists(path) and os.access(path, os.W_OK):
                self.record_pass(f"mount:{path}")
            else:
                self.record_fail(f"mount:{path}", "missing or not writable")

    def check_gpu(self):
        """Check that nvidia-smi runs successfully."""
        with self.record_check("gpu:nvidia-smi"):
            subprocess.run(["nvidia-smi"], capture_output=True, check=True)

    def check_packages(self, packages):
        """Check that Python packages can be imported."""
        for package in packages:
            with self.record_check(f"pkg:{package}"):
                __import__(package)

    # --- Lifecycle --------------------------------------------------------

    def run_checks(self):
        """Override in subclass to define checks."""
        raise NotImplementedError("Subclasses must implement run_checks()")

    def execute(self):
        """Run checks, print JSON results, exit with status."""
        self.run_checks()
        print(json.dumps(self.results), flush=True)
        sys.exit(1 if self.results["failed"] > 0 else 0)

    # --- Internal ---------------------------------------------------------

    def _record(self, name, passed, detail):
        status = "PASS" if passed else "FAIL"
        self.results["checks"].append({
            "name": name,
            "status": status,
            "detail": detail,
        })
        if passed:
            self.results["passed"] += 1
        else:
            self.results["failed"] += 1
        print(f"[{status}] {name}: {detail}", flush=True)


class _CheckResult:
    """Mutable container yielded by `TaskFixture.record_check()` so callers
    can attach a free-form `message` string to the recorded PASS result."""

    def __init__(self):
        self.message = ""
