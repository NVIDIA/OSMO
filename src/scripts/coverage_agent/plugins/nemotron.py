# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Nemotron-based test writer plugin using LangChain and NVIDIA AI Endpoints."""

import logging
import os
import re
from typing import Optional

try:
    from langchain_nvidia_ai_endpoints import ChatNVIDIA
except ImportError:
    ChatNVIDIA = None

from coverage_agent.plugins.base import (
    GeneratedTest,
    TestType,
    ValidationResult,
    WriterPlugin,
    determine_test_path,
)
from coverage_agent.prompts.go_test import GO_TEST_SYSTEM_PROMPT, build_go_prompt
from coverage_agent.prompts.python_test import PYTHON_TEST_SYSTEM_PROMPT, build_python_prompt
from coverage_agent.prompts.ui_test import UI_TEST_SYSTEM_PROMPT, build_ui_prompt
from coverage_agent.tools.file_ops import read_file, write_file
from coverage_agent.tools.test_runner import run_test

logger = logging.getLogger(__name__)

SYSTEM_PROMPTS = {
    TestType.PYTHON: PYTHON_TEST_SYSTEM_PROMPT,
    TestType.GO: GO_TEST_SYSTEM_PROMPT,
    TestType.UI: UI_TEST_SYSTEM_PROMPT,
}

PROMPT_BUILDERS = {
    TestType.PYTHON: build_python_prompt,
    TestType.GO: build_go_prompt,
    TestType.UI: build_ui_prompt,
}


class NemotronWriter(WriterPlugin):
    """Test writer using Nemotron via ChatNVIDIA and LangChain tool-calling."""

    def __init__(self):
        if ChatNVIDIA is None:
            logger.warning(
                "langchain-nvidia-ai-endpoints not installed."
                " NemotronWriter will not work.",
            )
            self.llm = None
            return
        self.llm = ChatNVIDIA(
            model=os.getenv("NIM_MODEL", "nvidia/nemotron-3-super-120b-a12b"),
            base_url=os.getenv(
                "NIM_BASE_URL", "https://integrate.api.nvidia.com/v1",
            ),
        )

    def generate_test(
        self,
        source_path: str,
        uncovered_ranges: list[tuple[int, int]],
        existing_test_path: Optional[str] = None,
        test_type: str = "python",
        build_package: str = "",
        retry_context: Optional[str] = None,
    ) -> GeneratedTest:
        if self.llm is None:
            raise RuntimeError(
                "ChatNVIDIA is not available. Install langchain-nvidia-ai-endpoints."
            )

        source_content = read_file(source_path)
        existing_test_content = read_file(existing_test_path) if existing_test_path else None

        test_type_enum = TestType(test_type)
        system_prompt = SYSTEM_PROMPTS[test_type_enum]
        build_prompt = PROMPT_BUILDERS[test_type_enum]

        user_prompt = build_prompt(
            source_content=source_content,
            source_path=source_path,
            uncovered_ranges=uncovered_ranges,
            existing_test_content=existing_test_content,
        )

        if retry_context:
            user_prompt += (
                f"\n\n### Previous attempt failed with:\n"
                f"```\n{retry_context}\n```\n"
                f"Fix the issues and try again."
            )

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        logger.info("Calling Nemotron LLM for %s (test_type=%s)", source_path, test_type)
        response = self.llm.invoke(messages)
        logger.info("Nemotron response: %d chars", len(response.content))

        test_content, build_entry = self._parse_response(response.content, test_type)
        test_file_path = determine_test_path(source_path, test_type_enum)

        write_file(test_file_path, test_content)

        return GeneratedTest(
            test_file_path=test_file_path,
            test_content=test_content,
            build_entry=build_entry,
        )

    def validate_test(self, test: GeneratedTest) -> ValidationResult:
        return run_test(test.test_file_path)

    def _parse_response(self, response: str, test_type: str) -> tuple[str, Optional[str]]:
        """Parse LLM response to extract test content and optional BUILD entry."""
        test_content = response
        build_entry = None

        code_blocks = re.findall(r"```(?:python|go|typescript|ts)?\n(.*?)```", response, re.DOTALL)
        if code_blocks:
            test_content = code_blocks[0]
            logger.debug("Extracted %d code blocks from response", len(code_blocks))
        else:
            logger.warning(
                "No code blocks found in LLM response,"
                " using raw response as test content",
            )

        build_blocks = re.findall(r"```(?:starlark|bzl|bazel)?\n(.*?)```", response, re.DOTALL)
        if build_blocks and test_type == "python":
            build_entry = build_blocks[-1]

        return test_content.strip() + "\n", build_entry
