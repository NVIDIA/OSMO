# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Tests for select_targets_agent."""

import tempfile
import unittest
from pathlib import Path

from src.scripts.testbot.select_targets_agent import (
    _build_meta,
    _stream_npx,
    build_prompt,
    format_candidate,
    format_targets_markdown,
    merge_picks_with_shortlist,
    parse_agent_output,
)


def _shortlist_entry(file_path: str, **overrides) -> dict:
    base = {
        "file_path": file_path,
        "coverage_pct": 25.0,
        "uncovered_lines": 50,
        "uncovered_ranges": [(10, 20), (30, 40)],
        "tier": 0,
        "fan_in": 30,
        "churn": 12,
        "loc": 200,
        "score": 8.5,
        "score_breakdown": {
            "tier": 4.0, "fan_in": 2.0, "churn": 1.5,
            "criticality": 7.5, "gap": 1.13,
        },
    }
    base.update(overrides)
    return base


class TestFormatCandidate(unittest.TestCase):
    """Tests for format_candidate prompt rendering."""

    def test_includes_path_and_score(self):
        rendered = format_candidate(1, _shortlist_entry("src/lib/foo.py"))
        self.assertIn("src/lib/foo.py", rendered)
        self.assertIn("8.50", rendered)
        self.assertIn("Coverage: 25.0%", rendered)
        self.assertIn("Tier: 0", rendered)


class TestBuildPrompt(unittest.TestCase):
    """Tests for build_prompt template substitution."""

    def test_inlines_candidates_and_max_targets(self):
        shortlist = [
            _shortlist_entry("src/lib/a.py"),
            _shortlist_entry("src/lib/b.py"),
        ]
        prompt = build_prompt(shortlist, max_targets=2)
        self.assertIn("at most 2", prompt)
        self.assertIn("src/lib/a.py", prompt)
        self.assertIn("src/lib/b.py", prompt)
        self.assertIn("shortlist of 2", prompt)


class TestParseAgentOutput(unittest.TestCase):
    """Tests for extracting JSON picks from raw agent output."""

    def test_parses_fenced_json(self):
        output = (
            "Here are my picks:\n\n"
            "```json\n"
            '{"targets": [{"file_path": "src/lib/foo.py", "reason": "good"}]}\n'
            "```\n"
        )
        picks = parse_agent_output(output)
        self.assertEqual(len(picks), 1)
        self.assertEqual(picks[0]["file_path"], "src/lib/foo.py")

    def test_parses_empty_targets(self):
        output = '```json\n{"targets": []}\n```'
        self.assertEqual(parse_agent_output(output), [])

    def test_raises_on_missing_block(self):
        with self.assertRaises(ValueError):
            parse_agent_output("Sorry, I can't help with that.")

    def test_raises_on_non_list_targets(self):
        output = '```json\n{"targets": "src/lib/foo.py"}\n```'
        with self.assertRaises(ValueError):
            parse_agent_output(output)


class TestMergePicksWithShortlist(unittest.TestCase):
    """Tests for merging agent picks with full shortlist entries."""

    def test_attaches_uncovered_ranges_from_shortlist(self):
        shortlist = [_shortlist_entry("src/lib/foo.py")]
        picks = [{"file_path": "src/lib/foo.py", "reason": "central API"}]
        merged = merge_picks_with_shortlist(picks, shortlist)
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["uncovered_ranges"], [(10, 20), (30, 40)])
        self.assertEqual(merged[0]["reason"], "central API")

    def test_drops_picks_not_in_shortlist(self):
        shortlist = [_shortlist_entry("src/lib/foo.py")]
        picks = [
            {"file_path": "src/lib/foo.py", "reason": "ok"},
            {"file_path": "src/lib/hallucinated.py", "reason": "made up"},
        ]
        merged = merge_picks_with_shortlist(picks, shortlist)
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["file_path"], "src/lib/foo.py")

    def test_skips_pick_without_file_path(self):
        shortlist = [_shortlist_entry("src/lib/foo.py")]
        picks = [{"reason": "missing path"}]
        merged = merge_picks_with_shortlist(picks, shortlist)
        self.assertEqual(merged, [])

    def test_skips_non_dict_pick(self):
        # Defensive: the agent could emit a list of strings or other
        # non-object entries. Don't crash on `.get(...)`.
        shortlist = [_shortlist_entry("src/lib/foo.py")]
        picks: list = ["src/lib/foo.py", 42, None]
        merged = merge_picks_with_shortlist(picks, shortlist)
        self.assertEqual(merged, [])


class TestFormatTargetsMarkdown(unittest.TestCase):
    """Tests for the final markdown rendering of selected targets."""

    def test_empty_picks_emits_skip_message(self):
        output = format_targets_markdown([])
        self.assertIn("No coverage targets selected", output)

    def test_renders_target_with_reason(self):
        target = _shortlist_entry("src/lib/foo.py")
        target["reason"] = "Central error formatter"
        output = format_targets_markdown([target])
        self.assertIn("## Target 1: src/lib/foo.py", output)
        self.assertIn("Coverage: 25.0%", output)
        self.assertIn("10-20, 30-40", output)
        self.assertIn("Why this file: Central error formatter", output)

    def test_omits_why_line_when_no_reason(self):
        target = _shortlist_entry("src/lib/foo.py")
        # No 'reason' key on this entry
        output = format_targets_markdown([target])
        self.assertNotIn("Why this file:", output)


class TestBuildMeta(unittest.TestCase):
    """Tests for the picker's PR-description sidecar shape."""

    def test_projects_only_pr_relevant_fields(self):
        merged = [{
            "file_path": "src/lib/foo.py",
            "coverage_pct": 25.0,
            "uncovered_lines": 50,
            "uncovered_ranges": [(10, 20), (30, 40)],
            "tier": 0,
            "fan_in": 30,
            "churn": 12,
            "loc": 200,
            "score": 8.5,
            "score_breakdown": {"tier": 4.0},
            "reason": "central API",
        }]
        meta = _build_meta(merged)
        self.assertEqual(meta, [{
            "file_path": "src/lib/foo.py",
            "coverage_pct": 25.0,
            "uncovered_lines": 50,
            "reason": "central API",
        }])

    def test_empty_merged_produces_empty_list(self):
        self.assertEqual(_build_meta([]), [])

    def test_missing_reason_defaults_to_empty_string(self):
        merged = [{
            "file_path": "src/lib/foo.py",
            "coverage_pct": 10.0,
            "uncovered_lines": 5,
        }]
        self.assertEqual(_build_meta(merged)[0]["reason"], "")


class TestStreamNpxTimeout(unittest.TestCase):
    """End-to-end test of _stream_npx's timeout enforcement.

    Uses a real subprocess (sleep) — no Claude CLI dependency. The earlier
    synchronous-drain implementation would hang here despite timeout_sec=1
    because the for-loop blocked on the pipe; this test pins the
    background-thread-drain fix in place.
    """

    def test_timeout_kills_process_and_returns_124(self):
        with tempfile.NamedTemporaryFile(
            suffix=".jsonl", delete=False, mode="w",
        ) as tmp:
            log_path = Path(tmp.name)
        try:
            exit_code = _stream_npx(
                ["sleep", "30"], log_path, timeout_sec=1,
            )
            self.assertEqual(exit_code, 124)
        finally:
            log_path.unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
