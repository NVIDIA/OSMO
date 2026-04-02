# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Respond to PR review comments by delegating fixes to Claude Code CLI.

Fetches unresolved review threads and top-level PR comments containing a
trigger phrase, runs a single Claude Code CLI session to apply all fixes,
then posts per-comment replies and resolves addressed threads.

Usage:
    python respond.py --pr-number 789 --trigger-phrase /testbot
"""

import argparse
import json
import logging
import os
import shlex
import subprocess
import sys

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger(__name__)

MAX_AUTO_RESPONSES = 8
MAX_PUSH_RETRIES = 3
SELF_AUTHORS = frozenset({"github-actions[bot]", "svc-osmo-ci"})

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

RESOLVE_MUTATION = """
mutation($threadId: ID!) {
  resolveReviewThread(input: {threadId: $threadId}) {
    thread { isResolved }
  }
}
"""

REPLY_SCHEMA = json.dumps({
    "type": "object",
    "properties": {
        "replies": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "comment_id": {
                        "type": "integer",
                        "description": "The comment ID being replied to",
                    },
                    "reply": {
                        "type": "string",
                        "description": "Explanation of what was done and why",
                    },
                    "resolve": {
                        "type": "boolean",
                        "description": "True if the issue is fully addressed",
                    },
                },
                "required": ["comment_id", "reply", "resolve"],
            },
        },
    },
    "required": ["replies"],
})


def run_gh(args: str) -> subprocess.CompletedProcess:
    """Run a gh CLI command and return the result."""
    return subprocess.run(
        f"gh {args}",
        shell=True,
        capture_output=True,
        text=True,
    )


def fetch_threads(owner: str, repo: str, pr_number: int) -> list[dict]:
    """Fetch review threads via GraphQL. Returns list of comment dicts."""
    result = run_gh(
        f"api graphql -f query={shlex.quote(THREADS_QUERY)} "
        f"-F owner={shlex.quote(owner)} -F repo={shlex.quote(repo)} "
        f"-F pr={pr_number}"
    )
    if result.returncode != 0:
        logger.error("GraphQL query failed: %s", result.stderr)
        return []

    data = json.loads(result.stdout)
    nodes = (
        data.get("data", {})
        .get("repository", {})
        .get("pullRequest", {})
        .get("reviewThreads", {})
        .get("nodes", [])
    )

    comments = []
    for node in nodes:
        if node.get("isResolved", False):
            continue
        thread_comments = node.get("comments", {}).get("nodes", [])
        if not thread_comments:
            continue
        first = thread_comments[0]
        comments.append({
            "comment_id": first["databaseId"],
            "comment_type": "review",
            "thread_id": node["id"],
            "path": node.get("path", ""),
            "line": node.get("line", 0),
            "body": first["body"],
            "author": first.get("author", {}).get("login", "unknown"),
        })

    logger.info("Fetched %d unresolved review threads", len(comments))
    return comments


def fetch_pr_comments(owner: str, repo: str, pr_number: int) -> list[dict]:
    """Fetch top-level PR comments via REST API."""
    result = run_gh(
        f"api repos/{owner}/{repo}/issues/{pr_number}/comments "
        f"--jq '.[] | {{id: .id, body: .body, author: .user.login}}'"
    )
    if result.returncode != 0:
        logger.error("Failed to fetch PR comments: %s", result.stderr)
        return []

    comments = []
    for line in result.stdout.strip().splitlines():
        if not line:
            continue
        item = json.loads(line)
        comments.append({
            "comment_id": item["id"],
            "comment_type": "issue",
            "thread_id": None,
            "path": "",
            "line": 0,
            "body": item["body"],
            "author": item["author"],
        })

    logger.info("Fetched %d top-level PR comments", len(comments))
    return comments


def filter_actionable(
    comments: list[dict],
    trigger_phrase: str,
) -> list[dict]:
    """Keep comments with the trigger phrase from non-bot authors."""
    actionable = []
    for comment in comments:
        if trigger_phrase not in comment["body"]:
            continue
        if comment["author"] in SELF_AUTHORS:
            continue
        if comment["path"].startswith("src/scripts/testbot/"):
            continue
        actionable.append(comment)

    if len(actionable) > MAX_AUTO_RESPONSES:
        logger.info(
            "Capping from %d to %d actionable comments",
            len(actionable), MAX_AUTO_RESPONSES,
        )
        actionable = actionable[:MAX_AUTO_RESPONSES]

    logger.info("Found %d actionable comment(s)", len(actionable))
    return actionable


def build_prompt(comments: list[dict]) -> str:
    """Build a single prompt with all comments for Claude Code."""
    lines = [
        "Read and follow the test quality rules in src/scripts/testbot/TESTBOT_PROMPT.md.",
        "",
        "Address these review comments on an AI-generated test PR:",
        "",
    ]
    for comment in comments:
        location = f"`{comment['path']}` line {comment['line']}" if comment["path"] else "general PR comment"
        body = comment["body"].replace("/testbot", "").strip()
        lines.append(f"- **Comment {comment['comment_id']}** ({location}): {body}")

    lines.extend([
        "",
        "Steps:",
        "1. Read the relevant source and test files.",
        "2. Apply the requested changes.",
        "3. Run tests to validate:",
        "   - Python/Go: bazel test <target>",
        "   - TypeScript: cd src/ui && pnpm test -- --run <test_file>",
        "4. If tests fail, fix and re-run.",
        "5. Do NOT create git commits or branches.",
        "",
        "After completing all work, produce a structured JSON reply for each comment.",
        "Each reply should explain what you did and whether the issue is resolved.",
        "Include the comment_id so replies can be matched to the original comments.",
    ])
    return "\n".join(lines)


def run_claude(prompt: str) -> dict:
    """Run Claude Code CLI and return parsed JSON output.

    Returns a dict with 'structured_output' and/or 'result' fields.
    Returns empty dict on failure.
    """
    cmd = [
        "npx", "@anthropic-ai/claude-code@latest", "--print",
        "--model", os.environ.get("ANTHROPIC_MODEL", "aws/anthropic/claude-opus-4-5"),
        "--output-format", "json",
        "--json-schema", REPLY_SCHEMA,
        "--allowedTools",
        "Read,Edit,Write,Bash(bazel:*),Bash(pnpm:*),Bash(cat:*),Glob,Grep",
        "--max-turns", "25",
        prompt,
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    except subprocess.TimeoutExpired:
        logger.error("Claude Code CLI timed out after 600s")
        return {}

    if result.returncode != 0:
        logger.error(
            "Claude Code CLI exited %d: stdout=%s stderr=%s",
            result.returncode, result.stdout[:500], result.stderr[:500],
        )
        return {}

    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        logger.error("Failed to parse Claude Code JSON output")
        return {}


def parse_replies(claude_output: dict, comments: list[dict]) -> list[dict]:
    """Extract replies from Claude Code output with three-tier fallback."""
    # Tier 1: structured_output
    structured = claude_output.get("structured_output")
    if isinstance(structured, dict) and "replies" in structured:
        replies = structured["replies"]
        if isinstance(replies, list) and replies:
            logger.info("Parsed %d replies from structured_output", len(replies))
            return replies

    # Tier 2: extract JSON from result text
    result_text = claude_output.get("result", "")
    if result_text:
        try:
            start = result_text.index("{")
            end = result_text.rindex("}") + 1
            data = json.loads(result_text[start:end])
            if isinstance(data, dict) and "replies" in data:
                logger.info("Parsed replies from result text (tier 2)")
                return data["replies"]
        except (ValueError, json.JSONDecodeError):
            pass

    # Tier 3: fallback — single reply with raw text on the first comment
    if result_text and comments:
        logger.warning("Using raw text fallback (tier 3)")
        return [{
            "comment_id": comments[0]["comment_id"],
            "reply": result_text[:2000],
            "resolve": False,
        }]

    return []


def get_changed_files() -> list[str]:
    """Return list of files with uncommitted changes or newly created."""
    # Modified tracked files
    diff_result = subprocess.run(
        ["git", "diff", "--name-only"],
        capture_output=True, text=True,
    )
    # New untracked files (excluding directories)
    untracked_result = subprocess.run(
        ["git", "ls-files", "--others", "--exclude-standard"],
        capture_output=True, text=True,
    )
    files = set()
    for output in (diff_result.stdout, untracked_result.stdout):
        for line in output.strip().splitlines():
            if line and not line.startswith(".claude/"):
                files.add(line)
    return sorted(files)


def discard_changes() -> None:
    """Discard all uncommitted changes."""
    subprocess.run(["git", "checkout", "--", "."], check=False)


def commit_and_push(files: list[str]) -> bool:
    """Stage specific files, commit, and push with retries."""
    subprocess.run(["git", "add"] + files, check=True)
    subprocess.run(
        ["git", "commit", "-m", "testbot: address review feedback"],
        check=True,
    )
    for attempt in range(1, MAX_PUSH_RETRIES + 1):
        result = subprocess.run(
            ["git", "push"],
            capture_output=True, text=True,
        )
        if result.returncode == 0:
            return True
        logger.warning(
            "git push failed (attempt %d/%d): %s",
            attempt, MAX_PUSH_RETRIES, result.stderr[:200],
        )
        if attempt < MAX_PUSH_RETRIES:
            subprocess.run(["git", "pull", "--rebase"], check=False)

    logger.error("git push failed after %d attempts", MAX_PUSH_RETRIES)
    return False


def reply_to_comment(
    owner: str,
    repo: str,
    pr_number: int,
    comment: dict,
    message: str,
) -> None:
    """Post a reply using the correct API for the comment type."""
    if comment["comment_type"] == "review":
        run_gh(
            f"api repos/{owner}/{repo}/pulls/{pr_number}"
            f"/comments/{comment['comment_id']}/replies "
            f"-F body={shlex.quote(message)}"
        )
    else:
        run_gh(
            f"api repos/{owner}/{repo}/issues/{pr_number}/comments "
            f"-F body={shlex.quote(message)}"
        )


def resolve_thread(thread_id: str) -> None:
    """Mark a review thread as resolved via GraphQL."""
    result = run_gh(
        f"api graphql -f query={shlex.quote(RESOLVE_MUTATION)} "
        f"-F threadId={shlex.quote(thread_id)}"
    )
    if result.returncode != 0:
        logger.warning("Failed to resolve thread %s: %s", thread_id, result.stderr)


def main() -> None:
    """Fetch actionable comments, delegate to Claude Code, post replies."""
    parser = argparse.ArgumentParser(
        description="Respond to PR review comments via Claude Code CLI.",
    )
    parser.add_argument("--pr-number", type=int, required=True)
    parser.add_argument("--trigger-phrase", default="/testbot")
    args = parser.parse_args()

    github_repository = os.environ.get("GITHUB_REPOSITORY", "NVIDIA/OSMO")
    owner, repo = github_repository.split("/", 1)

    # Fetch all comments
    review_comments = fetch_threads(owner, repo, args.pr_number)
    pr_comments = fetch_pr_comments(owner, repo, args.pr_number)
    all_comments = review_comments + pr_comments

    actionable = filter_actionable(all_comments, args.trigger_phrase)
    if not actionable:
        logger.info("No actionable comments on PR #%d", args.pr_number)
        return

    # Build comment lookup for reply routing
    comment_lookup = {c["comment_id"]: c for c in actionable}

    # Save HEAD for crash recovery
    head_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()

    # Run Claude Code
    prompt = build_prompt(actionable)
    logger.info("Running Claude Code for %d comment(s)...", len(actionable))
    claude_output = run_claude(prompt)

    if not claude_output:
        logger.error("Claude Code failed — discarding any partial changes")
        discard_changes()
        reply_to_comment(
            owner, repo, args.pr_number, actionable[0],
            "I encountered an error processing this request. Needs human review.",
        )
        return

    # Parse replies
    replies = parse_replies(claude_output, actionable)

    # Check for file modifications and commit
    modified_files = get_changed_files()
    push_succeeded = False
    if modified_files:
        logger.info("Modified files: %s", modified_files)
        push_succeeded = commit_and_push(modified_files)
        if not push_succeeded:
            logger.error("Push failed — discarding changes")
            subprocess.run(
                ["git", "reset", "--hard", head_sha],
                check=False,
            )

    # Post replies and resolve threads
    replied = 0
    for reply_data in replies:
        comment_id = reply_data.get("comment_id")
        comment = comment_lookup.get(comment_id)
        if not comment:
            logger.warning("Reply for unknown comment_id %s, skipping", comment_id)
            continue

        message = reply_data.get("reply", "Acknowledged.")
        should_resolve = reply_data.get("resolve", False)

        if modified_files and not push_succeeded:
            message = (
                f"I applied a fix locally but could not push. "
                f"Needs human review.\n\n**Intended fix:** {message}"
            )
            should_resolve = False

        reply_to_comment(owner, repo, args.pr_number, comment, message)
        replied += 1

        if should_resolve and comment.get("thread_id"):
            resolve_thread(comment["thread_id"])
            logger.info("Resolved thread for comment %s", comment_id)

    logger.info(
        "Responded to %d comment(s) on PR #%d", replied, args.pr_number,
    )


if __name__ == "__main__":
    main()
