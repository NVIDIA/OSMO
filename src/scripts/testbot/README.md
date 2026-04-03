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
  ├─ guardrails: filter non-test changes
  ├─ respond.py: git commit + push
  ├─ structured reply via --json-schema
  ├─ post inline reply to each thread
  └─ resolve addressed threads (GraphQL)
```

| Feature | Description |
|---------|-------------|
| **Trigger** | `/testbot` in any inline review comment on `ai-generated` PRs |
| **Thread context** | Full conversation history (all nested comments) passed to Claude |
| **Structured output** | `--json-schema` returns per-comment replies with resolve verdict and commit message |
| **Thread resolution** | Resolved via GraphQL mutation after fix is applied |
| **Safety** | Repo-member-only access, test-file-only guardrail, crash recovery, push retry |
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

## Running Locally

### Prerequisites

- Claude Code CLI: `npm install -g @anthropic-ai/claude-code`
- NVIDIA API key from [inference.nvidia.com](https://inference.nvidia.com)
- Codecov token (for test generation only)

Set environment variables:

```bash
export ANTHROPIC_API_KEY=<your-nvidia-nim-key>
export ANTHROPIC_BASE_URL=https://inference-api.nvidia.com
export ANTHROPIC_MODEL=aws/anthropic/claude-opus-4-5
export DISABLE_PROMPT_CACHING=1
export CODECOV_TOKEN=<your-codecov-token>
export GH_TOKEN=<your-github-token>
```

### Generate tests

```bash
# Select coverage targets
python src/scripts/testbot/coverage_targets.py \
  --max-targets 1 \
  --max-uncovered 300 \
  > /tmp/targets.txt

# Run Claude Code to generate and validate tests
TARGETS=$(cat /tmp/targets.txt)
claude -p "$(cat src/scripts/testbot/TESTBOT_PROMPT.md)

Coverage targets:
$TARGETS" \
  --allowedTools "Read,Edit,Write,Bash(bazel:*),Bash(pnpm:*),Bash(cat:*),Glob,Grep" \
  --max-turns 50

# Create PR from generated test files
PYTHONPATH=src/scripts python -m testbot.create_pr
```

### Respond to PR comments

```bash
python src/scripts/testbot/respond.py \
  --pr-number <PR_NUMBER> \
  --trigger-phrase /testbot
```

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

Post `/testbot <instruction>` as an inline review comment on any `ai-generated` PR. Examples:

```
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
| `model` | `aws/anthropic/claude-opus-4-5` | LLM model on NVIDIA gateway |
| `dry_run` | `false` | Generate without creating PR |

### Review response (env vars)

| Env Var | Default | Description |
|---------|---------|-------------|
| `TESTBOT_MAX_TURNS` | `50` | Claude Code agent turns |
| `TESTBOT_MAX_RESPONSES` | `10` | Max threads to address per trigger |
| `ANTHROPIC_MODEL` | `aws/anthropic/claude-opus-4-5` | LLM model |

### Coverage target selection (constants in `coverage_targets.py`)

| Constant | Value | Description |
|----------|-------|-------------|
| `MIN_FILE_LINES` | `10` | Skip files smaller than this |
| `MAX_FILE_LINES` | `0` | Skip files larger than this (0 = no cap) |

## File Structure

```text
src/scripts/testbot/
├── coverage_targets.py    # Codecov API → select low-coverage targets
├── create_pr.py           # Branch, commit, push, open PR
├── guardrails.py          # Test-file-only filter, shared by all scripts
├── respond.py             # Review response: Claude Code CLI + GraphQL
├── TESTBOT_PROMPT.md      # Quality rules and conventions for Claude Code
└── README.md              # This file

.github/workflows/
├── testbot.yaml           # Scheduled test generation
└── testbot-respond.yaml   # /testbot review response
```
