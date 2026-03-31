# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""LangGraph node for delegating test generation to the active writer plugin."""

import logging
import os
import re

from coverage_agent.plugins import get_writer
from coverage_agent.plugins.base import file_path_to_bazel_package
from coverage_agent.state import CoverageState

logger = logging.getLogger(__name__)


def write_test(state: CoverageState) -> CoverageState:
    """LangGraph node: delegate test generation to the active WriterPlugin."""
    target = state["targets"][state["current_index"]]
    writer = get_writer(state["provider"])
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
        "Writing test for %s (index=%d, retry=%d/%d, type=%s)",
        target.file_path, state["current_index"],
        state["retry_count"], state["max_retries"], target.test_type,
    )
    if retry_context:
        logger.info("Retry context (first 500 chars): %s", retry_context[:500])

    result = writer.generate_test(
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

    # Apply BUILD entry so bazel can discover the test target
    if target.test_type == "python":
        _apply_build_entry(result.test_file_path, result.build_entry, target.file_path)

    return {**state, "last_generated": result}


def _apply_build_entry(
    test_file_path: str,
    build_entry: str | None,
    source_path: str,
) -> None:
    """Append a BUILD entry for the generated test file.

    If the LLM provided a build_entry, use it. Otherwise generate a default
    py_test rule based on existing deps in the BUILD file.
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

    # Check if a target for this test already exists
    with open(build_path, encoding="utf-8") as build_file:
        build_content = build_file.read()
    if test_basename in build_content:
        logger.info("BUILD already contains entry for %s", test_basename)
        return

    if build_entry:
        entry = build_entry.strip()
    else:
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
    dep_matches = re.findall(r'deps\s*=\s*\[\s*"([^"]+)"', existing_build_content)
    if dep_matches:
        deps_str = ",\n        ".join(f'"{dep}"' for dep in set(dep_matches))
    else:
        source_package = file_path_to_bazel_package(source_path)
        deps_str = f'"{source_package}"'

    return (
        f'py_test(\n'
        f'    name = "{test_name}",\n'
        f'    srcs = ["{test_basename}"],\n'
        f'    deps = [\n'
        f'        {deps_str},\n'
        f'    ],\n'
        f')'
    )
