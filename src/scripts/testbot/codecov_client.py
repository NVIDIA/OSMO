# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Fetch coverage data from the Codecov API."""

import logging

import requests

from testbot.lcov_parser import CoverageEntry, _is_ignored

logger = logging.getLogger(__name__)

CODECOV_API_BASE = "https://api.codecov.io/api/v2"


def fetch_coverage(
    token: str,
    owner: str = "NVIDIA",
    repo: str = "OSMO",
    branch: str = "main",
) -> list[CoverageEntry]:
    """Fetch coverage data from Codecov API. Returns all files (backend + UI)."""
    url = f"{CODECOV_API_BASE}/github/{owner}/repos/{repo}/report/"
    headers = {"Authorization": f"token {token}"}
    params = {"branch": branch}

    logger.info("Fetching coverage from Codecov (branch=%s)", branch)
    response = requests.get(url, params=params, headers=headers, timeout=60)
    response.raise_for_status()

    data = response.json()
    logger.info(
        "Codecov: %d files, %.1f%% coverage (%d lines, %d hits, %d misses)",
        data["totals"]["files"], data["totals"]["coverage"],
        data["totals"]["lines"], data["totals"]["hits"], data["totals"]["misses"],
    )

    return _parse_report(data)


def _parse_report(data: dict) -> list[CoverageEntry]:
    """Convert Codecov report JSON to list[CoverageEntry]."""
    entries = []
    for file_report in data.get("files", []):
        file_path = file_report["name"]

        if _is_ignored(file_path):
            continue

        line_coverage = file_report.get("line_coverage", [])
        if not line_coverage:
            continue

        # line_coverage is [[line_num, status], ...] where 0=hit, 1=miss
        total_lines = len(line_coverage)
        covered_lines = sum(1 for _, status in line_coverage if status == 0)
        coverage_pct = (covered_lines / total_lines * 100) if total_lines else 0.0

        uncovered_line_numbers = sorted(line for line, status in line_coverage if status == 1)
        uncovered_ranges = _lines_to_ranges(uncovered_line_numbers)

        entries.append(CoverageEntry(
            file_path=file_path,
            total_lines=total_lines,
            covered_lines=covered_lines,
            coverage_pct=coverage_pct,
            uncovered_ranges=uncovered_ranges,
        ))

    entries.sort(key=lambda entry: entry.coverage_pct)
    logger.info("Parsed %d coverage entries from Codecov", len(entries))
    return entries


def _lines_to_ranges(lines: list[int]) -> list[tuple[int, int]]:
    """Convert sorted list of line numbers to contiguous ranges.

    Example: [1, 2, 3, 7, 8, 15] → [(1, 3), (7, 8), (15, 15)]
    """
    if not lines:
        return []

    ranges = []
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
