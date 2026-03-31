# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Unified LLM writer for any OpenAI-compatible API endpoint.

Supports all models on NVIDIA NIM (Nemotron, Claude), OpenAI, or any
OpenAI-compatible inference server. Configured via environment variables:

  AGENT_MODEL    - Model name (default depends on --provider)
  AGENT_BASE_URL - API base URL (default depends on --provider)
  AGENT_API_KEY  - API key (falls back to provider-specific env var)
"""

import logging
import os
import re
from typing import Optional

from coverage_agent.plugins.base import (
    GeneratedTest,
    TestType,
    ValidationResult,
    WriterPlugin,
    determine_test_path,
)
from coverage_agent.prompts.go_test import GO_TEST_SYSTEM_PROMPT, build_go_prompt
from coverage_agent.prompts.python_test import (
    PYTHON_TEST_SYSTEM_PROMPT,
    build_python_prompt,
)
from coverage_agent.prompts.ui_test import UI_TEST_SYSTEM_PROMPT, build_ui_prompt
from coverage_agent.tools.file_ops import read_file, write_file
from coverage_agent.tools.test_runner import run_test

try:
    from openai import OpenAI
except ImportError:
    OpenAI = None

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

PROVIDER_DEFAULTS = {
    "nemotron": {
        "model": "nvidia/nvidia/nemotron-3-super-v3",
        "base_url": "https://inference-api.nvidia.com",
        "api_key_env": "NVIDIA_API_KEY",
    },
    "claude": {
        "model": "aws/anthropic/claude-opus-4-5",
        "base_url": "https://inference-api.nvidia.com/v1",
        "api_key_env": "NVIDIA_API_KEY",
    },
    "openai": {
        "model": "openai/openai/gpt-5.3-codex",
        "base_url": "https://inference-api.nvidia.com/v1/responses",
        "api_key_env": "NVIDIA_API_KEY",
    },
}


class LLMWriter(WriterPlugin):
    """Unified test writer for any OpenAI-compatible LLM endpoint.

    Works with NVIDIA NIM (Nemotron, Claude), OpenAI, or any
    OpenAI-compatible server. Use --provider for presets, or override
    with AGENT_MODEL / AGENT_BASE_URL / AGENT_API_KEY env vars.
    """

    def __init__(self, provider: str = "nemotron"):
        defaults = PROVIDER_DEFAULTS.get(provider, PROVIDER_DEFAULTS["nemotron"])

        self.model = os.getenv("AGENT_MODEL", defaults["model"])
        self.base_url = os.getenv("AGENT_BASE_URL", defaults["base_url"])
        api_key = os.getenv(
            "AGENT_API_KEY", os.getenv(defaults["api_key_env"], ""),
        )

        if OpenAI is None:
            logger.warning("openai package not installed. LLMWriter will not work.")
            self.client = None
            return

        if not api_key:
            logger.warning(
                "No API key for provider=%s (set AGENT_API_KEY or %s)",
                provider, defaults["api_key_env"],
            )

        self.client = OpenAI(base_url=self.base_url, api_key=api_key)
        logger.info("LLMWriter: model=%s base_url=%s", self.model, self.base_url)

    def generate_test(
        self,
        source_path: str,
        uncovered_ranges: list[tuple[int, int]],
        existing_test_path: Optional[str] = None,
        test_type: str = "python",
        build_package: str = "",  # pylint: disable=unused-argument
        retry_context: Optional[str] = None,
    ) -> GeneratedTest:
        """Generate a test file by calling the LLM."""
        if self.client is None:
            raise RuntimeError("OpenAI client not available. pip install openai")

        source_content = read_file(source_path)
        existing_test_content = (
            read_file(existing_test_path) if existing_test_path else None
        )

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
                "\n\n### Previous attempt failed with:\n"
                f"```\n{retry_context}\n```\n"
                "Fix the issues and try again."
            )

        logger.info(
            "Calling LLM model=%s for %s (type=%s)",
            self.model, source_path, test_type,
        )

        response = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.7,
            max_tokens=8192,
        )

        content = response.choices[0].message.content or ""
        logger.info("LLM response: %d chars", len(content))

        test_content, build_entry = _parse_response(content, test_type)
        test_file_path = determine_test_path(source_path, test_type_enum)
        write_file(test_file_path, test_content)

        return GeneratedTest(
            test_file_path=test_file_path,
            test_content=test_content,
            build_entry=build_entry,
        )

    def validate_test(self, test: GeneratedTest) -> ValidationResult:
        """Validate generated test by running it via bazel/pnpm."""
        return run_test(test.test_file_path)


def _parse_response(
    response: str, test_type: str,
) -> tuple[str, Optional[str]]:
    """Parse LLM response to extract test content and optional BUILD entry."""
    test_content = response
    build_entry = None

    code_blocks = re.findall(
        r"```(?:python|go|typescript|ts)?\n(.*?)```", response, re.DOTALL,
    )
    if code_blocks:
        test_content = code_blocks[0]
        logger.info("Extracted %d code blocks from response", len(code_blocks))
    else:
        logger.warning("No code blocks in LLM response, stripping markdown markers from raw response")
        test_content = _strip_markdown_markers(response)

    # Require language tag for BUILD blocks to avoid matching bare ``` fences
    build_blocks = re.findall(
        r"```(?:starlark|bzl|bazel)\n(.*?)```", response, re.DOTALL,
    )
    if build_blocks and test_type == "python":
        build_entry = build_blocks[-1]

    content = test_content.strip() + "\n"
    logger.info("Parsed test content: %d chars, first line: %s", len(content), content.split("\n", 1)[0][:100])
    return content, build_entry


def _strip_markdown_markers(content: str) -> str:
    """Strip leading/trailing markdown code fence markers from raw content.

    Handles cases where the LLM returns a single unfenced code block or
    forgets to close the fence. Also strips prose preamble before code
    (common in retry responses where the LLM explains before writing code).
    """
    lines = content.strip().split("\n")

    # Strip leading fence (e.g., ```python, ```go, ```)
    if lines and re.match(r"^```\w*\s*$", lines[0]):
        lines = lines[1:]

    # Strip trailing fence
    if lines and lines[-1].strip() == "```":
        lines = lines[:-1]

    # If the content starts with prose (not a comment or import), try to find
    # where the actual Python/Go code begins
    result = "\n".join(lines)
    if lines and not _looks_like_code(lines[0]):
        code_start = _find_code_start(lines)
        if code_start > 0:
            logger.info(
                "Stripped %d lines of prose preamble before code (first prose line: %s)",
                code_start, lines[0][:100],
            )
            result = "\n".join(lines[code_start:])

    return result


def _looks_like_code(line: str) -> bool:
    """Check if a line looks like the start of source code."""
    stripped = line.strip()
    return (
        stripped.startswith("#")
        or stripped.startswith("//")
        or stripped.startswith("import ")
        or stripped.startswith("from ")
        or stripped.startswith("package ")
        or stripped.startswith("def ")
        or stripped.startswith("class ")
        or stripped.startswith("func ")
        or stripped == ""
    )


def _find_code_start(lines: list[str]) -> int:
    """Find the line index where actual code begins after prose preamble.

    Skips blank lines between prose and code — requires a non-empty code line.
    """
    for i, line in enumerate(lines):
        if line.strip() and _looks_like_code(line):
            return i
    return 0


