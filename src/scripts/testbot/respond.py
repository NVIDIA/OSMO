# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Batch-respond to PR review comments using GraphQL thread resolution.

Fetches review threads via GraphQL (includes resolution status), groups
unresolved threads by file, sends one LLM call per file, replies to each
thread, and resolves threads the LLM marks as addressed.
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

THREADS_QUERY = """
query($owner: String!, $repo: String!, $pr: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pr) {
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          path
          line
          comments(first: 50) {
            nodes {
              databaseId
              body
              author { login }
            }
          }
        }
      }
    }
  }
}
"""


def _get_repo_nwo() -> str:
    """Get the owner/repo from gh CLI."""
    result = run_shell("gh repo view --json nameWithOwner --jq .nameWithOwner")
    if result.returncode == 0 and result.stdout.strip():
        return result.stdout.strip()
    return "NVIDIA/OSMO"


@dataclasses.dataclass
class ReviewThread:
    """A PR review thread with resolution status and comments."""

    thread_id: str  # GraphQL node ID (for resolve mutation)
    path: str
    line: int
    is_resolved: bool
    comments: list[dict]  # [{databaseId, body, author}]


def _fetch_threads(pr_number: int) -> list[ReviewThread]:
    """Fetch all review threads on a PR via GraphQL."""
    nwo = _get_repo_nwo()
    owner, repo = nwo.split("/", 1)

    result = run_shell(
        f"gh api graphql -f query='{THREADS_QUERY}' "
        f"-F owner={shlex.quote(owner)} -F repo={shlex.quote(repo)} -F pr={pr_number}"
    )
    if result.returncode != 0:
        logger.error("GraphQL query failed: %s", result.stderr)
        return []

    data = json.loads(result.stdout)
    thread_nodes = (
        data.get("data", {})
        .get("repository", {})
        .get("pullRequest", {})
        .get("reviewThreads", {})
        .get("nodes", [])
    )

    threads = []
    for node in thread_nodes:
        comments = [
            {
                "databaseId": c["databaseId"],
                "body": c["body"],
                "author": c.get("author", {}).get("login", "unknown"),
            }
            for c in node.get("comments", {}).get("nodes", [])
        ]
        threads.append(ReviewThread(
            thread_id=node["id"],
            path=node.get("path", ""),
            line=node.get("line", 0),
            is_resolved=node.get("isResolved", False),
            comments=comments,
        ))

    logger.info("Fetched %d review threads on PR #%d", len(threads), pr_number)
    return threads


def _resolve_thread(thread_id: str) -> None:
    """Mark a review thread as resolved via GraphQL mutation."""
    mutation = f'mutation {{ resolveReviewThread(input: {{threadId: "{thread_id}"}}) {{ thread {{ isResolved }} }} }}'
    result = run_shell(f"gh api graphql -f query='{mutation}'")
    if result.returncode != 0:
        logger.warning("Failed to resolve thread %s: %s", thread_id, result.stderr)


def _filter_actionable_threads(threads: list[ReviewThread]) -> list[ReviewThread]:
    """Filter to threads that need a response.

    Skip:
    - Resolved threads
    - Threads where the last comment is from our bot (already replied, awaiting response)
    - Threads on testbot source files
    """
    actionable = []
    skip_counts: dict[str, int] = {}

    for thread in threads:
        if thread.is_resolved:
            skip_counts["resolved"] = skip_counts.get("resolved", 0) + 1
            continue

        if thread.path.startswith("src/scripts/testbot/"):
            skip_counts["testbot source"] = skip_counts.get("testbot source", 0) + 1
            continue

        if not thread.comments:
            skip_counts["no comments"] = skip_counts.get("no comments", 0) + 1
            continue

        last_author = thread.comments[-1]["author"]
        if last_author in SELF_AUTHORS:
            skip_counts["awaiting response"] = skip_counts.get("awaiting response", 0) + 1
            continue

        actionable.append(thread)

    logger.info(
        "Actionable: %d threads, skipped: %s",
        len(actionable),
        ", ".join(f"{v} {k}" for k, v in skip_counts.items()) if skip_counts else "none",
    )
    return actionable


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


def _infer_source_path(test_path: str) -> Optional[str]:
    """Infer the source file path from a test file path."""
    if test_path.endswith(".test.ts") or test_path.endswith(".test.tsx"):
        source = test_path.replace(".test.ts", ".ts").replace(".test.tsx", ".tsx")
        return source if os.path.exists(source) else None

    if test_path.endswith("_test.go"):
        source = test_path.replace("_test.go", ".go")
        return source if os.path.exists(source) else None

    if "/tests/test_" in test_path and test_path.endswith(".py"):
        directory = test_path.rsplit("/tests/", 1)[0]
        basename = test_path.rsplit("/test_", 1)[-1]
        source = f"{directory}/{basename}"
        return source if os.path.exists(source) else None

    return None


def parse_llm_json_response(response_text: str) -> dict:
    """Parse JSON LLM response. Returns dict with 'fix' and 'replies' keys."""
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


def _process_file_threads(
    pr_number: int,
    file_path: str,
    threads: list[ReviewThread],
    provider: str,
) -> int:
    """Process all threads on a single file with one LLM call. Returns reply count."""
    logger.info("Processing %d threads on %s", len(threads), file_path)

    file_content = read_file(file_path)
    if file_content.startswith("Error"):
        logger.error("Cannot read %s: %s", file_path, file_content)
        return 0

    llm = get_llm(provider)
    if llm.client is None:
        logger.error("LLM client not available")
        return 0

    # Find source file for context
    source_path = _infer_source_path(file_path)
    source_content = None
    if source_path:
        source_content = read_file(source_path)
        if source_content.startswith("Error"):
            source_content = None
        else:
            logger.info("Including source context: %s (%d chars)", source_path, len(source_content))

    # Build comment list from all threads on this file
    # Use the first comment in each thread as the review comment to address
    comment_dicts = []
    thread_map = {}  # comment_id → thread
    for thread in threads:
        first_comment = thread.comments[0]
        comment_id = first_comment["databaseId"]
        comment_dicts.append({
            "comment_id": comment_id,
            "author": first_comment["author"],
            "line": thread.line,
            "body": first_comment["body"],
        })
        thread_map[comment_id] = thread

    user_prompt = build_batch_respond_prompt(
        file_path, file_content, comment_dicts,
        source_content=source_content, source_path=source_path,
    )

    logger.info("Calling LLM for %d comments on %s (prompt=%d chars)", len(comment_dicts), file_path, len(user_prompt))
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
        return 0

    logger.info("LLM response (%d chars)", len(response_text))
    data = parse_llm_json_response(response_text)

    fix_content = data.get("fix")
    replies = {r["comment_id"]: r for r in data.get("replies", []) if "comment_id" in r}

    # Apply fix if provided
    if fix_content:
        logger.info("LLM provided a fix (%d chars), validating", len(fix_content))
        write_file(file_path, fix_content)

        validation = run_test(file_path)
        if not validation.passed:
            logger.warning("Fix validation failed: %s", validation.output[:300])
            write_file(file_path, file_content)
            # Post replies with failure note, don't resolve
            for comment_id, reply_data in replies.items():
                _reply_to_comment(
                    pr_number, comment_id,
                    f"{reply_data.get('reply', 'Addressed.')}\n\n"
                    f"> **Note:** tests failed after applying fix, needs human review.",
                )
            return len(replies)

        # Commit and push
        run_shell(f"git add {shlex.quote(file_path)}")
        commit_msg = f"testbot: address {len(threads)} review thread(s) on {file_path}"
        msg_file = tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False)  # pylint: disable=consider-using-with
        try:
            msg_file.write(commit_msg)
            msg_file.close()
            run_shell(f"git commit -F {shlex.quote(msg_file.name)}")
        finally:
            os.unlink(msg_file.name)
        run_shell("git push")
        logger.info("Committed and pushed fix for %s", file_path)

    # Post replies and resolve threads
    replied = 0
    for comment_id, reply_data in replies.items():
        reply_text = reply_data.get("reply", "Acknowledged.")
        should_resolve = reply_data.get("resolve", False)

        _reply_to_comment(pr_number, comment_id, reply_text)
        replied += 1

        if should_resolve and comment_id in thread_map:
            thread = thread_map[comment_id]
            _resolve_thread(thread.thread_id)
            logger.info("Resolved thread %s on %s:%d", thread.thread_id, file_path, thread.line)

    return replied


def respond_to_pr(pr_number: int, provider: str = "claude") -> None:
    """Process all actionable review threads on a PR, batched by file."""
    threads = _fetch_threads(pr_number)
    actionable = _filter_actionable_threads(threads)

    if not actionable:
        logger.info("No actionable threads on PR #%d", pr_number)
        return

    # Group by file
    by_file = collections.defaultdict(list)
    for thread in actionable:
        by_file[thread.path].append(thread)

    logger.info("Processing threads on %d file(s)", len(by_file))

    total_replied = 0
    for file_path, file_threads in by_file.items():
        if total_replied >= MAX_AUTO_RESPONSES:
            logger.info("Reached max auto-responses (%d), stopping", MAX_AUTO_RESPONSES)
            break
        replied = _process_file_threads(pr_number, file_path, file_threads, provider)
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
