# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Stage-2 target picker: a small Claude Code subagent with read-only access.

The criticality scorer (Stage 1) produces a heuristic shortlist of ~20
candidates. This script wraps a separate ``claude --print`` invocation to let
the model **read** each candidate's source and pick the 1-3 best test targets
based on whether good unit tests are actually feasible — something a static
heuristic can't tell.

Output is a markdown block in the same shape ``coverage_targets.format_targets``
emits, so the downstream prompt assembly in the testbot workflow doesn't care
which selector produced it.

Usage:
    python select_targets_agent.py \
        --shortlist /tmp/shortlist.json \
        --max-targets 1 \
        --output /tmp/targets.md
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

CLAUDE_CLI_VERSION = "2.1.116"
DEFAULT_MAX_TURNS = 30
DEFAULT_TIMEOUT_SEC = 600
ALLOWED_TOOLS = "Read,Glob,Grep"
PROMPT_TEMPLATE_PATH = Path(__file__).parent / "SELECT_TARGETS_PROMPT.md"

# Match a fenced JSON block (```json ... ```). The prompt instructs the agent
# to emit exactly this shape; we don't try to recover from arbitrary prose.
JSON_BLOCK_RE = re.compile(r"```json\s*(\{.*?\})\s*```", re.DOTALL)


def format_candidate(rank: int, target: dict) -> str:
    """Render one shortlist entry for the agent's prompt."""
    breakdown = target.get("score_breakdown", {})
    return (
        f"### {rank}. `{target["file_path"]}` "
        f"(score={target["score"]:.2f})\n"
        f"- Coverage: {target["coverage_pct"]:.1f}% "
        f"({target["uncovered_lines"]} uncovered lines, {target["loc"]} LoC)\n"
        f"- Tier: {target["tier"]} (0=lib/utils, 4=other)\n"
        f"- Fan-in: {target["fan_in"]} reverse imports\n"
        f"- Churn (6mo): {target["churn"]} commits\n"
        f"- Score breakdown: tier={breakdown.get("tier", 0):.2f} "
        f"fan_in={breakdown.get("fan_in", 0):.2f} "
        f"churn={breakdown.get("churn", 0):.2f} "
        f"gap={breakdown.get("gap", 0):.2f}\n"
    )


def build_prompt(shortlist: list[dict], max_targets: int) -> str:
    """Render the agent prompt with the shortlist spliced in."""
    template = PROMPT_TEMPLATE_PATH.read_text(encoding="utf-8")
    candidates_md = "\n".join(
        format_candidate(rank, target)
        for rank, target in enumerate(shortlist, start=1)
    )
    return template.format(
        shortlist_count=len(shortlist),
        max_targets=max_targets,
        candidates=candidates_md,
    )


DIAGNOSTIC_KEYS = (
    "subtype",
    "is_error",
    "num_turns",
    "duration_ms",
    "duration_api_ms",
    "total_cost_usd",
)


def _stream_npx(cmd: list[str], stream_log_path: Path, timeout_sec: int) -> int:
    """Run ``cmd`` streaming stdout into both the workflow log and a JSONL file.

    Returns the subprocess exit code. Wraps the live stream in a foldable
    ``::group::`` so the per-turn JSON doesn't spam the default workflow view.
    """
    print("::group::Claude Code stream — target picker (click to expand)",
          flush=True)
    try:
        with open(stream_log_path, "w", encoding="utf-8") as logf:
            with subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            ) as proc:
                assert proc.stdout is not None  # bound by stdout=PIPE
                try:
                    for line in proc.stdout:
                        sys.stdout.write(line)
                        logf.write(line)
                    proc.wait(timeout=timeout_sec)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait()
                    logger.error("Claude CLI timed out after %ds", timeout_sec)
                    return 124
                return proc.returncode
    finally:
        print("::endgroup::", flush=True)


def _load_final_result(stream_log_path: Path) -> dict | None:
    """Pull the final stream-json ``result`` event out of the JSONL log.

    Iterates the file in reverse so we stop at the first match instead of
    parsing every assistant turn and tool-use line.
    """
    if not stream_log_path.exists():
        return None
    with open(stream_log_path, encoding="utf-8") as logf:
        lines = logf.readlines()
    for line in reversed(lines):
        line = line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event.get("type") == "result":
            return event
    return None


def _emit_diagnostics(final: dict | None, exit_status: int) -> None:
    """Print a foldable diagnostics block, stop-command-protected.

    Mirrors the ``Claude Code diagnostics`` block on the generate step in
    testbot.yaml: untrusted ``result`` text is wrapped in
    ``::stop-commands::`` so it can't inject ``::warning::``,
    ``::add-mask::``, etc. into the workflow.
    """
    stop_token = secrets.token_hex(16)
    print("::group::Claude Code diagnostics — target picker", flush=True)
    print(f"::stop-commands::{stop_token}", flush=True)
    print(f"exit_status: {exit_status}")
    if final is None:
        print("no final result message captured")
    else:
        for key in DIAGNOSTIC_KEYS:
            if key in final:
                print(f"{key}: {final[key]}")
        result_text = final.get("result")
        if isinstance(result_text, str) and result_text:
            print("result:")
            print(result_text[:2000])
    print(f"::{stop_token}::", flush=True)
    print("::endgroup::", flush=True)


def invoke_claude(
    prompt: str,
    *,
    model: str,
    max_turns: int,
    timeout_sec: int,
) -> str:
    """Run the picker subagent and return its final assistant text.

    Streams the per-turn stream-json events live into a foldable workflow
    group, then prints a diagnostics summary (turns, duration, cost, exit
    status) modelled on the generate step in ``testbot.yaml``.

    The NVIDIA-gateway env (``ANTHROPIC_API_KEY``, ``ANTHROPIC_BASE_URL``,
    ``ANTHROPIC_MODEL``, ``DISABLE_PROMPT_CACHING``,
    ``CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS``) is inherited from the calling
    workflow step.
    """
    npx = shutil.which("npx")
    if npx is None:
        raise RuntimeError("npx not found on PATH; cannot invoke Claude CLI")
    cmd = [
        npx, f"@anthropic-ai/claude-code@{CLAUDE_CLI_VERSION}", "--print",
        "--model", model,
        "--allowedTools", ALLOWED_TOOLS,
        "--max-turns", str(max_turns),
        "--output-format", "stream-json",
        "--verbose",
        prompt,
    ]
    logger.info("Invoking Claude CLI (model=%s, max_turns=%d)",
                model, max_turns)

    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".jsonl", delete=False, encoding="utf-8"
    ) as tmp:
        stream_log_path = Path(tmp.name)
    try:
        exit_status = _stream_npx(cmd, stream_log_path, timeout_sec)
        final = _load_final_result(stream_log_path)
        _emit_diagnostics(final, exit_status)

        if exit_status != 0:
            sys.exit(exit_status)
        if final is None:
            raise RuntimeError(
                "Claude CLI exited 0 but no final result event was captured"
            )
        result_text = final.get("result")
        if not isinstance(result_text, str):
            raise RuntimeError(
                f"Final event missing string 'result' field: {final!r}"
            )
        return result_text
    finally:
        stream_log_path.unlink(missing_ok=True)


def parse_agent_output(output: str) -> list[dict]:
    """Extract the ``targets`` array from the agent's fenced JSON block."""
    match = JSON_BLOCK_RE.search(output)
    if not match:
        raise ValueError(
            "Agent output did not contain a ```json``` block — refusing to "
            "guess. Raw output (truncated): " + output[:500]
        )
    payload = json.loads(match.group(1))
    targets = payload.get("targets", [])
    if not isinstance(targets, list):
        raise ValueError(f"Expected list under 'targets', got {type(targets)}")
    return targets


def merge_picks_with_shortlist(
    picks: list[dict],
    shortlist: list[dict],
) -> list[dict]:
    """Re-attach uncovered_ranges/coverage data to each picked file.

    The agent only emits ``file_path`` + ``reason``; the downstream prompt
    needs the full per-target shape (uncovered ranges, etc.) so it can tell
    the test-generation agent *which lines* to focus on.
    """
    by_path = {entry["file_path"]: entry for entry in shortlist}
    merged: list[dict] = []
    for pick in picks:
        path = pick.get("file_path")
        if not path:
            logger.warning("Skipping pick with no file_path: %r", pick)
            continue
        entry = by_path.get(path)
        if entry is None:
            logger.warning("Pick %r not in shortlist; ignoring", path)
            continue
        merged.append({
            **entry,
            "reason": pick.get("reason", ""),
        })
    return merged


def format_targets_markdown(picks: list[dict]) -> str:
    """Render the final target list in the format coverage_targets.py emits.

    Identical to ``coverage_targets.format_targets`` but with an extra
    ``Why this file:`` line carrying the LLM's rationale so reviewers can
    see why it was chosen.
    """
    if not picks:
        return "No coverage targets selected — shortlist did not contain any high-ROI candidates today."

    lines: list[str] = []
    for index, target in enumerate(picks, start=1):
        ranges_str = ", ".join(
            f"{s}-{e}" if s != e else str(s)
            for s, e in target["uncovered_ranges"]
        )
        lines.append(f"## Target {index}: {target["file_path"]}")
        lines.append(
            f"Coverage: {target["coverage_pct"]:.1f}% "
            f"({target["uncovered_lines"]} uncovered lines)"
        )
        lines.append(f"Uncovered ranges: {ranges_str}")
        if target.get("reason"):
            lines.append(f"Why this file: {target["reason"]}")
        lines.append("")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--shortlist", required=True,
                        help="Path to the JSON shortlist from criticality_scorer")
    parser.add_argument("--max-targets", type=int, default=1)
    parser.add_argument("--max-turns", type=int, default=DEFAULT_MAX_TURNS)
    parser.add_argument("--timeout-sec", type=int, default=DEFAULT_TIMEOUT_SEC)
    parser.add_argument("--model",
                        default=os.environ.get(
                            "ANTHROPIC_MODEL",
                            "aws/anthropic/bedrock-claude-opus-4-7",
                        ))
    parser.add_argument("--output", default="-",
                        help="Output path; '-' (default) writes to stdout")
    args = parser.parse_args()

    shortlist = json.loads(Path(args.shortlist).read_text(encoding="utf-8"))
    if not shortlist:
        logger.warning("Empty shortlist; nothing to pick")
        markdown = format_targets_markdown([])
    else:
        prompt = build_prompt(shortlist, args.max_targets)
        output = invoke_claude(
            prompt,
            model=args.model,
            max_turns=args.max_turns,
            timeout_sec=args.timeout_sec,
        )
        picks = parse_agent_output(output)
        logger.info("Agent picked %d target(s) of %d max", len(picks), args.max_targets)
        merged = merge_picks_with_shortlist(picks, shortlist)
        markdown = format_targets_markdown(merged)

    if args.output == "-":
        print(markdown)
    else:
        Path(args.output).write_text(markdown, encoding="utf-8")


if __name__ == "__main__":
    main()
