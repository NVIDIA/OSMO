# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Respond to PR review comments by applying AI-generated fixes."""

import argparse
import dataclasses
import json
import logging
import os
import shlex
import tempfile
from typing import Optional

from testbot.nodes.quality_gate import check_test_quality
from testbot.plugins import _register_defaults, get_llm
from testbot.plugins.base import detect_test_type
from testbot.tools.file_ops import read_file
from testbot.tools.shell import run_shell

logger = logging.getLogger(__name__)

MAX_AUTO_RESPONSES = 5
BOT_LOGIN = "testbot[bot]"


def _get_repo_nwo() -> str:
    """Get the owner/repo (e.g., 'NVIDIA/OSMO') from gh CLI."""
    result = run_shell("gh repo view --json nameWithOwner --jq .nameWithOwner")
    if result.returncode == 0 and result.stdout.strip():
        return result.stdout.strip()
    return "NVIDIA/OSMO"  # fallback


@dataclasses.dataclass
class ReviewComment:
    """A parsed GitHub PR review comment."""

    file_path: str
    line: int
    start_line: Optional[int]
    body: str
    author: str
    comment_id: int


def parse_review_comment(comment_data: dict) -> ReviewComment:
    """Parse a GitHub review comment API response into a ReviewComment."""
    return ReviewComment(
        file_path=comment_data["path"],
        line=comment_data["line"],
        start_line=comment_data.get("start_line"),
        body=comment_data["body"],
        author=comment_data["user"]["login"],
        comment_id=comment_data["id"],
    )


def should_skip_comment(
    comment_data: dict,
    bot_login: str = BOT_LOGIN,
    current_response_count: int = 0,
) -> bool:
    """Determine if a comment should be skipped by the agent."""
    body = comment_data.get("body", "")
    author = comment_data.get("user", {}).get("login", "")

    if body.startswith("[skip-agent]"):
        return True

    if author == bot_login:
        return True

    if current_response_count >= MAX_AUTO_RESPONSES:
        return True

    return False


def _get_response_count(pr_number: int) -> int:
    """Get the current auto-response count for a PR from labels."""
    result = run_shell(
        f"gh pr view {pr_number} --json labels --jq \".labels[].name\""
    )
    if result.returncode != 0:
        return 0

    for label in result.stdout.strip().split("\n"):
        if label.startswith("agent-responses:"):
            try:
                return int(label.split(":")[1])
            except (ValueError, IndexError):
                return 0
    return 0


def _update_response_count(pr_number: int, count: int) -> None:
    """Update the auto-response count label on a PR."""
    old_label = f"agent-responses:{count - 1}" if count > 1 else None
    new_label = f"agent-responses:{count}"

    if old_label:
        run_shell(f"gh pr edit {pr_number} --remove-label \"{old_label}\"")

    run_shell(f"gh label create \"{new_label}\" --force --color c5def5 2>/dev/null || true")
    run_shell(f"gh pr edit {pr_number} --add-label \"{new_label}\"")


def _reply_to_comment(pr_number: int, comment_id: int, message: str) -> None:
    """Post a reply to a review comment."""
    repo = _get_repo_nwo()
    body_file = tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False)  # pylint: disable=consider-using-with
    try:
        body_file.write(message)
        body_file.close()
        run_shell(
            f"gh api repos/{repo}/pulls/{pr_number}/comments/{comment_id}/replies "
            f"-F body=@{shlex.quote(body_file.name)}"
        )
    finally:
        os.unlink(body_file.name)


def respond_to_comment(
    pr_number: int,
    comment_id: int,
    provider: str = "nemotron",
) -> None:
    """Fetch a review comment, apply fix, validate, and push."""
    # Fetch the comment
    repo = _get_repo_nwo()
    result = run_shell(
        f"gh api repos/{repo}/pulls/comments/{comment_id}"
    )
    if result.returncode != 0:
        logger.error("Failed to fetch comment %d: %s", comment_id, result.stderr)
        return

    comment_data = json.loads(result.stdout)

    # Check skip conditions
    response_count = _get_response_count(pr_number)
    if should_skip_comment(comment_data, current_response_count=response_count):
        logger.info("Skipping comment %d (skip condition met)", comment_id)
        return

    comment = parse_review_comment(comment_data)
    logger.info(
        "Responding to comment by %s on %s:%d",
        comment.author, comment.file_path, comment.line,
    )

    # Read the file being commented on
    file_content = read_file(comment.file_path)
    if file_content.startswith("Error"):
        _reply_to_comment(pr_number, comment_id, f"Unable to read file: {comment.file_path}")
        return

    # Build a prompt for the LLM provider to apply the fix
    llm = get_llm(provider)

    fix_prompt = (
        f"A reviewer commented on {comment.file_path} at line {comment.line}:\n"
        f"\"{comment.body}\"\n\n"
        f"Apply the suggested fix to the file. Only modify what's needed to address the comment."
    )

    test_type = detect_test_type(comment.file_path)
    test_type_str = test_type.value if test_type else "python"

    generated = llm.generate_test(
        source_path=comment.file_path,
        uncovered_ranges=[(comment.start_line or comment.line, comment.line)],
        existing_test_path=comment.file_path,
        test_type=test_type_str,
        build_package="",
        retry_context=fix_prompt,
    )

    validation = llm.validate_test(generated)

    if not validation.passed:
        _reply_to_comment(
            pr_number, comment_id,
            "Unable to auto-fix. Tests fail after applying change:\n"
            f"```\n{validation.output[:500]}\n```\nNeeds human review."
        )
        return

    quality = check_test_quality(generated.test_content, test_type_str)
    if not quality.passed:
        _reply_to_comment(
            pr_number, comment_id,
            f"Fix applied but failed quality gate: "
            f"{'; '.join(quality.blocking_issues)}\nNeeds human review."  # pylint: disable=inconsistent-quotes
        )
        return

    # Commit and push
    run_shell(f"git add {shlex.quote(comment.file_path)}")
    commit_message = f"Address review comment on {comment.file_path}:{comment.line}"
    msg_file = tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False)  # pylint: disable=consider-using-with
    try:
        msg_file.write(commit_message)
        msg_file.close()
        run_shell(f"git commit -F {shlex.quote(msg_file.name)}")
    finally:
        os.unlink(msg_file.name)
    run_shell("git push")

    # Update response count and reply
    _update_response_count(pr_number, response_count + 1)
    quality_summary = ""
    if quality.warnings:
        quality_summary = f"\n\nQuality warnings: {'; '.join(quality.warnings)}"  # pylint: disable=inconsistent-quotes

    _reply_to_comment(
        pr_number, comment_id,
        f"Applied fix. Tests pass.{quality_summary}"
    )
    logger.info("Successfully responded to comment %d", comment_id)


def main():
    parser = argparse.ArgumentParser(description="Respond to PR review comments")
    parser.add_argument("--pr-number", type=int, required=True)
    parser.add_argument("--comment-id", type=int, required=True)
    parser.add_argument("--provider", default="nemotron",
                        choices=["nemotron", "claude", "openai"])
    args = parser.parse_args()

    _register_defaults()

    respond_to_comment(args.pr_number, args.comment_id, args.provider)


if __name__ == "__main__":
    main()
