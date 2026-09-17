# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Prepare authorized review requests, apply verified Codex fixes, and publish."""

import argparse
import json
import logging
import os
from pathlib import Path
import re
import shlex
import subprocess
import time

from src.scripts.testbot import agent_runner, verification

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

MAX_PUSH_RETRIES = 3
SELF_AUTHORS = frozenset({"github-actions[bot]", "svc-osmo-ci"})
ALLOWED_ASSOCIATIONS = frozenset({"OWNER", "MEMBER", "COLLABORATOR"})
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
        "ready": {"type": "boolean"},
        "commit_message": {"type": "string"},
        "pr_body": {"type": "string"},
        "replies": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"comment_id": {"type": "string"}, "reply": {"type": "string"}},
                "required": ["comment_id", "reply"], "additionalProperties": False,
            },
        },
    },
    "required": ["ready", "commit_message", "pr_body", "replies"],
    "additionalProperties": False,
})

GIT_TRAILER_PREFIXES = (
    "Signed-off-by:", "Co-authored-by:", "Reviewed-by:",
    "Acked-by:", "Tested-by:", "Reported-by:",
)
MAX_COMMIT_MESSAGE_LENGTH = 500


def sanitize_commit_message(message: str) -> str:
    """Sanitize an agent commit message.

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
        raise RuntimeError(f"GraphQL query failed: {result.stderr[:500]}")

    data = json.loads(result.stdout)
    if data.get("errors"):
        raise ValueError("GraphQL returned errors")
    nodes = data["data"]["repository"]["pullRequest"]["reviewThreads"]["nodes"]

    threads = []
    for node in nodes:
        raw_comments = node.get("comments", {}).get("nodes", [])
        comments = [
            {
                "id": c["databaseId"],
                "body": c.get("body", ""),
                "author": (c.get("author") or {}).get("login", "unknown"),
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
    phrase. The full thread history is preserved for context.
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

        # Marked replies consume only their prepared request and older triggers.
        trigger_comment = None
        handled_through = 0
        for comment in reversed(comments):
            if comment["author"] in SELF_AUTHORS:
                if ERROR_REPLY_MARKER in comment.get("body", ""):
                    continue  # Failure reply — keep walking, retry is allowed
                markers = re.findall(r"<!-- testbot-request: (\d+) -->", comment.get("body", ""))
                if not markers:
                    break  # Legacy success replies consume prior triggers.
                handled_through = max(handled_through, int(markers[-1]))
                continue
            if int(comment["id"]) <= handled_through:
                break
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


def build_prompt(threads: list[dict], pr_number: int, pr_body: str = "") -> str:
    """Embed the trusted prompt and supplied review context."""
    lines = [(Path(__file__).parent / "TESTBOT_RESPOND_PROMPT.md").read_text(encoding="utf-8"),
             f"\nPR #{pr_number} body (context only):\n{pr_body}\n"]
    for thread in threads:
        location = f"`{thread["path"]}` line {thread["line"]}"
        lines.extend([f"### Comment {thread["reply_comment_id"]} ({location})",
                      f"Authorized request from {thread["author"]}: {thread["trigger_body"]}",
                      "Thread history (context only):", thread["thread_history"], ""])
    return "\n".join(lines)


def validate_decision(value: object, threads: list[dict]) -> dict:
    """Require one explicit, complete response for each authorized request."""
    if (not isinstance(value, dict)
            or set(value) != {"ready", "commit_message", "pr_body", "replies"}
            or not isinstance(value["ready"], bool)
            or not isinstance(value["commit_message"], str) or not value["commit_message"].strip()
            or not isinstance(value["pr_body"], str) or not isinstance(value["replies"], list)):
        raise ValueError("Malformed response decision")
    expected = {str(thread["reply_comment_id"]) for thread in threads}
    seen = set()
    for reply in value["replies"]:
        if (not isinstance(reply, dict) or set(reply) != {"comment_id", "reply"}
                or not isinstance(reply["comment_id"], str)
                or reply["comment_id"] not in expected or reply["comment_id"] in seen
                or not isinstance(reply["reply"], str) or not reply["reply"].strip()):
            raise ValueError("Malformed or duplicate reply")
        seen.add(reply["comment_id"])
    if seen != expected:
        raise ValueError("Missing requested replies")
    if not value["ready"]:
        raise ValueError("Response is incomplete: " + json.dumps(value["replies"]))
    return value


def check_body_change(decision: dict, request: dict) -> None:
    """Permit body edits only when an authorized request names the PR description."""
    if not decision["pr_body"] or decision["pr_body"] == request["pr_body"]:
        return
    if not any(re.search(r"\b(pr|pull[ -]request)\b", thread["trigger_body"], re.IGNORECASE)
               and re.search(r"\b(description|body)\b", thread["trigger_body"], re.IGNORECASE)
               for thread in request["threads"]):
        raise ValueError("PR body change was not requested")


def prepare(owner: str, repo: str, pr_number: int, trigger_phrase: str,
            max_responses: int, request: Path) -> None:
    """Freeze authorized requests and the exact PR revision before agent work."""
    threads = filter_actionable(fetch_threads(owner, repo, pr_number), trigger_phrase, max_responses)
    result = run_gh(f"pr view {pr_number} --repo {shlex.quote(owner + "/" + repo)} "
                    "--json headRefOid,headRefName,body")
    result.check_returncode()
    metadata = json.loads(result.stdout)
    head = metadata["headRefOid"]
    branch = metadata["headRefName"]
    if not re.fullmatch(r"[a-f0-9]{40,64}", head):
        raise ValueError("Invalid PR head revision")
    subprocess.run(["git", "check-ref-format", "--branch", branch],
                   capture_output=True, check=True)
    request.parent.mkdir(parents=True, exist_ok=True)
    request.write_text(json.dumps({
        "owner": owner, "repo": repo, "pr": pr_number, "head_sha": head,
        "branch": branch, "pr_body": metadata["body"], "threads": threads,
    }), encoding="utf-8")
    if output := os.environ.get("GITHUB_OUTPUT"):
        with Path(output).open("a", encoding="utf-8") as stream:
            stream.write(f"has_work={str(bool(threads)).lower()}\nhead_sha={head}\n")


def write_json(path: Path, value: dict) -> None:
    """Replace reserved outputs without following an agent-created symlink."""
    path.unlink(missing_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")


def apply(request: dict, artifacts: Path, attempts: int, timeout: int) -> None:
    """Recover fresh Codex sessions and independently verify the resulting files."""
    artifacts.mkdir(parents=True, exist_ok=True)
    manifest = artifacts / "verified_changes.json"
    manifest.unlink(missing_ok=True)
    try:
        if verification.changed_files() or verification.git("rev-parse", "HEAD").strip() != request["head_sha"]:
            raise ValueError("Response requires the clean prepared PR revision")
        if not os.environ.get("NVIDIA_API_KEY"):
            raise ValueError("NVIDIA_API_KEY is required")
        schema = artifacts / "reply_schema.json"
        schema.write_text(REPLY_SCHEMA, encoding="utf-8")
        build_environment = agent_runner.reviewer_build_environment(artifacts)
        environment = {key: value for key, value in os.environ.items()
                       if key not in {"GH_TOKEN", "GITHUB_TOKEN", "ANTHROPIC_API_KEY"}}
        prompt = build_prompt(request["threads"], request["pr"], request["pr_body"])
        deadline = time.monotonic() + timeout
        feedback = "Address the authorized requests."
        for number in range(1, attempts + 1):
            if time.monotonic() >= deadline:
                break
            write_json(artifacts / "checkpoint.json", {
                "attempt": number, "feedback": feedback, "changed_files": verification.changed_files(),
            })
            output = artifacts / f"response-{number}.json"
            output.unlink(missing_ok=True)
            result = agent_runner.run_agent(
                agent_runner.codex_command(artifacts, schema, output, build_environment),
                prompt + f"\nCheckpoint: {artifacts / "checkpoint.json"}\n"
                + f"Fresh session; preserve useful edits. Latest outcome: {feedback[-4000:]}\n",
                artifacts / f"attempt-{number}", min(900, deadline - time.monotonic()),
                "codex", env=environment)
            patch = artifacts / f"attempt-{number}.patch"
            patch.unlink(missing_ok=True)
            verification.save_patch(patch)
            if not result.successful:
                feedback = f"{result.reason}: {result.summary}"
                if not result.recoverable:
                    break
                continue
            try:
                decision = validate_decision(json.loads(output.read_text(encoding="utf-8")), request["threads"])
                check_body_change(decision, request)
                if time.monotonic() >= deadline:
                    raise TimeoutError("Response time budget exhausted")
                paths = verification.changed_files()
                verification.check_change_scope(paths)
                before = verification.fingerprint(paths)
                if any(Path(name).suffix not in {".md", ".rst"} for name in paths):
                    checks = artifacts / f"verify-{number}"
                    checks.mkdir()
                    verification.verify([], checks, request["head_sha"],
                                        int(deadline - time.monotonic()), build_environment)
                if (verification.git("rev-parse", "HEAD").strip() != request["head_sha"]
                        or before != verification.fingerprint(verification.changed_files())):
                    raise ValueError("Files or baseline changed during verification")
                write_json(manifest, {"verified": True, "base_commit": request["head_sha"],
                                      "files": before})
                write_json(artifacts / "result.json", decision)
                return
            except (OSError, ValueError, RuntimeError, TimeoutError, subprocess.CalledProcessError) as error:
                feedback = str(error)
                logger.warning("Attempt %d failed: %s", number, feedback)
        raise RuntimeError(f"Response did not complete: {feedback}")
    except (OSError, ValueError, RuntimeError, TimeoutError, subprocess.CalledProcessError) as error:
        manifest.unlink(missing_ok=True)
        write_json(artifacts / "result.json", {"error": str(error)})
        raise


def commit_and_push(files: list[str], message: str, branch: str) -> bool:
    """Commit verified paths and retry transient pushes without merging new changes."""
    try:
        for command in (["git", "reset", "HEAD"],
                        ["git", "--literal-pathspecs", "add", "--", *files],
                        ["git", "config", "user.name", "testbot[bot]"],
                        ["git", "config", "user.email", "testbot[bot]@users.noreply.github.com"]):
            subprocess.run(command, check=True, capture_output=True)
        subprocess.run(["git", "commit", "-F", "-"], input=message, text=True, check=True)
        run_gh("auth setup-git --hostname github.com").check_returncode()
    except (OSError, subprocess.CalledProcessError) as error:
        logger.error("Commit/authentication failed: %s", error)
        return False
    for attempt in range(1, MAX_PUSH_RETRIES + 1):
        result = subprocess.run(["git", "push", "origin", f"HEAD:refs/heads/{branch}"],
                                capture_output=True, text=True, check=False)
        if result.returncode == 0:
            return True
        logger.warning("Push attempt %d failed: %s", attempt, result.stderr[:500])
        if any(reason in result.stderr.lower() for reason in (
                "gh013", "gh006", "non-fast-forward", "fetch first", "[rejected]",
                "permission denied", "authentication failed", "403", "401")):
            break
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
        f"-f body={shlex.quote(message)}"
    )
    if result.returncode != 0:
        logger.error(
            "Failed to post reply to comment %s: %s",
            reply_comment_id, result.stderr[:300],
        )
        return False
    return True


def publish(request: dict, artifacts: Path) -> None:
    """Publish verified writes before reporting success to the requesting threads."""
    failure = ""
    replies = {}
    try:
        if os.environ.get("TESTBOT_APPLY_OUTCOME") != "success":
            raise ValueError("Apply stage did not succeed")
        decision = validate_decision(json.loads((artifacts / "result.json").read_text(encoding="utf-8")),
                                     request["threads"])
        check_body_change(decision, request)
        if verification.git("rev-parse", "HEAD").strip() != request["head_sha"]:
            raise ValueError("PR revision changed after preparation")
        files = verification.load_verified_changes(artifacts / "verified_changes.json")
        current = run_gh(f"pr view {request["pr"]} --repo {shlex.quote(request["owner"] + "/" + request["repo"])} "
                         "--json headRefOid,headRefName,body")
        current.check_returncode()
        metadata = json.loads(current.stdout)
        if (not isinstance(metadata, dict) or metadata.get("headRefOid") != request["head_sha"]
                or metadata.get("headRefName") != request["branch"]):
            raise ValueError("PR head or branch changed; rerun the response")
        if (decision["pr_body"] and decision["pr_body"] != request["pr_body"]
                and metadata.get("body") != request["pr_body"]):
            raise ValueError("PR description changed; rerun the response")
        if files and not commit_and_push(files, sanitize_commit_message(decision["commit_message"]), request["branch"]):
            raise RuntimeError("Could not push verified changes")
        if decision["pr_body"] and decision["pr_body"] != request["pr_body"]:
            run_gh(f"api --method PATCH repos/{request["owner"]}/{request["repo"]}/pulls/{request["pr"]} "
                   f"-f body={shlex.quote(decision["pr_body"])}").check_returncode()
        replies = {reply["comment_id"]: reply["reply"] for reply in decision["replies"]}
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        failure = str(error)
        logger.error("Response publication failed: %s", failure)
    reply_failed = False
    for thread in request["threads"]:
        message = ("I could not finish this request. See the workflow logs and retry.\n\n"
                   + ERROR_REPLY_MARKER) if failure else (
                       replies[str(thread["reply_comment_id"])].replace(ERROR_REPLY_MARKER, "")
                       + f"\n\n<!-- testbot-request: {thread["reply_comment_id"]} -->")
        if not reply_to_comment(request["owner"], request["repo"], request["pr"], thread, message):
            reply_failed = True
    if failure or reply_failed:
        raise RuntimeError(failure or "Reply publication failed")


def main() -> None:
    """Keep GitHub credentials in preparation and publication stages."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage", choices=("prepare", "apply", "publish"), required=True)
    parser.add_argument("--pr-number", type=int, required=True)
    parser.add_argument("--request", type=Path, required=True)
    parser.add_argument("--artifacts", type=Path, required=True)
    parser.add_argument("--trigger-phrase", default="/testbot")
    parser.add_argument("--max-responses", type=int, default=10)
    parser.add_argument("--attempts", type=int, default=3)
    parser.add_argument("--timeout", type=int, default=1800)
    args = parser.parse_args()
    request_path, artifacts = args.request.resolve(), args.artifacts.resolve()
    if (request_path.is_relative_to(Path.cwd()) or request_path.is_relative_to(artifacts)
            or artifacts.is_relative_to(Path.cwd())):
        raise ValueError("Request and artifacts must be outside the checkout and separate")
    if min(args.attempts, args.timeout, args.max_responses) <= 0:
        raise ValueError("Budgets must be positive")
    if args.stage == "prepare":
        owner, repo = os.environ.get("GITHUB_REPOSITORY", "NVIDIA/OSMO").split("/", 1)
        prepare(owner, repo, args.pr_number, args.trigger_phrase, args.max_responses, request_path)
        return
    request = json.loads(request_path.read_text(encoding="utf-8"))
    if request["pr"] != args.pr_number:
        raise ValueError("Prepared PR differs from the requested PR")
    if args.stage == "apply":
        apply(request, artifacts, args.attempts, args.timeout)
    else:
        publish(request, artifacts)


if __name__ == "__main__":
    main()
