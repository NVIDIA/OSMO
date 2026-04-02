# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Respond to PR review comments by delegating fixes to Claude Code CLI.

Fetches unresolved review threads containing a trigger phrase, runs a
single Claude Code CLI session to apply all fixes, then posts per-comment
inline replies and resolves addressed threads.

Usage:
    python respond.py --pr-number 789 --trigger-phrase /testbot
"""

import argparse
import json
import logging
import os
import shlex
import subprocess

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
        "commit_message": {
            "type": "string",
            "description": (
                "A concise git commit message (subject line under 72 chars, "
                "optional body after blank line) summarizing all changes made. "
                "Prefix with 'testbot: '. Example: "
                "'testbot: rename describe block, add edge case tests'"
            ),
        },
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
    "required": ["commit_message", "replies"],
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
    """Fetch all review threads via GraphQL. Returns every thread with metadata."""
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

    threads = []
    for node in nodes:
        thread_comments = node.get("comments", {}).get("nodes", [])
        first = thread_comments[0] if thread_comments else {}
        threads.append({
            "comment_id": first.get("databaseId"),
            "thread_id": node["id"],
            "is_resolved": node.get("isResolved", False),
            "path": node.get("path", ""),
            "line": node.get("line", 0),
            "body": first.get("body", ""),
            "author": first.get("author", {}).get("login", "unknown"),
            "comment_count": len(thread_comments),
        })

    logger.info("Fetched %d total review threads on PR #%d", len(threads), pr_number)
    return threads


def filter_actionable(
    threads: list[dict],
    trigger_phrase: str,
) -> list[dict]:
    """Filter threads to actionable ones, logging each skip reason."""
    actionable = []
    for thread in threads:
        comment_id = thread["comment_id"]
        path = thread["path"]
        author = thread["author"]
        body_preview = thread["body"][:80].replace("\n", " ")

        if thread["is_resolved"]:
            logger.info(
                "  SKIP (resolved) comment=%s path=%s author=%s body=%s",
                comment_id, path, author, body_preview,
            )
            continue

        if not thread["comment_id"]:
            logger.info("  SKIP (no comments) thread=%s path=%s", thread["thread_id"], path)
            continue

        if trigger_phrase not in thread["body"]:
            logger.info(
                "  SKIP (no trigger) comment=%s path=%s author=%s body=%s",
                comment_id, path, author, body_preview,
            )
            continue

        if author in SELF_AUTHORS:
            logger.info(
                "  SKIP (bot author) comment=%s path=%s author=%s",
                comment_id, path, author,
            )
            continue

        if path.startswith("src/scripts/testbot/"):
            logger.info(
                "  SKIP (testbot source) comment=%s path=%s author=%s",
                comment_id, path, author,
            )
            continue

        logger.info(
            "  ACTIONABLE comment=%s path=%s line=%s author=%s body=%s",
            comment_id, path, thread["line"], author, body_preview,
        )
        actionable.append({
            "comment_id": comment_id,
            "comment_type": "review",
            "thread_id": thread["thread_id"],
            "path": path,
            "line": thread["line"],
            "body": thread["body"],
            "author": author,
        })

    if len(actionable) > MAX_AUTO_RESPONSES:
        logger.info(
            "Capping from %d to %d actionable comments",
            len(actionable), MAX_AUTO_RESPONSES,
        )
        actionable = actionable[:MAX_AUTO_RESPONSES]

    logger.info("Result: %d actionable comment(s)", len(actionable))
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
        location = f"`{comment['path']}` line {comment['line']}"
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
    model = os.environ.get("ANTHROPIC_MODEL", "aws/anthropic/claude-opus-4-5")
    cmd = [
        "npx", "@anthropic-ai/claude-code@latest", "--print",
        "--model", model,
        "--output-format", "json",
        "--json-schema", REPLY_SCHEMA,
        "--allowedTools",
        "Read,Edit,Write,Bash(bazel:*),Bash(pnpm:*),Bash(cat:*),Glob,Grep",
        "--max-turns", "25",
        prompt,
    ]
    logger.info("Claude Code command: %s", " ".join(shlex.quote(c) for c in cmd))

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
        logger.error("Failed to parse Claude Code JSON output: %s", result.stdout[:500])
        return {}


def parse_replies(claude_output: dict, comments: list[dict]) -> list[dict]:
    """Extract replies from Claude Code output with three-tier fallback."""
    # Tier 1: structured_output
    structured = claude_output.get("structured_output")
    if isinstance(structured, dict) and "replies" in structured:
        replies = structured["replies"]
        if isinstance(replies, list) and replies:
            logger.info("Parsed %d replies from structured_output (tier 1)", len(replies))
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
    diff_result = subprocess.run(
        ["git", "diff", "--name-only"],
        capture_output=True, text=True,
    )
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


def commit_and_push(files: list[str], message: str) -> bool:
    """Stage specific files, commit, and push with retries."""
    logger.info("Commit message: %s", message.split("\n")[0])
    subprocess.run(["git", "add"] + files, check=True)
    subprocess.run(
        ["git", "commit", "-F", "-"],
        input=message, text=True, check=True,
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
    """Post an inline reply to a review comment."""
    comment_id = comment["comment_id"]
    logger.info(
        "Posting inline reply to review comment %s (path=%s, line=%s)",
        comment_id, comment.get("path", ""), comment.get("line", ""),
    )
    result = run_gh(
        f"api repos/{owner}/{repo}/pulls/{pr_number}"
        f"/comments/{comment_id}/replies "
        f"-F body={shlex.quote(message)}"
    )
    if result.returncode != 0:
        logger.error(
            "Failed to post reply to comment %s: %s",
            comment_id, result.stderr[:300],
        )


def resolve_thread(thread_id: str) -> None:
    """Mark a review thread as resolved via GraphQL."""
    logger.info("Resolving thread %s", thread_id)
    result = run_gh(
        f"api graphql -f query={shlex.quote(RESOLVE_MUTATION)} "
        f"-F threadId={shlex.quote(thread_id)}"
    )
    if result.returncode != 0:
        logger.warning("Failed to resolve thread %s: %s", thread_id, result.stderr[:300])


def main() -> None:
    """Fetch actionable review threads, delegate to Claude Code, post replies."""
    parser = argparse.ArgumentParser(
        description="Respond to PR review comments via Claude Code CLI.",
    )
    parser.add_argument("--pr-number", type=int, required=True)
    parser.add_argument("--trigger-phrase", default="/testbot")
    args = parser.parse_args()

    github_repository = os.environ.get("GITHUB_REPOSITORY", "NVIDIA/OSMO")
    owner, repo = github_repository.split("/", 1)

    # Fetch review threads only (no top-level PR comments)
    threads = fetch_threads(owner, repo, args.pr_number)
    logger.info("Filtering %d threads for trigger '%s':", len(threads), args.trigger_phrase)
    actionable = filter_actionable(threads, args.trigger_phrase)
    if not actionable:
        logger.info("No actionable comments on PR #%d", args.pr_number)
        return

    # Log actionable comments passed to Claude
    logger.info("=== Actionable comments to send to Claude ===")
    for comment in actionable:
        logger.info(
            "  id=%s author=%s path=%s line=%s body=%s",
            comment["comment_id"], comment["author"],
            comment["path"], comment["line"],
            comment["body"][:120].replace("\n", " "),
        )

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

    # Log raw output for debugging
    logger.info("Claude output keys: %s", list(claude_output.keys()))
    if "structured_output" in claude_output:
        logger.info("structured_output: %s", json.dumps(claude_output["structured_output"])[:1000])
    if "result" in claude_output:
        logger.info("result text: %s", claude_output["result"][:500])

    # Parse replies and commit message
    replies = parse_replies(claude_output, actionable)
    structured = claude_output.get("structured_output", {})
    commit_message = (
        structured.get("commit_message", "testbot: address review feedback")
        if isinstance(structured, dict)
        else "testbot: address review feedback"
    )

    # Check for file modifications and commit
    modified_files = get_changed_files()
    push_succeeded = False
    if modified_files:
        logger.info("Modified files: %s", modified_files)
        push_succeeded = commit_and_push(modified_files, commit_message)
        if not push_succeeded:
            logger.error("Push failed — discarding changes")
            subprocess.run(
                ["git", "reset", "--hard", head_sha],
                check=False,
            )
    else:
        logger.info("No file modifications detected")

    # Post replies and resolve threads
    logger.info(
        "Processing %d replies (comment_lookup IDs: %s)",
        len(replies), list(comment_lookup.keys()),
    )
    replied = 0
    for reply_data in replies:
        comment_id = reply_data.get("comment_id")
        logger.info(
            "Reply entry: comment_id=%s (type=%s) resolve=%s reply=%s",
            comment_id, type(comment_id).__name__,
            reply_data.get("resolve"), reply_data.get("reply", "")[:100],
        )
        comment = comment_lookup.get(comment_id)
        if not comment:
            logger.warning(
                "Reply for unknown comment_id %s, skipping. Known IDs: %s",
                comment_id, list(comment_lookup.keys()),
            )
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

    logger.info(
        "Done: responded to %d comment(s) on PR #%d", replied, args.pr_number,
    )


if __name__ == "__main__":
    main()
