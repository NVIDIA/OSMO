#!/usr/bin/env python3
"""
OSMO Agent Harness — Uses OpenAI-compatible API (NVIDIA inference endpoint).

Calls Claude via NVIDIA's inference-api.nvidia.com with tool definitions.
Executes tool calls via subprocess/file ops.
No permission system. No restrictions.

Features:
- Context compaction: estimates token usage, summarizes old messages when approaching limit
- Automatic checkpointing: periodic git commit+push to prevent work loss
- System prompt support: separate system message for orchestrator prompt

Usage:
    python3 agent-harness.py --prompt "your task here"
    python3 agent-harness.py --prompt-file /path/to/prompt.txt
    python3 agent-harness.py --system-prompt-file /osmo/agent/orchestrator-prompt.md --prompt "task"
"""

import argparse
import glob as glob_module
import json
import os
import select
import subprocess
import sys
import threading
import time

from openai import OpenAI


# ============================================================
# Tool Definitions (OpenAI function calling format)
# ============================================================

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "Bash",
            "description": "Execute a bash command. Returns stdout and stderr. The harness monitors output to detect progress. NEVER pipe through tail/head/grep — piping buffers ALL output, harness sees nothing, command gets killed.",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {"type": "string", "description": "The bash command to execute"},
                },
                "required": ["command"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "Read",
            "description": "Read a file from the filesystem.",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {"type": "string", "description": "Absolute path to the file"},
                    "offset": {"type": "integer", "description": "Line number to start from (1-indexed)"},
                    "limit": {"type": "integer", "description": "Number of lines to read"},
                },
                "required": ["file_path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "Write",
            "description": "Write content to a file, creating it if it doesn't exist.",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {"type": "string", "description": "Absolute path to the file"},
                    "content": {"type": "string", "description": "Content to write"},
                },
                "required": ["file_path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "Edit",
            "description": "Edit a file by replacing an exact string match.",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {"type": "string", "description": "Absolute path to the file"},
                    "old_string": {"type": "string", "description": "Exact string to find"},
                    "new_string": {"type": "string", "description": "Replacement string"},
                },
                "required": ["file_path", "old_string", "new_string"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "Glob",
            "description": "Find files matching a glob pattern.",
            "parameters": {
                "type": "object",
                "properties": {
                    "pattern": {"type": "string", "description": "Glob pattern (e.g., 'src/**/*.py')"},
                    "path": {"type": "string", "description": "Base directory to search from"},
                },
                "required": ["pattern"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "Grep",
            "description": "Search file contents using a regex pattern.",
            "parameters": {
                "type": "object",
                "properties": {
                    "pattern": {"type": "string", "description": "Regex pattern to search for"},
                    "path": {"type": "string", "description": "Directory or file to search in"},
                    "include": {"type": "string", "description": "File glob to include (e.g., '*.py')"},
                },
                "required": ["pattern"],
            },
        },
    },
]


# ============================================================
# Tool Executors
# ============================================================


# LLM client/model set by run_agent so execute_bash can consult the LLM
_llm_client = None
_llm_model = None

PEEK_INTERVAL = 60  # seconds between LLM progress checks


def execute_bash(command):
    """Execute a bash command. No artificial time limits.

    The LLM monitors progress every PEEK_INTERVAL seconds and decides
    whether to continue or kill. If the LLM client is not available,
    the command runs until it finishes on its own.
    """
    try:
        _progress_history.clear()

        # Start in a new process group so we can kill the entire tree
        process = subprocess.Popen(
            ["bash", "-c", command],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, cwd=os.getcwd(),
            preexec_fn=os.setsid,
        )

        output_lines = []
        start = time.time()
        last_output_time = start
        last_peek_time = start

        while True:
            # Check if process exited
            if process.poll() is not None:
                # Drain remaining output
                for line in process.stdout:
                    clean = line.rstrip()
                    if clean:
                        output_lines.append(clean)
                        sys.stderr.write(f"  | {clean}\n")
                        sys.stderr.flush()
                break

            ready = select.select([process.stdout], [], [], 1.0)[0]
            if ready:
                line = process.stdout.readline()
                if line:
                    clean = line.rstrip()
                    if clean:
                        output_lines.append(clean)
                        sys.stderr.write(f"  | {clean}\n")
                        sys.stderr.flush()
                        last_output_time = time.time()
                elif process.poll() is not None:
                    break

            now = time.time()
            elapsed = now - start

            # LLM progress check
            if _llm_client and now - last_peek_time > PEEK_INTERVAL:
                last_peek_time = now
                silent = int(now - last_output_time)
                recent = output_lines[-30:] if output_lines else [f"(no output for {silent}s)"]
                verdict = _check_progress(command, int(elapsed), recent)
                if verdict == "kill":
                    try:
                        os.killpg(os.getpgid(process.pid), 9)
                    except ProcessLookupError:
                        pass
                    process.wait()
                    sys.stderr.write(f"\n  === KILL: dumping progress snapshots ===\n")
                    for entry in _progress_history:
                        sys.stderr.write(
                            f"  --- {entry['elapsed']}s elapsed ---\n"
                            f"  {entry['snapshot']}\n"
                        )
                    sys.stderr.write(f"  === END snapshots ===\n")

                    has_pipe = "|" in command
                    kill_msg = f"(killed after {int(elapsed)}s — no progress detected."
                    if has_pipe:
                        kill_msg += (
                            " NOTE: This command used a pipe which buffers output "
                            "and prevents progress monitoring. Retry without piping."
                        )
                    kill_msg += ")"
                    output_lines.append(kill_msg)
                    break

        process.wait()

        output = "\n".join(output_lines)
        if process.returncode and process.returncode != 0:
            output += f"\n(exit code: {process.returncode})"
        return output or "(no output)"
    except Exception as e:
        return f"Error: {e}"


_progress_history = []  # list of {"elapsed": int, "line_count": int, "snapshot": str}


def _check_progress(command, elapsed_seconds, recent_lines):
    """Ask the LLM whether a long-running command should continue or be killed.

    Maintains history of prior snapshots. Only allows a kill verdict when
    all 5 snapshot slots are filled — giving the command 5 full intervals
    (5 minutes at 60s) before any kill is possible.
    """
    try:
        snapshot = "\n".join(recent_lines)
        _progress_history.append({
            "elapsed": elapsed_seconds,
            "line_count": len(recent_lines),
            "snapshot": snapshot,
        })

        # Keep only last 5 snapshots
        if len(_progress_history) > 5:
            _progress_history[:] = _progress_history[-5:]

        # Don't even ask until we have 5 snapshots — always continue early
        if len(_progress_history) < 5:
            sys.stderr.write(
                f"  [progress check {len(_progress_history)}/5 at {elapsed_seconds}s: "
                f"continue (collecting snapshots)]\n"
            )
            return "continue"

        # Build context showing all 5 snapshots
        history_parts = []
        for i, entry in enumerate(_progress_history):
            history_parts.append(
                f"--- Snapshot {i + 1} ({entry['elapsed']}s elapsed) ---\n"
                f"{entry['snapshot']}"
            )
        history_text = "\n\n".join(history_parts)

        resp = _llm_client.chat.completions.create(
            model=_llm_model,
            messages=[
                {"role": "system", "content": (
                    "You are monitoring a running command. You see 5 output snapshots "
                    "taken at regular intervals. Reply 'kill' only if ALL 5 show no "
                    "forward progress. Otherwise reply 'continue'. "
                    "One word only: 'continue' or 'kill'."
                )},
                {"role": "user", "content": (
                    f"Command: {command}\n\n{history_text}"
                )},
            ],
            max_tokens=10,
        )
        verdict = resp.choices[0].message.content.strip().lower()
        sys.stderr.write(f"  [progress check 5/5 at {elapsed_seconds}s: {verdict}]\n")
        return "kill" if "kill" in verdict else "continue"
    except Exception as e:
        sys.stderr.write(f"  [progress check failed: {e} — continuing]\n")
        return "continue"


def execute_read(file_path, offset=None, limit=None):
    try:
        with open(file_path, "r") as f:
            lines = f.readlines()
        start = (offset or 1) - 1
        end = start + limit if limit else len(lines)
        selected = lines[start:end]
        numbered = [f"{start + i + 1:>6}|{line.rstrip()}" for i, line in enumerate(selected)]
        return "\n".join(numbered)
    except FileNotFoundError:
        return f"File not found: {file_path}"
    except Exception as e:
        return f"Error: {e}"


def execute_write(file_path, content):
    try:
        os.makedirs(os.path.dirname(file_path) or ".", exist_ok=True)
        with open(file_path, "w") as f:
            f.write(content)
        return f"File written: {file_path}"
    except Exception as e:
        return f"Error: {e}"


def execute_edit(file_path, old_string, new_string):
    try:
        with open(file_path, "r") as f:
            content = f.read()
        if old_string not in content:
            return f"String not found in {file_path}"
        new_content = content.replace(old_string, new_string, 1)
        with open(file_path, "w") as f:
            f.write(new_content)
        return f"File updated: {file_path}"
    except FileNotFoundError:
        return f"File not found: {file_path}"
    except Exception as e:
        return f"Error: {e}"


def execute_glob(pattern, path=None):
    try:
        base = path or os.getcwd()
        matches = sorted(glob_module.glob(os.path.join(base, pattern), recursive=True))
        if not matches:
            return "No files found"
        return "\n".join(matches[:200])
    except Exception as e:
        return f"Error: {e}"


def execute_grep(pattern, path=None, include=None):
    try:
        cmd = ["grep", "-rn", "-E", "--color=never"]
        if include:
            cmd.extend(["--include", include])
        cmd.append(pattern)
        cmd.append(path or os.getcwd())
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if not result.stdout:
            return "No matches found"
        lines = result.stdout.strip().split("\n")
        if len(lines) > 200:
            return "\n".join(lines[:200]) + f"\n... ({len(lines)} total, truncated)"
        return result.stdout.strip()
    except subprocess.TimeoutExpired:
        return "Grep timed out"
    except Exception as e:
        return f"Error: {e}"


def execute_tool(name, args_json):
    args = json.loads(args_json) if isinstance(args_json, str) else args_json
    if name == "Bash":
        return execute_bash(args["command"])
    elif name == "Read":
        return execute_read(args["file_path"], args.get("offset"), args.get("limit"))
    elif name == "Write":
        return execute_write(args["file_path"], args["content"])
    elif name == "Edit":
        return execute_edit(args["file_path"], args["old_string"], args["new_string"])
    elif name == "Glob":
        return execute_glob(args["pattern"], args.get("path"))
    elif name == "Grep":
        return execute_grep(args["pattern"], args.get("path"), args.get("include"))
    else:
        return f"Unknown tool: {name}"


# ============================================================
# Context Compaction
# ============================================================

# Rough estimate: ~4 chars per token for English + code
CHARS_PER_TOKEN = 4


def estimate_tokens(messages):
    """Estimate token count for a message list."""
    total_chars = 0
    for msg in messages:
        if isinstance(msg.get("content"), str):
            total_chars += len(msg["content"])
        # Tool calls in assistant messages
        if msg.get("tool_calls"):
            for tc in msg["tool_calls"]:
                if isinstance(tc, dict):
                    total_chars += len(tc.get("function", {}).get("arguments", ""))
                else:
                    total_chars += len(tc.function.arguments)
    return total_chars // CHARS_PER_TOKEN


COMPACT_MARKER = "[CONTEXT SUMMARY"


def compact_messages(client, model, messages, keep_recent=6):
    """Rolling compaction: merges prior summary + new messages into a richer summary.

    Each compaction builds on the last, so the summary carries forward the
    full compressed history rather than summarizing a summary (telephone game).
    """
    # Find boundaries
    has_system = messages[0]["role"] == "system" if messages else False
    prefix = messages[:1] if has_system else []
    rest = messages[1:] if has_system else messages

    # Nothing to compact if conversation is small
    if len(rest) <= keep_recent + 2:
        return messages

    # Find safe split point — don't orphan tool results from their tool_use
    split = len(rest) - keep_recent
    while split > 0 and split < len(rest) and rest[split].get("role") == "tool":
        split -= 1

    old_messages = rest[:split]
    recent_messages = rest[split:]

    # Extract prior summary if it exists (from a previous compaction)
    prior_summary = ""
    new_messages = old_messages
    for i, msg in enumerate(old_messages):
        content = msg.get("content", "")
        if isinstance(content, str) and content.startswith(COMPACT_MARKER):
            prior_summary = content
            # Skip the summary message and the "Understood" response after it
            new_messages = old_messages[i + 2:] if i + 2 <= len(old_messages) else []
            break

    # Build digest of new messages (since last compaction)
    new_parts = []
    for msg in new_messages:
        role = msg.get("role", "unknown")
        content = msg.get("content", "")
        if role == "assistant" and msg.get("tool_calls"):
            tool_names = []
            for tc in msg["tool_calls"]:
                if isinstance(tc, dict):
                    tool_names.append(tc.get("function", {}).get("name", "?"))
                else:
                    tool_names.append(tc.function.name)
            new_parts.append(f"[assistant called: {', '.join(tool_names)}]")
            if content:
                new_parts.append(f"[assistant said: {content[:200]}]")
        elif role == "tool":
            new_parts.append(f"[tool result: {content[:150]}...]" if len(
                content) > 150 else f"[tool result: {content}]")
        elif role == "user":
            new_parts.append(f"[user: {content[:300]}]")
        elif role == "assistant":
            new_parts.append(f"[assistant: {content[:300]}]")

    new_text = "\n".join(new_parts)

    # Build the compaction prompt: prior summary + new activity
    if prior_summary:
        compact_input = (
            f"PRIOR SUMMARY (from earlier compaction):\n{prior_summary}\n\n"
            f"NEW ACTIVITY (since that summary):\n{new_text}"
        )
    else:
        compact_input = new_text

    # Ask the model to produce a merged summary
    try:
        compress_response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": (
                    "You are a context compactor. Merge the prior summary with new activity "
                    "into a single, updated working memory. Preserve: (1) what task is being done, "
                    "(2) ALL files modified and how, (3) decisions made, (4) what remains to be done, "
                    "(5) errors encountered and how they were resolved. Be specific about file paths. "
                    "The merged summary must be complete — a future reader should understand the full "
                    "history from this summary alone. Output only the summary, no preamble."
                )},
                {"role": "user", "content": compact_input},
            ],
            max_tokens=4096,
        )
        compact_summary = compress_response.choices[0].message.content
    except Exception as e:
        sys.stderr.write(f"Compaction failed: {e}. Falling back to truncation.\n")
        compact_summary = f"[Compaction failed. Prior summary preserved.]\n{prior_summary}\n\n[Recent activity:]\n{new_text[-2000:]}"

    # Rebuild: system + merged summary + recent
    compacted = prefix + [
        {"role": "user", "content": f"{COMPACT_MARKER} — rolling history]\n\n{compact_summary}"},
        {"role": "assistant", "content": "Understood. I have the full context from the summary. Continuing with the task."},
    ] + recent_messages

    sys.stderr.write(f"Compacted: {len(messages)} messages -> {len(compacted)} messages "
                     f"(~{estimate_tokens(messages)} -> ~{estimate_tokens(compacted)} tokens)\n")
    return compacted


# ============================================================
# Checkpointing
# ============================================================


def checkpoint(commit_prefix="agent", client=None, model=None):
    """Git add + commit + push. Returns True if changes were pushed."""
    try:
        # Check for changes
        status = subprocess.run(
            ["git", "diff", "--stat", "HEAD"],
            capture_output=True, text=True, timeout=10,
        )
        staged = subprocess.run(
            ["git", "diff", "--cached", "--stat"],
            capture_output=True, text=True, timeout=10,
        )
        if not status.stdout.strip() and not staged.stdout.strip():
            # Also check untracked files
            untracked = subprocess.run(
                ["git", "ls-files", "--others", "--exclude-standard"],
                capture_output=True, text=True, timeout=10,
            )
            if not untracked.stdout.strip():
                return False

        subprocess.run(["git", "add", "-A"], capture_output=True, timeout=10)

        # Get diff stat for commit message context
        diff_stat = subprocess.run(
            ["git", "diff", "--cached", "--stat"],
            capture_output=True, text=True, timeout=10,
        ).stdout.strip()

        # Ask the model for a meaningful commit message
        msg = None
        if client and model and diff_stat:
            try:
                resp = client.chat.completions.create(
                    model=model,
                    messages=[
                        {"role": "system",
                            "content": "Write a single-line git commit message (max 72 chars, no prefix, no quotes) summarizing these changes. Be specific about what changed, not generic."},
                        {"role": "user", "content": diff_stat},
                    ],
                    max_tokens=60,
                )
                summary = resp.choices[0].message.content.strip().strip('"\'')
                if summary:
                    msg = f"{commit_prefix}: {summary}"
                    if len(msg) > 120:
                        msg = msg[:117] + "..."
            except Exception as e:
                sys.stderr.write(f"Commit message generation failed: {e}\n")

        if not msg:
            msg = f"{commit_prefix}: checkpoint"

        result = subprocess.run(
            ["git", "commit", "-m", msg],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode != 0:
            return False

        branch = subprocess.run(
            ["git", "branch", "--show-current"],
            capture_output=True, text=True, timeout=10,
        ).stdout.strip()

        push_result = subprocess.run(
            ["git", "push", "origin", branch],
            capture_output=True, text=True, timeout=60,
        )
        if push_result.returncode != 0:
            sys.stderr.write(f"Checkpoint push failed: {push_result.stderr}\n")
            return False

        sys.stderr.write(f"Checkpoint pushed to {branch}\n")
        return True
    except Exception as e:
        sys.stderr.write(f"Checkpoint error: {e}\n")
        return False


# ============================================================
# Agent Loop
# ============================================================

# Compaction thresholds. Two triggers — whichever fires first:
#
# 1. Token count: Claude Opus context is ~200k tokens. Quality degrades well
#    before the hard limit — attention dilution starts around 60-80k. We compact
#    at 40k to keep the model in its sharpest range.
#
# 2. Message count: Even at low token counts, hundreds of messages dilute
#    attention. Tool call/result pairs are high-volume, low-signal after the
#    model has processed them. 100 messages is a reasonable upper bound.
TOKEN_COMPACT_THRESHOLD = 40_000
MESSAGE_COMPACT_THRESHOLD = 100


# ============================================================
# Hard Gates
# ============================================================
# Each gate maps a non-negotiable behavior to an artifact.
# The harness checks for the artifact and blocks the agent
# until it exists. This compensates for prompt-level guardrails
# that the LLM tends to rationalize past.

GATE_ALIGNMENT = "/tmp/environment.json"
GATE_QUALITY = "/tmp/quality-verified.json"


def _check_gates():
    """Check gates that block during execution. Returns list of BLOCKED messages."""
    blockers = []

    # Gate: runtime alignment must happen after discovery, before code changes
    if (os.path.exists(".agent/discovered")
            and not os.path.exists(GATE_ALIGNMENT)):
        blockers.append(
            "BLOCKED: Runtime alignment (Phase 2) is not complete. "
            "/tmp/environment.json does not exist. Read /osmo/agent/skills/preflight.md "
            "and align your runtime before doing any other work."
        )

    return blockers


def _review_quality_claim(quality_json):
    """Independent LLM review of a quality verification claim.

    Called only when the agent claims passed=true. Checks whether the
    verification is legitimate — did it run the right commands, or did
    it substitute easier alternatives to pass?
    """
    if not _llm_client:
        return True  # no client, trust the claim

    quality_gates = ""
    try:
        with open(".agent/discovered/quality-gates.json", "r") as f:
            quality_gates = f.read()
    except FileNotFoundError:
        return True  # no gates to compare against

    try:
        resp = _llm_client.chat.completions.create(
            model=_llm_model,
            messages=[
                {"role": "system", "content": (
                    "You are reviewing a quality verification claim. "
                    "Compare the discovered quality gates with what the agent claims to have run. "
                    "Reply 'accept' if the agent ran the discovered commands (or equivalent). "
                    "Reply 'reject' if the agent substituted different commands to pass "
                    "(e.g., ran pytest instead of bazel test, or skipped commands). "
                    "One word only: 'accept' or 'reject'."
                )},
                {"role": "user", "content": (
                    f"Discovered quality gates:\n{quality_gates}\n\n"
                    f"Agent's verification claim:\n{quality_json}"
                )},
            ],
            max_tokens=10,
        )
        verdict = resp.choices[0].message.content.strip().lower()
        sys.stderr.write(f"  [quality review: {verdict}]\n")
        return "accept" in verdict
    except Exception as e:
        sys.stderr.write(f"  [quality review failed: {e} — accepting]\n")
        return True


def _check_completion_gates():
    """Check gates that block the agent from declaring done.

    Reads the agent's own quality-gates.json (written during discovery) and
    verifies that quality-verified.json references the discovered commands.
    The agent is held to its own discovery — no hardcoded build systems.
    """
    blockers = []

    # Check if quality verification passed — not just that the file exists.
    # When the agent claims passed=true, a separate LLM reviews the findings
    # to catch false positives (e.g., ran pytest instead of bazel test).
    quality_passed = False
    if os.path.exists(GATE_QUALITY):
        try:
            with open(GATE_QUALITY, "r") as f:
                qv_content = f.read()
                qv = json.loads(qv_content)
            if qv.get("passed", False) is True:
                # Second opinion: does the verification look legitimate?
                quality_passed = _review_quality_claim(qv_content)
        except (json.JSONDecodeError, OSError):
            pass

    if not quality_passed:
        # Read the agent's discovered quality gates to include in the message
        quality_gates = ""
        try:
            with open(".agent/discovered/quality-gates.json", "r") as f:
                quality_gates = f.read()
        except FileNotFoundError:
            pass

        if quality_gates:
            blockers.append(
                "BLOCKED: Quality verification required. "
                "During discovery you wrote these quality gates:\n\n"
                f"{quality_gates}\n\n"
                "NEVER substitute different commands to pass verification. "
                "Run exactly what you discovered — these are the repo's gates, not yours to change. "
                "Write /tmp/quality-verified.json with \"passed\": true only when "
                "zero errors and zero warnings. Include actionable findings."
            )
        else:
            blockers.append(
                "BLOCKED: Quality verification required. "
                "Run the repo's quality gates. Write /tmp/quality-verified.json "
                "with \"passed\": true only when zero errors and zero warnings. "
                "Include actionable findings."
            )

    return blockers


def run_agent(client, model, prompt, system_prompt=None,
              checkpoint_interval=10, commit_prefix="agent"):
    """Run the agent loop with context compaction and checkpointing.

    Args:
        client: OpenAI client
        model: Model identifier
        prompt: User prompt (task description + role context)
        system_prompt: System prompt (orchestrator prompt, optional)
        checkpoint_interval: Git checkpoint every N turns (0 to disable)
        commit_prefix: Prefix for checkpoint commit messages
    """
    global _llm_client, _llm_model
    _llm_client = client
    _llm_model = model

    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})

    turn = 0
    last_checkpoint_turn = 0
    quality_history = []  # track quality verification attempts
    turn_start = time.time()
    session_start = turn_start

    while True:
        turn += 1
        now = time.time()
        turn_elapsed = int(now - turn_start)
        session_elapsed = int(now - session_start)
        turn_start = now
        sys.stderr.write(
            f"\n--- Turn {turn} | {session_elapsed}s elapsed | "
            f"last turn {turn_elapsed}s ---\n"
        )

        # Context compaction check (token count OR message count)
        estimated_tokens = estimate_tokens(messages)
        msg_count = len(messages)
        sys.stderr.write(f"Context: ~{estimated_tokens} tokens, {msg_count} messages\n")
        if estimated_tokens > TOKEN_COMPACT_THRESHOLD or msg_count > MESSAGE_COMPACT_THRESHOLD:
            reason = (f"tokens={estimated_tokens}>{TOKEN_COMPACT_THRESHOLD}"
                      if estimated_tokens > TOKEN_COMPACT_THRESHOLD
                      else f"messages={msg_count}>{MESSAGE_COMPACT_THRESHOLD}")
            sys.stderr.write(f"Compacting context ({reason})...\n")
            messages = compact_messages(client, model, messages)

        # Periodic checkpointing
        if checkpoint_interval > 0 and (turn - last_checkpoint_turn) >= checkpoint_interval:
            sys.stderr.write("Periodic checkpoint...\n")
            checkpoint(commit_prefix, client, model)
            last_checkpoint_turn = turn

        # Hard gates: structural enforcement of non-negotiable behaviors.
        # Each gate checks for an artifact. If missing at the right time,
        # injects a BLOCKED message every turn until the agent complies.
        for gate in _check_gates():
            messages.append({"role": "user", "content": gate})

        # API call with exponential backoff (retries forever for transient errors)
        response = None
        attempt = 0
        while True:
            try:
                # Run API call in background thread, heartbeat while waiting
                api_result = {"response": None, "error": None}

                def _call_api():
                    try:
                        api_result["response"] = client.chat.completions.create(
                            model=model,
                            messages=messages,
                            tools=TOOLS,
                        )
                    except Exception as api_err:
                        api_result["error"] = api_err

                thread = threading.Thread(target=_call_api)
                thread.start()
                heartbeat = 0
                while thread.is_alive():
                    thread.join(timeout=30)
                    if thread.is_alive():
                        heartbeat += 1
                        sys.stderr.write(f"  [waiting for API response... {heartbeat * 30}s]\n")

                if api_result["error"]:
                    raise api_result["error"]
                response = api_result["response"]
                break
            except Exception as e:
                attempt += 1
                error_str = str(e)
                status_code = getattr(e, "status_code", None)

                # Non-retryable errors: auth, model not found, bad request
                if status_code in (400, 401, 403, 404, 422):
                    sys.stderr.write(f"API error (non-retryable, {status_code}): {error_str}\n")
                    break

                # Retryable: rate limit, server error, timeout, connection error
                wait = min(2 ** attempt * 5, 300)  # 10s, 20s, 40s, ... capped at 5min
                sys.stderr.write(
                    f"API error (attempt {attempt}): {error_str}\n"
                    f"Retrying in {wait}s...\n"
                )
                time.sleep(wait)

        if response is None:
            sys.stderr.write("API error: non-retryable. Checkpointing and exiting.\n")
            if checkpoint_interval > 0:
                checkpoint(commit_prefix, client, model)
            break

        choice = response.choices[0]
        message = choice.message

        # Print any text content
        if message.content:
            print(message.content, flush=True)

        # Add assistant message to history
        messages.append(message.model_dump())

        # If no tool calls, agent wants to finish — check completion gates
        if not message.tool_calls:
            blockers = _check_completion_gates()
            if blockers:
                # Read current quality file to track what failed this attempt
                attempt_info = ""
                if os.path.exists(GATE_QUALITY):
                    try:
                        with open(GATE_QUALITY, "r") as f:
                            attempt_info = f.read()
                    except OSError:
                        pass
                quality_history.append(attempt_info or "(no quality file written)")

                # Show the LLM its own history so it can reason about progress
                history_text = ""
                if len(quality_history) > 1:
                    history_parts = []
                    for i, entry in enumerate(quality_history):
                        history_parts.append(f"--- Attempt {i + 1} ---\n{entry}")
                    history_text = (
                        "\n\nYour previous quality verification attempts:\n\n"
                        + "\n\n".join(history_parts)
                        + "\n\nCompare these attempts. Are you making progress? "
                        "Are the same errors repeating? Reason about what to try next."
                    )

                for b in blockers:
                    messages.append({"role": "user", "content": b + history_text})
                continue
            sys.stderr.write(f"\nAgent finished after {turn} turns.\n")
            break

        # Execute tool calls
        for tool_call in message.tool_calls:
            fn = tool_call.function
            sys.stderr.write(f"Tool: {fn.name}({fn.arguments[:200]})\n")

            result = execute_tool(fn.name, fn.arguments)
            sys.stderr.write(
                f"  -> {result[:100]}...\n" if len(result) > 100 else f"  -> {result}\n"
            )

            messages.append({
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": result,
            })

        # Check if model wants to stop
        if choice.finish_reason == "stop":
            sys.stderr.write(f"\nAgent stopped after {turn} turns.\n")
            break

    # Final checkpoint
    if checkpoint_interval > 0:
        sys.stderr.write("Final checkpoint...\n")
        checkpoint(commit_prefix, client, model)


# ============================================================
# Main
# ============================================================


def main():
    parser = argparse.ArgumentParser(description="OSMO Agent Harness")
    parser.add_argument("--model", default="us/aws/anthropic/bedrock-claude-opus-4-6",
                        help="Model to use")
    parser.add_argument("--api-key", default=os.environ.get("NV_API_KEY", ""),
                        help="API key (or set NV_API_KEY env var)")
    parser.add_argument("--base-url", default="https://inference-api.nvidia.com",
                        help="API base URL")
    parser.add_argument("--prompt", help="Prompt text")
    parser.add_argument("--prompt-file", help="Read prompt from file")
    parser.add_argument("--system-prompt", help="System prompt text")
    parser.add_argument("--system-prompt-file", help="Read system prompt from file")
    parser.add_argument("--checkpoint-interval", type=int, default=10,
                        help="Git checkpoint every N turns (0 to disable)")
    parser.add_argument("--commit-prefix", default=os.environ.get("COMMIT_PREFIX", "agent"),
                        help="Prefix for checkpoint commits")
    args = parser.parse_args()

    # Read prompt
    if args.prompt_file:
        with open(args.prompt_file) as f:
            prompt = f.read()
    elif args.prompt:
        prompt = args.prompt
    else:
        prompt = sys.stdin.read()

    if not prompt.strip():
        print("Error: no prompt provided", file=sys.stderr)
        sys.exit(1)

    # Read system prompt
    system_prompt = None
    if args.system_prompt_file:
        with open(args.system_prompt_file) as f:
            system_prompt = f.read()
    elif args.system_prompt:
        system_prompt = args.system_prompt

    # API key
    api_key = args.api_key or os.environ.get("NV_API_KEY") or os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("Error: no API key. Set NV_API_KEY or --api-key", file=sys.stderr)
        sys.exit(1)

    client = OpenAI(api_key=api_key, base_url=args.base_url)

    sys.stderr.write(f"Model: {args.model}\n")
    sys.stderr.write(f"Base URL: {args.base_url}\n")
    sys.stderr.write(f"Prompt: {len(prompt)} chars\n")
    if system_prompt:
        sys.stderr.write(f"System prompt: {len(system_prompt)} chars\n")
    sys.stderr.write(f"Checkpoint interval: {args.checkpoint_interval} turns\n")
    sys.stderr.write(f"Tools: {', '.join(t['function']['name'] for t in TOOLS)}\n")
    sys.stderr.write(f"CWD: {os.getcwd()}\n\n")

    run_agent(client, args.model, prompt, system_prompt,
              checkpoint_interval=args.checkpoint_interval,
              commit_prefix=args.commit_prefix)


if __name__ == "__main__":
    main()
