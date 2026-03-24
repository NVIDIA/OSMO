# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

from coverage_agent.plugins import get_writer
from coverage_agent.state import CoverageState


def write_test(state: CoverageState) -> CoverageState:
    """LangGraph node: delegate test generation to the active WriterPlugin."""
    target = state["targets"][state["current_index"]]
    writer = get_writer(state["provider"])
    retry_context = state["validation_output"] if state["retry_count"] > 0 else None

    result = writer.generate_test(
        source_path=target.file_path,
        uncovered_ranges=target.uncovered_ranges,
        existing_test_path=target.existing_test_path,
        test_type=target.test_type,
        build_package=target.build_package,
        retry_context=retry_context,
    )
    return {**state, "last_generated": result}
