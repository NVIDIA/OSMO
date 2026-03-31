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

    # Fast-fail on known syntax errors (e.g., truncated LLM output)
    if last_generated.syntax_error:
        error_msg = (
            f"Generated code has a syntax error (likely truncated LLM output): "
            f"{last_generated.syntax_error}"
        )
        logger.error("Validation FAILED (syntax): %s", error_msg)
        return {
            **state,
            "validation_passed": False,
            "validation_output": error_msg,
        }

    writer = get_writer(state["provider"])
    result = writer.validate_test(last_generated)

    if result.passed:
        logger.info("Validation PASSED")
    else:
        logger.error("Validation FAILED for %s:", last_generated.test_file_path)
        for line in result.output.strip().split("\n"):
            logger.error("  %s", line)

    return {
        **state,
        "validation_passed": result.passed,
        "validation_output": result.output,
    }
