"""
Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# Allure result-JSON emitter for OETF test runs. This module starts with
# unittest -> Allure status mapping; subsequent commits add Recorder, JSON
# builders, and metadata helpers.

import datetime
import enum
import json
import os
import uuid
from typing import Any, Dict, List, Optional


class TestStatus(enum.Enum):
    """unittest TestCase outcome.

    The `value` is the lowercase form _classify_outcome historically returned;
    keeping it stable means existing test fixtures and JSON dumps don't shift.
    Allure's vocabulary differs (`failed` / `broken`); see _ALLURE_STATUS.
    """
    PASSED = "passed"
    FAILURE = "failure"
    ERROR = "error"
    SKIPPED = "skipped"


class StepStatus(enum.Enum):
    """Allure step status — flows directly into JSON without remapping.

    Distinct enum from TestStatus because the vocabulary is Allure's own
    (`failed` for assertion failure, `broken` for infrastructure error)
    rather than unittest's (`failure` / `error`). Keeping them separate
    makes the type system enforce the right vocabulary at each call site.
    """
    PASSED = "passed"
    FAILED = "failed"
    BROKEN = "broken"
    SKIPPED = "skipped"


# unittest TestCase outcomes -> Allure status. ERROR maps to "broken"
# (infrastructure failure) per Allure's vocabulary.
_ALLURE_STATUS = {
    TestStatus.PASSED: "passed",
    TestStatus.FAILURE: "failed",
    TestStatus.ERROR: "broken",
    TestStatus.SKIPPED: "skipped",
}


def map_status(status: TestStatus) -> str:
    """Map a unittest TestCase outcome to an Allure status string."""
    return _ALLURE_STATUS.get(status, "unknown")


# Parameters whose value changes every run for the same logical test.
# Allure 3 recomputes historyId as `<testCase.id>.<md5(stringifyParams(p))>`
# and stringifyParams skips entries with `excluded: true` — so build_result
# marks these names excluded to keep historyId stable across runs.
_VOLATILE_PARAM_NAMES = frozenset({"workflow"})


def _severity(tags: List[str]) -> str:
    return "critical" if "smoke" in tags else "normal"


def build_result(
    env_name: str,
    target: str,
    test_name: str,
    unittest_status: TestStatus,
    start_ms: int,
    stop_ms: int,
    parameters: dict,
    tags: List[str],
    steps: List[dict],
    attachments: List[dict],
    actor: str,
    message: str = "",
    trace: str = "",
    links: Optional[List[dict]] = None,
) -> dict:
    """Build the Allure result-JSON dict for a single test execution.

    A fresh uuid is generated and embedded in the returned dict. Callers
    that need to reference it (e.g. write_result) should read it from the
    returned `uuid` field.
    """
    # host + thread are what Allure's Timeline plugin uses to draw swim
    # lanes. Setting host = env_name groups all results under "staging"
    # (instead of the meaningless Jenkins agent pod name); thread = target
    # gives one swim lane per Bazel target so parallel py_tests show up
    # as parallel bars instead of stacking into a single row.
    labels = [
        {"name": "severity", "value": _severity(tags)},
        {"name": "epic", "value": env_name},
        {"name": "owner", "value": actor},
        {"name": "host", "value": env_name},
        {"name": "thread", "value": target},
    ]
    for tag in tags:
        labels.append({"name": "tag", "value": tag})

    # `excluded: true` keeps a parameter visible in the UI but drops it
    # from the historyId hash (see _VOLATILE_PARAM_NAMES). Without this
    # the workflow URL — fresh per submission — perturbs historyId every
    # run and the trend chart never accumulates.
    params_list = [
        {
            "name": k,
            "value": str(v),
            **({"excluded": True} if k in _VOLATILE_PARAM_NAMES else {}),
        }
        for k, v in sorted(parameters.items())
    ]

    body: Dict[str, Any] = {
        "uuid": str(uuid.uuid4()),
        "name": test_name,
        "fullName": f"oetf.{env_name}.{target}",
        "status": map_status(unittest_status),
        "start": start_ms,
        "stop": stop_ms,
        "labels": labels,
        "parameters": params_list,
        "links": list(links or []),
        "steps": list(steps),
        "attachments": list(attachments),
    }
    if message or trace:
        body["statusDetails"] = {"message": message, "trace": trace}
    return body


_MIME_TO_EXT = {
    "text/plain": "txt",
    "application/json": "json",
    "text/html": "html",
}


class Recorder:
    """Per-test scratch store. Probe classes append steps and attachments;
    the fixture's run() reads from this when building the result JSON.

    Attachment writes are no-ops until set_outputs_dir is called — this
    lets unit tests instantiate Recorder without a filesystem.
    """

    def __init__(self) -> None:
        self.steps: List[dict] = []
        self.attachments: List[dict] = []
        self.links: List[dict] = []
        self._outputs_dir: Optional[str] = None

    def set_outputs_dir(self, path: str) -> None:
        self._outputs_dir = path
        os.makedirs(path, exist_ok=True)

    @property
    def outputs_dir(self) -> Optional[str]:
        """Where the recorder writes attachments; None if unconfigured."""
        return self._outputs_dir

    def record_step(
        self, name: str, status: StepStatus, start_ms: int, stop_ms: int,
        message: str = "", trace: str = "",
    ) -> None:
        # Dict[str, Any]: Allure step JSON mixes scalar (str/int) and nested
        # (statusDetails: dict) values. Without the explicit annotation mypy
        # narrows the value type to int|str from the initializer and rejects
        # the statusDetails assignment below.
        step: Dict[str, Any] = {
            "name": name,
            "status": status.value,
            "stage": "finished",
            "start": start_ms,
            "stop": stop_ms,
        }
        if message or trace:
            step["statusDetails"] = {"message": message, "trace": trace}
        self.steps.append(step)

    def record_link(self, name: str, url: str, link_type: str = "tms") -> None:
        """Add a link badge to the test result. type is one of 'tms' (test mgmt
        system), 'issue', or 'custom'. Renders as a clickable badge in Allure.
        """
        self.links.append({"name": name, "url": url, "type": link_type})

    def record_attachment(self, name: str, mime: str, content: bytes) -> None:
        if self._outputs_dir is None:
            return
        ext = _MIME_TO_EXT.get(mime, "bin")
        file_name = f"{uuid.uuid4()}-attachment.{ext}"
        with open(os.path.join(self._outputs_dir, file_name), "wb") as fh:
            fh.write(content)
        self.attachments.append({"name": name, "type": mime, "source": file_name})


def build_executor(
    run_id: str,
    env_name: str,
    build_url: str,
    report_url_base: str,
    source: str,
    start_epoch: int,
) -> dict:
    """Construct executor.json content per Allure v2/v3 schema."""
    base = report_url_base.rstrip("/")
    return {
        "name": "OETF",
        "type": "custom",
        "buildOrder": start_epoch,
        "buildName": run_id,
        "buildUrl": build_url,
        "reportName": f"OETF {env_name} @ {run_id}",
        "reportUrl": f"{base}/{source}/runs/{run_id}/index.html",
    }


def build_environment_properties(props: dict) -> str:
    """Serialize a dict to Java-properties format for environment.properties."""
    return "\n".join(f"{k} = {v}" for k, v in props.items()) + "\n"


def compute_run_id(now: datetime.datetime, git_sha: Optional[str]) -> str:
    """Deterministic run_id from a UTC datetime + git short SHA.

    Format: 2026-04-28T22-13Z-a79176b (sortable, unique-per-minute, traceable).
    Falls back to a non-hex sentinel `XXXXXXX` when the SHA isn't available
    (no git, detached state, etc.) so the slug can never collide with a real
    short SHA.

    Takes a datetime to avoid string-format brittleness — earlier versions
    accepted an ISO string and counted dashes to strip seconds, which broke
    on offset-aware ISO strings (`+00:00` introduced extra dashes after
    `:`-replacement).
    """
    if now.tzinfo is None:
        now = now.replace(tzinfo=datetime.timezone.utc)
    stamp = now.strftime("%Y-%m-%dT%H-%MZ")
    sha = (git_sha or "")[:7] or "XXXXXXX"
    return f"{stamp}-{sha}"


def write_result(
    outputs_dir: str,
    recorder: Recorder,
    env_name: str,
    target: str,
    test_name: str,
    unittest_status: TestStatus,
    start_ms: int,
    stop_ms: int,
    parameters: dict,
    tags: List[str],
    actor: str,
    message: str = "",
    trace: str = "",
) -> str:
    """Write <uuid>-result.json into outputs_dir; return the uuid."""
    payload = build_result(
        env_name=env_name,
        target=target,
        test_name=test_name,
        unittest_status=unittest_status,
        start_ms=start_ms, stop_ms=stop_ms,
        parameters=parameters,
        tags=tags,
        steps=recorder.steps,
        attachments=recorder.attachments,
        links=recorder.links,
        actor=actor,
        message=message, trace=trace,
    )
    result_uuid = payload["uuid"]
    path = os.path.join(outputs_dir, f"{result_uuid}-result.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh)
    return result_uuid
