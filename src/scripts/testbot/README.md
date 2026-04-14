# Testbot: AI-Powered Test Generation

Testbot analyzes coverage gaps, generates tests using Claude Code, validates them, and opens PRs for human review. It also responds to inline review comments via `/testbot`.

## Architecture

### Test Generation (`testbot.yaml`)

```text
Codecov API → coverage_targets.py → Claude Code CLI → guardrails → create_pr.py
                                      |         ↑
                                      └─────────┘ (agent retries on test failures)
```

| Stage | Component | Description |
|-------|-----------|-------------|
| **Coverage analysis** | `coverage_targets.py` | Fetches Codecov report, selects lowest-coverage files |
| **Test generation** | Claude Code CLI | Reads source, writes test files and BUILD entries, runs tests, iterates on failures |
| **Guardrails** | `guardrails.py` | Filters out any non-test file changes made by Claude |
| **PR creation** | `create_pr.py` | Creates branch, commits test files, pushes, opens PR with `ai-generated` label |

Claude Code is sandboxed: it can only read files, edit test files, and run test commands (`bazel test`, `pnpm test`). It cannot run `git`, `gh`, or modify source code. All git and GitHub operations are in deterministic harness scripts.

### Review Response (`testbot-respond.yaml`)

```text
/testbot comment → respond.py
  ├─ fetch all thread comments (GraphQL)
  ├─ filter: trigger phrase, author, dedup
  ├─ Claude Code CLI: read files, apply fix, run tests
  ├─ respond.py: git commit + push
  ├─ structured reply via --json-schema
  └─ post inline reply to each thread
```

| Feature | Description |
|---------|-------------|
| **Trigger** | Comment starting with `/testbot` on inline review threads of `ai-generated` PRs |
| **Thread context** | Full conversation history (all nested comments) passed to Claude |
| **Structured output** | `--json-schema` returns per-thread replies and commit message |
| **Safety** | Repo-member-only access, crash recovery, push retry |
| **Dedup** | Skips threads where the bot already replied and is awaiting human follow-up |

### Security Boundary

|  | Claude Code | Harness scripts |
|---|---|---|
| Read source files | Yes | — |
| Write/edit test files | Yes | — |
| Run `bazel test` / `pnpm test` | Yes | — |
| Run `git` commands | **No** | `create_pr.py`, `respond.py` |
| Run `gh` commands | **No** | `create_pr.py`, `respond.py` |
| Filter non-test changes | — | `guardrails.py` |

## Triggering on GitHub

### Manual dispatch

**Actions → Testbot → Run workflow**, or via CLI:

```bash
gh workflow run testbot.yaml --ref <branch> \
  -f max_targets=1 \
  -f max_uncovered=300 \
  -f max_turns=50 \
  -f model=aws/anthropic/claude-opus-4-5
```

### Schedule

Runs automatically on weekdays at 6 AM UTC.

### Review response

Start an inline review comment with `/testbot <instruction>` on any `ai-generated` PR. The command must be the first text in the comment. Examples:

```text
/testbot rename test methods to follow test_<behavior>_<condition> convention
/testbot add edge case tests for empty input
/testbot remove the redundant tests for preset labels
```

The bot responds only to repo members (OWNER, MEMBER, COLLABORATOR). It will not respond to its own replies or comments from bots.

## Configuration

### Test generation (dispatch inputs)

| Input | Default | Description |
|-------|---------|-------------|
| `max_targets` | `1` | Files to target per run |
| `max_uncovered` | `300` | Uncovered lines cap per target (0 = no cap) |
| `max_turns` | `50` | Claude Code agent turns |
| `timeout_minutes` | `30` | Workflow timeout |
| `model` | `aws/anthropic/claude-opus-4-5` | LLM model on API gateway |
| `dry_run` | `false` | Generate without creating PR |

### Review response (CLI args in `testbot-respond.yaml`)

| Arg | Default | Description |
|-----|---------|-------------|
| `--max-turns` | `50` | Claude Code agent turns |
| `--max-responses` | `10` | Max threads to address per trigger |
| `--timeout` | `720` | Claude Code CLI timeout in seconds |
| `--model` | `aws/anthropic/claude-opus-4-5` | LLM model |

### Coverage target selection (constants in `coverage_targets.py`)

| Constant | Value | Description |
|----------|-------|-------------|
| `MIN_FILE_LINES` | `10` | Skip files smaller than this |
| `MAX_FILE_LINES` | `0` | Skip files larger than this (0 = no cap) |

## File Structure

```text
src/scripts/testbot/
├── coverage_targets.py         # Codecov API → select low-coverage targets
├── create_pr.py                # Branch, commit, push, open PR
├── guardrails.py               # Test-file-only filter, shared by all scripts
├── respond.py                  # Review response: Claude Code CLI + GitHub API
├── TESTBOT_RULES.md            # Shared test quality rules and conventions
├── TESTBOT_PROMPT.md           # Prompt for generate workflow (coverage targets)
├── TESTBOT_RESPOND_PROMPT.md   # Prompt for respond workflow (review feedback)
├── README.md                   # This file
└── tests/
    ├── test_coverage_targets.py
    ├── test_create_pr.py
    ├── test_guardrails.py
    └── test_respond.py

.github/workflows/
├── testbot.yaml                    # Scheduled test generation
├── testbot-respond.yaml            # /testbot review response
└── testbot-respond-approve.yaml    # Auto-approve for org members
```
