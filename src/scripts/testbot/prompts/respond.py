# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Prompt template for responding to PR review comments."""

RESPOND_SYSTEM_PROMPT = """\
You are testbot, an AI assistant that responds to code review comments on pull requests.
You respond in JSON format with two fields:
- "reply": your response in markdown (always required)
- "fix": the complete updated file content if a code change is needed, or null if not

Return ONLY valid JSON. No text before or after the JSON object.

Example for an explanation request:
{"reply": "This test verifies that dates are parsed correctly in UTC format.", "fix": null}

Example for a code change request:
{"reply": "Added test case for timezone handling.", "fix": "import unittest\\n..."}
"""


def build_respond_prompt(
    comment_body: str,
    file_path: str,
    file_content: str,
    line: int,
    start_line: int | None = None,
) -> str:
    """Build the user prompt for responding to a review comment."""
    line_ref = f"lines {start_line}-{line}" if start_line else f"line {line}"
    return (
        f"Review comment on `{file_path}` at {line_ref}:\n\n"
        f"> {comment_body}\n\n"
        f"File content:\n```\n{file_content}\n```\n\n"
        f"Respond as JSON with \"reply\" and \"fix\" fields."
    )
