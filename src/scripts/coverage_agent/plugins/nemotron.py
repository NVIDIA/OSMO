# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

import logging
import os
from typing import Optional

from coverage_agent.plugins.base import GeneratedTest, ValidationResult, WriterPlugin
from coverage_agent.prompts.go_test import GO_TEST_SYSTEM_PROMPT, build_go_prompt
from coverage_agent.prompts.python_test import PYTHON_TEST_SYSTEM_PROMPT, build_python_prompt
from coverage_agent.prompts.ui_test import UI_TEST_SYSTEM_PROMPT, build_ui_prompt
from coverage_agent.tools.file_ops import read_file, write_file
from coverage_agent.tools.shell import run_shell

logger = logging.getLogger(__name__)

SYSTEM_PROMPTS = {
    "python": PYTHON_TEST_SYSTEM_PROMPT,
    "go": GO_TEST_SYSTEM_PROMPT,
    "ui": UI_TEST_SYSTEM_PROMPT,
}

PROMPT_BUILDERS = {
    "python": build_python_prompt,
    "go": build_go_prompt,
    "ui": build_ui_prompt,
}


class NemotronWriter(WriterPlugin):
    """Test writer using Nemotron via ChatNVIDIA and LangChain tool-calling."""

    def __init__(self):
        try:
            from langchain_nvidia_ai_endpoints import ChatNVIDIA

            self.llm = ChatNVIDIA(
                model=os.getenv("NIM_MODEL", "nvidia/nemotron-3-super-120b-a12b"),
                base_url=os.getenv("NIM_BASE_URL", "https://integrate.api.nvidia.com/v1"),
            )
        except ImportError:
            logger.warning("langchain-nvidia-ai-endpoints not installed. NemotronWriter will not work.")
            self.llm = None

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
            raise RuntimeError("ChatNVIDIA is not available. Install langchain-nvidia-ai-endpoints.")

        source_content = read_file(source_path)
        existing_test_content = read_file(existing_test_path) if existing_test_path else None

        system_prompt = SYSTEM_PROMPTS[test_type]
        build_prompt = PROMPT_BUILDERS[test_type]

        user_prompt = build_prompt(
            source_content=source_content,
            source_path=source_path,
            uncovered_ranges=uncovered_ranges,
            existing_test_content=existing_test_content,
        )

        if retry_context:
            user_prompt += f"\n\n### Previous attempt failed with:\n```\n{retry_context}\n```\nFix the issues and try again."

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        response = self.llm.invoke(messages)
        generated_content = response.content

        # Parse response to extract test file content and BUILD entry
        test_content, build_entry = self._parse_response(generated_content, test_type)

        # Determine output path
        test_file_path = self._determine_test_path(source_path, test_type)

        # Write the test file
        write_file(test_file_path, test_content)

        return GeneratedTest(
            test_file_path=test_file_path,
            test_content=test_content,
            build_entry=build_entry,
        )

    def validate_test(self, test: GeneratedTest) -> ValidationResult:
        if test.test_file_path.endswith(".py"):
            result = run_shell(f"python -m py_compile {test.test_file_path}")
            if result.returncode != 0:
                return ValidationResult(
                    passed=False,
                    output=result.stderr,
                    retry_hint=f"Syntax error: {result.stderr}",
                )
            # Try running with pytest
            result = run_shell(f"python -m pytest {test.test_file_path} -v --tb=short")
        elif test.test_file_path.endswith(".go"):
            directory = os.path.dirname(test.test_file_path)
            result = run_shell(f"cd {directory} && go test -v -run .")
        elif test.test_file_path.endswith(".ts") or test.test_file_path.endswith(".tsx"):
            result = run_shell(f"cd src/ui && pnpm test -- --run {test.test_file_path}")
        else:
            return ValidationResult(passed=False, output="Unknown test type", retry_hint=None)

        return ValidationResult(
            passed=result.returncode == 0,
            output=result.stdout + result.stderr,
            retry_hint=result.stderr if result.returncode != 0 else None,
        )

    def _parse_response(self, response: str, test_type: str) -> tuple[str, Optional[str]]:
        """Parse LLM response to extract test content and optional BUILD entry."""
        # Look for code blocks
        test_content = response
        build_entry = None

        # Extract python/go/typescript code block
        import re

        code_blocks = re.findall(r"```(?:python|go|typescript|ts)?\n(.*?)```", response, re.DOTALL)
        if code_blocks:
            test_content = code_blocks[0]

        # Extract BUILD entry if present
        build_blocks = re.findall(r"```(?:starlark|bzl|bazel)?\n(.*?)```", response, re.DOTALL)
        if build_blocks and test_type == "python":
            build_entry = build_blocks[-1]  # Last code block is usually the BUILD entry

        return test_content.strip() + "\n", build_entry

    def _determine_test_path(self, source_path: str, test_type: str) -> str:
        """Determine the output path for a generated test file."""
        directory = os.path.dirname(source_path)
        basename = os.path.splitext(os.path.basename(source_path))[0]

        if test_type == "python":
            test_dir = os.path.join(directory, "tests")
            return os.path.join(test_dir, f"test_{basename}.py")
        elif test_type == "go":
            return os.path.join(directory, f"{basename}_test.go")
        elif test_type == "ui":
            return os.path.join(directory, f"{basename}.test.ts")
        return os.path.join(directory, f"test_{basename}")
