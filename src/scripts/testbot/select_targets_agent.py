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
import shutil
import subprocess
import sys
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


def invoke_claude(
    prompt: str,
    *,
    model: str,
    max_turns: int,
    timeout_sec: int,
) -> str:
    """Run ``claude --print`` and return its stdout.

    The same NVIDIA-gateway env (``ANTHROPIC_API_KEY``, ``ANTHROPIC_BASE_URL``,
    ``ANTHROPIC_MODEL``, ``DISABLE_PROMPT_CACHING``,
    ``CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS``) is inherited from the calling
    workflow step, so this function doesn't manage credentials itself.
    """
    npx = shutil.which("npx")
    if npx is None:
        raise RuntimeError("npx not found on PATH; cannot invoke Claude CLI")
    cmd = [
        npx, f"@anthropic-ai/claude-code@{CLAUDE_CLI_VERSION}", "--print",
        "--model", model,
        "--allowedTools", ALLOWED_TOOLS,
        "--max-turns", str(max_turns),
        prompt,
    ]
    logger.info("Invoking Claude CLI (model=%s, max_turns=%d)", model, max_turns)
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=timeout_sec,
        check=False,
    )
    if result.returncode != 0:
        logger.error("Claude CLI exited %d", result.returncode)
        logger.error("stderr: %s", result.stderr[:1000])
        sys.exit(result.returncode)
    return result.stdout


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
