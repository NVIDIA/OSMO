# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Respond to PR review comments with LLM-powered replies and auto-fixes."""

import argparse
import dataclasses
import json
import logging
import os
import shlex
import tempfile
from typing import Optional

from testbot.plugins import _register_defaults, get_llm
from testbot.prompts.respond import RESPOND_SYSTEM_PROMPT, build_respond_prompt
from testbot.tools.file_ops import read_file, write_file
from testbot.tools.shell import run_shell
from testbot.tools.test_runner import run_test

logger = logging.getLogger(__name__)

MAX_AUTO_RESPONSES = 5
# Authors whose comments are silently skipped (prevents loops)
SELF_AUTHORS = {"github-actions[bot]", "svc-osmo-ci"}


def _get_repo_nwo() -> str:
    """Get the owner/repo (e.g., 'NVIDIA/OSMO') from gh CLI."""
    result = run_shell("gh repo view --json nameWithOwner --jq .nameWithOwner")
    if result.returncode == 0 and result.stdout.strip():
        return result.stdout.strip()
    return "NVIDIA/OSMO"


@dataclasses.dataclass
class ReviewComment:
    """A parsed GitHub PR review comment."""

    file_path: str
    line: int
    start_line: Optional[int]
    body: str
    author: str
    comment_id: int
    in_reply_to_id: Optional[int] = None


def parse_review_comment(comment_data: dict) -> ReviewComment:
    """Parse a GitHub review comment API response into a ReviewComment."""
    return ReviewComment(
        file_path=comment_data["path"],
        line=comment_data["line"],
        start_line=comment_data.get("start_line"),
        body=comment_data["body"],
        author=comment_data["user"]["login"],
        comment_id=comment_data["id"],
        in_reply_to_id=comment_data.get("in_reply_to_id"),
    )


def should_skip_comment(
    comment_data: dict,
    current_response_count: int = 0,
) -> Optional[str]:
    """Check if a comment should be skipped. Returns skip reason or None.

    All skips are SILENT — no reply is posted to avoid triggering bot loops.
    """
    author = comment_data.get("user", {}).get("login", "")

    if author in SELF_AUTHORS:
        return "own comment"

    # Bot auto-replies have in_reply_to_id set — these are not original reviews
    if comment_data.get("in_reply_to_id") and author.endswith("[bot]"):
        return "bot auto-reply"

    if comment_data.get("body", "").startswith("[skip-agent]"):
        return "[skip-agent]"

    if comment_data.get("path", "").startswith("src/scripts/testbot/"):
        return "testbot source file"

    if current_response_count >= MAX_AUTO_RESPONSES:
        return f"max responses ({MAX_AUTO_RESPONSES})"

    return None


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


def parse_llm_json_response(response_text: str) -> tuple[str, Optional[str]]:
    """Parse JSON LLM response into (reply_text, fix_content_or_none).

    Expected format: {"reply": "...", "fix": "..." or null}
    Falls back to raw text if JSON parsing fails.
    """
    try:
        data = json.loads(response_text)
        reply = data.get("reply", "")
        fix = data.get("fix")
        return reply, fix
    except (json.JSONDecodeError, TypeError, KeyError):
        logger.warning("Failed to parse LLM JSON response, using raw text")
        return response_text.strip(), None


def respond_to_comment(
    pr_number: int,
    comment_id: int,
    provider: str = "claude",
) -> None:
    """Fetch a review comment, respond with LLM reply or auto-fix."""
    repo = _get_repo_nwo()
    result = run_shell(f"gh api repos/{repo}/pulls/comments/{comment_id}")
    if result.returncode != 0:
        logger.error("Failed to fetch comment %d: %s", comment_id, result.stderr)
        return

    comment_data = json.loads(result.stdout)

    # All skips are silent — no reply posted, just log and return
    response_count = _get_response_count(pr_number)
    skip_reason = should_skip_comment(comment_data, current_response_count=response_count)
    if skip_reason:
        logger.info("Silently skipping comment %d: %s", comment_id, skip_reason)
        return

    comment = parse_review_comment(comment_data)
    logger.info(
        "Responding to comment by %s on %s:%d: %s",
        comment.author, comment.file_path, comment.line, comment.body[:200],
    )

    # Read the file being commented on
    file_content = read_file(comment.file_path)
    if file_content.startswith("Error"):
        logger.error("Cannot read %s: %s", comment.file_path, file_content)
        _reply_to_comment(
            pr_number, comment_id,
            f"Unable to read file `{comment.file_path}`. The file may not exist on this branch.",
        )
        return

    # Call LLM with JSON response format
    llm = get_llm(provider)
    if llm.client is None:
        logger.error("LLM client not available")
        return

    user_prompt = build_respond_prompt(
        comment_body=comment.body,
        file_path=comment.file_path,
        file_content=file_content,
        line=comment.line,
        start_line=comment.start_line,
    )

    logger.info("Calling LLM for response (prompt=%d chars)", len(user_prompt))
    try:
        llm_response = llm.client.chat.completions.create(
            model=llm.model,
            messages=[
                {"role": "system", "content": RESPOND_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.3,
            max_tokens=16384,
            response_format={"type": "json_object"},
        )
        response_text = llm_response.choices[0].message.content or ""
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("LLM call failed: %s", exc)
        _reply_to_comment(pr_number, comment_id, "Unable to generate response (LLM error).")
        return

    logger.info("LLM response (%d chars)", len(response_text))

    # Parse structured JSON response
    reply_text, fix_content = parse_llm_json_response(response_text)

    if fix_content:
        logger.info("LLM suggested a code fix (%d chars)", len(fix_content))
        write_file(comment.file_path, fix_content)

        validation = run_test(comment.file_path)
        if not validation.passed:
            logger.warning("Fix validation failed: %s", validation.output[:300])
            write_file(comment.file_path, file_content)  # restore original
            _reply_to_comment(
                pr_number, comment_id,
                f"{reply_text}\n\n> **Note:** tests failed after applying this fix, needs human review.",
            )
            _update_response_count(pr_number, response_count + 1)
            return

        # Commit and push the fix
        run_shell(f"git add {shlex.quote(comment.file_path)}")
        commit_msg = f"testbot: address review comment on {comment.file_path}:{comment.line}"
        msg_file = tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False)  # pylint: disable=consider-using-with
        try:
            msg_file.write(commit_msg)
            msg_file.close()
            run_shell(f"git commit -F {shlex.quote(msg_file.name)}")
        finally:
            os.unlink(msg_file.name)
        run_shell("git push")
        logger.info("Committed and pushed fix for %s", comment.file_path)

    # Post reply
    _reply_to_comment(pr_number, comment_id, reply_text)
    _update_response_count(pr_number, response_count + 1)
    logger.info("Responded to comment %d", comment_id)


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")

    parser = argparse.ArgumentParser(description="Respond to PR review comments")
    parser.add_argument("--pr-number", type=int, required=True)
    parser.add_argument("--comment-id", type=int, required=True)
    parser.add_argument("--provider", default="claude",
                        choices=["nemotron", "claude", "openai"])
    args = parser.parse_args()

    logger.info("Responding to comment %d on PR #%d (provider=%s)", args.comment_id, args.pr_number, args.provider)

    _register_defaults()
    respond_to_comment(args.pr_number, args.comment_id, args.provider)


if __name__ == "__main__":
    main()
