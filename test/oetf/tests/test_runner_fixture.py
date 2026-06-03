"""
Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# Unit tests for runner_fixture — checkpoint parser + wait_for_task_checkpoint.
#
# No live OSMO instance needed: the wait tests build a WorkflowHandle with a
# MagicMock fixture and drive per-poll log/status responses.

import os
import pathlib
import tempfile
import unittest
from unittest.mock import MagicMock

import yaml

from test.oetf.models import WorkflowServerStatus
from test.oetf.runner_fixture import (
    RunnerFixture,
    WorkflowHandle,
    _find_checkpoint_marker,
    _format_seen_checkpoints,
    _inject_task_files,
    _iter_checkpoints,
)


# Old-style checkpoint lines (no `task` field) — exercise backward-compat.
CHECKPOINT_READY_LEGACY = 'OETF_CHECKPOINT::{"name":"ready","message":"/sentinel","time":1}'

# Task-scoped checkpoint lines (new shape).
CHECKPOINT_A_READY = 'OETF_CHECKPOINT::{"task":"task-a","name":"ready","message":"a1","time":1}'
CHECKPOINT_B_READY = 'OETF_CHECKPOINT::{"task":"task-b","name":"ready","message":"b1","time":2}'
CHECKPOINT_A_BOUND = 'OETF_CHECKPOINT::{"task":"task-a","name":"bound","message":"port","time":3}'


class FindCheckpointMarkerTest(unittest.TestCase):
    """Pure parser — one marker name, many log shapes."""

    def test_marker_present(self):
        result = _find_checkpoint_marker(
            f"noise\n{CHECKPOINT_READY_LEGACY}\nmore noise\n", "ready",
        )
        assert result is not None
        self.assertEqual(result["name"], "ready")
        self.assertEqual(result["message"], "/sentinel")

    def test_first_match_wins_on_duplicate(self):
        log = (
            'OETF_CHECKPOINT::{"name":"ready","message":"first","time":1}\n'
            'OETF_CHECKPOINT::{"name":"ready","message":"second","time":2}\n'
        )
        result = _find_checkpoint_marker(log, "ready")
        assert result is not None
        self.assertEqual(result["message"], "first")

    def test_no_match_returns_none(self):
        self.assertIsNone(_find_checkpoint_marker("random\ntext\n", "ready"))

    def test_different_name_returns_none(self):
        self.assertIsNone(_find_checkpoint_marker(CHECKPOINT_READY_LEGACY, "serving"))

    def test_tolerates_log_pipeline_prefix(self):
        """Logger service may prefix each line with a timestamp + tag."""
        log = f"[2024-01-01T12:00:00] [TASK] {CHECKPOINT_READY_LEGACY}\n"
        self.assertIsNotNone(_find_checkpoint_marker(log, "ready"))

    def test_invalid_json_is_skipped(self):
        log = (
            "OETF_CHECKPOINT::{broken json here\n"
            f"{CHECKPOINT_READY_LEGACY}\n"
        )
        self.assertIsNotNone(_find_checkpoint_marker(log, "ready"))

    def test_non_dict_payload_is_skipped(self):
        log = 'OETF_CHECKPOINT::"just a string"\n'
        self.assertIsNone(_find_checkpoint_marker(log, "ready"))

    def test_does_not_collide_with_taskfixture_results_blob(self):
        # TaskFixture.execute() prints `{"checks":[...], "passed":1, "failed":0}`
        # on stdout — this is a different marker and must NOT match.
        log = '{"checks":[{"name":"ready","status":"PASS","detail":""}],"passed":1,"failed":0}'
        self.assertIsNone(_find_checkpoint_marker(log, "ready"))

    def test_does_not_collide_with_other_oetf_markers(self):
        # logger_connectivity uses `[OETF-MARKER] OETF_LOGGER_PROBE_2024`.
        self.assertIsNone(_find_checkpoint_marker(
            "[OETF-MARKER] OETF_LOGGER_PROBE_2024\n", "ready",
        ))
        self.assertIsNone(_find_checkpoint_marker(
            "[OETF-ROUTER] probe ready\n", "ready",
        ))

    # --- Multi-task filtering ---

    def test_task_filter_disambiguates_same_name_across_tasks(self):
        log = f"{CHECKPOINT_A_READY}\n{CHECKPOINT_B_READY}\n"
        marker_b = _find_checkpoint_marker(log, "ready", task_name="task-b")
        assert marker_b is not None
        self.assertEqual(marker_b["message"], "b1")
        marker_a = _find_checkpoint_marker(log, "ready", task_name="task-a")
        assert marker_a is not None
        self.assertEqual(marker_a["message"], "a1")

    def test_no_task_filter_returns_first_emission(self):
        log = f"{CHECKPOINT_A_READY}\n{CHECKPOINT_B_READY}\n"
        marker = _find_checkpoint_marker(log, "ready")
        assert marker is not None
        self.assertEqual(marker["task"], "task-a")

    def test_task_filter_returns_none_when_task_absent(self):
        log = f"{CHECKPOINT_A_READY}\n{CHECKPOINT_B_READY}\n"
        self.assertIsNone(
            _find_checkpoint_marker(log, "ready", task_name="task-missing"),
        )

    def test_task_filter_skips_legacy_payloads_without_task(self):
        # Old-style (no `task` key) must not match a task-scoped wait.
        self.assertIsNone(
            _find_checkpoint_marker(
                CHECKPOINT_READY_LEGACY, "ready", task_name="task-a",
            ),
        )


class IterCheckpointsTest(unittest.TestCase):

    def test_yields_in_emission_order(self):
        log = f"{CHECKPOINT_A_READY}\n{CHECKPOINT_B_READY}\n{CHECKPOINT_A_BOUND}\n"
        self.assertEqual(
            [(p["task"], p["name"]) for p in _iter_checkpoints(log)],
            [("task-a", "ready"), ("task-b", "ready"), ("task-a", "bound")],
        )

    def test_empty_log_yields_nothing(self):
        self.assertEqual(list(_iter_checkpoints("")), [])

    def test_ignores_invalid_lines(self):
        log = f"OETF_CHECKPOINT::{{broken\n{CHECKPOINT_A_READY}\n"
        self.assertEqual(len(list(_iter_checkpoints(log))), 1)


class FormatSeenCheckpointsTest(unittest.TestCase):

    def test_multi_task_format(self):
        log = f"{CHECKPOINT_A_READY}\n{CHECKPOINT_B_READY}\n{CHECKPOINT_A_BOUND}\n"
        self.assertEqual(
            _format_seen_checkpoints(log),
            ["task-a/ready", "task-b/ready", "task-a/bound"],
        )

    def test_legacy_payload_displays_bare_name(self):
        self.assertEqual(_format_seen_checkpoints(CHECKPOINT_READY_LEGACY), ["ready"])

    def test_empty_task_field_displays_bare_name(self):
        log = 'OETF_CHECKPOINT::{"task":"","name":"ready","message":"","time":1}\n'
        self.assertEqual(_format_seen_checkpoints(log), ["ready"])


class InjectTaskFilesTest(unittest.TestCase):
    """_inject_task_files injects into every task that runs /tmp/oetf/task.py,
    and stamps each with its own name for self-identification."""

    # Minimal spec with two tasks, both running task.py.
    SPEC_TWO_TASKS = yaml.safe_dump({
        "version": 2,
        "workflow": {
            "name": "multi",
            "tasks": [
                {
                    "name": "task-a",
                    "image": "python:3.10",
                    "command": ["python3"],
                    "args": ["/tmp/oetf/task.py"],
                },
                {
                    "name": "task-b",
                    "image": "python:3.10",
                    "command": ["python3"],
                    "args": ["/tmp/oetf/task.py"],
                },
            ],
        },
    })

    def test_injects_into_every_matching_task(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            task_py = pathlib.Path(tmpdir) / "task.py"
            task_py.write_text("# user task body\n")
            out_yaml = _inject_task_files(self.SPEC_TWO_TASKS, str(task_py))
            out = yaml.safe_load(out_yaml)
            tasks = out["workflow"]["tasks"]
            self.assertEqual(len(tasks), 2)
            for task in tasks:
                paths = [f["path"] for f in task.get("files", [])]
                self.assertIn("/tmp/oetf/task.py", paths)
                self.assertIn("/tmp/oetf/task_fixture.py", paths)
                self.assertIn("/tmp/oetf/task_name", paths)
                name_file = next(
                    f for f in task["files"]
                    if f["path"] == "/tmp/oetf/task_name"
                )
                self.assertEqual(name_file["contents"], task["name"])

    def test_preserves_existing_files(self):
        spec = yaml.safe_dump({
            "version": 2,
            "workflow": {
                "name": "with-files",
                "tasks": [{
                    "name": "task-a",
                    "image": "python:3.10",
                    "command": ["python3"],
                    "args": ["/tmp/oetf/task.py"],
                    "files": [{"path": "/tmp/user/data.txt", "contents": "keep me"}],
                }],
            },
        })
        with tempfile.TemporaryDirectory() as tmpdir:
            task_py = pathlib.Path(tmpdir) / "task.py"
            task_py.write_text("# body\n")
            out_yaml = _inject_task_files(spec, str(task_py))
            out = yaml.safe_load(out_yaml)
            paths = [f["path"] for f in out["workflow"]["tasks"][0]["files"]]
            self.assertIn("/tmp/user/data.txt", paths)
            self.assertIn("/tmp/oetf/task.py", paths)

    def test_skips_tasks_not_running_task_py(self):
        spec = yaml.safe_dump({
            "version": 2,
            "workflow": {
                "name": "mixed",
                "tasks": [
                    {
                        "name": "runner",
                        "image": "python:3.10",
                        "command": ["python3"],
                        "args": ["/tmp/oetf/task.py"],
                    },
                    {
                        "name": "sidecar",
                        "image": "busybox",
                        "command": ["sleep"],
                        "args": ["60"],
                    },
                ],
            },
        })
        with tempfile.TemporaryDirectory() as tmpdir:
            task_py = pathlib.Path(tmpdir) / "task.py"
            task_py.write_text("# body\n")
            out_yaml = _inject_task_files(spec, str(task_py))
            out = yaml.safe_load(out_yaml)
            tasks = {t["name"]: t for t in out["workflow"]["tasks"]}
            self.assertIn("files", tasks["runner"])
            # Sidecar has no OETF files injected (no args reference task.py).
            self.assertNotIn("files", tasks["sidecar"])


class WaitForTaskCheckpointTest(unittest.TestCase):
    """End-to-end: WorkflowHandle with a mocked fixture that scripts per-poll
    responses for /logs and /workflow GET."""

    def _make_handle(self, *, logs_sequence, status_sequence):
        fixture = MagicMock()
        fixture.config.url = "https://staging.example"

        logs_list = list(logs_sequence)
        status_list = list(status_sequence)

        def service_request(method=None, endpoint="", **_kwargs):  # pylint: disable=unused-argument
            if endpoint.endswith("/logs"):
                text = logs_list.pop(0) if len(logs_list) > 1 else logs_list[0]
                # _fetch_logs uses STREAMING mode + iter_lines() on the raw
                # requests.Response; mimic that shape here.
                streamed = MagicMock()
                streamed.iter_lines.return_value = [
                    line.encode("utf-8") for line in text.splitlines()
                ]
                return streamed
            status = status_list.pop(0) if len(status_list) > 1 else status_list[0]
            return {"status": status, "groups": []}

        fixture.service_client.request.side_effect = service_request

        return WorkflowHandle(
            fixture=fixture, workflow_id="wf-test-1", timeout_seconds=60,
        )

    def test_returns_on_first_poll_when_marker_present(self):
        handle = self._make_handle(
            logs_sequence=[CHECKPOINT_A_READY + "\n"],
            status_sequence=["RUNNING"],
        )
        result = handle.wait_for_task_checkpoint(
            "ready", task_name="task-a", timeout=5, poll_interval=0.01,
        )
        self.assertEqual(result["name"], "ready")
        self.assertEqual(result["message"], "a1")

    def test_returns_after_several_polls(self):
        handle = self._make_handle(
            logs_sequence=[
                "no marker yet\n",
                "still nothing\n",
                CHECKPOINT_A_READY + "\n",
            ],
            status_sequence=["RUNNING", "RUNNING", "RUNNING"],
        )
        result = handle.wait_for_task_checkpoint(
            "ready", task_name="task-a", timeout=5, poll_interval=0.01,
        )
        self.assertEqual(result["name"], "ready")

    def test_task_filter_routes_to_correct_emitter(self):
        handle = self._make_handle(
            logs_sequence=[f"{CHECKPOINT_A_READY}\n{CHECKPOINT_B_READY}\n"],
            status_sequence=["RUNNING"],
        )
        result = handle.wait_for_task_checkpoint(
            "ready", task_name="task-b", timeout=5, poll_interval=0.01,
        )
        self.assertEqual(result["message"], "b1")

    def test_fast_fail_when_workflow_is_terminal(self):
        handle = self._make_handle(
            logs_sequence=["nothing relevant\n"],
            status_sequence=[WorkflowServerStatus.COMPLETED.value],
        )
        with self.assertRaises(TimeoutError) as ctx:
            handle.wait_for_task_checkpoint(
                "ready", task_name="task-a", timeout=60, poll_interval=0.01,
            )
        message = str(ctx.exception)
        self.assertIn("'ready'", message)
        self.assertIn("terminal", message)
        self.assertIn("COMPLETED", message)
        self.assertIn("https://staging.example/workflows/wf-test-1", message)

    def test_fast_fail_on_failed_status(self):
        handle = self._make_handle(
            logs_sequence=["task crashed\n"],
            status_sequence=[WorkflowServerStatus.FAILED.value],
        )
        with self.assertRaises(TimeoutError) as ctx:
            handle.wait_for_task_checkpoint(
                "ready", task_name="task-a", timeout=60, poll_interval=0.01,
            )
        self.assertIn("FAILED", str(ctx.exception))

    def test_timeout_message_includes_task_scoped_seen(self):
        log = (
            f"{CHECKPOINT_A_READY}\n"
            f"{CHECKPOINT_B_READY}\n"
            "diagnostic line\n"
        )
        handle = self._make_handle(
            logs_sequence=[log], status_sequence=["RUNNING"],
        )
        with self.assertRaises(TimeoutError) as ctx:
            handle.wait_for_task_checkpoint(
                "missing", task_name="task-a",
                timeout=0.05, poll_interval=0.01,
            )
        message = str(ctx.exception)
        self.assertIn("'task-a'/'missing'", message)
        self.assertIn("task-a/ready", message)
        self.assertIn("task-b/ready", message)
        self.assertIn("diagnostic line", message)

    def test_timeout_message_is_actionable_when_logs_empty(self):
        handle = self._make_handle(
            logs_sequence=[""],
            status_sequence=["RUNNING"],
        )
        with self.assertRaises(TimeoutError) as ctx:
            handle.wait_for_task_checkpoint(
                "ready", task_name="task-a", timeout=0.05, poll_interval=0.01,
            )
        message = str(ctx.exception)
        self.assertIn("(empty)", message)
        self.assertIn("[]", message)

    def test_task_name_is_required(self):
        handle = self._make_handle(
            logs_sequence=[""], status_sequence=["RUNNING"],
        )
        with self.assertRaises(TypeError):
            handle.wait_for_task_checkpoint("ready")  # type: ignore[call-arg]


class TestRunnerFixtureDefaults(unittest.TestCase):
    """OETF_DEFAULT_* env-var-backed RunnerFixture defaults.

    Scenarios in OETF reference ``self.default_image`` / ``default_platform`` /
    ``default_bucket`` so the same scenario runs against both internal staging
    (with Jenkins-injected overrides like python:3.10-slim)
    AND public KIND (with the safe OSS defaults below). Verified by direct
    env-var manipulation rather than mocking, so the property contract is
    exercised end-to-end.
    """

    def setUp(self):
        self._fixture_cls = RunnerFixture
        # Snapshot env vars we may mutate, restore in tearDown.
        self._saved_env = {
            k: os.environ.get(k) for k in (
                "OETF_DEFAULT_IMAGE", "OETF_DEFAULT_PLATFORM", "OETF_DEFAULT_BUCKET",
            )
        }
        for k in self._saved_env:
            os.environ.pop(k, None)

    def tearDown(self):
        for k, v in self._saved_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def _bare_fixture(self):
        # Construct without going through unittest's setUp pipeline — the
        # default_* properties don't depend on config / setUp.
        f = self._fixture_cls.__new__(self._fixture_cls)
        return f

    def test_default_image_falls_back_to_ubuntu(self):
        f = self._bare_fixture()
        self.assertEqual(f.default_image, "ubuntu:22.04")

    def test_default_image_reads_env_var(self):
        os.environ["OETF_DEFAULT_IMAGE"] = "registry.example.com/proj/python:3.11"
        f = self._bare_fixture()
        self.assertEqual(f.default_image, "registry.example.com/proj/python:3.11")

    def test_default_platform_falls_back_to_cpu(self):
        f = self._bare_fixture()
        self.assertEqual(f.default_platform, "cpu")

    def test_default_platform_reads_env_var(self):
        os.environ["OETF_DEFAULT_PLATFORM"] = "gpu"
        f = self._bare_fixture()
        self.assertEqual(f.default_platform, "gpu")

    def test_default_bucket_falls_back_to_empty(self):
        f = self._bare_fixture()
        self.assertEqual(f.default_bucket, "")

    def test_default_bucket_reads_env_var(self):
        os.environ["OETF_DEFAULT_BUCKET"] = "my-test-bucket"
        f = self._bare_fixture()
        self.assertEqual(f.default_bucket, "my-test-bucket")


if __name__ == "__main__":
    unittest.main()
