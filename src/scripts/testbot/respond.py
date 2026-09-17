# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Respond to PR review comments by delegating fixes to the agent CLI.

Fetches unresolved review threads containing a trigger phrase, runs a
single agent CLI session to apply all fixes, then posts per-comment
inline replies.

Usage:
    python respond.py --pr-number 789 --trigger-phrase /testbot
"""

import argparse
import json
import logging
import os
from pathlib import Path
import re
import shlex
import subprocess
import tempfile

from src.scripts.testbot import agent_runner
from src.scripts.testbot.guardrails import get_changed_files

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger(__name__)

MAX_PUSH_RETRIES = 3
SELF_AUTHORS = frozenset({"github-actions[bot]", "svc-osmo-ci"})
ALLOWED_ASSOCIATIONS = frozenset({"OWNER", "MEMBER", "COLLABORATOR"})
# Hidden trailer appended to every failure reply (max-turns, timeout, generic
# error). filter_actionable treats bot replies bearing this marker as
# non-terminal so the user's /testbot is still eligible for retry on the next
# event without having to repost the comment.
ERROR_REPLY_MARKER = "<!-- testbot-status: error -->"
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
            "description": (
                "One reply per review comment. Each entry maps a comment ID "
                "from the prompt to a short explanation of what was done."
            ),
            "items": {
                "type": "object",
                "properties": {
                    "comment_id": {
                        "type": "string",
                        "description": "The comment ID from the prompt header (e.g. '3066587176')",
                    },
                    "reply": {
                        "type": "string",
                        "description": "What was done for this thread",
                    },
                },
                "required": ["comment_id", "reply"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["commit_message", "replies"],
    "additionalProperties": False,
})

GIT_TRAILER_PREFIXES = (
    "Signed-off-by:", "Co-authored-by:", "Reviewed-by:",
    "Acked-by:", "Tested-by:", "Reported-by:",
)
MAX_COMMIT_MESSAGE_LENGTH = 500


def sanitize_commit_message(message: str) -> str:
    """Sanitize a commit message from the agent's output.

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
    phrase. The full thread history is preserved for the agent's context.
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

        # Find the latest authorized /testbot comment that hasn't been
        # replied to (successfully) by the bot. Walk backwards: stop at a
        # successful bot reply (prior triggers handled), but skip past
        # error replies so the user's /testbot is still actionable on
        # retry. Skip unauthorized triggers so an earlier authorized one
        # can still be found.
        trigger_comment = None
        for comment in reversed(comments):
            if comment["author"] in SELF_AUTHORS:
                if ERROR_REPLY_MARKER in comment.get("body", ""):
                    continue  # Failure reply — keep walking, retry is allowed
                break  # Successful reply — prior triggers handled
            if not _has_trigger(comment["body"], trigger_phrase):
                continue
            if comment.get("association", "NONE") not in ALLOWED_ASSOCIATIONS:
                continue  # Unauthorized trigger — keep searching earlier comments
            trigger_comment = comment
            break

        if not trigger_comment:
            logger.info(
                "  SKIP (no unprocessed trigger in %d comments) path=%s body=%s",
                len(comments), path, first_body,
            )
            continue

        # Build full thread conversation for context
        thread_history = "\n".join(
            f"  [{c["author"]}]: {c["body"]}" for c in comments
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


def build_prompt(threads: list[dict], pr_number: int) -> str:
    """Build a single prompt with all actionable threads for the agent.

    Each thread includes the full conversation history so the agent
    understands the context (original comment + follow-up replies).
    """
    lines = [
        "Read and follow src/scripts/testbot/TESTBOT_RESPOND_PROMPT.md for your role,",
        "process, and output format.",
        "",
        f"Address these review comments on PR #{pr_number}.",
        "Each thread includes the full conversation history — pay attention to",
        "the LATEST request (the one containing /testbot), not just the first comment.",
        "",
    ]
    for thread in threads:
        location = f"`{thread["path"]}` line {thread["line"]}"
        lines.append(f"### Comment {thread["reply_comment_id"]} ({location})")
        lines.append(thread["thread_history"])
        lines.append("")

    return "\n".join(lines)


def run_agent(
    prompt: str,
    model: str = "azure/openai/gpt-6-astra",
    timeout: int = 720,
) -> dict:
    """Run one agent session and adapt its final JSON to the existing reply flow."""
    with tempfile.TemporaryDirectory(prefix="testbot-respond-") as directory:
        artifacts = Path(directory)
        schema, output = artifacts / "schema.json", artifacts / "response.json"
        schema.write_text(REPLY_SCHEMA, encoding="utf-8")
        command = agent_runner.agent_command(
            artifacts, schema, output, agent_runner.reviewer_build_environment(artifacts),
            model=model, allow_github=True)
        result = agent_runner.run_agent(command, prompt, artifacts / "session", timeout, "codex")
        if result.reason == "timeout":
            return {"is_error": True, "subtype": "timeout"}
        if not result.successful:
            logger.error("Agent failed: %s: %s", result.reason, result.summary)
            return {}
        try:
            parsed = json.loads(output.read_text(encoding="utf-8"))
            if isinstance(parsed, dict):
                return {"structured_output": parsed, "result": result.summary}
        except (OSError, ValueError) as error:
            logger.error("Failed to read agent JSON output: %s", error)
        return {}


def _extract_replies(agent_output: dict) -> dict[str, str]:
    """Extract per-comment replies from agent output with tiered fallback.

    Returns a dict mapping comment_id (str) to reply text.
    """
    def _parse_replies_list(replies: list) -> dict[str, str]:
        result: dict[str, str] = {}
        for entry in replies:
            if not isinstance(entry, dict):
                continue
            comment_id = str(entry.get("comment_id", ""))
            reply = entry.get("reply", "")
            if comment_id and reply:
                result[comment_id] = reply
        return result

    # Tier 1: structured_output.replies
    structured = agent_output.get("structured_output")
    if isinstance(structured, dict) and isinstance(structured.get("replies"), list):
        replies = _parse_replies_list(structured["replies"])
        if replies:
            logger.info("Parsed %d replies from structured_output (tier 1)", len(replies))
            return replies

    # Tier 2: extract JSON from result text
    result_text = agent_output.get("result", "")
    if isinstance(result_text, str) and result_text:
        try:
            start = result_text.index("{")
            end = result_text.rindex("}") + 1
            data = json.loads(result_text[start:end])
            if isinstance(data, dict) and isinstance(data.get("replies"), list):
                replies = _parse_replies_list(data["replies"])
                if replies:
                    logger.info("Parsed %d replies from result text (tier 2)", len(replies))
                    return replies
        except (ValueError, json.JSONDecodeError):
            pass

    logger.warning("No per-thread replies found in agent output")
    return {}


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
        stderr = result.stderr.strip()
        logger.warning(
            "git push failed (attempt %d/%d): %s",
            attempt, MAX_PUSH_RETRIES, stderr[:500],
        )
        # Repository rule violations (GH013) won't resolve with retries.
        if "GH013" in stderr:
            logger.error(
                "Push blocked by repository ruleset. "
                "The service account may need bypass permissions."
            )
            return False
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


def main() -> None:
    """Fetch actionable review threads, delegate to the agent, post replies."""
    parser = argparse.ArgumentParser(
        description="Respond to PR review comments via the agent CLI.",
    )
    parser.add_argument("--pr-number", type=int, required=True)
    parser.add_argument("--trigger-phrase", default="/testbot")
    parser.add_argument("--max-responses", type=int, default=10,
                        help="Max threads to address per trigger (default: 10)")
    parser.add_argument("--timeout", type=int, default=720,
                        help="Agent CLI timeout in seconds (default: 720)")
    parser.add_argument("--model", default="azure/openai/gpt-6-astra",
                        help="LLM model name (default: azure/openai/gpt-6-astra)")
    args = parser.parse_args()

    github_repository = os.environ.get("GITHUB_REPOSITORY", "NVIDIA/OSMO")
    owner, repo = github_repository.split("/", 1)

    threads = fetch_threads(owner, repo, args.pr_number)
    logger.info("Filtering %d threads for trigger '%s':", len(threads), args.trigger_phrase)
    actionable = filter_actionable(threads, args.trigger_phrase, args.max_responses)
    if not actionable:
        logger.info("No actionable comments on PR #%d", args.pr_number)
        return

    logger.info("=== Actionable threads to send to the agent ===")
    for thread in actionable:
        logger.info(
            "  reply_comment_id=%s author=%s path=%s line=%s trigger=%s",
            thread["reply_comment_id"], thread["author"],
            thread["path"], thread["line"],
            thread["trigger_body"][:120].replace("\n", " "),
        )

    head_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()

    prompt = build_prompt(actionable, args.pr_number)
    logger.info("Running the agent for %d comment(s)...", len(actionable))
    agent_output = run_agent(
        prompt, model=args.model, timeout=args.timeout,
    )

    if not agent_output:
        logger.error("Agent failed — discarding any partial changes")
        discard_changes()
        for comment in actionable:
            reply_to_comment(
                owner, repo, args.pr_number, comment,
                "I encountered an error processing this request. "
                "Please retry or handle manually.\n\n"
                + ERROR_REPLY_MARKER,
            )
        return

    # On timeout or max-turns, discard partial file changes (may be incomplete)
    # and post an informative reply with the error marker so the user can
    # retry without having to repost the /testbot comment.
    subtype = agent_output.get("subtype")
    if subtype in ("timeout", "error_max_turns"):
        reason = "timed out" if subtype == "timeout" else "hit the max-turns limit"
        turns_used = agent_output.get("num_turns", "?")
        logger.warning("Agent %s after %s turns — discarding partial changes", reason, turns_used)
        discard_changes()
        status_msg = (
            f"I {reason} after {turns_used} turns. "
            f"Try breaking this into smaller requests, or handle manually.\n\n"
            + ERROR_REPLY_MARKER
        )
        for comment in actionable:
            reply_to_comment(owner, repo, args.pr_number, comment, status_msg)
        return

    logger.info("Agent output keys: %s", list(agent_output.keys()))
    logger.info(
        "Agent diagnostics: num_turns=%s stop_reason=%s terminal_reason=%s cost=$%s",
        agent_output.get("num_turns"),
        agent_output.get("stop_reason"),
        agent_output.get("terminal_reason"),
        agent_output.get("total_cost_usd"),
    )
    if "structured_output" in agent_output:
        logger.info("structured_output: %s", json.dumps(agent_output["structured_output"]))
    if "result" in agent_output:
        logger.info("result text: %s", agent_output["result"])

    per_thread_replies = _extract_replies(agent_output)
    structured = agent_output.get("structured_output", {})
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

    # When push fails, the agent's per-thread replies describe work that wasn't
    # applied — discard them so we don't mislead the reviewer.
    if modified_files and not push_succeeded:
        per_thread_replies = {}
        fallback_message = (
            "I prepared a fix but could not push it. "
            "Please retry or push manually.\n\n"
            + ERROR_REPLY_MARKER
        )
    elif not modified_files:
        fallback_message = (
            "I reviewed this but didn't find changes to make. "
            "Please retry or review manually."
        )
    else:
        fallback_message = "Fix applied — see the latest commit for details."

    # Post reply to each actionable thread
    replied = 0
    for comment in actionable:
        comment_id = str(comment["reply_comment_id"])
        message = per_thread_replies.get(comment_id, fallback_message)
        reply_posted = reply_to_comment(
            owner, repo, args.pr_number, comment, message,
        )
        if reply_posted:
            replied += 1

    logger.info(
        "Done: responded to %d comment(s) on PR #%d", replied, args.pr_number,
    )


if __name__ == "__main__":
    main()
