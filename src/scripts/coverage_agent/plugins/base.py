# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

import dataclasses
from abc import ABC, abstractmethod
from typing import Optional


@dataclasses.dataclass
class GeneratedTest:
    test_file_path: str
    test_content: str
    build_entry: Optional[str]  # BUILD file addition (None for Go/UI)


@dataclasses.dataclass
class ValidationResult:
    passed: bool
    output: str  # stdout/stderr
    retry_hint: Optional[str]  # Error context for retry prompt


class WriterPlugin(ABC):
    @abstractmethod
    def generate_test(
        self,
        source_path: str,
        uncovered_ranges: list[tuple[int, int]],
        existing_test_path: Optional[str],
        test_type: str,
        build_package: str,
        retry_context: Optional[str] = None,
    ) -> GeneratedTest:
        ...

    @abstractmethod
    def validate_test(self, test: GeneratedTest) -> ValidationResult:
        ...
