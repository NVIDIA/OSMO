# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Recover test generation, independently review/repair, then verify the diff."""

import argparse
import json
import os
from pathlib import Path
import subprocess
import time

from src.scripts.testbot import agent_runner, coverage_targets, run_summary, verification


GENERATOR_CLI_VERSION = '2.1.116'
ALLOWED_TOOLS = (
    'Read,Edit,Write,Glob,Grep,Bash(cd *),Bash(mv *),Bash(rm *),'
    'Bash(bazel test *),Bash(bazel build *),Bash(bazel coverage *),Bash(bazel query *),'
    'Bash(python *),Bash(python3 *),Bash(pnpm *),Bash(npx vitest *),Bash(npx tsc *),'
    'Bash(./node_modules/.bin/vitest *),Bash(./node_modules/.bin/tsc *)'
)
REVIEW_SCHEMA = {
    'type': 'object',
    'properties': {
        'ready': {'type': 'boolean'},
        'summary': {'type': 'string'},
        'remaining_work': {'type': 'array', 'items': {'type': 'string'}},
        'coverage_exceptions': {
            'type': 'array', 'items': {
                'type': 'object',
                'properties': {'file_path': {'type': 'string'}, 'reason': {'type': 'string'}},
                'required': ['file_path', 'reason'], 'additionalProperties': False,
            },
        },
    },
    'required': ['ready', 'summary', 'remaining_work', 'coverage_exceptions'],
    'additionalProperties': False,
}


def write_json(path: Path, value: object) -> None:
    """Write a durable machine-readable checkpoint."""
    path.write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')


def context(artifacts: Path, feedback: str) -> str:
    """Pass paths and a bounded recovery hint instead of replaying old transcripts."""
    metadata_path = artifacts / 'targets_meta.json'
    checkpoint_path = artifacts / 'checkpoint.md'
    return (
        f'\nOriginal target metadata: {metadata_path}\n'
        f'Checkpoint path: {checkpoint_path}\n'
        f'Prior attempts and validation logs: {artifacts}\n'
        f'Current changed files: {json.dumps(verification.changed_files())}\n'
        f'Latest outcome: {feedback[-4000:]}\n'
        'This is a fresh session. Preserve useful edits already on disk. Read the checkpoint '
        'if present; confirm its claims against source and test results. Inspect only relevant '
        'parts of old logs as needed. Continue unfinished work without repeating broad exploration.\n'
    )


def generate(prompt: str, artifacts: Path, max_turns: int, attempts: int,
             timeout: int) -> agent_runner.Attempt:
    """Recover generation in fresh sessions without splitting the target work queue."""
    deadline = time.monotonic() + timeout
    result = agent_runner.Attempt()
    remaining_turns = max_turns
    feedback = 'Initial generation.'
    for number in range(1, attempts + 1):
        if time.monotonic() >= deadline or remaining_turns <= 0:
            break
        command = [
            'npx', '--yes', f'@anthropic-ai/claude-code@{GENERATOR_CLI_VERSION}', '--print',
            '--model', os.environ['ANTHROPIC_MODEL'], '--output-format', 'stream-json',
            '--verbose', '--allowedTools', ALLOWED_TOOLS, '--max-turns', str(remaining_turns),
        ]
        print(f'Starting generation attempt {number}; {remaining_turns} turns remain.', flush=True)
        started = time.monotonic()
        result = agent_runner.run_agent(
            command, prompt + context(artifacts, feedback), artifacts / f'generate-{number}',
            min(900, deadline - time.monotonic()), 'claude')
        print(json.dumps({'stage': 'generate', 'attempt': number, 'reason': result.reason,
                          'exit_status': result.returncode, 'successful': result.successful}),
              flush=True)
        run_summary.record(artifacts, f'Generation attempt {number}',
                           'passed' if result.successful else 'incomplete', started,
                           f'{result.reason}; {result.turns} turns')
        remaining_turns -= max(1, result.turns)
        verification.save_patch(artifacts / f'generate-{number}.patch')
        verification.retain_generated_tests()
        if result.successful or not result.recoverable:
            break
        feedback = f'Previous generation stopped: {result.reason}. {result.summary}'
    (artifacts / 'generate_summary.md').write_text(result.summary, encoding='utf-8')
    return result


def review_decision(output: Path) -> dict:
    """Validate the response locally even when the endpoint accepts a JSON schema."""
    decision = json.loads(output.read_text(encoding='utf-8'))
    if (not isinstance(decision, dict) or not isinstance(decision.get('ready'), bool)
            or not isinstance(decision.get('summary'), str)
            or not isinstance(decision.get('remaining_work'), list)
            or not all(isinstance(item, str) for item in decision['remaining_work'])
            or not isinstance(decision.get('coverage_exceptions'), list)):
        raise ValueError('Malformed review decision')
    for entry in decision['coverage_exceptions']:
        if (not isinstance(entry, dict) or not isinstance(entry.get('file_path'), str)
                or not isinstance(entry.get('reason'), str) or not entry['reason'].strip()):
            raise ValueError('Malformed coverage exception')
    if not decision['ready'] or decision['remaining_work']:
        raise ValueError('Review incomplete: ' + json.dumps(decision))
    return decision


def review_and_verify(prompt: str, meta: list[dict], artifacts: Path, base_commit: str,
                      attempts: int, review_timeout: int, verification_timeout: int) -> None:
    """Always use independent agent context; allow repairs after failed validation."""
    schema = artifacts / 'review_schema.json'
    write_json(schema, REVIEW_SCHEMA)
    build_environment = agent_runner.reviewer_build_environment(artifacts)
    bazel_wrapper = artifacts / '.build-cache' / 'bin' / 'bazel'
    if bazel_wrapper.exists():
        prompt += (f'\nFor every Bazel command, use this executable: {bazel_wrapper}. '
                   'It keeps build writes in the permitted per-run cache.\n')
    review_seconds = float(review_timeout)
    verification_seconds = float(verification_timeout)
    feedback = 'Review the full proposed change, including incomplete generation.'
    for number in range(1, attempts + 1):
        if review_seconds <= 0 or verification_seconds <= 0:
            break
        output = artifacts / f'review-{number}.json'
        output.unlink(missing_ok=True)
        started = time.monotonic()
        print(f'Starting independent review attempt {number}.', flush=True)
        result = agent_runner.run_agent(
            agent_runner.agent_command(artifacts, schema, output, build_environment),
            prompt + context(artifacts, feedback), artifacts / f'review-{number}',
            min(900, review_seconds), 'codex')
        review_seconds -= time.monotonic() - started
        stage = f'Review attempt {number}'
        verification.save_patch(artifacts / f'review-{number}.patch')
        if not result.successful:
            feedback = f'Reviewer process failed: {result.reason}. {result.summary}'
            run_summary.record(artifacts, stage, 'failed', started, feedback)
            if not result.recoverable:
                break
            continue
        try:
            decision = review_decision(output)
            if json.loads((artifacts / 'targets_meta.json').read_text(encoding='utf-8')) != meta:
                raise ValueError('An agent modified the original target metadata')
            run_summary.record(artifacts, stage, 'passed', started, decision['summary'])
            stage = f'Verification attempt {number}'
            started = time.monotonic()
            checks = artifacts / f'verify-{number}'
            checks.mkdir()
            try:
                reports = verification.verify(meta, checks, base_commit, int(verification_seconds),
                                              build_environment)
            finally:
                verification_seconds -= time.monotonic() - started
            exceptions = {entry['file_path']: entry['reason']
                          for entry in decision['coverage_exceptions']}
            if any(not report['passed'] and report['file_path'] not in exceptions for report in reports):
                raise ValueError(f'Coverage goal missed without reviewed explanation; see {checks}')
            for name in ('coverage_report.json', 'coverage_report.md'):
                (artifacts / name).write_bytes((checks / name).read_bytes())
            summary = decision['summary']
            if exceptions:
                summary += '\n\nCoverage exceptions:\n' + '\n'.join(
                    f'- {name}: {reason}' for name, reason in exceptions.items())
            (artifacts / 'review_summary.md').write_text(summary, encoding='utf-8')
            write_json(artifacts / 'verified_changes.json', {
                'verified': True, 'base_commit': base_commit,
                'files': verification.fingerprint(verification.changed_files()),
            })
            run_summary.record(artifacts, stage, 'passed', started,
                               'Tests, style, BUILD wiring, and fresh coverage checked')
            return
        except (OSError, ValueError, RuntimeError, TimeoutError, subprocess.CalledProcessError) as error:
            feedback = f'{stage} failed: {error}'
            print(feedback[:2000], flush=True)
            run_summary.record(artifacts, stage, 'failed', started, str(error))
    raise RuntimeError(f'Review/verification did not complete within its recovery budget. {feedback}')


def positive(value: str) -> int:
    """Reject invalid budgets before launching agents."""
    number = int(value)
    if number <= 0:
        raise argparse.ArgumentTypeError('must be a positive integer')
    return number


def restore_handoff(artifacts: Path) -> str:
    """Reconstruct the prior job's exact changes on the same clean baseline."""
    if verification.changed_files():
        raise ValueError('Stage handoff requires a clean checkout')
    manifest = json.loads((artifacts / 'handoff.json').read_text(encoding='utf-8'))
    base_commit = verification.git('rev-parse', 'HEAD').strip()
    if manifest['base_commit'] != base_commit:
        raise ValueError('Stage handoff baseline differs from this checkout')
    verification.check_change_scope(list(manifest['files']))
    patch = artifacts / 'final.patch'
    if patch.stat().st_size:
        verification.git('apply', str(patch))
    if manifest['files'] != verification.fingerprint(verification.changed_files()):
        raise ValueError('Stage handoff contents differ from the saved changes')
    return base_commit


def save_handoff(artifacts: Path, base_commit: str) -> None:
    """Preserve binary/new/deleted files and executable modes between runners."""
    verification.save_patch(artifacts / 'final.patch')
    write_json(artifacts / 'handoff.json', {
        'base_commit': base_commit,
        'files': verification.fingerprint(verification.changed_files()),
    })


def main() -> None:
    """Run in a clean CI checkout; keep artifacts outside the repository."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stage', choices=('generate', 'review', 'restore'), required=True)
    parser.add_argument('--targets-meta', type=Path)
    parser.add_argument('--artifacts', type=Path, required=True)
    parser.add_argument('--max-turns', type=positive, default=400)
    parser.add_argument('--attempts', type=positive, default=3)
    parser.add_argument('--generation-timeout', type=positive, default=1800)
    parser.add_argument('--review-timeout', type=positive, default=1200)
    parser.add_argument('--verification-timeout', type=positive, default=900)
    args = parser.parse_args()
    artifacts = args.artifacts.resolve()
    if artifacts.is_relative_to(Path.cwd()):
        raise ValueError('Artifacts must be outside the repository')
    if verification.changed_files():
        raise ValueError('Testbot requires a clean checkout to preserve unrelated user edits')
    artifacts.mkdir(parents=True, exist_ok=True)
    if args.stage in ('review', 'restore'):
        base_commit = restore_handoff(artifacts)
        if args.stage == 'restore':
            verification.load_verified_changes(artifacts / 'verified_changes.json')
            return
        meta = json.loads((artifacts / 'targets_meta.json').read_text(encoding='utf-8'))
    else:
        if any(artifacts.iterdir()):
            raise ValueError('Use an empty artifact directory for each pipeline run')
        if args.targets_meta is None:
            raise ValueError('--targets-meta is required for generation')
        base_commit = verification.git('rev-parse', 'HEAD').strip()
        meta = json.loads(args.targets_meta.read_text(encoding='utf-8'))
        if not isinstance(meta, list):
            raise ValueError('Target metadata must be a list')
        write_json(artifacts / 'targets_meta.json', meta)
    if not meta:
        if args.stage == 'review':
            raise ValueError('Review requires selected targets')
        return
    for target in meta:
        path = Path(target['file_path'])
        if path.is_absolute() or '..' in path.parts or not path.is_file():
            raise ValueError(f'Invalid target path: {path}')
    if args.stage == 'review' and not os.environ.get('NVIDIA_API_KEY'):
        raise ValueError('NVIDIA_API_KEY is required for independent review')
    scripts = Path(__file__).parent
    targets = coverage_targets.format_targets(meta)
    try:
        if args.stage == 'generate':
            prompt = (scripts / 'TESTBOT_PROMPT.md').read_text(encoding='utf-8') + '\n' + (
                scripts / 'TESTBOT_RULES.md').read_text(encoding='utf-8') + '\nCoverage targets:\n' + targets
            generate(prompt, artifacts, args.max_turns, args.attempts, args.generation_timeout)
        else:
            review_prompt = (scripts / 'TESTBOT_REVIEW_PROMPT.md').read_text(encoding='utf-8') + '\n' + targets
            review_and_verify(review_prompt, meta, artifacts, base_commit, args.attempts,
                              args.review_timeout, args.verification_timeout)
    finally:
        save_handoff(artifacts, base_commit)


if __name__ == '__main__':
    main()
