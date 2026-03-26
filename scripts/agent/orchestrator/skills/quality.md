<!--
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
-->

# Skill: Quality

Validation is a HARD GATE. You cannot declare success without it. If you made code changes but can't validate them, you are **blocked**, not done.

## Discover Before Validating

During the Discovery phase, you should have identified how this repo validates code. Use whatever you found.

**Use the repo's tooling, not your own.** If the repo's tooling doesn't work, fix it or report blocked — don't substitute your own.

## Fallbacks (When Repo Has No Tooling)

See `/osmo/agent/skills/discovery-quality-fallbacks.md` for language/build-system defaults.

## When to Validate

- After modifying code, before committing: run the quick check
- After pulling a child's changes: run the full check on the combined state
- Before declaring the entire task done: run the full check. No exceptions.

"I'll validate later" is not acceptable. Validate as you go. The longer you wait, the harder it is to find what broke.

## When You Can't Run Validation

If a tool is blocked, unavailable, or broken:
1. **Do NOT declare success.** You are blocked, not done.
2. Report exactly what validation you couldn't run and why.
3. List what commands need to be run manually.
4. Exit with a non-zero status so the orchestrator knows you're not finished.

An agent that changes files and says "done" without running tests is worse than one that says "blocked — couldn't run tests." The first creates false confidence. The second is honest.

After running quality gates, write `/tmp/quality-verified.json` with what you ran and the results. The harness will not let you finish without this file.

## When Validation Fails

1. Read the error output carefully
2. Fix the issue yourself if you can
3. If you can't fix it after a reasonable attempt:
   - Revert: `git revert --no-edit HEAD && git push`
   - Ask a human (see `human-interaction.md`)
   - Try a different approach

Don't keep retrying the same approach. If it failed twice with similar errors, the approach is wrong.
