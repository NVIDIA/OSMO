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


def render(artifacts: Path, stage: str, outcome: str, dry_run: bool) -> str:
    """Summarize actual attempts; never infer success from missing evidence."""
    lines = [f'## Testbot: {stage}', '', f'Job result: **{cell(outcome)}**', '',
             'Preflight → Pick targets → Generate tests → Review, repair, and verify → Publish', '']
    metadata = artifacts / 'targets_meta.json'
    if metadata.exists():
        targets = json.loads(metadata.read_text(encoding='utf-8'))
        lines.extend(['### Selected targets', ''])
        lines.extend(f'- `{cell(target['file_path'])}`' for target in targets)
        if not targets:
            lines.append('No targets selected; this run has no changes to publish.')
        lines.append('')
    events = artifacts / 'events.jsonl'
    if events.exists():
        lines.extend(['### Attempts and checks', '',
                      '| Stage | Result | Time | Details |', '|---|---|---:|---|'])
        for line in events.read_text(encoding='utf-8').splitlines():
            event = json.loads(line)
            lines.append(f'| {cell(event['stage'])} | {cell(event['outcome'])} | '
                         f'{event['seconds']}s | {cell(event['detail'])} |')
        lines.append('')
    else:
        lines.extend(['No agent attempts recorded in this job.', ''])
    if (artifacts / 'verified_changes.json').exists():
        lines.append('Final verification completed; publication must match the verified files.')
    elif stage in ('review', 'publish') and not (artifacts / 'skipped.json').exists():
        lines.append('No final verification manifest: publication is blocked.')
    coverage = artifacts / 'coverage_report.md'
    if coverage.exists():
        lines.extend(['', '### Measured coverage', '', coverage.read_text(encoding='utf-8')])
    if dry_run:
        lines.extend(['', '**Dry run:** generated-PR publication is disabled.'])
    lines.extend(['', 'Per-attempt logs, patches, checkpoints, and results are in this run’s artifacts.'])
    return '\n'.join(lines) + '\n'


def main() -> None:
    """Write the summary even when an earlier step failed before starting an agent."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifacts', type=Path, required=True)
    parser.add_argument('--stage', required=True)
    parser.add_argument('--outcome', required=True)
    parser.add_argument('--dry-run', choices=('true', 'false'), default='false')
    args = parser.parse_args()
    summary = render(args.artifacts, args.stage, args.outcome, args.dry_run == 'true')
    output = os.environ.get('GITHUB_STEP_SUMMARY')
    if output:
        with Path(output).open('a', encoding='utf-8') as stream:
            stream.write(summary)
    else:
        print(summary)


if __name__ == '__main__':
    main()
