<!--
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
-->

# Skill: Quality

Read this when you need to validate your work.

## Discover Before Validating

During the Discovery phase, you should have identified how this repo validates code. Use whatever you found:

- Repo-specific scripts (e.g., `scripts/agent/quality-gate.sh`, `make test`, `npm run lint`)
- CI config commands (from `.github/workflows/`, `.gitlab-ci.yml`)
- Package scripts (from `package.json` scripts section)
- Makefile targets

**Prefer repo-specific tooling** over generic checks. If the repo has a quality gate script, it was built for this codebase and knows things you don't.

## Fallbacks (When Repo Has No Tooling)

| Language | Quick check | Full check |
|----------|------------|------------|
| Python | `python -m py_compile <file>` | `python -m pytest` (if tests exist) |
| Go | `go vet ./...` | `go test ./...` |
| TypeScript | `npx tsc --noEmit` | `npm test` (if configured) |
| Rust | `cargo check` | `cargo test` |
| Generic | syntax check the changed files | run whatever tests exist |

## When to Validate

- After modifying code, before committing: at minimum run the quick check
- After pulling a child's changes: verify the combined state is healthy
- Before declaring the entire task done: run the full check

Use your judgment on frequency. Don't skip validation entirely, but don't run the full test suite after every single file edit either.

## When Validation Fails

1. Read the error output carefully
2. Fix the issue yourself if you can
3. If you can't fix it after a reasonable attempt:
   - Revert: `git revert --no-edit HEAD && git push`
   - Ask a human (see `human-interaction.md`)
   - Try a different approach

Don't keep retrying the same approach. If it failed twice with similar errors, the approach is wrong.
