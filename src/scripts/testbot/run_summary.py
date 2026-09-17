# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Persist stage outcomes and render GitHub Actions job summaries."""

import argparse
import html
import json
import os
from pathlib import Path
import time


def record(artifacts: Path, stage: str, outcome: str, started: float, detail: str) -> None:
    """Keep attempt history across jobs, including failures and recovery."""
    event = {'stage': stage, 'outcome': outcome, 'seconds': round(time.monotonic() - started, 1),
             'detail': detail[:2000]}
    with (artifacts / 'events.jsonl').open('a', encoding='utf-8') as output:
        output.write(json.dumps(event) + '\n')
    print(f'{stage}: {outcome} ({event['seconds']}s)', flush=True)


def cell(value: object) -> str:
    """Keep file names and model text from changing the summary table layout."""
    return html.escape(str(value)).replace('|', '&#124;').replace('\n', ' ')[:2000]


def attempt_summary(artifacts: Path, stage: str) -> list[str]:
    """Show only this job's attempts, retaining failures followed by recovery."""
    prefixes = ('Generation ',) if stage == 'generation' else ('Review ', 'Verification ')
    events = artifacts / 'events.jsonl'
    attempts = []
    if events.exists():
        for line in events.read_text(encoding='utf-8').splitlines():
            event = json.loads(line)
            if event['stage'].startswith(prefixes):
                attempts.append(event)
    if not attempts:
        return ['No attempts recorded for this stage.', '']
    lines = ['### Attempts and checks', '',
             '| Attempt | Result | Time | Details |', '|---|---|---:|---|']
    for event in attempts:
        lines.append(f'| {cell(event['stage'])} | {cell(event['outcome'])} | '
                     f'{event['seconds']}s | {cell(event['detail'])} |')
    return lines + ['']


def selection_summary(artifacts: Path) -> list[str]:
    """Show the selection inputs once, before generation starts."""
    metadata = artifacts / 'targets_meta.json'
    if not metadata.exists():
        return ['No target selection was recorded.']
    targets = json.loads(metadata.read_text(encoding='utf-8'))
    if not targets:
        return ['No targets selected; this run has no changes to publish.']
    lines = ['### Selected targets', '',
             '| File | Starting coverage | Uncovered lines |', '|---|---:|---:|']
    for target in targets:
        coverage_pct = target.get('coverage_pct')
        coverage = f'{coverage_pct:.1f}%' if coverage_pct is not None else '—'
        lines.append(f'| `{cell(target['file_path'])}` | {coverage} | '
                     f'{cell(target.get('uncovered_lines', '—'))} |')
    return lines + ['', 'Selection rationale is in the targets artifact.']


def render(artifacts: Path, stage: str, outcome: str, dry_run: bool, pr_url: str = '') -> str:
    """Summarize this stage's results without repeating upstream job summaries."""
    lines = [f'## Testbot: {stage}', '', f'Job result: **{cell(outcome)}**', '']
    if (artifacts / 'skipped.json').exists():
        return '\n'.join(lines + ['No targets selected; nothing to process in this stage.', ''])
    if stage == 'selection':
        lines.extend(selection_summary(artifacts))
    elif stage in ('generation', 'review'):
        lines.extend(attempt_summary(artifacts, stage))
        if stage == 'review':
            if (artifacts / 'verified_changes.json').exists():
                lines.append('Final verification completed.')
            else:
                lines.append('No final verification manifest: publication is blocked.')
            coverage_report = artifacts / 'coverage_report.md'
            if coverage_report.exists():
                lines.extend(['', coverage_report.read_text(encoding='utf-8')])
        lines.extend(['', f'Detailed logs and patches are in the {stage} artifact.'])
    else:
        if pr_url:
            lines.append(f'Created PR: {cell(pr_url)}')
        elif dry_run:
            lines.append('**Dry run:** generated-PR publication is disabled.')
            if outcome == 'success' and (artifacts / 'verified_changes.json').exists():
                lines.append('Verified changes restored successfully.')
        elif outcome == 'success':
            lines.append('No PR URL was reported; see the Create PR step for details.')
        if not (artifacts / 'verified_changes.json').exists():
            lines.append('No final verification manifest: publication is blocked.')
    return '\n'.join(lines) + '\n'


def main() -> None:
    """Write the summary even when an earlier step failed before starting an agent."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifacts', type=Path, required=True)
    parser.add_argument('--stage', choices=('selection', 'generation', 'review', 'publish'),
                        required=True)
    parser.add_argument('--outcome', required=True)
    parser.add_argument('--dry-run', choices=('true', 'false'), default='false')
    parser.add_argument('--pr-url', default='')
    args = parser.parse_args()
    summary = render(args.artifacts, args.stage, args.outcome, args.dry_run == 'true', args.pr_url)
    output = os.environ.get('GITHUB_STEP_SUMMARY')
    if output:
        with Path(output).open('a', encoding='utf-8') as stream:
            stream.write(summary)
    else:
        print(summary)


if __name__ == '__main__':
    main()
