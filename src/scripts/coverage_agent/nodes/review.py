# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""LLM-based test quality review node."""

import logging
import re
from typing import Optional

from coverage_agent.plugins import get_writer
from coverage_agent.prompts.review import REVIEW_SYSTEM_PROMPT, build_review_prompt
from coverage_agent.state import CoverageState
from coverage_agent.tools.file_ops import read_file

logger = logging.getLogger(__name__)


def review_test(state: CoverageState) -> CoverageState:
    """LangGraph node: LLM-based quality review of generated tests."""
    last_generated = state.get("last_generated")
    if last_generated is None or not last_generated.test_content.strip():
        logger.warning("No test content to review")
        return {
            **state,
            "review_passed": False,
            "validation_output": "No test content generated",
        }

    test_file_path = last_generated.test_file_path
    test_content = last_generated.test_content

    llm_passed, llm_feedback = _run_llm_review(state, test_content, test_file_path)

    if not llm_passed:
        logger.info("LLM review BLOCKED %s: %s", test_file_path, llm_feedback[:200])
        return {
            **state,
            "review_passed": False,
            "validation_output": f"LLM review failed:\n{llm_feedback}",
        }

    logger.info("Review PASSED: %s", test_file_path)
    new_generated_files = list(state["generated_files"])
    new_generated_files.append(test_file_path)

    return {
        **state,
        "review_passed": True,
        "generated_files": new_generated_files,
    }


def _run_llm_review(
    state: CoverageState,
    test_content: str,
    test_file_path: str,
) -> tuple[bool, str]:
    """Call the LLM to review the test for quality issues.

    Returns (passed, feedback).
    """
    target = state["targets"][state["current_index"]]
    source_content = read_file(target.file_path)

    if source_content.startswith("Error"):
        logger.warning("Cannot read source file for review: %s", target.file_path)
        return True, ""

    writer = get_writer(state["provider"])
    if writer.client is None:
        logger.warning("LLM client not available, skipping LLM review")
        return True, ""

    user_prompt = build_review_prompt(
        test_content=test_content,
        test_file_path=test_file_path,
        source_content=source_content,
        source_path=target.file_path,
    )

    logger.info("Running LLM review for %s", test_file_path)

    try:
        response = writer.client.chat.completions.create(
            model=writer.model,
            messages=[
                {"role": "system", "content": REVIEW_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.3,
            max_tokens=2048,
        )
        review_text = response.choices[0].message.content or ""
    except Exception as exc:  # pylint: disable=broad-except
        logger.warning("LLM review failed: %s. Skipping.", exc)
        return True, ""

    logger.info("LLM review response: %s", review_text[:200])

    verdict_match = re.search(r"VERDICT:\s*(PASS|FAIL)", review_text, re.IGNORECASE)
    if not verdict_match:
        logger.warning("Could not parse VERDICT from LLM review. Assuming PASS.")
        return True, ""

    passed = verdict_match.group(1).upper() == "PASS"

    feedback_match = re.search(r"FEEDBACK:\s*(.*)", review_text, re.DOTALL)
    feedback = feedback_match.group(1).strip() if feedback_match else ""

    return passed, feedback
