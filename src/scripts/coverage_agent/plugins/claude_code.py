# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

import json
import logging
import os
import shlex
import subprocess
import tempfile
from typing import Optional

from coverage_agent.plugins.base import GeneratedTest, ValidationResult, WriterPlugin
from coverage_agent.prompts.quality_rules import QUALITY_RULES_PREAMBLE

logger = logging.getLogger(__name__)

# Per the official docs, --allowedTools uses permission rule syntax.
# Bash(cmd *) prefix-matches commands starting with "cmd ".
# The space before * is important to avoid over-matching.
ALLOWED_TOOLS_BY_TYPE = {
    "python": "Read,Write,Edit,Bash(python *),Bash(bazel *),Bash(ruff *),Bash(cat *),Bash(ls *),Bash(find *)",
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

    def generate_test(
        self,
        source_path: str,
        uncovered_ranges: list[tuple[int, int]],
        existing_test_path: Optional[str] = None,
        test_type: str = "python",
        build_package: str = "",
        retry_context: Optional[str] = None,
    ) -> GeneratedTest:
        test_file_path = self._determine_test_path(source_path, test_type)
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
        """Claude Code already validates during generation (self-correction).

        This runs a final confirmation to catch any edge cases Claude missed.
        """
        if not os.path.exists(test.test_file_path):
            return ValidationResult(
                passed=False,
                output=f"File not found: {test.test_file_path}",
                retry_hint="Claude Code did not create the test file",
            )

        if not test.test_content.strip():
            return ValidationResult(
                passed=False,
                output="Generated test file is empty",
                retry_hint="Generate actual test content with assertions",
            )

        command = self._get_test_command(test.test_file_path)
        if command is None:
            return ValidationResult(passed=False, output="Unknown test type", retry_hint=None)

        try:
            result = subprocess.run(
                command, shell=True, capture_output=True, text=True, timeout=120,
            )
            return ValidationResult(
                passed=result.returncode == 0,
                output=result.stdout + result.stderr,
                retry_hint=result.stderr if result.returncode != 0 else None,
            )
        except subprocess.TimeoutExpired:
            return ValidationResult(
                passed=False,
                output="Test execution timed out after 120s",
                retry_hint="Test may have an infinite loop or hung process",
            )

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
            "--bare",
            "-p", prompt,
            "--output-format", "json",
            "--allowedTools", allowed_tools,
            "--append-system-prompt", SYSTEM_PROMPT_ADDITION,
            "--max-turns", str(self._max_turns),
        ]

        # Per official docs: use --resume with session_id for multi-turn.
        # On retry, resume the same session so Claude has context of the failure.
        if is_retry and self._session_id:
            cmd.extend(["--resume", self._session_id])

        logger.info("Running Claude Code: claude --bare -p <prompt> --max-turns %d", self._max_turns)
        logger.debug("Allowed tools: %s", allowed_tools)

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=self._timeout,
                env={**os.environ, "ANTHROPIC_API_KEY": os.environ.get("ANTHROPIC_API_KEY", "")},
            )
        except subprocess.TimeoutExpired:
            logger.error("Claude Code timed out after %ds", self._timeout)
            return None
        except FileNotFoundError:
            logger.error("Claude Code CLI not found. Install: npm install -g @anthropic-ai/claude-code")
            return None

        if result.returncode != 0:
            logger.error("Claude Code failed (exit %d): %s", result.returncode, result.stderr[:500])
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
        build_package: str,
        test_file_path: str,
        retry_context: Optional[str],
    ) -> str:
        ranges_str = ", ".join(f"lines {start}-{end}" for start, end in uncovered_ranges)

        prompt = (
            f"Generate unit tests for {source_path} targeting these uncovered line ranges: {ranges_str}.\n\n"
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
        self, data: dict, source_path: str, test_type: str, test_file_path: str,
    ) -> GeneratedTest:
        """Parse Claude Code JSON output. Claude writes files directly to disk."""
        # Claude Code writes files via its Write/Edit tools during execution.
        # The JSON output's "result" field contains the text response, not the file content.
        # Check disk for the actual generated file.
        if os.path.exists(test_file_path):
            with open(test_file_path) as file:
                test_content = file.read()

            # Also check if Claude wrote a BUILD file entry
            build_dir = os.path.dirname(test_file_path)
            build_path = os.path.join(build_dir, "BUILD")
            build_entry = None
            if os.path.exists(build_path):
                with open(build_path) as file:
                    build_entry = file.read()

            return GeneratedTest(
                test_file_path=test_file_path,
                test_content=test_content,
                build_entry=build_entry,
            )

        # Fallback: Claude may have returned the content in the result field
        # instead of writing to disk (happens when Write tool isn't used)
        result_text = data.get("result", "")
        if result_text:
            logger.warning(
                "Claude Code did not write to %s. Attempting to extract from result.",
                test_file_path,
            )
            from coverage_agent.tools.file_ops import write_file
            write_file(test_file_path, result_text)

        return GeneratedTest(
            test_file_path=test_file_path,
            test_content=result_text,
            build_entry=None,
        )

    def _get_test_command(self, test_file_path: str) -> Optional[str]:
        """Return the shell command to run a test file."""
        if test_file_path.endswith(".py"):
            return f"python -m pytest {shlex.quote(test_file_path)} -v --tb=short"
        if test_file_path.endswith(".go"):
            directory = os.path.dirname(test_file_path)
            return f"cd {shlex.quote(directory)} && go test -v -run ."
        if test_file_path.endswith((".ts", ".tsx")):
            return f"cd src/ui && pnpm test -- --run {shlex.quote(test_file_path)}"
        return None

    def _determine_test_path(self, source_path: str, test_type: str) -> str:
        """Determine the output path for a generated test file."""
        directory = os.path.dirname(source_path)
        basename = os.path.splitext(os.path.basename(source_path))[0]

        if test_type == "python":
            return os.path.join(directory, "tests", f"test_{basename}.py")
        if test_type == "go":
            return os.path.join(directory, f"{basename}_test.go")
        if test_type == "ui":
            return os.path.join(directory, f"{basename}.test.ts")
        return os.path.join(directory, f"test_{basename}")
