# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""LangGraph node for delegating test generation to the active LLM provider."""

import logging
import os
import re

from testbot.plugins import get_llm
from testbot.plugins.base import file_path_to_bazel_package
from testbot.state import TestbotState

logger = logging.getLogger(__name__)

_DEPS_RE = re.compile(r'deps\s*=\s*\[\s*"([^"]+)"')


def write_test(state: TestbotState) -> TestbotState:
    """LangGraph node: delegate test generation to the active LLMProvider."""
    target = state["targets"][state["current_index"]]
    llm = get_llm(state["provider"])
    retry_context = None
    if state["retry_count"] > 0:
        previous_test = state.get("last_generated")
        issues = state.get("validation_output", "")
        if previous_test and previous_test.test_content.strip():
            retry_context = (
                f"Your previous test:\n```\n{previous_test.test_content}\n```\n\n"
                f"Issues found:\n{issues}\n\n"
                f"Fix these specific issues in the test above."
            )
        else:
            retry_context = issues

    logger.info(
        "Writing test for %s (target %d/%d, attempt %d/%d, type=%s)",
        target.file_path, state["current_index"] + 1, len(state["targets"]),
        state["retry_count"] + 1, state["max_retries"] + 1, target.test_type,
    )
    if retry_context:
        issues = state.get("validation_output", "")
        error_summary = _summarize_errors(issues)
        logger.info("Feeding validation feedback to LLM for retry: %s", error_summary)

    result = llm.generate_test(
        source_path=target.file_path,
        uncovered_ranges=target.uncovered_ranges,
        existing_test_path=target.existing_test_path,
        test_type=target.test_type,
        build_package=target.build_package,
        retry_context=retry_context,
    )

    logger.info(
        "Write result: file=%s, content_length=%d, build_entry=%s",
        result.test_file_path, len(result.test_content),
        "yes" if result.build_entry else "no",
    )

    # Apply BUILD entry so bazel can discover the test target.
    # Always generate from existing BUILD deps — LLM-generated entries are
    # unreliable (the LLM guesses dep target names that don't exist).
    if target.test_type == "python":
        _apply_build_entry(result.test_file_path, target.file_path)

    return {**state, "last_generated": result}


def _apply_build_entry(test_file_path: str, source_path: str) -> None:
    """Append a py_test BUILD entry for the generated test file.

    Always generates the entry from existing deps in the BUILD file rather than
    using LLM-generated entries (which guess wrong dep target names).
    """
    test_dir = os.path.dirname(test_file_path)
    build_path = os.path.join(test_dir, "BUILD")
    if not os.path.exists(build_path):
        build_path = os.path.join(test_dir, "BUILD.bazel")
    if not os.path.exists(build_path):
        logger.warning("No BUILD file found in %s, cannot register test target", test_dir)
        return

    test_basename = os.path.basename(test_file_path)
    test_name = test_basename.replace(".py", "")

    with open(build_path, encoding="utf-8") as build_file:
        build_content = build_file.read()
    if test_basename in build_content:
        logger.info("BUILD already contains entry for %s", test_basename)
        return

    entry = _generate_default_build_entry(test_name, test_basename, source_path, build_content)
    logger.info("BUILD entry to append for %s:\n%s", test_name, entry)
    with open(build_path, "a", encoding="utf-8") as build_file:
        build_file.write("\n" + entry + "\n")
    logger.info("Appended BUILD entry for %s to %s", test_name, build_path)


def _generate_default_build_entry(
    test_name: str,
    test_basename: str,
    source_path: str,
    existing_build_content: str,
) -> str:
    """Generate a default py_test BUILD entry by inferring deps from existing targets."""
    # Try to extract deps from existing py_test entries in the same BUILD file
    dep_matches = _DEPS_RE.findall(existing_build_content)
    if dep_matches:
        deps_str = ",\n        ".join(f'"{dep}"' for dep in set(dep_matches))
    else:
        source_package = file_path_to_bazel_package(source_path)
        deps_str = f'"{source_package}"'

    return (
        f"py_test(\n"
        f"    name = \"{test_name}\",\n"
        f"    srcs = [\"{test_basename}\"],\n"
        f"    deps = [\n"
        f"        {deps_str},\n"
        f"    ],\n"
        f")"
    )


def _summarize_errors(raw_output: str) -> str:
    """Extract key error lines from bazel/test output for concise logging.

    Pulls out Python exception types and messages, skipping bazel progress noise.
    """
    if not raw_output:
        return "unknown"

    errors = []
    for line in raw_output.split("\n"):
        stripped = line.strip()
        # Capture Python exception lines (e.g., "ValueError: invalid literal...")
        if "Error:" in stripped and not stripped.startswith("("):
            errors.append(stripped)
        # Capture "FAIL:" lines from test runner
        elif stripped.startswith("FAIL:") or stripped.startswith("FAILED"):
            errors.append(stripped)
        # Capture LLM review feedback
        elif stripped.startswith("LLM review failed"):
            errors.append(stripped)

    if errors:
        unique_errors = list(dict.fromkeys(errors))  # deduplicate preserving order
        return f"{len(unique_errors)} error(s): " + "; ".join(unique_errors[:5])

    # Fallback: first non-empty line
    first_line = next((line.strip() for line in raw_output.split("\n") if line.strip()), "unknown")
    return first_line
