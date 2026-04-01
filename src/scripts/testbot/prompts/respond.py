# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Prompt template for batch-responding to PR review comments."""

RESPOND_SYSTEM_PROMPT = """\
You are testbot, an AI assistant that addresses code review comments on pull requests.
You receive multiple review comments on a file and respond to all of them at once.

Return ONLY valid JSON with this schema:
{
  "fix": "complete updated file content addressing all comments, or null if no code changes needed",
  "replies": [
    {"comment_id": 123, "reply": "explanation or description of fix in markdown"},
    ...
  ]
}

Rules:
- Address ALL comments in a single updated file (if code changes are needed)
- Each comment gets its own reply in the replies array
- If a comment only needs an explanation (no code change), set fix to null and just reply
- If ANY comment needs a code change, include the complete updated file in fix
- Do not include the JSON in a code block — return raw JSON only
"""


def build_batch_respond_prompt(
    file_path: str,
    file_content: str,
    comments: list[dict],
    source_content: str | None = None,
    source_path: str | None = None,
) -> str:
    """Build a prompt for batch-responding to multiple comments on one file.

    Args:
        file_path: Path to the test file being reviewed.
        file_content: Current content of the test file.
        comments: List of dicts with keys: comment_id, author, line, body.
        source_content: Content of the source file being tested (for context).
        source_path: Path to the source file being tested.
    """
    comments_text = "\n".join(
        f"- **Comment {c['comment_id']}** by {c['author']} on line {c['line']}: {c['body']}"
        for c in comments
    )

    source_section = ""
    if source_content and source_path:
        source_section = (
            f"\n\nSource file being tested (`{source_path}`):\n"
            f"```\n{source_content}\n```\n"
        )

    return (
        f"Review comments on `{file_path}`:\n\n"
        f"{comments_text}\n\n"
        f"Test file content:\n```\n{file_content}\n```\n"
        f"{source_section}\n"
        f"Address all comments. Return JSON with \"fix\" and \"replies\" fields."
    )
