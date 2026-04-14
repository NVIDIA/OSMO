# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Local e2e test for the testbot respond pipeline.

Runs the full prompt -> Claude Code CLI -> structured output pipeline locally.
Used to iterate on prompt quality without deploying to GitHub Actions.
Supports --prompt-version old|new for A/B comparison.

Requirements:
    - Claude Code CLI installed (npx @anthropic-ai/claude-code or 'claude')
    - ANTHROPIC_API_KEY set in environment, or local Claude CLI auth configured

Usage:
    python src/scripts/testbot/tests/e2e_respond.py --prompt-version new
    python src/scripts/testbot/tests/e2e_respond.py --prompt-version old
    python src/scripts/testbot/tests/e2e_respond.py --model claude-haiku-4-5-20251001
"""

import argparse
import json
import logging
import os
import shutil
import subprocess
import sys
import time

# Add parent to path so imports work when running standalone
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))

from src.scripts.testbot.respond import (  # noqa: E402
    REPLY_SCHEMA,
    _extract_replies,
    build_prompt,
    sanitize_commit_message,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger("e2e_respond")

# A test file with an intentional issue for Claude to fix
MOCK_TEST_CONTENT = '''\
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Tests for string utilities."""

import unittest


class TestStringUtils(unittest.TestCase):
    """Tests for string utility functions."""

    def test1(self):
        """Test capitalize."""
        self.assertEqual("hello".capitalize(), "Hello")

    def test2(self):
        """Test uppercase."""
        self.assertEqual("hello".upper(), "HELLO")

    def test3(self):
        """Test strip."""
        self.assertEqual("  hello  ".strip(), "hello")


if __name__ == "__main__":
    unittest.main()
'''

# Mock thread data simulating real review comments
MOCK_THREADS = [
    {
        "reply_comment_id": 9990001,
        "thread_id": "T_mock_thread_1",
        "path": "src/utils/tests/test_string_utils.py",
        "line": 14,
        "thread_history": (
            "  [reviewer]: Test method names don't follow conventions. "
            "They should be test_<behavior>_<condition>_<expected>.\n"
            "  [reviewer]: /testbot rename the test methods to follow "
            "test_<behavior>_<condition> naming convention"
        ),
        "trigger_body": (
            "/testbot rename the test methods to follow "
            "test_<behavior>_<condition> naming convention"
        ),
        "author": "reviewer",
    },
    {
        "reply_comment_id": 9990002,
        "thread_id": "T_mock_thread_2",
        "path": "src/utils/tests/test_string_utils.py",
        "line": 22,
        "thread_history": (
            "  [reviewer]: /testbot add an edge case test for "
            "strip with only whitespace input"
        ),
        "trigger_body": (
            "/testbot add an edge case test for "
            "strip with only whitespace input"
        ),
        "author": "reviewer",
    },
]

# Complex scenario: writing Go unit tests for a real source file.
# Simulates the actual case that timed out in production (authz_server.go).
# Claude must read a 388-line Go file, understand gRPC authorization flow,
# read existing tests (677 lines), and write new test coverage.
COMPLEX_THREADS = [
    {
        "reply_comment_id": 9990101,
        "thread_id": "T_complex_thread_1",
        "path": "src/service/authz_sidecar/server/authz_server.go",
        "line": 1,
        "thread_history": (
            "  [reviewer]: /testbot add unit tests for the Check method "
            "in authz_server.go — cover the happy path (valid user with roles) "
            "and the error path (missing user header returns denied)"
        ),
        "trigger_body": (
            "/testbot add unit tests for the Check method "
            "in authz_server.go — cover the happy path (valid user with roles) "
            "and the error path (missing user header returns denied)"
        ),
        "author": "reviewer",
    },
]

# --- Old prompt (before improvements) ---
# Reproduces the prompt structure from before PR #851 improvements:
# - References TESTBOT_PROMPT.md (generate workflow prompt, not respond-specific)
# - Thread headers use "### Thread {id}" (no "ID:" label)
# - Inline steps 1-4 with output format instructions
# - Separate --append-system-prompt for structured output enforcement
OLD_APPEND_SYSTEM_PROMPT = (
    "IMPORTANT: Your final response MUST be the structured JSON matching "
    "the provided schema. You MUST include a reply for EVERY thread listed "
    "in the prompt — each with the thread_id and a description of what you "
    "did. If you delegated work to sub-agents, review their results and "
    "write the replies yourself based on what was accomplished."
)


def build_prompt_old(threads: list[dict]) -> str:
    """Build prompt using the OLD structure (before improvements)."""
    lines = [
        "Read and follow the test quality rules in src/scripts/testbot/TESTBOT_PROMPT.md.",
        "",
        "Address these review threads on an AI-generated test PR.",
        "Each thread includes the full conversation history — pay attention to",
        "the LATEST request (the one containing /testbot), not just the first comment.",
        "",
    ]
    for thread in threads:
        location = f"`{thread['path']}` line {thread['line']}"
        lines.append(f"### Thread {thread['reply_comment_id']} ({location})")
        lines.append(thread["thread_history"])
        lines.append("")

    lines.extend([
        "Steps:",
        "1. Read the relevant source and test files.",
        "2. Apply the requested changes from the LATEST /testbot comment in each thread.",
        "3. Follow the test run, bug detection, and verification steps in TESTBOT_PROMPT.md.",
        "   Pay special attention to assertion failures: if the output looks like a source",
        "   bug (contradicts the function's docstring/name/comments), skip the test with",
        "   a SUSPECTED BUG marker — do NOT change the assertion to match buggy output.",
        "4. Do NOT create git commits or branches.",
        "",
        "After completing all work, produce structured JSON output with:",
        "- commit_message: a concise summary prefixed with 'testbot: '",
        "- replies: one {thread_id, reply} for EVERY thread above, explaining",
        "  what was done. Include any SUSPECTED BUG markers found.",
    ])
    return "\n".join(lines)


class QualityGate:
    """Tracks pass/fail/warn results for quality gates."""

    def __init__(self):
        self.results = []

    def check(self, name: str, passed: bool, severity: str = "FAIL") -> None:
        status = "PASS" if passed else severity
        self.results.append((name, status))
        icon = "+" if passed else "-"
        logger.info("[%s] %s: %s", icon, status, name)

    def summary(self) -> bool:
        """Print summary and return True if all hard gates passed."""
        logger.info("=== Quality Gate Summary ===")
        all_passed = True
        for name, status in self.results:
            logger.info("  [%s] %s", status, name)
            if status == "FAIL":
                all_passed = False
        return all_passed


def run_claude_with_version(
    prompt: str,
    prompt_version: str,
    model: str,
    max_turns: int,
) -> dict:
    """Run Claude Code CLI, optionally adding --append-system-prompt for old version."""
    import shlex

    claude_bin = os.environ.get("CLAUDE_CODE_BIN", "npx @anthropic-ai/claude-code@2.1.91")
    cmd = [
        *claude_bin.split(), "--print",
        "--model", model,
        "--output-format", "json",
        "--json-schema", REPLY_SCHEMA,
        "--allowedTools",
        "Read,Edit,Write,Bash(bazel test *),Bash(pnpm --dir src/ui test *),Bash(pnpm --dir src/ui validate),Bash(pnpm --dir src/ui format),Glob,Grep",
    ]
    if prompt_version == "old":
        cmd.extend(["--append-system-prompt", OLD_APPEND_SYSTEM_PROMPT])
    cmd.extend(["--max-turns", str(max_turns), prompt])

    logger.info("Claude Code command: %s", " ".join(shlex.quote(c) for c in cmd))

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=600, check=False)
    except subprocess.TimeoutExpired:
        logger.error("Claude Code CLI timed out after 600s")
        return {}

    if result.returncode != 0:
        logger.warning("Claude Code CLI exited %d", result.returncode)

    try:
        return json.loads(result.stdout)
    except (json.JSONDecodeError, ValueError):
        logger.error("Failed to parse output: %s", result.stdout[:500])
        return {}


def run_e2e(
    model: str,
    max_turns: int,
    prompt_version: str,
    threads: list[dict] | None = None,
) -> dict:
    """Run the full e2e test pipeline. Returns metrics dict for comparison."""
    if threads is None:
        threads = MOCK_THREADS
    gate = QualityGate()
    metrics = {"version": prompt_version, "model": model}

    # Build prompt
    if prompt_version == "old":
        prompt = build_prompt_old(threads)
    else:
        prompt = build_prompt(threads)

    logger.info("=== Prompt Version: %s (%d chars) ===", prompt_version.upper(), len(prompt))
    logger.info("%s", prompt)
    metrics["prompt_chars"] = len(prompt)

    expected_thread_ids = {str(t["reply_comment_id"]) for t in threads}

    # Run Claude Code
    logger.info("Running Claude Code (version=%s, model=%s, max_turns=%d)...",
                prompt_version, model, max_turns)
    start_time = time.time()
    claude_output = run_claude_with_version(prompt, prompt_version, model, max_turns)
    elapsed = time.time() - start_time
    metrics["elapsed_seconds"] = round(elapsed, 1)
    logger.info("Completed in %.1fs", elapsed)

    # Gate: Claude returned output
    gate.check("Claude returned non-empty output", bool(claude_output))
    if not claude_output:
        logger.error("Claude returned empty output — cannot validate further")
        metrics["gates"] = gate.results
        gate.summary()
        return metrics

    # Diagnostics
    metrics["num_turns"] = claude_output.get("num_turns")
    metrics["cost_usd"] = claude_output.get("total_cost_usd")
    metrics["stop_reason"] = claude_output.get("stop_reason")
    logger.info(
        "Diagnostics: num_turns=%s stop_reason=%s cost=$%s",
        metrics["num_turns"], metrics["stop_reason"], metrics["cost_usd"],
    )
    if "structured_output" in claude_output:
        logger.info(
            "structured_output: %s",
            json.dumps(claude_output["structured_output"], indent=2),
        )
    if "result" in claude_output:
        result_text = claude_output["result"]
        logger.info("result text (%d chars): %s", len(result_text), result_text[:500])

    # Extract replies
    per_thread_replies = _extract_replies(claude_output)

    # Gate: Structured output tier
    structured = claude_output.get("structured_output")
    is_tier1 = (
        isinstance(structured, dict)
        and isinstance(structured.get("replies"), list)
        and len(structured["replies"]) > 0
    )
    tier = "tier1" if is_tier1 else ("tier2" if per_thread_replies else "none")
    metrics["output_tier"] = tier
    gate.check(f"Structured output from tier 1 ({tier})", is_tier1, severity="WARN")

    # Gate: All thread IDs present
    found_ids = set(per_thread_replies.keys())
    all_ids_present = expected_thread_ids.issubset(found_ids)
    metrics["thread_ids_found"] = len(found_ids)
    metrics["thread_ids_expected"] = len(expected_thread_ids)
    metrics["all_ids_present"] = all_ids_present
    gate.check(
        f"All thread IDs present (expected={expected_thread_ids}, found={found_ids})",
        all_ids_present,
    )

    # Gate: Commit message format
    raw_commit_message = ""
    if isinstance(structured, dict):
        raw_commit_message = structured.get("commit_message", "")
    has_commit_msg = bool(raw_commit_message)
    metrics["has_commit_message"] = has_commit_msg
    if raw_commit_message:
        sanitized = sanitize_commit_message(raw_commit_message)
        metrics["commit_message"] = sanitized[:80]
        gate.check(
            f"Commit message has testbot: prefix ('{sanitized[:60]}')",
            sanitized.startswith("testbot:"),
        )
    else:
        gate.check("Commit message present in structured output", False)

    # Gate: Reply text quality
    reply_lengths = []
    for thread_id, reply in per_thread_replies.items():
        reply_lengths.append(len(reply))
        gate.check(
            f"Reply for thread {thread_id} has >10 chars ({len(reply)} chars)",
            len(reply) > 10,
        )
    metrics["avg_reply_length"] = round(sum(reply_lengths) / max(len(reply_lengths), 1))

    # Gate: Cost
    cost = claude_output.get("total_cost_usd")
    if cost is not None:
        gate.check(f"Cost under $1.00 (${cost:.4f})", cost < 1.0, severity="WARN")

    # Gate: Time
    gate.check(f"Completed in <5 min ({elapsed:.0f}s)", elapsed < 300, severity="WARN")

    # Summary
    metrics["gates"] = gate.results
    all_passed = gate.summary()
    metrics["all_passed"] = all_passed
    return metrics


def print_comparison(old_metrics: dict, new_metrics: dict) -> None:
    """Print a side-by-side comparison table."""
    logger.info("")
    logger.info("=" * 70)
    logger.info("  A/B COMPARISON: OLD vs NEW prompt")
    logger.info("=" * 70)

    rows = [
        ("Prompt version", old_metrics.get("version", ""), new_metrics.get("version", "")),
        ("Prompt size (chars)", old_metrics.get("prompt_chars", ""), new_metrics.get("prompt_chars", "")),
        ("Time (seconds)", old_metrics.get("elapsed_seconds", ""), new_metrics.get("elapsed_seconds", "")),
        ("Turns used", old_metrics.get("num_turns", ""), new_metrics.get("num_turns", "")),
        ("Cost (USD)", f"${old_metrics.get('cost_usd', 0):.4f}", f"${new_metrics.get('cost_usd', 0):.4f}"),
        ("Stop reason", old_metrics.get("stop_reason", ""), new_metrics.get("stop_reason", "")),
        ("Output tier", old_metrics.get("output_tier", ""), new_metrics.get("output_tier", "")),
        ("Thread IDs found", old_metrics.get("thread_ids_found", ""), new_metrics.get("thread_ids_found", "")),
        ("All IDs present", old_metrics.get("all_ids_present", ""), new_metrics.get("all_ids_present", "")),
        ("Commit message", old_metrics.get("has_commit_message", ""), new_metrics.get("has_commit_message", "")),
        ("Avg reply length", old_metrics.get("avg_reply_length", ""), new_metrics.get("avg_reply_length", "")),
        ("All gates passed", old_metrics.get("all_passed", ""), new_metrics.get("all_passed", "")),
    ]

    logger.info("  %-22s  %-20s  %-20s", "Metric", "OLD", "NEW")
    logger.info("  %s  %s  %s", "-" * 22, "-" * 20, "-" * 20)
    for label, old_val, new_val in rows:
        logger.info("  %-22s  %-20s  %-20s", label, old_val, new_val)
    logger.info("=" * 70)


def print_matrix(all_results: list[dict]) -> None:
    """Print a matrix comparison table across models and scenarios."""
    logger.info("")
    logger.info("=" * 90)
    logger.info("  MODEL COMPARISON MATRIX")
    logger.info("=" * 90)

    headers = [
        "Model", "Scenario", "Turns", "Time(s)", "Cost($)",
        "Tier", "IDs OK", "Passed",
    ]
    logger.info(
        "  %-28s %-8s %5s %7s %8s %5s %6s %6s",
        *headers,
    )
    logger.info("  %s", "-" * 84)

    for m in all_results:
        model_short = m.get("model", "").split("-")[-1][:12]
        if "haiku" in m.get("model", ""):
            model_short = "haiku-4.5"
        elif "sonnet" in m.get("model", ""):
            model_short = "sonnet-4.6"
        elif "opus" in m.get("model", ""):
            model_short = "opus-4.6"
        logger.info(
            "  %-28s %-8s %5s %7s %8s %5s %6s %6s",
            model_short,
            m.get("scenario", ""),
            m.get("num_turns", "?"),
            m.get("elapsed_seconds", "?"),
            f"${m.get('cost_usd', 0):.3f}" if m.get("cost_usd") else "?",
            m.get("output_tier", "?"),
            m.get("all_ids_present", "?"),
            m.get("all_passed", "?"),
        )

    logger.info("=" * 90)


def main() -> None:
    """Parse args and run the e2e test."""
    parser = argparse.ArgumentParser(
        description="Local e2e test for testbot respond pipeline.",
    )
    parser.add_argument(
        "--model", default="claude-haiku-4-5-20251001",
        help="Claude model to use (default: claude-haiku-4-5-20251001)",
    )
    parser.add_argument(
        "--max-turns", type=int, default=20,
        help="Max Claude Code agent turns (default: 20)",
    )
    parser.add_argument(
        "--prompt-version", choices=["old", "new", "compare"],
        default="compare",
        help="Which prompt version to test (default: compare = run both)",
    )
    parser.add_argument(
        "--scenario", choices=["simple", "complex", "both"],
        default="simple",
        help=(
            "Test scenario: 'simple' = rename test methods (quick), "
            "'complex' = write Go unit tests for a real source file (slow), "
            "'both' = run both scenarios"
        ),
    )
    parser.add_argument(
        "--matrix", action="store_true",
        help="Run all models x scenarios and print comparison matrix",
    )
    args = parser.parse_args()

    if not os.environ.get("ANTHROPIC_API_KEY") and not shutil.which("claude"):
        logger.error(
            "Neither ANTHROPIC_API_KEY is set nor 'claude' CLI is in PATH. "
            "Set ANTHROPIC_API_KEY or install Claude Code CLI to run this test."
        )
        sys.exit(1)

    if args.matrix:
        models = [
            "claude-haiku-4-5-20251001",
            "claude-sonnet-4-6",
            "claude-opus-4-6",
        ]
        scenarios = [
            ("simple", MOCK_THREADS, 20),
            ("complex", COMPLEX_THREADS, 30),
        ]
        all_results = []
        for model in models:
            for scenario_name, threads, turns in scenarios:
                logger.info("")
                logger.info(
                    ">>> %s / %s (max_turns=%d)",
                    model.split("claude-")[-1], scenario_name, turns,
                )
                metrics = run_e2e(
                    model=model, max_turns=turns,
                    prompt_version="new", threads=threads,
                )
                metrics["scenario"] = scenario_name
                all_results.append(metrics)
        print_matrix(all_results)
        return

    if args.prompt_version == "compare":
        logger.info("Running A/B comparison: OLD prompt vs NEW prompt")
        logger.info("")

        threads = COMPLEX_THREADS if args.scenario == "complex" else MOCK_THREADS
        logger.info(">>> Running OLD prompt version (scenario=%s)...", args.scenario)
        old_metrics = run_e2e(
            model=args.model, max_turns=args.max_turns,
            prompt_version="old", threads=threads,
        )

        logger.info("")
        logger.info(">>> Running NEW prompt version (scenario=%s)...", args.scenario)
        new_metrics = run_e2e(
            model=args.model, max_turns=args.max_turns,
            prompt_version="new", threads=threads,
        )

        print_comparison(old_metrics, new_metrics)
    else:
        threads = COMPLEX_THREADS if args.scenario == "complex" else MOCK_THREADS
        run_e2e(
            model=args.model,
            max_turns=args.max_turns,
            prompt_version=args.prompt_version,
            threads=threads,
        )


if __name__ == "__main__":
    main()
