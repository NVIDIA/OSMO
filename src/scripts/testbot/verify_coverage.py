# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Compute per-target coverage gain from a Bazel LCOV report.

Given the picker's target metadata (source file + uncovered ranges that the
generator was asked to cover) and the LCOV report produced by
``bazel coverage``, this script:

  1. parses LCOV's per-file hit table,
  2. for each listed uncovered range, counts how many lines now have hits,
  3. emits a JSON sidecar (machine-readable) and a Markdown snippet
     (human-readable, embedded in the PR body by ``create_pr.py``).

The script is the source of truth used by both the LLM (which calls it
during its self-iteration loop to find ranges still uncovered) and the
harness (which calls it after generation to attach a report to the PR).
Both consume the same JSON, so the LLM and the human reviewer see the same
numbers.

Usage:
    python verify_coverage.py \\
        --targets-meta /tmp/targets_meta.json \\
        --lcov bazel-out/_coverage/_coverage_report.dat \\
        --json-output /tmp/coverage_report.json \\
        --markdown-output /tmp/coverage_report.md
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import logging
import sys
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

# A range is "covered" if at least this fraction of its lines have hits>0.
# Single-hit-anywhere is too lenient (one line of a 20-line block barely
# proves the branch executed); >= half feels right for declaring a range
# materially exercised. The generator's self-iteration loop uses the same
# threshold so its view of "still uncovered" matches the report.
RANGE_HIT_FRACTION = 0.5

# A target passes if at least this fraction of *listed* lines are hit. The
# generator iterates until it clears this bar (or runs out of turns).
DEFAULT_TARGET_THRESHOLD = 0.70


@dataclasses.dataclass(frozen=True)
class RangeResult:
    """Per-range coverage outcome.

    ``start``/``end`` are inclusive 1-based line numbers as Codecov reports
    them. ``hit_lines`` is the count of lines in the range with hits>0 in the
    LCOV report; ``total_lines`` is the span.
    """

    start: int
    end: int
    hit_lines: int
    total_lines: int

    @property
    def covered(self) -> bool:
        """A range is covered when ≥ RANGE_HIT_FRACTION of its lines hit."""
        if self.total_lines == 0:
            return False
        return self.hit_lines / self.total_lines >= RANGE_HIT_FRACTION


@dataclasses.dataclass
class TargetReport:
    """Aggregated coverage report for one source file in the picker meta."""

    file_path: str
    listed_lines: int
    hit_lines: int
    ranges: list[RangeResult]
    lcov_seen: bool

    @property
    def hit_fraction(self) -> float:
        """Fraction of listed lines now hit (0.0–1.0)."""
        if self.listed_lines == 0:
            return 0.0
        return self.hit_lines / self.listed_lines

    @property
    def passed(self) -> bool:
        """True when the file clears DEFAULT_TARGET_THRESHOLD."""
        return self.hit_fraction >= DEFAULT_TARGET_THRESHOLD

    def still_uncovered_ranges(self) -> list[tuple[int, int]]:
        """Return ranges that did not meet RANGE_HIT_FRACTION.

        These are the ranges the generator should target on its next
        iteration.
        """
        return [(r.start, r.end) for r in self.ranges if not r.covered]


def parse_lcov(lcov_path: Path) -> dict[str, dict[int, int]]:
    """Parse an LCOV report into ``{source_path: {line: hits}}``.

    Only ``SF:`` / ``DA:`` records are needed for line-coverage roll-up.
    Other LCOV records (``FN:``, ``BRDA:``, summary counters) are ignored.

    Missing / empty files yield an empty dict so callers can still emit a
    "no LCOV available" report instead of crashing the workflow step.
    """
    if not lcov_path.exists():
        logger.warning("LCOV report not found: %s", lcov_path)
        return {}

    coverage: dict[str, dict[int, int]] = {}
    current_file: str | None = None
    # Fail-soft on unreadable LCOV (permissions, partial write, broken
    # symlink): warn and return whatever we got. The harness step is
    # already `continue-on-error`, but an uncaught OSError here would
    # still surface a workflow failure annotation.
    try:
        fh = open(lcov_path, encoding="utf-8", errors="replace")
    except OSError as exc:
        logger.warning("Could not open LCOV report %s: %s", lcov_path, exc)
        return {}
    try:
        for raw_line in fh:
            line = raw_line.strip()
            if line.startswith("SF:"):
                current_file = line[len("SF:"):].strip()
                # `bazel coverage` emits workspace-relative paths; the
                # picker metadata uses the same convention so we don't
                # normalize further.
                coverage.setdefault(current_file, {})
            elif line.startswith("DA:") and current_file is not None:
                # DA:<line>,<hits>[,<checksum>]
                payload = line[len("DA:"):].split(",")
                if len(payload) < 2:
                    continue
                try:
                    line_no = int(payload[0])
                    hits = int(payload[1])
                except ValueError:
                    continue
                # Take the max if the line shows up twice (e.g., the same
                # source file participates in multiple test targets).
                existing = coverage[current_file].get(line_no, 0)
                coverage[current_file][line_no] = max(existing, hits)
            elif line == "end_of_record":
                current_file = None
    except OSError as exc:
        # Mid-read I/O failure (e.g., NFS truncation) — keep what we
        # parsed so far so partial coverage data still flows to the PR.
        logger.warning(
            "Error reading LCOV report %s mid-stream: %s", lcov_path, exc,
        )
    finally:
        fh.close()
    return coverage


def _normalize_ranges(raw_ranges: object) -> list[tuple[int, int]]:
    """Coerce the picker's uncovered-ranges JSON shape into ``(start, end)``.

    The meta JSON stores ranges as 2-element lists (``[[90, 91], [97, 97]]``).
    Older payloads sometimes drop the second element for single-line ranges.
    """
    if not isinstance(raw_ranges, list):
        return []
    out: list[tuple[int, int]] = []
    for entry in raw_ranges:
        if isinstance(entry, (list, tuple)) and len(entry) >= 2:
            try:
                start, end = int(entry[0]), int(entry[1])
            except (TypeError, ValueError):
                continue
        elif isinstance(entry, (list, tuple)) and len(entry) == 1:
            try:
                start = end = int(entry[0])
            except (TypeError, ValueError):
                continue
        elif isinstance(entry, int):
            start = end = entry
        else:
            continue
        if start <= end:
            out.append((start, end))
    return out


def evaluate_target(
    file_path: str,
    raw_ranges: object,
    file_coverage: dict[int, int] | None,
) -> TargetReport:
    """Compute the ``TargetReport`` for one picker meta entry.

    ``file_coverage`` is the per-line ``hits`` map for ``file_path`` (the
    inner dict produced by ``parse_lcov``); pass ``None`` when the source
    file did not appear in the LCOV so the report still renders a row.
    """
    ranges = _normalize_ranges(raw_ranges)
    range_results: list[RangeResult] = []
    total_listed = 0
    total_hit = 0
    for start, end in ranges:
        span = end - start + 1
        if file_coverage is None:
            hit_lines = 0
        else:
            hit_lines = sum(
                1 for line in range(start, end + 1)
                if file_coverage.get(line, 0) > 0
            )
        range_results.append(RangeResult(
            start=start,
            end=end,
            hit_lines=hit_lines,
            total_lines=span,
        ))
        total_listed += span
        total_hit += hit_lines
    return TargetReport(
        file_path=file_path,
        listed_lines=total_listed,
        hit_lines=total_hit,
        ranges=range_results,
        lcov_seen=file_coverage is not None,
    )


def build_reports(
    targets_meta: list[dict],
    lcov_coverage: dict[str, dict[int, int]],
) -> list[TargetReport]:
    """Build a ``TargetReport`` for every entry in the picker metadata."""
    reports: list[TargetReport] = []
    for entry in targets_meta:
        if not isinstance(entry, dict):
            continue
        file_path = entry.get("file_path")
        if not isinstance(file_path, str) or not file_path:
            continue
        file_coverage = lcov_coverage.get(file_path)
        reports.append(evaluate_target(
            file_path=file_path,
            raw_ranges=entry.get("uncovered_ranges", []),
            file_coverage=file_coverage,
        ))
    return reports


def render_markdown(reports: list[TargetReport]) -> str:
    """Render a Markdown coverage-gain section for the PR body.

    Mirrors the picker-rationale block format already used by
    ``create_pr.py``: one heading, one row per target, then a per-range
    checklist. The numbers come from the same JSON the LLM consumed during
    iteration, so the PR description and the generator's view agree.
    """
    if not reports:
        return ""
    lines: list[str] = ["## Coverage gain on listed uncovered ranges", ""]
    for report in reports:
        pct = report.hit_fraction * 100
        status = "✅" if report.passed else "⚠️"
        if not report.lcov_seen:
            status = "❔"
            note = " — file not found in LCOV (was the test target run?)"
        else:
            note = ""
        lines.append(
            f"{status} **`{report.file_path}`** — "
            f"{report.hit_lines}/{report.listed_lines} listed lines hit "
            f"({pct:.0f}%){note}"
        )
        if not report.ranges:
            lines.append("")
            continue
        for r in report.ranges:
            span = (
                f"line {r.start}" if r.start == r.end
                else f"lines {r.start}-{r.end}"
            )
            check = "✅" if r.covered else "❌"
            lines.append(
                f"  - {check} {span} — {r.hit_lines}/{r.total_lines} hit"
            )
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def render_json(reports: list[TargetReport]) -> str:
    """Serialize reports as JSON for downstream tools (e.g., create_pr.py).

    Each report is flattened: range hits live as plain dicts so the JSON
    can be consumed without importing the dataclasses.
    """
    payload = [
        {
            "file_path": r.file_path,
            "listed_lines": r.listed_lines,
            "hit_lines": r.hit_lines,
            "hit_fraction": round(r.hit_fraction, 4),
            "passed": r.passed,
            "lcov_seen": r.lcov_seen,
            "threshold": DEFAULT_TARGET_THRESHOLD,
            "ranges": [
                {
                    "start": rr.start,
                    "end": rr.end,
                    "hit_lines": rr.hit_lines,
                    "total_lines": rr.total_lines,
                    "covered": rr.covered,
                }
                for rr in r.ranges
            ],
            "still_uncovered_ranges": [
                [start, end] for start, end in r.still_uncovered_ranges()
            ],
        }
        for r in reports
    ]
    return json.dumps(payload, indent=2) + "\n"


def main() -> None:
    """Entry point: parse LCOV, evaluate against picker meta, emit reports."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--targets-meta", required=True,
        help="JSON list emitted by select_targets_agent (file_path + "
             "uncovered_ranges per target)",
    )
    parser.add_argument(
        "--lcov", required=True,
        help="Path to the LCOV report from `bazel coverage` "
             "(usually bazel-out/_coverage/_coverage_report.dat)",
    )
    parser.add_argument(
        "--json-output", default="",
        help="Where to write the machine-readable report (empty = skip)",
    )
    parser.add_argument(
        "--markdown-output", default="",
        help="Where to write the Markdown PR snippet (empty = skip)",
    )
    args = parser.parse_args()

    try:
        targets_meta = json.loads(
            Path(args.targets_meta).read_text(encoding="utf-8")
        )
    except (OSError, json.JSONDecodeError) as exc:
        logger.error("Could not read targets meta %s: %s",
                     args.targets_meta, exc)
        sys.exit(1)
    if not isinstance(targets_meta, list):
        logger.error("targets meta must be a JSON list, got %s",
                     type(targets_meta).__name__)
        sys.exit(1)

    lcov_coverage = parse_lcov(Path(args.lcov))
    reports = build_reports(targets_meta, lcov_coverage)

    for report in reports:
        logger.info(
            "%s — %d/%d listed lines hit (%.0f%%)%s",
            report.file_path,
            report.hit_lines,
            report.listed_lines,
            report.hit_fraction * 100,
            "" if report.lcov_seen else " [no LCOV entry]",
        )

    if args.json_output:
        Path(args.json_output).write_text(render_json(reports), encoding="utf-8")
        logger.info("Wrote JSON report to %s", args.json_output)
    if args.markdown_output:
        Path(args.markdown_output).write_text(
            render_markdown(reports), encoding="utf-8",
        )
        logger.info("Wrote Markdown report to %s", args.markdown_output)


if __name__ == "__main__":
    main()
