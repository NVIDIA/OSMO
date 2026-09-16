# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Bounded, fresh-session execution of testbot's CLI agents."""

import dataclasses
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import threading
import time


@dataclasses.dataclass
class Attempt:
    """Process and protocol outcomes; an exit code alone is insufficient."""

    returncode: int = -1
    reason: str = 'missing_result'
    summary: str = ''
    turns: int = 0
    compaction_failures: int = 0
    completed: bool = False
    successful: bool = False

    @property
    def recoverable(self) -> bool:
        """Restart bounded operational failures, but not auth/configuration errors."""
        if self.reason == 'launch_failed':
            return False
        detail = f'{self.reason} {self.summary}'.lower()
        if any(word in detail for word in (
                'invalid api key', 'unauthorized', 'authentication', 'permission denied',
                'unknown model', 'model not found', 'credit balance', 'http 401', 'http 403')):
            return False
        return not self.successful


def stop_process_group(process: subprocess.Popen) -> None:
    """Stop the CLI and its tool subprocesses before allowing another session."""
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        pass
    # The leader can exit before a tool subprocess. Kill the entire group.
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    process.wait()


def run_agent(command: list[str], prompt: str, directory: Path, timeout: float,
              backend: str, env: dict[str, str] | None = None) -> Attempt:
    """Capture streams and stop failed compaction immediately, preserving files.

    Every call starts a fresh process/session. The caller supplies recovery
    context from disk rather than resuming an overflowing conversation.
    """
    directory.mkdir(parents=True, exist_ok=True)
    prompt_path = directory / 'prompt.md'
    prompt_path.write_text(prompt, encoding='utf-8')
    attempt = Attempt()
    compact_failed = threading.Event()
    read_failed = threading.Event()
    assistant_ids: set[str] = set()

    def consume(stream, log) -> None:
        try:
            for line in stream:
                log.write(line)
                log.flush()
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(event, dict):
                    continue
                if backend == 'claude':
                    if event.get('compact_result') == 'failed':
                        attempt.compaction_failures += 1
                        attempt.summary = str(event.get('compact_error', 'Compaction failed'))
                        compact_failed.set()
                    if event.get('type') == 'assistant':
                        message_id = event.get('message', {}).get('id')
                        if message_id:
                            assistant_ids.add(message_id)
                    if event.get('type') == 'result':
                        attempt.completed = True
                        attempt.reason = str(event.get('terminal_reason') or event.get('subtype', 'error'))
                        attempt.summary = str(event.get('result', event.get('errors', '')))
                        attempt.turns = int(event.get('num_turns', 0))
                        attempt.successful = (
                            event.get('is_error') is False
                            and event.get('subtype') == 'success'
                            and attempt.reason in ('completed', 'success')
                        )
                else:
                    kind = event.get('type')
                    if kind == 'item.completed' and event.get('item', {}).get('type') == 'agent_message':
                        attempt.summary = event['item'].get('text', '')
                    if kind in ('turn.completed', 'turn.failed'):
                        attempt.completed = True
                        attempt.successful = kind == 'turn.completed'
                        attempt.reason = str(kind)
                        attempt.turns += 1
                    if kind in ('error', 'turn.failed'):
                        attempt.summary = json.dumps(event)
        except (OSError, ValueError, TypeError):
            read_failed.set()

    started = time.monotonic()
    with (prompt_path.open(encoding='utf-8') as stdin,
          (directory / 'stream.jsonl').open('w', encoding='utf-8') as log,
          (directory / 'stderr.log').open('w', encoding='utf-8') as stderr):
        try:
            with subprocess.Popen(command, stdin=stdin, stdout=subprocess.PIPE, stderr=stderr,
                                  text=True, encoding='utf-8', errors='replace', env=env,
                                  start_new_session=True) as process:
                drain = threading.Thread(target=consume, args=(process.stdout, log), daemon=True)
                drain.start()
                interrupted = ''
                while process.poll() is None:
                    if compact_failed.is_set():
                        interrupted = 'compaction_failed'
                        break
                    if time.monotonic() - started >= timeout:
                        interrupted = 'timeout'
                        break
                    compact_failed.wait(timeout=0.1)
                stop_process_group(process)
                drain.join(timeout=5)
                attempt.returncode = process.returncode
                if interrupted:
                    attempt.reason = interrupted
                if interrupted or read_failed.is_set() or drain.is_alive():
                    attempt.successful = False
        except OSError as error:
            attempt.reason = 'launch_failed'
            attempt.summary = str(error)
    if not attempt.turns and backend == 'claude':
        attempt.turns = len(assistant_ids)
    attempt.successful = attempt.successful and attempt.returncode == 0
    (directory / 'result.json').write_text(
        json.dumps(dataclasses.asdict(attempt), indent=2) + '\n', encoding='utf-8')
    return attempt


def reviewer_build_environment(artifacts: Path) -> dict[str, str]:
    """Keep reviewer build writes inside this run's writable artifact directory."""
    cache = artifacts / '.build-cache'
    tools = cache / 'bin'
    tools.mkdir(parents=True, exist_ok=True)
    bazel = shutil.which('bazel')
    if bazel:
        settings = cache / 'bazelrc'
        output_root = cache / 'output'
        repositories = cache / 'repositories'
        disk = cache / 'disk'
        settings.write_text(
            f'startup --output_user_root={output_root}\n'
            f'common --repository_cache={repositories}\n'
            f'build --disk_cache={disk}\n', encoding='utf-8')
        wrapper = tools / 'bazel'
        settings_argument = '--bazelrc=' + str(settings)
        wrapper.write_text(
            '#!/usr/bin/env python3\nimport os, sys\n'
            f'os.execv({bazel!r}, [{bazel!r}, {settings_argument!r}, '
            '*sys.argv[1:]])\n', encoding='utf-8')
        wrapper.chmod(0o755)
    return {
        'PATH': str(tools) + os.pathsep + os.environ.get('PATH', ''),
        'BAZELISK_HOME': str(cache / 'bazelisk'),
        'XDG_CACHE_HOME': str(cache / 'xdg'),
    }


def codex_command(artifacts: Path, schema: Path, output: Path) -> list[str]:
    """Use the NVIDIA Responses endpoint; credentials stay out of argv/config."""
    return [
        'npx', '--yes', '@openai/codex@0.154.0',
        '-a', 'never', 'exec', '--ignore-user-config', '--ephemeral', '--json',
        '--sandbox', 'workspace-write', '--add-dir', str(artifacts),
        '--output-schema', str(schema), '--output-last-message', str(output),
        '-c', 'model_provider="nvidia"',
        '-c', 'model="azure/openai/gpt-6-astra"',
        '-c', 'model_providers.nvidia.name="NVIDIA"',
        '-c', 'model_providers.nvidia.base_url="https://inference-api.nvidia.com/v1"',
        '-c', 'model_providers.nvidia.env_key="NVIDIA_API_KEY"',
        '-c', 'model_providers.nvidia.wire_api="responses"',
        '-c', 'model_providers.nvidia.requires_openai_auth=false',
        '-c', 'model_providers.nvidia.supports_websockets=false',
        '-c', 'sandbox_workspace_write.network_access=true',
        '-c', 'shell_environment_policy.exclude=["NVIDIA_API_KEY", "ANTHROPIC_API_KEY", '
              '"GH_TOKEN", "GITHUB_TOKEN"]',
        '-',
    ]
