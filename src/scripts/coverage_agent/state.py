# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

import dataclasses
from typing import Optional, TypedDict

from coverage_agent.plugins.base import GeneratedTest


@dataclasses.dataclass
class CoverageTarget:
    file_path: str
    uncovered_ranges: list[tuple[int, int]]
    coverage_pct: float
    existing_test_path: Optional[str]
    test_type: str  # "python" | "go" | "ui"
    build_package: str  # Bazel package path, e.g. "//src/utils/job"


class CoverageState(TypedDict):
    provider: str
    targets: list[CoverageTarget]
    current_index: int
    generated_files: list[str]
    last_generated: Optional[GeneratedTest]
    validation_passed: bool
    validation_output: str
    retry_count: int
    max_retries: int
    max_targets: int
    min_coverage_delta: float
    pr_url: Optional[str]
    branch_name: str
    dry_run: bool
    ui_lcov_path: str
    errors: list[str]
