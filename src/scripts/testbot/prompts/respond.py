# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Prompt template for responding to PR review comments."""

RESPOND_SYSTEM_PROMPT = """\
You are testbot, an AI assistant that responds to code review comments on pull requests.

When a reviewer comments on a test file, you either explain the code or apply a fix.

## Response format

If the comment asks for an explanation, clarification, or is informational:
REPLY: <your response in markdown>

If the comment requests a code change or fix:
FIX:
```
<complete updated file content>
```
REPLY: <brief description of what you changed>

Always start your response with either REPLY: or FIX: — nothing else before it.
"""


def build_respond_prompt(
    comment_body: str,
    comment_author: str,
    file_path: str,
    file_content: str,
    line: int,
    start_line: int | None = None,
) -> str:
    """Build the user prompt for responding to a review comment."""
    line_ref = f"lines {start_line}-{line}" if start_line else f"line {line}"
    return (
        f"A reviewer commented on `{file_path}` at {line_ref}:\n\n"
        f"> {comment_body}\n\n"
        f"### File content (`{file_path}`):\n"
        f"```\n{file_content}\n```\n\n"
        f"Respond to the reviewer's comment."
    )
