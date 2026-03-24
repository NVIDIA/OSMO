# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

from coverage_agent.plugins import get_writer
from coverage_agent.state import CoverageState


def validate_test(state: CoverageState) -> CoverageState:
    """LangGraph node: validate the last generated test."""
    last_generated = state.get("last_generated")
    if last_generated is None:
        return {
            **state,
            "validation_passed": False,
            "validation_output": "No test was generated",
        }

    writer = get_writer(state["provider"])
    result = writer.validate_test(last_generated)

    new_generated_files = list(state["generated_files"])
    if result.passed:
        new_generated_files.append(last_generated.test_file_path)

    return {
        **state,
        "validation_passed": result.passed,
        "validation_output": result.output,
        "generated_files": new_generated_files,
    }
