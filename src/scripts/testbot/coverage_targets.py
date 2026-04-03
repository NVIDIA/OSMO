# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Select low-coverage files from Codecov as targets for test generation.

Fetches the Codecov coverage report, ranks files by coverage percentage,
and prints a structured target list to stdout for consumption by Claude Code.

Usage:
    python coverage_targets.py --token $CODECOV_TOKEN --max-targets 3
"""

import argparse
import fnmatch
import json
import logging
import os
import sys
import urllib.error
import urllib.request

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

CODECOV_API_BASE = "https://api.codecov.io/api/v2"

IGNORE_PATTERNS = [
    "*/tests/*",
    "src/scripts/**",
    "bzl/**",
    "run/**",
    "deployments/**",
]

SKIP_BASENAME_PATTERNS = [
    "*generated.ts",
    "*_pb2.py",
    "*_pb2_grpc.py",
    "test_*.py",
    "*_test.go",
    "*.test.ts",
    "*.test.tsx",
    "__init__.py",
    "BUILD",
]

MIN_FILE_LINES = 10
MAX_FILE_LINES = 0  # 0 = no cap


def _is_ignored(file_path: str) -> bool:
    """Check if a file path matches ignore patterns.

    Filters out:
    - Files inside any tests/ directory (fixtures, helpers, etc.)
    - Scripts, build config, and deployment files
    - Generated code, test files, __init__.py, BUILD
    """
    for pattern in IGNORE_PATTERNS:
        if fnmatch.fnmatch(file_path, pattern):
            return True
    basename = file_path.rsplit("/", maxsplit=1)[-1]
    for pattern in SKIP_BASENAME_PATTERNS:
        if fnmatch.fnmatch(basename, pattern):
            return True
    return False


def _lines_to_ranges(lines: list[int]) -> list[tuple[int, int]]:
    """Convert a sorted list of line numbers to contiguous ranges.

    Example:
        [1, 2, 3, 7, 8, 15] -> [(1, 3), (7, 8), (15, 15)]
    """
    if not lines:
        return []
    ranges: list[tuple[int, int]] = []
    start = lines[0]
    end = lines[0]
    for line in lines[1:]:
        if line == end + 1:
            end = line
        else:
            ranges.append((start, end))
            start = line
            end = line
    ranges.append((start, end))
    return ranges


def _cap_ranges(
    ranges: list[tuple[int, int]],
    max_lines: int,
) -> list[tuple[int, int]]:
    """Trim uncovered ranges so the total does not exceed max_lines."""
    capped: list[tuple[int, int]] = []
    remaining = max_lines
    for start, end in ranges:
        span = end - start + 1
        if span <= remaining:
            capped.append((start, end))
            remaining -= span
        else:
            if remaining > 0:
                capped.append((start, start + remaining - 1))
            break
    return capped


def fetch_codecov_report(
    token: str,
    owner: str = "NVIDIA",
    repo: str = "OSMO",
    branch: str = "main",
) -> dict:
    """Fetch the coverage report JSON from Codecov API."""
    url = f"{CODECOV_API_BASE}/github/{owner}/repos/{repo}/report/?branch={branch}"
    request = urllib.request.Request(
        url,
        headers={"Authorization": f"token {token}"},
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as exc:
        logger.error("Codecov API returned %d: %s", exc.code, exc.reason)
        sys.exit(1)
    except urllib.error.URLError as exc:
        logger.error("Codecov API request failed: %s", exc.reason)
        sys.exit(1)
    except (json.JSONDecodeError, ValueError) as exc:
        logger.error("Failed to parse Codecov response: %s", exc)
        sys.exit(1)


def select_targets(
    report: dict,
    max_targets: int,
    max_uncovered: int,
) -> list[dict]:
    """Parse the Codecov report and return the lowest-coverage targets.

    Args:
        report: Raw JSON response from the Codecov API.
        max_targets: Maximum number of files to return.
        max_uncovered: Cap on uncovered lines per target (0 = no cap).

    Returns:
        A list of target dicts with keys: file_path, coverage_pct,
        uncovered_lines, uncovered_ranges.
    """
    entries = []
    for file_report in report.get("files", []):
        file_path = file_report["name"]

        if _is_ignored(file_path):
            continue

        line_coverage = file_report.get("line_coverage", [])
        if not line_coverage:
            continue

        total_lines = len(line_coverage)
        if total_lines < MIN_FILE_LINES:
            continue
        if 0 < MAX_FILE_LINES < total_lines:
            continue

        # Codecov line_coverage format: [[line_num, status], ...]
        # where 0 = hit (covered), 1 = miss (uncovered)
        covered = 0
        uncovered_numbers = []
        for line, status in line_coverage:
            if status == 0:
                covered += 1
            elif status == 1:
                uncovered_numbers.append(line)
        uncovered_numbers.sort()
        coverage_pct = (covered / total_lines * 100) if total_lines else 0.0
        uncovered_ranges = _lines_to_ranges(uncovered_numbers)

        if max_uncovered > 0:
            uncovered_ranges = _cap_ranges(uncovered_ranges, max_uncovered)

        uncovered_line_count = sum(e - s + 1 for s, e in uncovered_ranges)
        if uncovered_line_count == 0:
            continue

        entries.append({
            "file_path": file_path,
            "coverage_pct": coverage_pct,
            "uncovered_lines": uncovered_line_count,
            "uncovered_ranges": uncovered_ranges,
        })

    entries.sort(key=lambda entry: entry["coverage_pct"])
    return entries[:max_targets]


def format_targets(targets: list[dict]) -> str:
    """Format targets as structured text for the Claude Code prompt."""
    if not targets:
        return "No coverage targets found."

    lines: list[str] = []
    for i, target in enumerate(targets, start=1):
        ranges_str = ", ".join(
            f"{s}-{e}" if s != e else str(s)
            for s, e in target["uncovered_ranges"]
        )
        lines.append(f"## Target {i}: {target['file_path']}")
        lines.append(
            f"Coverage: {target['coverage_pct']:.1f}% "
            f"({target['uncovered_lines']} uncovered lines)"
        )
        lines.append(f"Uncovered ranges: {ranges_str}")
        lines.append("")
    return "\n".join(lines)


def main() -> None:
    """Entry point: fetch coverage data and print targets to stdout."""
    parser = argparse.ArgumentParser(
        description="Select low-coverage files from Codecov for test generation.",
    )
    parser.add_argument(
        "--token",
        default="",
        help="Codecov API token (or set CODECOV_TOKEN env var)",
    )
    parser.add_argument(
        "--max-targets",
        type=int,
        default=1,
        help="Maximum number of files to target (default: 1)",
    )
    parser.add_argument(
        "--max-uncovered",
        type=int,
        default=300,
        help="Max uncovered lines per target (default: 300, 0 = no cap)",
    )
    args = parser.parse_args()

    token = args.token or os.environ.get("CODECOV_TOKEN", "")
    if not token:
        logger.error("No Codecov token. Use --token or set CODECOV_TOKEN.")
        sys.exit(1)

    report = fetch_codecov_report(token)
    logger.info(
        "Codecov: %d files, %.1f%% overall coverage",
        report["totals"]["files"],
        report["totals"]["coverage"],
    )

    targets = select_targets(report, args.max_targets, args.max_uncovered)
    logger.info("Selected %d target(s)", len(targets))
    for target in targets:
        logger.info(
            "  %.1f%% %s (%d uncovered lines)",
            target["coverage_pct"],
            target["file_path"],
            target["uncovered_lines"],
        )

    print(format_targets(targets))


if __name__ == "__main__":
    main()
