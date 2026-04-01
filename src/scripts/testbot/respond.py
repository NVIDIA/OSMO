# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Batch-respond to PR review comments with a single LLM call per file.

Groups unresponded comments by file, sends one LLM call per file with all
comments, applies a single fix (if needed), and replies to each comment.
"""

import argparse
import collections
import dataclasses
import json
import logging
import os
import shlex
import tempfile
from typing import Optional

from testbot.plugins import _register_defaults, get_llm
from testbot.prompts.respond import RESPOND_SYSTEM_PROMPT, build_batch_respond_prompt
from testbot.tools.file_ops import read_file, write_file
from testbot.tools.shell import run_shell
from testbot.tools.test_runner import run_test

logger = logging.getLogger(__name__)

MAX_AUTO_RESPONSES = 10
SELF_AUTHORS = {"github-actions[bot]", "svc-osmo-ci"}


def _infer_source_path(test_path: str) -> Optional[str]:
    """Infer the source file path from a test file path.

    Conventions:
      Python: src/cli/tests/test_access_token.py → src/cli/access_token.py
      Go:     src/utils/roles/user_role_sync_test.go → src/utils/roles/user_role_sync.go
      UI:     src/ui/src/lib/date-range-utils.test.ts → src/ui/src/lib/date-range-utils.ts
    """
    if test_path.endswith(".test.ts") or test_path.endswith(".test.tsx"):
        # UI: remove .test before extension
        source = test_path.replace(".test.ts", ".ts").replace(".test.tsx", ".tsx")
        return source if os.path.exists(source) else None

    if test_path.endswith("_test.go"):
        # Go: remove _test suffix
        source = test_path.replace("_test.go", ".go")
        return source if os.path.exists(source) else None

    if "/tests/test_" in test_path and test_path.endswith(".py"):
        # Python: src/cli/tests/test_foo.py → src/cli/foo.py
        directory = test_path.rsplit("/tests/", 1)[0]
        basename = test_path.rsplit("/test_", 1)[-1]
        source = f"{directory}/{basename}"
        return source if os.path.exists(source) else None

    return None


def _get_repo_nwo() -> str:
    """Get the owner/repo from gh CLI."""
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
    """Parse a GitHub review comment API response."""
    return ReviewComment(
        file_path=comment_data["path"],
        line=comment_data["line"],
        start_line=comment_data.get("start_line"),
        body=comment_data["body"],
        author=comment_data["user"]["login"],
        comment_id=comment_data["id"],
        in_reply_to_id=comment_data.get("in_reply_to_id"),
    )


def should_skip_comment(comment_data: dict) -> Optional[str]:
    """Check if a comment should be skipped. Returns reason or None.

    All skips are SILENT — no reply posted to avoid bot loops.
    """
    author = comment_data.get("user", {}).get("login", "")

    if author in SELF_AUTHORS:
        return "own comment"

    if comment_data.get("in_reply_to_id") and author.endswith("[bot]"):
        return "bot auto-reply"

    if comment_data.get("body", "").startswith("[skip-agent]"):
        return "[skip-agent]"

    if comment_data.get("path", "").startswith("src/scripts/testbot/"):
        return "testbot source file"

    return None


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


def parse_llm_json_response(response_text: str) -> dict:
    """Parse JSON LLM response. Returns dict with 'fix' and 'replies' keys.

    Expected: {"fix": "..." or null, "replies": [{"comment_id": N, "reply": "..."}, ...]}
    Falls back to empty structure on parse failure.
    """
    text = response_text.strip()

    for attempt_text in [text, text[text.find("{"):text.rfind("}") + 1] if "{" in text else ""]:
        if not attempt_text:
            continue
        try:
            data = json.loads(attempt_text)
            if isinstance(data, dict):
                return data
        except (json.JSONDecodeError, TypeError):
            continue

    logger.warning("Failed to parse LLM JSON response")
    return {}


def _find_unresponded_comments(pr_number: int) -> list[dict]:
    """Fetch all review comments and return those needing a response."""
    repo = _get_repo_nwo()
    result = run_shell(f"gh api repos/{repo}/pulls/{pr_number}/comments --paginate")
    if result.returncode != 0:
        logger.error("Failed to fetch PR comments: %s", result.stderr)
        return []

    all_comments = json.loads(result.stdout)
    logger.info("Fetched %d total comments on PR #%d", len(all_comments), pr_number)

    # Comments that already have a bot reply
    responded_to = set()
    for comment in all_comments:
        author = comment.get("user", {}).get("login", "")
        reply_to = comment.get("in_reply_to_id")
        if author in SELF_AUTHORS and reply_to:
            responded_to.add(reply_to)

    unresponded = []
    skip_counts = {}
    already_replied = 0
    for comment in all_comments:
        if comment["id"] in responded_to:
            already_replied += 1
            continue
        skip_reason = should_skip_comment(comment)
        if skip_reason:
            skip_counts[skip_reason] = skip_counts.get(skip_reason, 0) + 1
            continue
        unresponded.append(comment)

    logger.info(
        "Found %d unresponded, %d already replied, %d skipped: %s",
        len(unresponded), already_replied,
        sum(skip_counts.values()),
        ", ".join(f"{v} {k}" for k, v in skip_counts.items()) if skip_counts else "none",
    )
    return unresponded


def _process_file_comments(
    pr_number: int,
    file_path: str,
    comments: list[ReviewComment],
    provider: str,
) -> int:
    """Process all comments on a single file with one LLM call. Returns reply count."""
    logger.info("Processing %d comments on %s", len(comments), file_path)

    file_content = read_file(file_path)
    if file_content.startswith("Error"):
        logger.error("Cannot read %s: %s", file_path, file_content)
        for comment in comments:
            _reply_to_comment(
                pr_number, comment.comment_id,
                f"Unable to read file `{file_path}`. The file may not exist on this branch.",
            )
        return len(comments)

    llm = get_llm(provider)
    if llm.client is None:
        logger.error("LLM client not available")
        return 0

    # Find the source file being tested (for context)
    source_path = _infer_source_path(file_path)
    source_content = None
    if source_path:
        source_content = read_file(source_path)
        if source_content.startswith("Error"):
            logger.debug("Could not read source file %s, proceeding without it", source_path)
            source_content = None
        else:
            logger.info("Including source file %s (%d chars) for context", source_path, len(source_content))

    # Build batch prompt with all comments for this file
    comment_dicts = [
        {"comment_id": c.comment_id, "author": c.author, "line": c.line, "body": c.body}
        for c in comments
    ]
    user_prompt = build_batch_respond_prompt(
        file_path, file_content, comment_dicts,
        source_content=source_content, source_path=source_path,
    )

    logger.info("Calling LLM for %d comments on %s (prompt=%d chars)", len(comments), file_path, len(user_prompt))
    try:
        llm_response = llm.client.chat.completions.create(
            model=llm.model,
            messages=[
                {"role": "system", "content": RESPOND_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.3,
            max_tokens=16384,
        )
        response_text = llm_response.choices[0].message.content or ""
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("LLM call failed: %s", exc)
        for comment in comments:
            _reply_to_comment(pr_number, comment.comment_id, "Unable to generate response (LLM error).")
        return len(comments)

    logger.info("LLM response (%d chars)", len(response_text))
    data = parse_llm_json_response(response_text)

    fix_content = data.get("fix")
    replies = {r["comment_id"]: r["reply"] for r in data.get("replies", []) if "comment_id" in r}

    # Apply fix if provided
    if fix_content:
        logger.info("LLM provided a fix (%d chars), validating", len(fix_content))
        write_file(file_path, fix_content)

        validation = run_test(file_path)
        if not validation.passed:
            logger.warning("Fix validation failed: %s", validation.output[:300])
            write_file(file_path, file_content)
            # Still post replies but note the failure
            for comment in comments:
                reply = replies.get(comment.comment_id, "Addressed in code fix.")
                _reply_to_comment(
                    pr_number, comment.comment_id,
                    f"{reply}\n\n> **Note:** tests failed after applying fix, needs human review.",
                )
            return len(comments)

        # Commit and push
        run_shell(f"git add {shlex.quote(file_path)}")
        commit_msg = f"testbot: address {len(comments)} review comment(s) on {file_path}"
        msg_file = tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False)  # pylint: disable=consider-using-with
        try:
            msg_file.write(commit_msg)
            msg_file.close()
            run_shell(f"git commit -F {shlex.quote(msg_file.name)}")
        finally:
            os.unlink(msg_file.name)
        run_shell("git push")
        logger.info("Committed and pushed fix for %s", file_path)

    # Post individual replies to each comment
    replied = 0
    for comment in comments:
        reply = replies.get(comment.comment_id, "Acknowledged.")
        _reply_to_comment(pr_number, comment.comment_id, reply)
        replied += 1
        logger.info("Replied to comment %d on %s:%d", comment.comment_id, file_path, comment.line)

    return replied


def respond_to_pr(pr_number: int, provider: str = "claude") -> None:
    """Process all unresponded review comments on a PR, batched by file."""
    unresponded = _find_unresponded_comments(pr_number)

    if not unresponded:
        logger.info("No unresponded comments on PR #%d", pr_number)
        return

    # Group by file
    by_file = collections.defaultdict(list)
    for comment_data in unresponded:
        comment = parse_review_comment(comment_data)
        by_file[comment.file_path].append(comment)

    logger.info("Processing comments on %d file(s)", len(by_file))

    total_replied = 0
    for file_path, comments in by_file.items():
        if total_replied >= MAX_AUTO_RESPONSES:
            logger.info("Reached max auto-responses (%d), stopping", MAX_AUTO_RESPONSES)
            break
        replied = _process_file_comments(pr_number, file_path, comments, provider)
        total_replied += replied

    logger.info("Responded to %d comments on PR #%d", total_replied, pr_number)


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")

    parser = argparse.ArgumentParser(description="Respond to PR review comments")
    parser.add_argument("--pr-number", type=int, required=True)
    parser.add_argument("--provider", default="claude",
                        choices=["nemotron", "claude"])
    args = parser.parse_args()

    logger.info("Processing comments on PR #%d (provider=%s)", args.pr_number, args.provider)

    _register_defaults()
    respond_to_pr(args.pr_number, args.provider)


if __name__ == "__main__":
    main()
