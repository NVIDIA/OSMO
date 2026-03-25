# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""LangGraph node for validating generated tests."""

import logging

from coverage_agent.plugins import get_writer
from coverage_agent.state import CoverageState

logger = logging.getLogger(__name__)


def validate_test(state: CoverageState) -> CoverageState:
    """LangGraph node: validate the last generated test."""
    last_generated = state.get("last_generated")
    if last_generated is None:
        logger.warning("No test was generated, skipping validation")
        return {
            **state,
            "validation_passed": False,
            "validation_output": "No test was generated",
        }

    logger.info(
        "Validating %s (content_length=%d)",
        last_generated.test_file_path, len(last_generated.test_content),
    )

    writer = get_writer(state["provider"])
    result = writer.validate_test(last_generated)

    logger.info("Validation %s: %s", "PASSED" if result.passed else "FAILED", result.output[:200])
    if result.retry_hint:
        logger.info("Retry hint: %s", result.retry_hint[:200])

    new_generated_files = list(state["generated_files"])
    if result.passed:
        new_generated_files.append(last_generated.test_file_path)

    return {
        **state,
        "validation_passed": result.passed,
        "validation_output": result.output,
        "generated_files": new_generated_files,
    }
