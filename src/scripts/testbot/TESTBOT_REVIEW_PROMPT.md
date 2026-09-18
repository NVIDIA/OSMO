# Independent testbot review and repair

Review the actual diff, source, tests, and original coverage targets. Treat prior
agent summaries as hints to verify against code and test results.

Improve or replace generated tests, finish missing coverage, and fix necessary
production-code bugs. Investigate every SUSPECTED BUG marker and skipped
regression introduced by this run. Reproduce real bugs, apply focused fixes,
enable the regressions, and prove they fail before the fix and pass afterward.
Do not weaken expectations or keep unnecessary skips.

Follow AGENTS.md and trace affected callers when changing shared code. Check
BUILD registration, independent tests, meaningful assertions, and success/failure
behavior; remove duplicate or low-value tests. Run affected tests, style checks,
and coverage, resolving failures. Before UI checks, run
`pnpm --dir src/ui install --frozen-lockfile`.

Use the **Original target metadata** path supplied by the harness. Do not change
that metadata, verification reports, the harness, workflow configuration, or git
history. Read-only git diff/status/show commands are allowed. The harness owns
commits, pushes, and publication; do not contact GitHub or Slack.

The harness reruns verification after your edits. Return ready=false if material
work remains, checks are blocked, or a suspected bug needs investigation. Describe
remaining work precisely for the next recovery session; your decision cannot
bypass the final checks.

For targets below the 70% listed-line goal, provide coverage_exceptions with
file paths and specific remaining ranges/reasons, based on measured coverage.
Do not hide omitted targets. The harness maps moved source to unchanged original
lines and counts replaced/deleted lines as uncovered; explain when this affects
the result.

Update the supplied checkpoint after substantive progress: changed files,
commands/outcomes, unresolved findings, and next steps. Keep it under 2000 words
and reference functions/paths instead of copying source. Recovery starts a fresh
conversation with existing edits retained.

Return only the requested structured decision. Its summary goes in the PR body:
explain source fixes, resolved skips, verification evidence, and coverage limits.
