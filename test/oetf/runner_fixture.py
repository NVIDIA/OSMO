"""
Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# Scenario-test runner-side framework: RunnerFixture + WorkflowBuilder + WorkflowHandle.
#
# External counterpart to TaskFixture (task_fixture.py). Each scenario's
# test_runner.py subclasses RunnerFixture (a unittest.TestCase) and writes
# test_* methods. Use self.workflow(spec_path) to start a submission; chain
# .pool(), .client(), .args(), .timeout() to override; terminate with
# .expect_completed() (or .expect_failed, etc.) for simple tests or .submit()
# to get a WorkflowHandle for imperative flows (load tests, router probes).

from __future__ import annotations

import collections
import contextlib
import dataclasses
import inspect
import json
import logging
import os
import pty
import re
import select
import shutil
import subprocess
import sys
import tempfile
import textwrap
import time
import traceback
from typing import TYPE_CHECKING, Callable, Dict, Iterator, List, Optional, Set, Tuple, TypeVar

import requests
import yaml

from src.cli.workflow import load_local_files
from src.lib.utils.client import RequestMethod, ResponseMode, ServiceClient
from src.lib.utils.osmo_errors import OSMOError
from test.oetf import reporter
from test.oetf.fixture_base import OetfFixture
from test.oetf.models import OetfConfig, WorkflowServerStatus
from test.oetf.osmo_cli import login_cli_to, resolve_osmo_cli
from test.oetf.task_fixture import CHECKPOINT_PREFIX, TASK_NAME_FILE

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)

T = TypeVar("T")


# --- Allure step recording ---


@contextlib.contextmanager  # type: ignore[misc]
def _record_step(fixture: object, name: str):  # type: ignore[no-untyped-def]
    """Context manager that times a workflow phase and records it as an Allure step.

    Appends a step to ``fixture._recorder`` with the wall-clock start/stop and
    passed/failed status. Re-raises any exception after recording so the test
    framework still sees the failure.  No-op when ``fixture`` has no
    ``_recorder`` attribute (e.g. in tests that don't set one up).
    """
    recorder = getattr(fixture, "_recorder", None)
    start_ms = int(time.time() * 1000)
    if recorder is None:
        yield
        return
    try:
        yield
    except Exception as exc:
        recorder.record_step(
            name=name,
            status=reporter.StepStatus.FAILED,
            start_ms=start_ms,
            stop_ms=int(time.time() * 1000),
            message=f"{type(exc).__name__}: {exc}",
            trace=traceback.format_exc(),
        )
        raise
    recorder.record_step(
        name=name,
        status=reporter.StepStatus.PASSED,
        start_ms=start_ms,
        stop_ms=int(time.time() * 1000),
    )


# --- CLI / network helpers ---


def _workspace_root() -> str:
    """Best-effort lookup of the repo/workspace root.

    Under `bazel run`, Bazel sets BUILD_WORKSPACE_DIRECTORY to the repo.
    Under `bazel test`, Bazel sets TEST_SRCDIR + TEST_WORKSPACE pointing
    at the runfiles tree — files declared via `data = [...]` are copied there.
    Fallback: cwd.
    """
    if "BUILD_WORKSPACE_DIRECTORY" in os.environ:
        return os.environ["BUILD_WORKSPACE_DIRECTORY"]
    test_srcdir = os.environ.get("TEST_SRCDIR")
    if test_srcdir:
        return os.path.join(test_srcdir, os.environ.get("TEST_WORKSPACE", "_main"))
    return os.getcwd()


def _runfiles_repo_root_for(filename: str, test_srcdir: str) -> Optional[str]:
    """Pure helper: the runfiles repo dir under ``test_srcdir`` that contains ``filename``.

    Returns ``None`` if ``filename`` isn't reachable from ``test_srcdir``
    (i.e. their common path isn't ``test_srcdir``).
    """
    srcdir_abs = os.path.abspath(test_srcdir)
    try:
        rel = os.path.relpath(os.path.abspath(filename), srcdir_abs)
    except ValueError:  # different drives on Windows
        return None
    first, _, _ = rel.partition(os.sep)
    if not first or first == "..":
        return None
    return os.path.join(srcdir_abs, first)


def _caller_runfiles_repo_root() -> Optional[str]:
    """Return the runfiles repo dir (``<TEST_SRCDIR>/<repo>``) that owns the caller.

    Required because under bzlmod, ``TEST_WORKSPACE`` is always ``_main``
    regardless of which module the test target actually lives in. A test
    target in ``@osmo_workspace//scenarios:app-cli`` runs from
    ``<TEST_SRCDIR>/osmo_workspace+/test/scenarios/app_cli.py`` and its
    data deps land under ``<TEST_SRCDIR>/osmo_workspace+/...`` — but
    ``_workspace_root()`` would point at ``<TEST_SRCDIR>/_main/`` and miss
    them entirely. Walk the call stack to the first non-fixture frame and
    map its path under ``TEST_SRCDIR`` to the runfiles repo dir.

    Returns ``None`` if not running under ``bazel test`` (no
    ``TEST_SRCDIR``) or no caller file lives under it.
    """
    test_srcdir = os.environ.get("TEST_SRCDIR")
    if not test_srcdir:
        return None
    for frame in inspect.stack()[1:]:
        filename = frame.filename
        if not filename.endswith(".py") or "runner_fixture" in filename:
            continue
        return _runfiles_repo_root_for(filename, test_srcdir)
    return None


def curl_until(url: str, match: str, deadline_seconds: int) -> None:
    """Poll `curl -fsS <url>` until body contains `match`, or raise.

    Used together with WorkflowHandle.cli_port_forward to assert in-task HTTP
    content is reachable via the router.
    """
    deadline = time.monotonic() + deadline_seconds
    last_error = "not attempted"
    while time.monotonic() < deadline:
        result = subprocess.run(
            ["curl", "-fsS", url],
            capture_output=True, text=True, timeout=10, check=False,
        )
        if result.returncode == 0 and match in (result.stdout or ""):
            return
        stderr_tail = (result.stderr or "").strip()[:120]
        last_error = (
            f"exit={result.returncode} stdout={result.stdout[:80]!r} "
            f"stderr={stderr_tail!r}"
        )
        time.sleep(2)
    raise RuntimeError(
        f"curl {url} never returned {match!r} within {deadline_seconds}s "
        f"(last: {last_error})"
    )


# --- Prometheus (optional, for tests that want PromQL) ---

@dataclasses.dataclass
class PrometheusClient:
    """Thin wrapper for PromQL queries against Prometheus."""
    prometheus_url: str

    def query(self, metric: str, labels: Dict[str, str] | None = None) -> Dict:
        """Execute instant PromQL query."""
        label_selector = ""
        if labels:
            pairs = [f'{key}="{value}"' for key, value in labels.items()]
            label_selector = "{" + ",".join(pairs) + "}"
        query_string = f"{metric}{label_selector}"
        response = requests.get(
            f"{self.prometheus_url}/api/v1/query",
            params={"query": query_string},
            timeout=30,
        )
        response.raise_for_status()
        return response.json().get("data", {}).get("result", {})


# --- Spec preparation helpers ---

_TIMEOUT_RE = re.compile(r"^(\d+)([smh])$")


def _parse_timeout_seconds(spec: str) -> int:
    """Parse '10m' / '30s' / '1h' / '300' to seconds."""
    spec = spec.strip()
    if spec.isdigit():
        return int(spec)
    match = _TIMEOUT_RE.match(spec)
    if not match:
        raise ValueError(f"invalid timeout: {spec!r} (use e.g. '10m', '30s', '1h')")
    value, unit = int(match.group(1)), match.group(2)
    return value * {"s": 1, "m": 60, "h": 3600}[unit]


def _task_fixture_path() -> str:
    """Return the absolute path to task_fixture.py (next to this file)."""
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "task_fixture.py")


def _iter_tasks(workflow: Dict) -> Iterator[Dict]:
    """Yield every task in a workflow spec, whether top-level (`workflow.tasks`)
    or nested in a group (`workflow.groups[].tasks`). v1 flat specs use only
    the former; v2 specs can use either shape."""
    yield from workflow.get("tasks", [])
    for group in workflow.get("groups", []):
        yield from group.get("tasks", [])


def _inject_task_files(spec_content: str, task_py_path: str) -> str:
    """Attach task_fixture.py + task.py + a task-name marker to every task
    whose args reference `/tmp/oetf/task.py`. Preserves existing `files:`
    entries on each task.

    The task-name marker lets `TaskFixture.checkpoint(...)` stamp the
    emitting task's YAML `name` into every payload, so the caller-side
    `wait_for_task_checkpoint(..., task_name=...)` can disambiguate in
    multi-task workflows.
    """
    task_fixture_content = _read_file(_task_fixture_path())
    if not task_fixture_content:
        return spec_content
    task_content = _read_file(task_py_path)
    if not task_content:
        return spec_content
    spec = yaml.safe_load(spec_content)
    workflow = spec.get("workflow", spec)
    for task in _iter_tasks(workflow):
        args = task.get("args", [])
        if not any("/tmp/oetf/task.py" in str(arg) for arg in args):
            continue
        files = list(task.get("files", []))
        files.extend([
            {"path": "/tmp/oetf/task_fixture.py", "contents": task_fixture_content},
            {"path": "/tmp/oetf/task.py", "contents": task_content},
            {"path": TASK_NAME_FILE, "contents": str(task.get("name", ""))},
        ])
        task["files"] = files
    return yaml.dump(spec, default_flow_style=False, sort_keys=False)


def _has_localpath_entries(spec_content: str) -> bool:
    """Quick check: does the spec reference local files by path?"""
    return "localpath:" in spec_content


def _resolve_localpath_files(
    spec_content: str,
    workflow_path: str,
    service_client: ServiceClient,
    pool: str,
    template_args: List[str],
) -> str:
    """Inline any localpath: file references before submission.

    Templated specs are dry-run against the server first so {{...}} resolves
    before parsing; load_local_files (from the CLI) reads the referenced
    files from disk and rewrites the entries in-place to inlined contents.
    """
    if not _has_localpath_entries(spec_content):
        return spec_content
    is_templated = any(m in spec_content for m in ("{{", "{%", "default-values"))
    if is_templated:
        dry_run = service_client.request(
            method=RequestMethod.POST,
            endpoint=f"api/pool/{pool}/workflow",
            payload={"file": spec_content, "set_variables": template_args},
            params={"dry_run": True},
        )
        expanded = dry_run.get("spec", spec_content)
        workflow_dict = yaml.safe_load(expanded)
    else:
        workflow_dict = yaml.safe_load(spec_content)
    load_local_files(workflow_path, workflow_dict)
    return yaml.dump(workflow_dict, default_flow_style=False, sort_keys=False)


def _read_file(path: str) -> str:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        logger.warning("Could not read %s", path)
        return ""


# --- CLI-mode submission (for scenarios whose spec uses dataset localpaths) ---

_LOCALPATH_PATTERN = re.compile(r"^\s*localpath:\s*(.+)$", re.MULTILINE)
_CLI_STATUS_CODE_PATTERN = re.compile(r"status code[:\s]+(\d+)", re.IGNORECASE)


def _submit_via_cli(
    spec_content: str,
    spec_path: str,
    pool: str,
    args: List[str],
    config: OetfConfig,
) -> str:
    """Submit a workflow through the osmo CLI. Returns the workflow_id.

    CLI submission (as opposed to the API path) walks dataset localpath
    directories and uploads files via the CLI's own transfer logic — the
    API submit can't do this. Query/logs/cancel continue through the HTTP
    API regardless, so this only affects the submission step.
    """
    login_cli_to(config)
    cli_path = resolve_osmo_cli(config)
    with tempfile.TemporaryDirectory() as temp_dir:
        prepared = _copy_localpath_files_to_dir(spec_content, spec_path, temp_dir)
        submit_path = os.path.join(temp_dir, "workflow.yaml")
        with open(submit_path, "w", encoding="utf-8") as submit_file:
            submit_file.write(prepared)
        argv = [
            cli_path, "workflow", "submit", submit_path,
            "--pool", pool, "--format-type", "json",
        ]
        if args:
            argv.extend(["--set"] + list(args))
        # cwd=temp_dir so the CLI resolves dataset-block `localpath:` refs
        # (which it joins with cwd, not the workflow file dir) against the
        # staged copies _copy_localpath_files_to_dir wrote. Without this
        # the CLI looks under the bazel sandbox's cwd and fails with
        # "The localpath <name> does not exist!".
        result = subprocess.run(
            argv, capture_output=True, text=True, check=False,
            cwd=temp_dir,
        )
        if result.returncode != 0:
            _raise_cli_submission_error(result)
        response = json.loads(result.stdout)
    workflow_id = response.get("name", "")
    if not workflow_id:
        raise RuntimeError(f"CLI submit response missing 'name': {response!r}")
    return workflow_id


def _copy_localpath_files_to_dir(
    spec_content: str,
    original_spec_path: str,
    target_dir: str,
) -> str:
    """Copy every localpath:-referenced file/dir next to the spec, rewrite
    the spec to reference just the basename."""
    spec_dir = os.path.dirname(os.path.abspath(original_spec_path))

    def replace(match: re.Match) -> str:
        raw = match.group(1).strip().strip("'\"")
        source = raw if os.path.isabs(raw) else os.path.join(spec_dir, raw)
        dest = os.path.join(target_dir, os.path.basename(raw))
        if os.path.isdir(source):
            shutil.copytree(source, dest, dirs_exist_ok=True)
        else:
            shutil.copy2(source, dest)
        indent = match.group(0)[:match.group(0).index("localpath")]
        return f"{indent}localpath: {os.path.basename(raw)}"

    return _LOCALPATH_PATTERN.sub(replace, spec_content)


_CLI_VERSION_WARNING_PATTERN = re.compile(
    r"^WARNING: New client.*?^curl .*?install\.sh[^\n]*\n?",
    re.DOTALL | re.MULTILINE,
)


def _raise_cli_submission_error(result: subprocess.CompletedProcess) -> None:
    """Translate a failing `osmo workflow submit` into OSMOError / OSMOSubmissionError.

    The CLI emits an "Error message:" line on stdout for submission failures
    (validation errors, missing localpaths, etc.) and prints a multi-line
    "New client X available" warning to stderr on every invocation. If we
    look only at stderr we usually miss the real cause and surface just the
    noise. Strip the version warning from stderr and build the error body
    from both streams so the actual failure is visible.
    """
    stderr = _CLI_VERSION_WARNING_PATTERN.sub("", result.stderr or "").strip()[:1000]
    stdout = (result.stdout or "").strip()[:1000]
    body = "\n".join(s for s in (stderr, stdout) if s) or "(no output captured)"
    status_match = _CLI_STATUS_CODE_PATTERN.search(stderr)
    status_code = int(status_match.group(1)) if status_match else 0
    if status_code == 429 or "429" in stderr:
        raise OSMOError(f"CLI rate limited (429): {body}")
    if "submission" in body.lower() or "validation" in body.lower():
        raise OSMOError(f"CLI submission error: {body}")
    raise OSMOError(f"CLI submit failed (exit {result.returncode}): {body}")


# --- RunnerFixture — the test base class ---


class RunnerFixture(OetfFixture):
    """Base for every scenario test (one test_runner.py subclasses this).

    Class attributes set defaults; builder methods override per submission.
    Reads OETF_* env vars in setUp (via OetfFixture).

    Scenario YAMLs and per-method overrides can reference ``self.default_image``,
    ``self.default_platform``, ``self.default_bucket`` so the same scenario
    runs on staging (with Jenkins-injected overrides) AND on a public KIND
    deploy (with the safe defaults below). Set ``OETF_DEFAULT_IMAGE`` /
    ``OETF_DEFAULT_PLATFORM`` / ``OETF_DEFAULT_BUCKET`` to override.
    """

    pool: str = "default"     # class-level defaults; overridable in subclasses
    client: str = "api"             # api | cli | hybrid
    timeout: str = "10m"            # per-workflow poll timeout (not Bazel-level)

    @property
    def default_image(self) -> str:
        """Default container image for scenario workflows.

        Reads ``OETF_DEFAULT_IMAGE`` at access time so tests/fixtures that
        monkey-patch the env see the current value. Falls back to a public
        ``ubuntu:22.04`` so KIND deploys work out of the box.
        """
        return os.environ.get("OETF_DEFAULT_IMAGE", "ubuntu:22.04")

    @property
    def default_platform(self) -> str:
        """Default platform/pool tag for scenario workflows.

        Reads ``OETF_DEFAULT_PLATFORM`` at access time. Falls back to ``cpu``
        which the public quick-start chart's default pool satisfies.
        """
        return os.environ.get("OETF_DEFAULT_PLATFORM", "cpu")

    @property
    def default_bucket(self) -> str:
        """Default object-storage bucket for scenarios that need one.

        Reads ``OETF_DEFAULT_BUCKET`` at access time. Empty string when not
        set — scenarios that genuinely need a bucket must override or skip.
        """
        return os.environ.get("OETF_DEFAULT_BUCKET", "")

    def setUp(self) -> None:
        super().setUp()
        # self.pool / self.client / self.timeout come from class attrs.
        # OETF_POOL / OETF_CLIENT env vars override if non-empty.
        if self.config.pool:
            self.pool = self.config.pool
        if self.config.client:
            self.client = self.config.client
        self._logged_in_cli = False
        self.prometheus: Optional[PrometheusClient] = None
        prometheus_url = os.environ.get("OETF_PROMETHEUS_URL", "")
        if prometheus_url:
            self.prometheus = PrometheusClient(prometheus_url=prometheus_url)

    def workflow(self, spec_path: str) -> "WorkflowBuilder":
        """Begin building a workflow submission. Chain overrides; terminate
        with .expect_*() or .submit().

        Spec-path resolution:
          - Workspace-relative if path starts with a top-level dir
            (validation/, test/, charts/, src/).
          - Otherwise relative to the test_runner.py file's directory.
        """
        resolved = self._resolve_spec_path(spec_path)
        return WorkflowBuilder(self, resolved)

    def _resolve_spec_path(self, spec_path: str) -> str:
        if os.path.isabs(spec_path):
            return spec_path
        # Workspace-relative if the path contains a directory separator and is
        # not explicitly caller-relative (./ or ../). Covers validation/...,
        # test/..., transfer_service/..., etc.
        if "/" in spec_path and not spec_path.startswith(("./", "../")):
            # Under bazel test in bzlmod, TEST_WORKSPACE is always "_main"
            # regardless of which module the test target lives in. So
            # _workspace_root() always points at <TEST_SRCDIR>/_main, even
            # for tests in dep modules like @osmo_workspace+ that bring
            # their own data via test/workflow/*. Try the caller's repo
            # root first (derived from the test_runner.py file's path
            # under <TEST_SRCDIR>/<repo>/...) and fall back to
            # _workspace_root for backwards compatibility.
            caller_root = _caller_runfiles_repo_root()
            if caller_root:
                candidate = os.path.join(caller_root, spec_path)
                if os.path.exists(candidate):
                    return candidate
            return os.path.join(_workspace_root(), spec_path)
        # Caller-relative: resolve against the test_runner.py file's directory.
        for frame in inspect.stack()[1:]:
            filename = frame.filename
            if filename.endswith(".py") and "runner_fixture" not in filename:
                return os.path.join(os.path.dirname(os.path.abspath(filename)), spec_path)
        return os.path.join(_workspace_root(), spec_path)

    def login_cli(self) -> None:
        """Log the osmo CLI in once per test instance."""
        if self._logged_in_cli:
            return
        login_cli_to(self.config)
        self._logged_in_cli = True

    # --- Load-test helpers for multi-handle flows ---

    def wait_all(self, handles: List["WorkflowHandle"]) -> None:
        """Wait for every handle to reach a terminal status."""
        for handle in handles:
            handle.wait_for_terminal()


# --- WorkflowBuilder — chainable submission setup ---


class WorkflowBuilder:
    """Chainable builder returned by RunnerFixture.workflow(spec_path).

    Terminals:
      - submit()          -> WorkflowHandle (imperative, no assertion)
      - expect_completed()/failed()/timeout()/failed_submission() (assert + run)
    """

    def __init__(self, fixture: RunnerFixture, spec_path: str) -> None:
        self._fixture = fixture
        self._spec_path = spec_path
        self._pool = fixture.pool
        self._client = fixture.client
        self._args: List[str] = []
        self._timeout = fixture.timeout

    def pool(self, pool: str) -> "WorkflowBuilder":
        self._pool = pool
        return self

    def client(self, mode: str) -> "WorkflowBuilder":
        self._client = mode
        return self

    def args(self, *template_args: str) -> "WorkflowBuilder":
        self._args.extend(template_args)
        return self

    def timeout(self, timeout_spec: str) -> "WorkflowBuilder":
        self._timeout = timeout_spec
        return self

    # --- Terminals ---

    def submit(self) -> "WorkflowHandle":
        """Submit via the OSMO API (or CLI if client="cli"/"hybrid").

        Returns a handle for imperative flows. Query/logs/cancel always go
        through the HTTP API regardless of submit mode.
        """
        with _record_step(self._fixture, "submit"):
            spec_content = _read_file(self._spec_path)
            if not spec_content:
                raise FileNotFoundError(f"spec file not found: {self._spec_path}")

            task_py_path = os.path.join(os.path.dirname(self._spec_path), "task.py")
            if os.path.exists(task_py_path):
                spec_content = _inject_task_files(spec_content, task_py_path)

            if self._client in {"cli", "hybrid"}:
                workflow_id = _submit_via_cli(
                    spec_content, self._spec_path, self._pool, self._args,
                    self._fixture.config,
                )
            else:
                # API path: inline localpaths via load_local_files, then POST.
                spec_content = _resolve_localpath_files(
                    spec_content, self._spec_path,
                    self._fixture.service_client, self._pool, self._args,
                )
                response = self._fixture.service_client.request(
                    method=RequestMethod.POST,
                    endpoint=f"api/pool/{self._pool}/workflow",
                    payload={"file": spec_content, "set_variables": self._args},
                )
                workflow_id = response.get("name", "")
                if not workflow_id:
                    raise RuntimeError(f"submit response missing 'name': {response!r}")

            base_url = self._fixture.config.url.rstrip("/")
            workflow_url = f"{base_url}/workflows/{workflow_id}"
            # Stderr so it surfaces in bazel test.log regardless of logging
            # level (root logger defaults to WARNING, so logger.info gets
            # swallowed). Readers click through to OSMO Web when debugging.
            print(
                f"OETF submitted: {workflow_id} ({workflow_url}) "
                f"[spec={os.path.basename(self._spec_path)} pool={self._pool} "
                f"client={self._client} args={list(self._args)}]",
                file=sys.stderr, flush=True,
            )
            # Surface the workflow URL as an Allure link badge at the test
            # level — clickable from the test detail page header without
            # diving into Test body → submit → workflow_url.txt.
            recorder = getattr(self._fixture, "_recorder", None)
            if recorder is not None:
                recorder.record_link("Workflow", workflow_url, "tms")
        return WorkflowHandle(
            fixture=self._fixture,
            workflow_id=workflow_id,
            timeout_seconds=_parse_timeout_seconds(self._timeout),
        )

    def expect_completed(self) -> None:
        self.submit().expect_outcome("completed")

    def expect_failed(self) -> None:
        self.submit().expect_outcome("failed")

    def expect_timeout(self) -> None:
        self.submit().expect_outcome("timeout")

    def expect_failed_submission(self) -> None:
        """Expect the submit call itself to raise an OSMOError."""
        try:
            self.submit()
        except OSMOError as expected:
            # The submission failure was the expected behavior. Flip the
            # just-recorded "submit" step from failed → passed so the
            # Allure UI doesn't show a red step inside a green test.
            recorder = getattr(self._fixture, "_recorder", None)
            if recorder is not None and recorder.steps:
                last_step = recorder.steps[-1]
                if (last_step.get("name") == "submit"
                        and last_step.get("status") == reporter.StepStatus.FAILED.value):
                    last_step["status"] = reporter.StepStatus.PASSED.value
                    last_step["statusDetails"] = {
                        "message": f"Expected failure: {type(expected).__name__}: {expected}",
                    }
            return
        raise AssertionError(
            f"expected submission of {os.path.basename(self._spec_path)} to fail, but it succeeded"
        )


# --- WorkflowHandle — imperative lifecycle + live-workflow helpers ---


_OUTCOME_TO_STATUSES: Dict[str, Set[WorkflowServerStatus]] = {
    "completed": {WorkflowServerStatus.COMPLETED},
    "failed": {
        WorkflowServerStatus.FAILED,
        WorkflowServerStatus.FAILED_CANCELED,
    },
    "timeout": {
        WorkflowServerStatus.FAILED_EXEC_TIMEOUT,
        WorkflowServerStatus.FAILED_QUEUE_TIMEOUT,
    },
}


class WorkflowHandle:
    """Represents a submitted workflow. Provides lifecycle, router-path probes,
    and lazy accessors for logs / tasks / status.
    """

    def __init__(
        self,
        fixture: RunnerFixture,
        workflow_id: str,
        timeout_seconds: int,
    ) -> None:
        self._fixture = fixture
        self.workflow_id = workflow_id
        self._timeout_seconds = timeout_seconds
        self._last_query: Dict = {}
        self._logs_cache: Optional[str] = None
        # Accumulates (epoch_ms, status) pairs across all _query() calls so
        # verify_outcome can attach a timeline when a workflow ends unexpectedly.
        self._status_history: List[Dict] = []

    @property
    def url(self) -> str:
        """OSMO Web page for this workflow — clickable in failure summaries."""
        base_url = self._fixture.config.url.rstrip("/")
        return f"{base_url}/workflows/{self.workflow_id}"

    def _id_with_url(self) -> str:
        """`<workflow_id> (<url>)` for inclusion in assertion messages."""
        return f"{self.workflow_id} ({self.url})"

    def _diagnostic_lines(self, workflow: Dict) -> List[str]:
        """Render per-task statuses + any workflow/task ``message`` fields.

        Surfaces the most common cause of timeouts on local KIND: a task
        stuck in PENDING because no node satisfies the resource request.
        Without this, the failure message is just "(last status: PENDING)"
        which gives the developer nothing to work with.
        """
        lines: List[str] = []
        workflow_message = workflow.get("message") or workflow.get("reason") or ""
        if workflow_message:
            lines.append(f"workflow message: {workflow_message}")
        task_summaries: List[str] = []
        for group in workflow.get("groups", []):
            for task in group.get("tasks", []):
                name = task.get("name", "?")
                status = task.get("status", "?")
                message = task.get("message") or task.get("reason") or ""
                summary = f"{name}={status}"
                if message:
                    summary += f" ({message})"
                task_summaries.append(summary)
        if task_summaries:
            lines.append("tasks: " + "; ".join(task_summaries))
        events = self._fetch_events_safely(last_n=5)
        if events:
            lines.append("recent events (last 5):")
            lines.extend(f"  - {event}" for event in events)
        return lines

    def _fetch_events_safely(self, last_n: int = 5) -> List[str]:
        """Best-effort fetch of recent workflow events. Never raises.

        Streams the events endpoint and keeps only the last ``last_n``
        lines via a bounded deque so a long-running workflow's full event
        log doesn't get buffered into memory.
        """
        try:
            response = self._fixture.service_client.request(
                method=RequestMethod.GET,
                endpoint=f"api/workflow/{self.workflow_id}/events",
                mode=ResponseMode.STREAMING,
            )
            tail: collections.deque = collections.deque(maxlen=last_n)
            for line in response.iter_lines():
                if line:
                    tail.append(line.decode("utf-8", errors="replace"))
            return list(tail)
        except Exception:  # pylint: disable=broad-except
            return []

    # --- Lifecycle ---

    def wait_for_task_running(
        self, task_name: str, timeout: int = 180, stabilize: int = 3,
    ) -> None:
        # Default 180s (was 90s): on local KIND with a cold image cache the
        # first ``docker pull`` of python:3.10-slim plus
        # container init regularly takes >90s. 180s is comfortably above the
        # observed worst case on a 6-node CPU KIND on Apple Silicon and still
        # well below the workflow's exec_timeout.
        def task_running(workflow: Dict) -> Optional[Dict]:
            for group in workflow.get("groups", []):
                for task in group.get("tasks", []):
                    if task.get("name") == task_name and task.get("status") == "RUNNING":
                        return task
            return None

        def timeout_error(last_workflow: Dict) -> Exception:
            last_status = "unknown"
            for group in last_workflow.get("groups", []):
                for task in group.get("tasks", []):
                    if task.get("name") == task_name:
                        last_status = task.get("status") or "unknown"
            parts = [
                f"task '{task_name}' never reached RUNNING within {timeout}s "
                f"(last status: {last_status})",
            ]
            parts.extend(self._diagnostic_lines(last_workflow))
            return ValueError("\n  ".join(parts))

        self._poll_query_until(
            task_running, timeout=timeout, poll_interval=2, on_timeout=timeout_error,
        )
        logger.info("task %s is RUNNING", task_name)
        time.sleep(stabilize)

    def wait_for_terminal(self, poll_interval: int = 10) -> Dict:
        def terminal_or_none(workflow: Dict) -> Optional[Dict]:
            try:
                status = WorkflowServerStatus(workflow.get("status", ""))
            except ValueError:
                return None
            return workflow if status.terminal else None

        def timeout_error(last_workflow: Dict) -> Exception:
            last_status = last_workflow.get("status", "unknown")
            parts = [
                f"Workflow {self._id_with_url()} did not reach terminal status "
                f"within {self._timeout_seconds}s (last status: {last_status})",
            ]
            parts.extend(self._diagnostic_lines(last_workflow))
            return ValueError("\n  ".join(parts))

        workflow = self._poll_query_until(
            terminal_or_none,
            timeout=self._timeout_seconds,
            poll_interval=poll_interval,
            on_timeout=timeout_error,
        )
        assert workflow is not None  # on_timeout raises; unreachable otherwise
        return workflow

    def wait_for_task_checkpoint(
        self, name: str, task_name: str,
        timeout: int = 180, poll_interval: float = 2.0,
    ) -> Dict:
        """Block until **one specific task** emits `checkpoint(name)`;
        return its payload.

        Durable: if the checkpoint was emitted before this call, returns
        from the first poll. Fast-fails if the workflow reaches terminal
        status without emitting. Otherwise raises TimeoutError after
        `timeout` seconds with workflow URL, status, checkpoints seen,
        and log tail.

        `task_name` is required — the checkpoint API is inherently
        task-scoped (checkpoints stamp their emitter's YAML name) and
        requiring it here prevents the non-deterministic "first emitter
        wins" surprise in multi-task workflows. For a many-tasks wait,
        see `wait_for_any_task_checkpoints` (returns on the first of a
        set) or `wait_for_all_task_checkpoints` (barrier: all named
        tasks must emit).

        Default timeout is 180s — the osmo logs API has an ingestion
        delay between in-container stdout and `/api/workflow/<id>/logs`
        serving the line (container → ctrl → logger → DB → API); 180s
        is the empirical ceiling observed on staging. A genuinely stuck
        workflow fast-fails via the terminal-status check, so the
        longer timeout costs nothing on the unhappy path.
        """
        deadline = time.monotonic() + timeout
        # Filter server-side by task and by checkpoint prefix — bandwidth
        # becomes O(that task's checkpoint_count) instead of O(all log
        # lines), so polling scales to arbitrary concurrency. We cap at
        # 5000 lines (way above any realistic checkpoint count) to avoid
        # losing early markers when the server's default cap is smaller.
        while True:
            last_logs = self._fetch_logs(
                task_name=task_name,
                regexes=[CHECKPOINT_PREFIX],
                last_n_lines=5000,
            )
            marker = _find_checkpoint_marker(last_logs, name, task_name=task_name)
            if marker is not None:
                return marker

            terminal_status = self._terminal_status_or_none()
            if terminal_status is not None:
                raise TimeoutError(self._build_checkpoint_error(
                    name=name, task_name=task_name, status=terminal_status,
                    logs=self._fetch_logs(task_name=task_name),
                    reason=f"workflow reached terminal status {terminal_status!r} first",
                ))

            if time.monotonic() >= deadline:
                last_status = self._last_query.get("status", "unknown")
                raise TimeoutError(self._build_checkpoint_error(
                    name=name, task_name=task_name, status=last_status,
                    logs=self._fetch_logs(task_name=task_name),
                    reason=f"timed out after {timeout}s",
                ))

            time.sleep(poll_interval)

    def wait_for_any_task_checkpoints(
        self, name: str, task_names: List[str],
        timeout: int = 180, poll_interval: float = 2.0,
    ) -> Tuple[str, Dict]:
        """First-match race: block until **any** task in `task_names` has
        emitted `checkpoint(name)`; return `(winning_task_name, payload)`.

        Use when one of several tasks is expected to reach the checkpoint
        first (e.g. leader election, earliest-finisher pattern). For a
        single-task wait use `wait_for_task_checkpoint`; for a barrier
        across all tasks use `wait_for_all_task_checkpoints`.

        Durable — an already-emitted checkpoint matches on the first
        poll. Fast-fails on terminal status; timeouts list all named
        tasks + which (if any) have emitted so far.
        """
        if not task_names:
            raise ValueError("task_names must be non-empty")

        deadline = time.monotonic() + timeout
        while True:
            # Regex-filter server-side; no task_name filter (we want any
            # of the named tasks).
            last_logs = self._fetch_logs(
                regexes=[CHECKPOINT_PREFIX], last_n_lines=5000,
            )
            for task in task_names:
                marker = _find_checkpoint_marker(last_logs, name, task_name=task)
                if marker is not None:
                    return task, marker

            terminal_status = self._terminal_status_or_none()
            if terminal_status is not None:
                raise TimeoutError(self._build_barrier_error(
                    name=name, task_names=task_names, seen={},
                    status=terminal_status, logs=self._fetch_logs(),
                    reason=f"workflow reached terminal status {terminal_status!r} "
                           f"before any of {task_names} emitted",
                ))

            if time.monotonic() >= deadline:
                last_status = self._last_query.get("status", "unknown")
                raise TimeoutError(self._build_barrier_error(
                    name=name, task_names=task_names, seen={},
                    status=last_status, logs=self._fetch_logs(),
                    reason=f"timed out after {timeout}s; no task emitted",
                ))

            time.sleep(poll_interval)

    def wait_for_all_task_checkpoints(
        self, name: str, task_names: List[str],
        timeout: int = 180, poll_interval: float = 2.0,
    ) -> Dict[str, Dict]:
        """Fan-in barrier: block until **every** task in `task_names` has
        emitted `checkpoint(name)`. Returns `{task_name: payload}`.

        Use as a sync point before driving parallel workers. For a
        single-task wait use `wait_for_task_checkpoint`; for a
        first-to-arrive race use `wait_for_any_task_checkpoints`.

        Durable — checkpoints emitted before this call count. Fast-fails
        if the workflow reaches terminal status with any task's emission
        still missing. On timeout, the error lists which tasks had
        emitted vs which were still pending.
        """
        if not task_names:
            raise ValueError("task_names must be non-empty")

        deadline = time.monotonic() + timeout
        seen: Dict[str, Dict] = {}

        while True:
            # No task_name filter — we need every named task's
            # checkpoints; the regex filter still keeps bandwidth
            # proportional to total checkpoint_count (not log volume).
            last_logs = self._fetch_logs(
                regexes=[CHECKPOINT_PREFIX], last_n_lines=5000,
            )
            for task in task_names:
                if task not in seen:
                    marker = _find_checkpoint_marker(last_logs, name, task_name=task)
                    if marker is not None:
                        seen[task] = marker
            if len(seen) == len(task_names):
                return seen

            missing = [t for t in task_names if t not in seen]
            terminal_status = self._terminal_status_or_none()
            if terminal_status is not None:
                raise TimeoutError(self._build_barrier_error(
                    name=name, task_names=task_names, seen=seen,
                    status=terminal_status, logs=self._fetch_logs(),
                    reason=f"workflow reached terminal status {terminal_status!r} "
                           f"before {missing} emitted",
                ))

            if time.monotonic() >= deadline:
                last_status = self._last_query.get("status", "unknown")
                raise TimeoutError(self._build_barrier_error(
                    name=name, task_names=task_names, seen=seen,
                    status=last_status, logs=self._fetch_logs(),
                    reason=f"timed out after {timeout}s",
                ))

            time.sleep(poll_interval)

    def cancel(self, terminal_timeout: int = 60) -> None:
        """Cancel and wait for a terminal status. Never raises."""
        logger.info("cancelling workflow %s", self.workflow_id)
        try:
            self._fixture.service_client.request(
                method=RequestMethod.POST,
                endpoint=f"api/workflow/{self.workflow_id}/cancel",
            )
        except Exception as error:  # pylint: disable=broad-except
            logger.warning("cancel error: %s", error)

        def terminal_sentinel(workflow: Dict) -> Optional[bool]:
            try:
                status = WorkflowServerStatus(workflow.get("status", ""))
            except ValueError:
                return None
            return True if status.terminal else None

        # on_timeout=None → silently returns; cancel() never raises.
        self._poll_query_until(
            terminal_sentinel, timeout=terminal_timeout, poll_interval=2, on_timeout=None,
        )

    def expect_outcome(self, outcome: str) -> None:
        """Wait for terminal and assert the workflow ended in `outcome`."""
        if outcome not in _OUTCOME_TO_STATUSES:
            raise ValueError(
                f"outcome must be one of {list(_OUTCOME_TO_STATUSES)}, got {outcome!r}"
            )
        with _record_step(self._fixture, "wait_for_terminal"):
            workflow = self.wait_for_terminal()
        with _record_step(self._fixture, "verify_outcome"):
            actual_status_string = workflow.get("status", "")
            try:
                actual = WorkflowServerStatus(actual_status_string)
            except ValueError:
                self._fixture.fail(
                    f"Workflow {self._id_with_url()} returned unknown status "
                    f"{actual_status_string!r}"
                )
                return
            expected = _OUTCOME_TO_STATUSES[outcome]
            if actual not in expected:
                expected_names = sorted(s.value for s in expected)
                failure_message = _first_failure_message(workflow)
                recorder = getattr(self._fixture, "_recorder", None)
                if recorder is not None:
                    recorder.record_attachment(
                        "workflow_url.txt", "text/plain",
                        self.url.encode("utf-8"),
                    )
                    recorder.record_attachment(
                        "failure_messages.txt", "text/plain",
                        failure_message.encode("utf-8"),
                    )
                    recorder.record_attachment(
                        "server_status_timeline.json", "application/json",
                        json.dumps(self._status_history, indent=2).encode("utf-8"),
                    )
                self._fixture.fail(
                    f"Workflow {self._id_with_url()}: expected outcome={outcome} "
                    f"(status in {expected_names}), got {actual.value}. "
                    f"First failure: {failure_message}"
                )

    # --- Router-path probes ---

    def cli_exec(self, task_name: str, command: str, timeout: int = 60) -> str:
        """Run `osmo workflow exec <wf> <task> --entry <command>` and return stdout.

        CLI exec path needs a TTY (tcsetattr), so we attach a PTY.
        """
        cli = resolve_osmo_cli(self._fixture.config)
        argv = [
            cli, "workflow", "exec", self.workflow_id, task_name,
            "--entry", command,
        ]
        master, slave = pty.openpty()
        try:
            process = subprocess.Popen(  # pylint: disable=consider-using-with
                argv, stdin=slave, stdout=slave, stderr=slave,
                start_new_session=True,
            )
            os.close(slave)
            output = _drain_pty(master, process, timeout)
            process.wait(timeout=5)
        finally:
            try:
                os.close(master)
            except OSError:
                pass
        if process.returncode != 0:
            raise RuntimeError(
                f"cli_exec exit={process.returncode} (output={output[:300]!r})"
            )
        return output

    @contextlib.contextmanager
    def cli_port_forward(
        self, task_name: str, local_port: int, remote_port: int,
    ) -> Iterator[int]:
        """Background-spawn `osmo workflow port-forward` for the duration of the block."""
        cli = resolve_osmo_cli(self._fixture.config)
        argv = [
            cli, "workflow", "port-forward", self.workflow_id, task_name,
            "--port", f"{local_port}:{remote_port}",
        ]
        process = subprocess.Popen(  # pylint: disable=consider-using-with
            argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        try:
            yield local_port
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)

    # --- Lazy accessors ---

    @property
    def status(self) -> WorkflowServerStatus:
        if "status" not in self._last_query:
            self._query()
        return WorkflowServerStatus(self._last_query.get("status", ""))

    @property
    def tasks(self) -> List[Dict]:
        if "groups" not in self._last_query:
            self._query()
        return [
            task
            for group in self._last_query.get("groups", [])
            for task in group.get("tasks", [])
        ]

    @property
    def logs(self) -> str:
        # Only cache non-empty results — staging's log stream can drop mid-
        # response (ChunkedEncodingError), producing a partial/empty fetch.
        # Caching an empty result would permanently hide logs that arrive later.
        if not self._logs_cache:
            self._logs_cache = self._fetch_logs()
        return self._logs_cache or ""

    # --- In-task check integration (for scenarios that inject task.py) ---

    def assert_in_task_checks_passed(self, task_name: str) -> None:
        """Assert one specific task's TaskFixture checks all passed.

        `task_name` is required so the log fetch is scoped server-side to
        that task's stdout — the "last blob wins" parser is then
        trivially correct regardless of how many other tasks the
        workflow runs. The regex filter further narrows the fetch to the
        results-blob line(s), so bandwidth is ~one line per task
        regardless of how chatty the task was. For asserting across
        multiple emitting tasks, use
        `assert_all_task_checks_passed(task_names=[...])`.
        """
        logs = self._fetch_logs(
            task_name=task_name, regexes=[CHECK_RESULTS_REGEX],
        )
        if not logs:
            self._fixture.fail(
                f"no TaskFixture results blob found for task {task_name!r} in "
                f"{self._id_with_url()} — did it run `TaskFixture.execute()`?"
            )
        results = _parse_check_results(logs)
        self._fail_if_any_check_failed(results, task_name=task_name)

    def assert_all_task_checks_passed(self, task_names: List[str]) -> None:
        """Fan-in assertion: **every** task in `task_names` must have
        emitted a TaskFixture result blob with zero failures.

        Contrast with `assert_in_task_checks_passed`:
          * `assert_in_task_checks_passed(task_name)` — one specific task.
          * `assert_all_task_checks_passed([...])` — every named task
            emitted a result blob AND all checks passed. Missing
            emissions fail the assertion.

        Each task's log stream is fetched separately with server-side
        task + regex filters so the parser sees exactly that task's
        results blob.
        """
        if not task_names:
            raise ValueError("task_names must be non-empty")
        missing: List[str] = []
        for task in task_names:
            logs = self._fetch_logs(
                task_name=task, regexes=[CHECK_RESULTS_REGEX],
            )
            results = _parse_check_results(logs) if logs else None
            if not results or not results.get("checks"):
                missing.append(task)
                continue
            self._fail_if_any_check_failed(results, task_name=task)
        if missing:
            self._fixture.fail(
                f"No TaskFixture results blob found for task(s) {missing} "
                f"in workflow {self._id_with_url()} — did those tasks run "
                f"`TaskFixture.execute()`?"
            )

    def _fail_if_any_check_failed(
        self, results: Dict, *, task_name: Optional[str],
    ) -> None:
        failed = results.get("failed", 0)
        if failed <= 0:
            return
        lines = []
        for check in results.get("checks", []):
            if check.get("status") == "FAIL":
                name = check.get("name", "?")
                detail = check.get("detail", "")
                lines.append(f"  - {name}: {detail}")
        scope = f" in task {task_name!r}" if task_name else ""
        self._fixture.fail(
            f"{failed} in-task checks failed{scope}:\n" + "\n".join(lines)
        )

    # --- Internal ---

    def _poll_query_until(
        self,
        done: Callable[[Dict], Optional[T]],
        *,
        timeout: float,
        poll_interval: float,
        on_timeout: Optional[Callable[[Dict], Exception]],
    ) -> Optional[T]:
        """Poll `self._query()` every `poll_interval` seconds until either
        `done(workflow)` returns non-None (success — that value is returned)
        or the deadline passes.

        Query errors are logged and retried; they don't count toward timeout
        termination beyond consuming wall-clock time. On timeout, if
        `on_timeout` is provided it's called with the last observed workflow
        dict (or `{}` if no successful query happened) to build an exception;
        if `on_timeout` is None, the helper returns None silently.
        """
        deadline = time.monotonic() + timeout
        last_workflow: Dict = {}
        while time.monotonic() < deadline:
            try:
                last_workflow = self._query()
            except Exception as error:  # pylint: disable=broad-except
                logger.warning("poll-query error: %s", error)
                time.sleep(poll_interval)
                continue
            result = done(last_workflow)
            if result is not None:
                return result
            time.sleep(poll_interval)
        if on_timeout is not None:
            raise on_timeout(last_workflow)
        return None

    def _query(self) -> Dict:
        self._last_query = self._fixture.service_client.request(
            method=RequestMethod.GET,
            endpoint=f"api/workflow/{self.workflow_id}",
        )
        status = self._last_query.get("status", "")
        if status:
            self._status_history.append(
                {"epoch_ms": int(time.time() * 1000), "status": status}
            )
        return self._last_query

    def _fetch_logs(
        self,
        *,
        task_name: Optional[str] = None,
        regexes: Optional[List[str]] = None,
        last_n_lines: int = 500,
    ) -> str:
        """Fetch a fresh copy of the workflow's logs (bypassing the `logs`
        property cache).

        Both filters are evaluated server-side — dramatically important
        for scaling with parallel tasks:

          * `task_name`: restrict to one task's stdout. Turns per-poll
            bandwidth into O(that task's log rate) instead of O(all
            tasks' combined log rate).
          * `regexes`: only lines whose content matches (server `re.search`).
            Shrinks bandwidth from "all recent lines" to "only the ones
            the caller cares about" (e.g. `[CHECKPOINT_PREFIX]` for sync
            markers — drops 99%+ of noise in active workflows).

        Uses STREAMING mode because the server streams logs via chunked
        transfer and PLAIN_TEXT's `response.text` doesn't consume it
        reliably (observed empty strings while logs were clearly being
        emitted). Mirrors the `osmo workflow logs` CLI.
        """
        params: Dict[str, object] = {"last_n_lines": last_n_lines}
        if task_name:
            params["task_name"] = task_name
        if regexes:
            params["regexes"] = regexes
        try:
            response = self._fixture.service_client.request(
                method=RequestMethod.GET,
                endpoint=f"api/workflow/{self.workflow_id}/logs",
                mode=ResponseMode.STREAMING,
                params=params,
            )
        except Exception as error:  # pylint: disable=broad-except
            logger.warning("logs fetch error: %s", error)
            return ""
        if response is None:
            return ""
        # Collect lines eagerly — the server often terminates the chunked
        # stream mid-response with `ChunkedEncodingError: Response ended
        # prematurely`. Keep whatever we got before the drop; the CLI does
        # the same (see external/src/cli/workflow.py:_workflow_logs).
        lines: List[str] = []
        try:
            for line in response.iter_lines():
                if isinstance(line, bytes):
                    lines.append(line.decode("utf-8", errors="replace"))
                elif line:
                    lines.append(line)
        except requests.exceptions.ChunkedEncodingError:
            pass
        finally:
            response.close()
        return "\n".join(lines)

    def _terminal_status_or_none(self) -> Optional[str]:
        """Return the current status string if the workflow is terminal,
        else None. Swallows query errors (caller can retry)."""
        try:
            workflow = self._query()
        except Exception as error:  # pylint: disable=broad-except
            logger.warning("terminal-status check: query error: %s", error)
            return None
        status = workflow.get("status", "")
        try:
            server_status = WorkflowServerStatus(status)
        except ValueError:
            return None
        return status if server_status.terminal else None

    def _build_checkpoint_error(
        self, *, name: str, task_name: Optional[str], status: str,
        logs: str, reason: str,
    ) -> str:
        tail = logs[-500:] if logs else "(empty)"
        indented_tail = textwrap.indent(tail, "    ")
        wait_desc = f"{task_name!r}/{name!r}" if task_name is not None else repr(name)
        return (
            f"checkpoint {wait_desc} not observed: {reason}.\n"
            f"  Workflow: {self._id_with_url()}\n"
            f"  Workflow status: {status}\n"
            f"  Checkpoints seen so far: {_format_seen_checkpoints(logs)}\n"
            f"  Log tail (last 500 chars):\n"
            f"{indented_tail}"
        )

    def _build_barrier_error(
        self, *, name: str, task_names: List[str], seen: Dict[str, Dict],
        status: str, logs: str, reason: str,
    ) -> str:
        tail = logs[-500:] if logs else "(empty)"
        indented_tail = textwrap.indent(tail, "    ")
        observed = [t for t in task_names if t in seen]
        missing = [t for t in task_names if t not in seen]
        return (
            f"checkpoint barrier {name!r} incomplete: {reason}.\n"
            f"  Workflow: {self._id_with_url()}\n"
            f"  Workflow status: {status}\n"
            f"  Observed ({len(observed)}/{len(task_names)}): {observed}\n"
            f"  Missing: {missing}\n"
            f"  Log tail (last 500 chars):\n"
            f"{indented_tail}"
        )


# --- PTY drain + log parsing helpers ---


def _drain_pty(master_fd: int, process: subprocess.Popen, timeout_seconds: int) -> str:
    """Read all output from a PTY master until child exits or timeout."""
    deadline = time.monotonic() + timeout_seconds
    buffer = bytearray()
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            process.terminate()
            raise RuntimeError(
                f"exec timed out after {timeout_seconds}s "
                f"(captured so far: {bytes(buffer)[:200]!r})"
            )
        ready, _, _ = select.select([master_fd], [], [], min(1.0, remaining))
        if master_fd in ready:
            try:
                chunk = os.read(master_fd, 4096)
            except OSError:
                break
            if not chunk:
                break
            buffer.extend(chunk)
            continue
        if process.poll() is not None:
            try:
                while True:
                    chunk = os.read(master_fd, 4096)
                    if not chunk:
                        break
                    buffer.extend(chunk)
            except OSError:
                pass
            break
    return buffer.decode("utf-8", errors="replace")


# Server-side regex that narrows `/logs` to the TaskFixture results blob
# (`json.dumps({"checks": [...], "passed": N, "failed": N})` — always
# starts with `{"checks":`). Drops bandwidth from O(full task stdout) to
# O(1 line) regardless of how chatty the task was. Mirrors the way
# `wait_for_task_checkpoint` server-filters by `CHECKPOINT_PREFIX`.
CHECK_RESULTS_REGEX = r'"checks":'


def _parse_check_results(log_text: str) -> Dict:
    """Parse TaskFixture JSON output from task logs.

    Scans log lines in reverse looking for a JSON blob with a "checks" key.
    Defense-in-depth: even when the log is pre-filtered by `CHECK_RESULTS_REGEX`
    at fetch time, the `startswith("{") + JSONDecodeError` guards here
    reject any false-positive line the regex lets through.
    """
    for line in reversed(log_text.splitlines()):
        stripped = line.strip()
        if stripped.startswith("{") and '"checks"' in stripped:
            try:
                return json.loads(stripped)
            except json.JSONDecodeError:
                continue
    return {"checks": [], "passed": 0, "failed": 0}


def _iter_checkpoints(log_text: str):
    """Yield every OETF_CHECKPOINT payload in the log, in emission order.

    Tolerates log-pipeline prefixes (timestamps, tags) — finds the prefix
    anywhere on a line. Skips invalid JSON and non-dict payloads silently.
    """
    for line in log_text.splitlines():
        idx = line.find(CHECKPOINT_PREFIX)
        if idx < 0:
            continue
        try:
            payload = json.loads(line[idx + len(CHECKPOINT_PREFIX):])
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            yield payload


def _find_checkpoint_marker(
    log_text: str, name: str, task_name: Optional[str] = None,
) -> Optional[Dict]:
    """Return the first checkpoint payload matching `name`, or None.

    First-match semantics: if the same (task, name) pair emits twice, the
    earlier occurrence wins. If `task_name` is given, only payloads whose
    `task` field equals it qualify; if None, any task's emission matches.
    """
    for payload in _iter_checkpoints(log_text):
        if payload.get("name") != name:
            continue
        if task_name is not None and payload.get("task", "") != task_name:
            continue
        return payload
    return None


def _format_seen_checkpoints(log_text: str) -> List[str]:
    """Render checkpoints from `log_text` for display in error messages.

    `<task>/<name>` when task is non-empty, bare `<name>` otherwise.
    """
    out: List[str] = []
    for payload in _iter_checkpoints(log_text):
        task = str(payload.get("task", ""))
        name = str(payload.get("name", ""))
        out.append(f"{task}/{name}" if task else name)
    return out


def _first_failure_message(workflow: Dict) -> str:
    """Find the first task with a failure_message and return it for error output."""
    for group in workflow.get("groups", []):
        for task in group.get("tasks", []):
            msg = task.get("failure_message") or ""
            if msg:
                name = task.get("name", "?")
                return f"{name}: {msg[:300]}"
    return "(none)"
