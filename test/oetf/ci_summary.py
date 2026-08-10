"""
Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# Classify an OETF CI result and render an actionable GitHub summary.

from __future__ import annotations

import argparse
import dataclasses
import json
import os
import pathlib
from typing import Dict, List


@dataclasses.dataclass(frozen=True)
class OetfCiSummary:
    status: str
    category: str
    failed_target: str
    summary: str
    next_action: str
    port_forward_restarted: bool

    def as_dict(self) -> Dict[str, object]:
        return dataclasses.asdict(self)


def _read_text(path: pathlib.Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def _read_result(path: pathlib.Path) -> Dict:
    try:
        result = json.loads(path.read_text(encoding="utf-8"))
        return result if isinstance(result, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _read_key_values(path: pathlib.Path) -> Dict[str, str]:
    values: Dict[str, str] = {}
    for line in _read_text(path).splitlines():
        key, separator, value = line.partition("=")
        if separator:
            values[key] = value
    return values


def classify_oetf_run(run_directory: pathlib.Path) -> OetfCiSummary:
    result = _read_result(run_directory / "oetf-result.json")
    wrapper_result = _read_result(
        run_directory / "deployment-test-result.json"
    )
    port_forward_log = _read_text(run_directory / "oetf-pf.log")
    raw_results = result.get("results", [])
    results: List[Dict] = (
        [row for row in raw_results if isinstance(row, dict)]
        if isinstance(raw_results, list) else []
    )
    failing_rows = [
        row for row in results if row.get("status") in {"fail", "error"}
    ]
    transport_failure = next(
        (
            row for row in failing_rows
            if (
                "localhost:" in str(row.get("message") or "").lower()
                or "127.0.0.1:" in str(row.get("message") or "").lower()
            )
            and (
                "connection refused" in str(row.get("message") or "").lower()
                or "failed to fetch logs" in str(row.get("message") or "").lower()
            )
        ),
        {},
    )
    failing = transport_failure or (failing_rows[0] if failing_rows else {})
    failed_count = int(result.get("failed", 0)) + int(result.get("errored", 0))
    failed_target = str(failing.get("target") or "")
    failed_message = str(failing.get("message") or "").strip().replace("\n", " ")
    port_forward_status = _read_key_values(
        run_directory / "oetf-pf-status.txt"
    )
    port_forward_evidence = port_forward_log.lower()
    port_forward_restarted = "attempt=2/2 start" in port_forward_log
    local_request_failed = bool(transport_failure)
    historical_disconnect = "lost connection to pod" in port_forward_evidence
    port_forward_failed = (
        local_request_failed
        or "supervisor exhausted attempts=2" in port_forward_evidence
        or (
            historical_disconnect
            and port_forward_status.get("endpoint_healthy") != "true"
        )
    )
    runner_succeeded = wrapper_result.get("overall") == "pass"
    runner_failed_with_passing_tests = (
        bool(result and results) and failed_count == 0 and not runner_succeeded
    )

    if result and results and failed_count == 0 and runner_succeeded:
        if port_forward_restarted:
            return OetfCiSummary(
                status="pass",
                category="transport/recovered",
                failed_target="",
                summary="The local kubectl port-forward recovered after one restart.",
                next_action=(
                    "No rerun is required; inspect oetf-pf.log if this becomes frequent."
                ),
                port_forward_restarted=True,
            )
        return OetfCiSummary(
            status="pass",
            category="none",
            failed_target="",
            summary="All OETF checks passed.",
            next_action="None.",
            port_forward_restarted=False,
        )

    if port_forward_failed:
        return OetfCiSummary(
            status="failure",
            category="transport/port-forward",
            failed_target=failed_target,
            summary=(
                "The local kubectl port-forward failed; the final OSMO API "
                "assertion is inconclusive."
            ),
            next_action=(
                "Rerun OETF and inspect oetf-pf.log plus the gateway and AKS "
                "connectivity diagnostics."
            ),
            port_forward_restarted=port_forward_restarted,
        )

    if not result or not results or runner_failed_with_passing_tests:
        runner_summary = (
            "OETF checks passed, but the deployment-test wrapper failed."
            if runner_failed_with_passing_tests
            else "OETF did not produce a readable result JSON."
        )
        return OetfCiSummary(
            status="failure",
            category="oetf-runner",
            failed_target="",
            summary=runner_summary,
            next_action="Inspect oetf.log and the deployment-test wrapper result.",
            port_forward_restarted=port_forward_restarted,
        )

    message = failed_message[:240] if failed_message else "OETF reported a failed target."
    return OetfCiSummary(
        status="failure",
        category="oetf-test",
        failed_target=failed_target,
        summary=message,
        next_action=(
            f"Inspect the {failed_target} result and related service logs."
            if failed_target else "Inspect oetf.log and the related service logs."
        ),
        port_forward_restarted=port_forward_restarted,
    )


def render_markdown(run_directory: pathlib.Path, summary: OetfCiSummary) -> str:
    result = _read_result(run_directory / "oetf-result.json")
    icon = "PASS" if summary.status == "pass" else "FAIL"
    lines = [
        f"### OETF stage: {icon}",
        "",
        f"- failure category: `{summary.category}`",
        f"- failed target: `{summary.failed_target or "-"}`",
        f"- summary: {summary.summary}",
        f"- next action: **{summary.next_action}**",
        "",
    ]
    if result:
        lines.extend([
            (
                f"- totals: {result.get("passed", 0)} passed, "
                f"{result.get("failed", 0)} failed, "
                f"{result.get("errored", 0)} errored, "
                f"{result.get("skipped", 0)} skipped"
            ),
            "",
            "| Status | Target | Time | Message |",
            "|---|---|---:|---|",
        ])
        for row in result.get("results", []):
            message = str(row.get("message") or "").strip().replace("\n", " ")
            message = message[:200] + ("..." if len(message) > 200 else "")
            message = message.replace("|", "\\|")
            lines.append(
                f"| {row.get("status", "?")} | `{row.get("target", "?")}` | "
                f"{float(row.get("time", 0)):.1f}s | {message} |"
            )
    return "\n".join(lines) + "\n"


def _write_github_outputs(path: pathlib.Path, summary: OetfCiSummary) -> None:
    values = {
        "failure_category": summary.category,
        "failure_summary": summary.summary,
        "next_action": summary.next_action,
        "failed_target": summary.failed_target,
    }
    with path.open("a", encoding="utf-8") as output:
        for key, value in values.items():
            output.write(f"{key}={value.replace(chr(10), " ")}\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-dir", required=True, type=pathlib.Path)
    parser.add_argument("--github-output", type=pathlib.Path)
    parser.add_argument("--github-summary", type=pathlib.Path)
    arguments = parser.parse_args()

    arguments.run_dir.mkdir(parents=True, exist_ok=True)
    summary = classify_oetf_run(arguments.run_dir)
    markdown = render_markdown(arguments.run_dir, summary)
    (arguments.run_dir / "failure-summary.json").write_text(
        json.dumps(summary.as_dict(), indent=2) + "\n", encoding="utf-8",
    )
    (arguments.run_dir / "failure-summary.md").write_text(markdown, encoding="utf-8")

    output_path = arguments.github_output
    if output_path is None and os.environ.get("GITHUB_OUTPUT"):
        output_path = pathlib.Path(os.environ["GITHUB_OUTPUT"])
    if output_path is not None:
        _write_github_outputs(output_path, summary)

    summary_path = arguments.github_summary
    if summary_path is None and os.environ.get("GITHUB_STEP_SUMMARY"):
        summary_path = pathlib.Path(os.environ["GITHUB_STEP_SUMMARY"])
    if summary_path is not None:
        with summary_path.open("a", encoding="utf-8") as github_summary:
            github_summary.write(markdown)

    if (
        os.environ.get("GITHUB_ACTIONS") == "true"
        and summary.category == "transport/recovered"
    ):
        print("::warning title=OETF port-forward recovered::One restart was required")

    print(markdown, end="")


if __name__ == "__main__":
    main()
