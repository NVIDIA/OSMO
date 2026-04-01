# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Base types and abstract LLM provider interface."""

import dataclasses
import enum
import os
from abc import ABC, abstractmethod
from typing import Optional


class TestType(str, enum.Enum):
    """Supported test framework types."""

    PYTHON = "python"
    GO = "go"
    UI = "ui"


@dataclasses.dataclass
class GeneratedTest:
    """Output of an LLM provider: test file content and optional BUILD entry."""

    test_file_path: str
    test_content: str
    build_entry: Optional[str]  # BUILD file addition (None for Go/UI)
    syntax_error: Optional[str] = None  # Pre-validation syntax error (e.g., truncated output)


@dataclasses.dataclass
class ValidationResult:
    """Result of running a generated test through the build system."""

    passed: bool
    output: str
    retry_hint: Optional[str]


def detect_test_type(file_path: str) -> Optional[TestType]:
    """Detect the test type based on file extension and path."""
    if file_path.endswith(".py"):
        return TestType.PYTHON
    if file_path.endswith(".go"):
        return TestType.GO
    if file_path.startswith("src/ui/") and file_path.endswith((".ts", ".tsx")):
        return TestType.UI
    return None


def determine_test_path(source_path: str, test_type: TestType) -> str:
    """Determine the output path for a generated test file."""
    directory = os.path.dirname(source_path)
    basename = os.path.splitext(os.path.basename(source_path))[0]

    if test_type == TestType.PYTHON:
        return os.path.join(directory, "tests", f"test_{basename}.py")
    if test_type == TestType.GO:
        return os.path.join(directory, f"{basename}_test.go")
    if test_type == TestType.UI:
        return os.path.join(directory, f"{basename}.test.ts")
    return os.path.join(directory, f"test_{basename}")


def file_path_to_bazel_package(file_path: str) -> str:
    """Convert a file path to a Bazel package (e.g., src/utils/roles → //src/utils/roles)."""
    return "//" + os.path.dirname(file_path)


class LLMProvider(ABC):
    """Abstract interface for LLM providers."""

    @abstractmethod
    def generate_test(
        self,
        source_path: str,
        uncovered_ranges: list[tuple[int, int]],
        existing_test_path: Optional[str],
        test_type: TestType,
        build_package: str,
        retry_context: Optional[str] = None,
    ) -> GeneratedTest:
        ...

    @abstractmethod
    def validate_test(self, test: GeneratedTest) -> ValidationResult:
        ...
