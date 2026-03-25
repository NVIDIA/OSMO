# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""LangGraph node for delegating test generation to the active writer plugin."""

import logging

from coverage_agent.plugins import get_writer
from coverage_agent.state import CoverageState

logger = logging.getLogger(__name__)


def write_test(state: CoverageState) -> CoverageState:
    """LangGraph node: delegate test generation to the active WriterPlugin."""
    target = state["targets"][state["current_index"]]
    writer = get_writer(state["provider"])
    retry_context = state["validation_output"] if state["retry_count"] > 0 else None

    logger.info(
        "Writing test for %s (index=%d, retry=%d/%d, type=%s)",
        target.file_path, state["current_index"],
        state["retry_count"], state["max_retries"], target.test_type,
    )

    result = writer.generate_test(
        source_path=target.file_path,
        uncovered_ranges=target.uncovered_ranges,
        existing_test_path=target.existing_test_path,
        test_type=target.test_type,
        build_package=target.build_package,
        retry_context=retry_context,
    )

    logger.info(
        "Write result: file=%s, content_length=%d",
        result.test_file_path, len(result.test_content),
    )
    return {**state, "last_generated": result}
