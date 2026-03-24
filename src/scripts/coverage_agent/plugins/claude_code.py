# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

import json
import logging
import os
from typing import Optional

from coverage_agent.plugins.base import GeneratedTest, ValidationResult, WriterPlugin
from coverage_agent.tools.shell import run_shell

logger = logging.getLogger(__name__)


class ClaudeCodeWriter(WriterPlugin):
    """Test writer using Claude Code headless mode (`claude -p`).

    Claude Code handles file I/O, test execution, and self-correction
    as one atomic operation — no separate tool-calling loop needed.
    """

    def generate_test(
        self,
        source_path: str,
        uncovered_ranges: list[tuple[int, int]],
        existing_test_path: Optional[str] = None,
        test_type: str = "python",
        build_package: str = "",
        retry_context: Optional[str] = None,
    ) -> GeneratedTest:
        prompt = self._build_prompt(
            source_path, uncovered_ranges, existing_test_path, test_type, build_package, retry_context
        )

        result = run_shell(
            f'claude -p "{prompt}" '
            f"--allowedTools Read,Write,Bash "
            f"--max-turns 15 "
            f"--output-format json",
            timeout=300,
        )

        if result.returncode != 0:
            logger.error("Claude Code failed: %s", result.stderr)
            test_file_path = self._determine_test_path(source_path, test_type)
            return GeneratedTest(
                test_file_path=test_file_path,
                test_content="",
                build_entry=None,
            )

        return self._parse_output(result.stdout, source_path, test_type)

    def validate_test(self, test: GeneratedTest) -> ValidationResult:
        """Claude Code already validates during generation (self-correction).

        This runs a final confirmation test to be safe.
        """
        if not os.path.exists(test.test_file_path):
            return ValidationResult(
                passed=False,
                output=f"File not found: {test.test_file_path}",
                retry_hint="Claude Code did not create the test file",
            )

        if test.test_file_path.endswith(".py"):
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

    def _build_prompt(
        self,
        source_path: str,
        uncovered_ranges: list[tuple[int, int]],
        existing_test_path: Optional[str],
        test_type: str,
        build_package: str,
        retry_context: Optional[str],
    ) -> str:
        prompt = (
            f"Read the source file at {source_path} and generate unit tests "
            f"for the uncovered line ranges: {uncovered_ranges}. "
        )

        if existing_test_path:
            prompt += f"Existing tests are at {existing_test_path} — extend them, don't duplicate. "

        if test_type == "python":
            prompt += (
                "Use unittest.TestCase. Follow AGENTS.md conventions. "
                "Create an osmo_py_test() BUILD entry. "
            )
        elif test_type == "go":
            prompt += "Use table-driven Go tests with t.Run(). "
        elif test_type == "ui":
            prompt += "Use Vitest with describe/it/expect. Use @/ absolute imports. "

        prompt += "Run the tests to validate they pass. Self-correct if they fail."

        if retry_context:
            prompt += f" Previous attempt failed: {retry_context}"

        return prompt

    def _parse_output(self, output: str, source_path: str, test_type: str) -> GeneratedTest:
        """Parse Claude Code JSON output to find generated test files."""
        test_file_path = self._determine_test_path(source_path, test_type)

        # Claude Code writes files directly — check if the file exists
        if os.path.exists(test_file_path):
            with open(test_file_path) as file:
                test_content = file.read()
            return GeneratedTest(
                test_file_path=test_file_path,
                test_content=test_content,
                build_entry=None,  # Claude Code may have written BUILD entry directly
            )

        # Fallback: try to parse JSON output
        try:
            data = json.loads(output)
            content = data.get("result", "")
            return GeneratedTest(
                test_file_path=test_file_path,
                test_content=content,
                build_entry=None,
            )
        except (json.JSONDecodeError, TypeError):
            return GeneratedTest(
                test_file_path=test_file_path,
                test_content="",
                build_entry=None,
            )

    def _determine_test_path(self, source_path: str, test_type: str) -> str:
        """Determine the output path for a generated test file."""
        directory = os.path.dirname(source_path)
        basename = os.path.splitext(os.path.basename(source_path))[0]

        if test_type == "python":
            return os.path.join(directory, "tests", f"test_{basename}.py")
        elif test_type == "go":
            return os.path.join(directory, f"{basename}_test.go")
        elif test_type == "ui":
            return os.path.join(directory, f"{basename}.test.ts")
        return os.path.join(directory, f"test_{basename}")
