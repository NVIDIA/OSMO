# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Claude Code headless-mode test writer plugin."""

import json
import logging
import os
import subprocess
from typing import Optional

from coverage_agent.plugins.base import (
    GeneratedTest,
    TestType,
    ValidationResult,
    WriterPlugin,
    determine_test_path,
)
from coverage_agent.prompts.quality_rules import QUALITY_RULES_PREAMBLE
from coverage_agent.tools.file_ops import write_file
from coverage_agent.tools.test_runner import run_test

logger = logging.getLogger(__name__)

# Per the official docs, --allowedTools uses permission rule syntax.
# Bash(cmd *) prefix-matches commands starting with "cmd ".
# The space before * is important to avoid over-matching.
ALLOWED_TOOLS_BY_TYPE = {
    "python": (
        "Read,Write,Edit,Bash(python *),Bash(bazel *),"
        "Bash(ruff *),Bash(cat *),Bash(ls *),Bash(find *)"
    ),
    "go": "Read,Write,Edit,Bash(go *),Bash(bazel *),Bash(cat *),Bash(ls *),Bash(find *)",
    "ui": "Read,Write,Edit,Bash(pnpm *),Bash(npx *),Bash(cat *),Bash(ls *),Bash(find *)",
}

# System prompt additions injected via --append-system-prompt.
# Claude Code already has its default system prompt; we add OSMO-specific context.
SYSTEM_PROMPT_ADDITION = QUALITY_RULES_PREAMBLE + """
## OSMO-Specific Conventions
- Python tests: use unittest.TestCase, osmo_py_test() BUILD macro from //bzl:py.bzl
- Go tests: table-driven with t.Run(), same package as source
- UI tests: Vitest with describe/it/expect, @/ absolute imports
- All files need SPDX-FileCopyrightText + SPDX-License-Identifier: Apache-2.0 header
- Follow AGENTS.md conventions: no abbreviations, imports at top level, no assert in production code
- After writing tests, RUN them to verify they pass. Self-correct on failure.
"""


class ClaudeCodeWriter(WriterPlugin):
    """Test writer using Claude Code headless mode (`claude -p`).

    Uses the official CLI interface per https://code.claude.com/docs/en/headless:
    - `--bare` for reproducible CI runs (skips hooks, skills, MCP, CLAUDE.md auto-discovery)
    - `--output-format json` for structured output with `result` and `session_id` fields
    - `--allowedTools` with permission rule syntax (prefix matching via trailing ` *`)
    - `--append-system-prompt` to add OSMO conventions while keeping default behavior
    - `--continue` / `--resume` for multi-turn conversations (retry with context)
    - `--max-turns` to cap agent iterations and control cost
    """

    def __init__(self):
        self._session_id: Optional[str] = None
        self._max_turns = int(os.getenv("CLAUDE_CODE_MAX_TURNS", "20"))
        self._timeout = int(os.getenv("CLAUDE_CODE_TIMEOUT", "300"))
        # Model selection via env var. Defaults to claude-sonnet-4-20250514 for
        # cost/speed balance. Use claude-opus-4-20250514 for higher quality.
        self._model = os.getenv("CLAUDE_CODE_MODEL", "")

    def generate_test(
        self,
        source_path: str,
        uncovered_ranges: list[tuple[int, int]],
        existing_test_path: Optional[str] = None,
        test_type: str = "python",
        build_package: str = "",
        retry_context: Optional[str] = None,
    ) -> GeneratedTest:
        test_file_path = determine_test_path(source_path, TestType(test_type))
        prompt = self._build_prompt(
            source_path, uncovered_ranges, existing_test_path,
            test_type, build_package, test_file_path, retry_context,
        )

        # Write prompt to a temp file to avoid shell escaping issues with complex prompts.
        # Pipe via stdin: echo "prompt" | claude -p (per official docs).
        result = self._run_claude(prompt, test_type, is_retry=retry_context is not None)

        if result is None:
            return GeneratedTest(test_file_path=test_file_path, test_content="", build_entry=None)

        return self._parse_output(result, source_path, test_type, test_file_path)

    def validate_test(self, test: GeneratedTest) -> ValidationResult:
        """Run a final confirmation via bazel test. Claude Code self-corrects during
        generation, but we verify once more to be safe.
        """
        if not test.test_content.strip():
            return ValidationResult(
                passed=False,
                output="Generated test file is empty",
                retry_hint="Generate actual test content with assertions",
            )

        return run_test(test.test_file_path)

    def _run_claude(self, prompt: str, test_type: str, is_retry: bool) -> Optional[dict]:
        """Execute `claude -p` and return parsed JSON output, or None on failure."""
        allowed_tools = ALLOWED_TOOLS_BY_TYPE.get(test_type, ALLOWED_TOOLS_BY_TYPE["python"])

        # Build command. Per official docs:
        # - --bare: skip hooks/skills/MCP/CLAUDE.md for reproducible CI runs
        # - --output-format json: structured output with result + session_id
        # - --allowedTools: auto-approve specific tools without prompting
        # - --append-system-prompt: add OSMO context while keeping defaults
        # - --max-turns: cap iterations to control cost/runtime
        cmd = [
            "claude",
            "-p", prompt,
            "--output-format", "json",
            "--allowedTools", allowed_tools,
            "--append-system-prompt", SYSTEM_PROMPT_ADDITION,
            "--max-turns", str(self._max_turns),
        ]

        if self._model:
            cmd.extend(["--model", self._model])

        # --bare skips hooks/skills/MCP/CLAUDE.md for reproducible CI runs,
        # but also disables OAuth login auto-discovery. Only enable when
        # ANTHROPIC_API_KEY is set (i.e., CI environments).
        if os.environ.get("ANTHROPIC_API_KEY"):
            cmd.insert(1, "--bare")

        if is_retry and self._session_id:
            cmd.extend(["--resume", self._session_id])

        bare_flag = "--bare " if "--bare" in cmd else ""
        model_flag = f"--model {self._model} " if self._model else ""
        logger.info(
            "Running Claude Code: claude %s%s-p <prompt> --max-turns %d",
            bare_flag, model_flag, self._max_turns,
        )
        logger.debug("Allowed tools: %s", allowed_tools)

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=self._timeout,
                check=False,
            )
        except subprocess.TimeoutExpired:
            logger.error("Claude Code timed out after %ds", self._timeout)
            return None
        except FileNotFoundError:
            logger.error(
                "Claude Code CLI not found. Install: npm install -g @anthropic-ai/claude-code",
            )
            return None

        if result.returncode != 0:
            logger.error(
                "Claude Code failed (exit %d): stderr=%s",
                result.returncode, result.stderr[:500],
            )
            logger.error("Claude Code stdout: %s", result.stdout[:500])
            return None

        # Parse JSON output. Per docs, --output-format json returns:
        # { "result": "...", "session_id": "...", "is_error": false, ... }
        try:
            data = json.loads(result.stdout)

            # Capture session_id for --resume on retries
            if "session_id" in data:
                self._session_id = data["session_id"]
                logger.info("Session ID: %s", self._session_id)

            if data.get("is_error"):
                logger.error("Claude Code returned error: %s", data.get("result", "")[:500])
                return None

            return data
        except json.JSONDecodeError:
            logger.error("Failed to parse Claude Code JSON output: %s", result.stdout[:500])
            return None

    def _build_prompt(
        self,
        source_path: str,
        uncovered_ranges: list[tuple[int, int]],
        existing_test_path: Optional[str],
        test_type: str,
        _build_package: str,
        test_file_path: str,
        retry_context: Optional[str],
    ) -> str:
        ranges_str = ", ".join(f"lines {start}-{end}" for start, end in uncovered_ranges)

        prompt = (
            f"Generate unit tests for {source_path} targeting these"
            f" uncovered line ranges: {ranges_str}.\n\n"
            f"Write the test file to: {test_file_path}\n"
        )

        if existing_test_path:
            prompt += (
                f"\nExisting tests are at {existing_test_path}. "
                f"Read them first. Extend coverage without duplicating existing test methods.\n"
            )

        if test_type == "python":
            prompt += (
                "\nPython conventions:\n"
                "- Use unittest.TestCase\n"
                "- Add osmo_py_test() entry to the BUILD file in the test directory\n"
                f"- BUILD file location: {os.path.dirname(test_file_path)}/BUILD\n"
            )
        elif test_type == "go":
            prompt += "\nGo conventions: use table-driven tests with t.Run().\n"
        elif test_type == "ui":
            prompt += "\nVitest conventions: use describe/it/expect, @/ absolute imports.\n"

        prompt += (
            "\nAfter writing the test file:\n"
            "1. Run the tests to verify they pass\n"
            "2. If tests fail, read the error, fix the test, and re-run\n"
            "3. Repeat until all tests pass\n"
        )

        if retry_context:
            prompt += (
                f"\n--- RETRY CONTEXT ---\n"
                f"Previous attempt failed. Here is the error:\n{retry_context}\n"
                f"Fix the issues and try again.\n"
            )

        return prompt

    def _parse_output(
        self, data: dict, _source_path: str, _test_type: str, test_file_path: str,
    ) -> GeneratedTest:
        """Parse Claude Code JSON output. Claude writes files directly to disk."""
        # Claude Code writes files directly via its Write/Edit tools.
        # Try reading from disk first; fall back to JSON result field.
        try:
            with open(test_file_path, encoding="utf-8") as file:
                test_content = file.read()

            build_dir = os.path.dirname(test_file_path)
            build_path = os.path.join(build_dir, "BUILD")
            build_entry = None
            try:
                with open(build_path, encoding="utf-8") as file:
                    build_entry = file.read()
            except FileNotFoundError:
                pass

            return GeneratedTest(
                test_file_path=test_file_path,
                test_content=test_content,
                build_entry=build_entry,
            )
        except FileNotFoundError:
            pass

        # Fallback: extract from JSON result field and write to disk
        result_text = data.get("result", "")
        if result_text:
            logger.warning(
                "Claude Code did not write to %s, extracting from result field",
                test_file_path,
            )
            write_file(test_file_path, result_text)

        return GeneratedTest(
            test_file_path=test_file_path,
            test_content=result_text,
            build_entry=None,
        )
