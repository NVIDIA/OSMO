# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""State types for the testbot pipeline."""

import dataclasses
from typing import Optional, TypedDict

from testbot.plugins.base import GeneratedTest


@dataclasses.dataclass
class TestTarget:
    """A single file targeted for test generation by the testbot."""

    file_path: str
    uncovered_ranges: list[tuple[int, int]]
    coverage_pct: float
    existing_test_path: Optional[str]
    test_type: str  # "python" | "go" | "ui"
    build_package: str  # Bazel package path, e.g. "//src/utils/job"


class TestbotState(TypedDict):
    """Typed dictionary representing the full pipeline state."""

    provider: str
    targets: list[TestTarget]
    current_index: int
    generated_files: list[str]
    last_generated: Optional[GeneratedTest]
    validation_passed: bool
    validation_output: str
    review_passed: bool
    retry_count: int
    max_retries: int
    max_targets: int
    max_lines: int
    pr_url: Optional[str]
    branch_name: str
    dry_run: bool
    codecov_token: str
    errors: list[str]
