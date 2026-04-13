# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
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
import re
import shlex
import subprocess

from src.scripts.testbot.guardrails import get_changed_files

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger(__name__)

MAX_PUSH_RETRIES = 3
SELF_AUTHORS = frozenset({"github-actions[bot]", "svc-osmo-ci"})
ALLOWED_ASSOCIATIONS = frozenset({"OWNER", "MEMBER", "COLLABORATOR"})

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
              authorAssociation
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

GIT_TRAILER_PREFIXES = (
    "Signed-off-by:", "Co-authored-by:", "Reviewed-by:",
    "Acked-by:", "Tested-by:", "Reported-by:",
)
MAX_COMMIT_MESSAGE_LENGTH = 500


def sanitize_commit_message(message: str) -> str:
    """Sanitize a commit message from Claude's output.

    Enforces testbot: prefix, strips git trailers that could fake
    attribution, and caps length.
    """
    lines = []
    for line in message.splitlines():
        if any(line.strip().startswith(prefix) for prefix in GIT_TRAILER_PREFIXES):
            continue
        lines.append(line)
    sanitized = "\n".join(lines).strip()
    if not sanitized.startswith("testbot:"):
        sanitized = f"testbot: {sanitized}"
    if len(sanitized) > MAX_COMMIT_MESSAGE_LENGTH:
        sanitized = sanitized[:MAX_COMMIT_MESSAGE_LENGTH].rsplit("\n", maxsplit=1)[0]
    return sanitized


def run_gh(args: str) -> subprocess.CompletedProcess:
    """Run a gh CLI command and return the result."""
    return subprocess.run(
        ["gh"] + shlex.split(args),
        capture_output=True,
        text=True,
        check=False,
    )


def fetch_threads(owner: str, repo: str, pr_number: int) -> list[dict]:
    """Fetch all review threads via GraphQL with full comment history."""
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
        raw_comments = node.get("comments", {}).get("nodes", [])
        comments = [
            {
                "id": c["databaseId"],
                "body": c.get("body", ""),
                "author": c.get("author", {}).get("login", "unknown"),
                "association": c.get("authorAssociation", "NONE"),
            }
            for c in raw_comments
        ]
        threads.append({
            "thread_id": node["id"],
            "is_resolved": node.get("isResolved", False),
            "path": node.get("path", ""),
            "line": node.get("line", 0),
            "comments": comments,
        })

    logger.info("Fetched %d total review threads on PR #%d", len(threads), pr_number)
    return threads


def _has_trigger(body: str, trigger_phrase: str) -> bool:
    """Check if body starts with the trigger phrase followed by whitespace or EOL.

    Strips leading whitespace before matching. This prevents false positives
    like '/testbot.yaml' or mid-sentence mentions from triggering the bot.
    """
    return bool(re.match(re.escape(trigger_phrase) + r"(\s|$)", body.lstrip()))


def filter_actionable(
    threads: list[dict],
    trigger_phrase: str,
    max_responses: int = 10,
) -> list[dict]:
    """Filter threads to actionable ones, logging each skip reason.

    A thread is actionable if ANY non-bot comment contains the trigger
    phrase. The full thread history is preserved for Claude's context.
    The reply_comment_id is set to the LAST comment with the trigger
    (the one that should receive the inline reply).
    """
    actionable = []
    for thread in threads:
        path = thread["path"]
        comments = thread["comments"]
        first_body = comments[0]["body"][:80].replace("\n", " ") if comments else ""

        if thread["is_resolved"]:
            logger.info("  SKIP (resolved) path=%s body=%s", path, first_body)
            continue

        if not comments:
            logger.info("  SKIP (no comments) thread=%s path=%s", thread["thread_id"], path)
            continue

        if path.startswith("src/scripts/testbot/"):
            logger.info("  SKIP (testbot source) path=%s", path)
            continue

        # Skip if the bot already replied (last comment is from us — awaiting human)
        last_author = comments[-1]["author"]
        if last_author in SELF_AUTHORS:
            logger.info(
                "  SKIP (bot already replied, awaiting human) path=%s last_author=%s",
                path, last_author,
            )
            continue

        # Only trigger if the LAST non-bot comment contains the trigger phrase.
        # This prevents an old /testbot from re-firing when a human follows up
        # with a non-trigger comment like "still failing".
        last_human_comment = None
        for comment in reversed(comments):
            if comment["author"] not in SELF_AUTHORS:
                last_human_comment = comment
                break

        trigger_comment = None
        if last_human_comment and _has_trigger(last_human_comment["body"], trigger_phrase):
            trigger_comment = last_human_comment

        if not trigger_comment:
            logger.info(
                "  SKIP (no trigger in %d comments) path=%s body=%s",
                len(comments), path, first_body,
            )
            continue

        # Only allow repo members to trigger the bot
        association = trigger_comment.get("association", "NONE")
        if association not in ALLOWED_ASSOCIATIONS:
            logger.info(
                "  SKIP (author %s has association %s, need %s) path=%s",
                trigger_comment["author"], association,
                ALLOWED_ASSOCIATIONS, path,
            )
            continue

        # Build full thread conversation for context
        thread_history = "\n".join(
            f"  [{c['author']}]: {c['body']}" for c in comments
        )
        logger.info(
            "  ACTIONABLE path=%s line=%s trigger_comment=%s author=%s (%d comments in thread)",
            path, thread["line"], trigger_comment["id"],
            trigger_comment["author"], len(comments),
        )
        actionable.append({
            "reply_comment_id": trigger_comment["id"],
            "thread_id": thread["thread_id"],
            "path": path,
            "line": thread["line"],
            "thread_history": thread_history,
            "trigger_body": trigger_comment["body"],
            "author": trigger_comment["author"],
        })

    if len(actionable) > max_responses:
        logger.info(
            "Capping from %d to %d actionable threads",
            len(actionable), max_responses,
        )
        actionable = actionable[:max_responses]

    logger.info("Result: %d actionable thread(s)", len(actionable))
    return actionable


def build_prompt(threads: list[dict]) -> str:
    """Build a single prompt with all actionable threads for Claude Code.

    Each thread includes the full conversation history so Claude
    understands the context (original comment + follow-up replies).
    """
    lines = [
        "Read and follow the test quality rules in src/scripts/testbot/TESTBOT_PROMPT.md.",
        "",
        "Address these review threads on an AI-generated test PR.",
        "Each thread includes the full conversation history — pay attention to",
        "the LATEST request (the one containing /testbot), not just the first comment.",
        "",
    ]
    for thread in threads:
        location = f"`{thread['path']}` line {thread['line']}"
        lines.append(f"### Thread {thread['reply_comment_id']} ({location})")
        lines.append(thread["thread_history"])
        lines.append("")

    lines.extend([
        "Steps:",
        "1. Read the relevant source and test files.",
        "2. Apply the requested changes from the LATEST /testbot comment in each thread.",
        "3. Follow the test run, bug detection, and verification steps in TESTBOT_PROMPT.md.",
        "   Pay special attention to assertion failures: if the output looks like a source",
        "   bug (contradicts the function's docstring/name/comments), skip the test with",
        "   a SUSPECTED BUG marker — do NOT change the assertion to match buggy output.",
        "4. Do NOT create git commits or branches.",
        "",
        "After completing all work, produce a structured JSON reply for each thread.",
        "Each reply should explain what you did and whether the issue is resolved.",
        "If you flagged any SUSPECTED BUG markers, mention them in the reply.",
        "Use the reply_comment_id as comment_id so replies are posted to the right thread.",
    ])
    return "\n".join(lines)


def run_claude(
    prompt: str,
    model: str = "aws/anthropic/claude-opus-4-5",
    max_turns: int = 50,
) -> dict:
    """Run Claude Code CLI and return parsed JSON output.

    Returns a dict with 'structured_output' and/or 'result' fields.
    Returns empty dict on failure.
    """
    cmd = [
        "npx", "@anthropic-ai/claude-code@2.1.91", "--print",
        "--model", model,
        "--output-format", "json",
        "--json-schema", REPLY_SCHEMA,
        "--allowedTools",
        "Read,Edit,Write,Bash(bazel test *),Bash(pnpm --dir src/ui test *),Bash(pnpm --dir src/ui validate),Bash(pnpm --dir src/ui format),Glob,Grep",
        "--max-turns", str(max_turns),
        prompt,
    ]
    logger.info("Claude Code command: %s", " ".join(shlex.quote(c) for c in cmd))

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=600, check=False)
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
            replies = data.get("replies") if isinstance(data, dict) else None
            if isinstance(replies, list) and replies and isinstance(replies[0], dict):
                logger.info("Parsed replies from result text (tier 2)")
                return replies
        except (ValueError, json.JSONDecodeError):
            pass

    # Tier 3: fallback — single reply with raw text on the first comment
    if result_text and comments:
        logger.warning("Using raw text fallback (tier 3)")
        return [{
            "comment_id": comments[0]["reply_comment_id"],
            "reply": result_text[:2000],
            "resolve": False,
        }]

    return []


def discard_changes() -> None:
    """Discard all uncommitted changes and remove untracked files."""
    subprocess.run(["git", "checkout", "--", "."], check=False)
    subprocess.run(["git", "clean", "-fd", "--exclude=.claude/"], check=False)


def commit_and_push(files: list[str], message: str) -> bool:
    """Stage specific files, commit, and push with retries."""
    logger.info("Commit message: %s", message.split("\n")[0])
    try:
        subprocess.run(["git", "add"] + files, check=True)
        subprocess.run(
            ["git", "commit", "-F", "-"],
            input=message, text=True, check=True,
        )
    except subprocess.CalledProcessError as exc:
        logger.error("git add/commit failed: %s", exc)
        return False
    for attempt in range(1, MAX_PUSH_RETRIES + 1):
        result = subprocess.run(
            ["git", "push"],
            capture_output=True, text=True, check=False,
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
) -> bool:
    """Post an inline reply to a review comment. Returns True on success."""
    reply_comment_id = comment["reply_comment_id"]
    logger.info(
        "Posting inline reply to comment %s (path=%s, line=%s)",
        reply_comment_id, comment.get("path", ""), comment.get("line", ""),
    )
    result = run_gh(
        f"api repos/{owner}/{repo}/pulls/{pr_number}"
        f"/comments/{reply_comment_id}/replies "
        f"-F body={shlex.quote(message)}"
    )
    if result.returncode != 0:
        logger.error(
            "Failed to post reply to comment %s: %s",
            reply_comment_id, result.stderr[:300],
        )
        return False
    return True


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
    parser.add_argument("--max-responses", type=int, default=10,
                        help="Max threads to address per trigger (default: 10)")
    parser.add_argument("--max-turns", type=int, default=50,
                        help="Max Claude Code agent turns (default: 50)")
    parser.add_argument("--model", default="aws/anthropic/claude-opus-4-5",
                        help="LLM model name (default: aws/anthropic/claude-opus-4-5)")
    args = parser.parse_args()

    github_repository = os.environ.get("GITHUB_REPOSITORY", "NVIDIA/OSMO")
    owner, repo = github_repository.split("/", 1)

    threads = fetch_threads(owner, repo, args.pr_number)
    logger.info("Filtering %d threads for trigger '%s':", len(threads), args.trigger_phrase)
    actionable = filter_actionable(threads, args.trigger_phrase, args.max_responses)
    if not actionable:
        logger.info("No actionable comments on PR #%d", args.pr_number)
        return

    logger.info("=== Actionable threads to send to Claude ===")
    for thread in actionable:
        logger.info(
            "  reply_comment_id=%s author=%s path=%s line=%s trigger=%s",
            thread["reply_comment_id"], thread["author"],
            thread["path"], thread["line"],
            thread["trigger_body"][:120].replace("\n", " "),
        )

    comment_lookup = {t["reply_comment_id"]: t for t in actionable}
    head_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()

    prompt = build_prompt(actionable)
    logger.info("Running Claude Code for %d comment(s)...", len(actionable))
    claude_output = run_claude(prompt, model=args.model, max_turns=args.max_turns)

    if not claude_output:
        logger.error("Claude Code failed — discarding any partial changes")
        discard_changes()
        reply_to_comment(
            owner, repo, args.pr_number, actionable[0],
            "I encountered an error processing this request. Needs human review.",
        )
        return

    logger.info("Claude output keys: %s", list(claude_output.keys()))
    if "structured_output" in claude_output:
        logger.info("structured_output: %s", json.dumps(claude_output["structured_output"]))
    if "result" in claude_output:
        logger.info("result text: %s", claude_output["result"])

    replies = parse_replies(claude_output, actionable)
    structured = claude_output.get("structured_output", {})
    raw_commit_message = (
        structured.get("commit_message", "testbot: address review feedback")
        if isinstance(structured, dict)
        else "testbot: address review feedback"
    )
    commit_message = sanitize_commit_message(raw_commit_message)

    modified_files = get_changed_files()
    push_succeeded = False
    if modified_files:
        logger.info("Modified files: %s", modified_files)
        push_succeeded = commit_and_push(modified_files, commit_message)
        if not push_succeeded:
            logger.error("Push failed — discarding changes")
            subprocess.run(["git", "reset", "--hard", head_sha], check=False)
    else:
        logger.info("No file modifications detected")

    logger.info(
        "Processing %d replies (comment_lookup IDs: %s)",
        len(replies), list(comment_lookup.keys()),
    )
    replied = 0
    for reply_data in replies:
        comment_id = reply_data.get("comment_id")
        if isinstance(comment_id, str) and comment_id.isdigit():
            comment_id = int(comment_id)
        logger.info(
            "Reply entry: comment_id=%s (type=%s) resolve=%s reply=%s",
            comment_id, type(comment_id).__name__,
            reply_data.get("resolve"), reply_data.get("reply", ""),
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

        reply_posted = reply_to_comment(owner, repo, args.pr_number, comment, message)
        if reply_posted:
            replied += 1

        if reply_posted and should_resolve and comment.get("thread_id"):
            resolve_thread(comment["thread_id"])

    logger.info(
        "Done: responded to %d comment(s) on PR #%d", replied, args.pr_number,
    )


if __name__ == "__main__":
    main()
