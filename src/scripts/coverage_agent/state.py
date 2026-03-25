# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""State types for the coverage agent pipeline."""

import dataclasses
from typing import Optional, TypedDict

from coverage_agent.plugins.base import GeneratedTest


@dataclasses.dataclass
class CoverageTarget:
    """A single file targeted for test generation by the coverage agent."""

    file_path: str
    uncovered_ranges: list[tuple[int, int]]
    coverage_pct: float
    existing_test_path: Optional[str]
    test_type: str  # "python" | "go" | "ui"
    build_package: str  # Bazel package path, e.g. "//src/utils/job"


class CoverageState(TypedDict):
    """Typed dictionary representing the full pipeline state."""

    provider: str
    lcov_path: str
    targets: list[CoverageTarget]
    current_index: int
    generated_files: list[str]
    last_generated: Optional[GeneratedTest]
    validation_passed: bool
    validation_output: str
    retry_count: int
    max_retries: int
    max_targets: int
    min_coverage_delta: float  # TODO: implement coverage delta check in quality_gate
    pr_url: Optional[str]
    branch_name: str
    dry_run: bool
    ui_lcov_path: str
    errors: list[str]
