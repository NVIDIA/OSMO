# Testbot: AI-Powered Test Generation

Testbot analyzes coverage gaps, generates tests using Claude Code, validates them, and opens PRs for human review. It also responds to inline review comments via `/testbot`.

## Architecture

### Test Generation (`testbot.yaml`)

```text
Codecov API ──┐
              ├─► criticality_scorer.py ──► select_targets_agent.py ──► Claude Code CLI ──► guardrails ──► create_pr.py
git log ──────┤    (heuristic shortlist)       (LLM target picker)         |          ↑
filesystem ───┘                                                            └──────────┘ (agent retries on test failures)
```

| Stage | Component | Description |
|-------|-----------|-------------|
| **Stage 1: Heuristic** | `criticality_scorer.py` | Combines Codecov coverage with static fan-in (Python AST + Go scan), 6-month git churn, and a path-tier classification to rank candidates by `criticality * coverage_gap`. Outputs a top-20 JSON shortlist. |
| **Stage 2: LLM picker** | `select_targets_agent.py` + `SELECT_TARGETS_PROMPT.md` | A read-only Claude Code subagent (`Read,Glob,Grep` only) reads each candidate, rejects hard-to-test infra glue, and picks the 1-3 files where unit tests would have the highest ROI. Can return zero picks if nothing meets the bar. |
| **Test generation** | Claude Code CLI | Reads source, writes test files and BUILD entries, runs tests, iterates on failures |
| **Guardrails** | `guardrails.py` | Filters out any non-test file changes made by Claude |
| **PR creation** | `create_pr.py` | Creates branch, commits test files, pushes, opens PR with `ai-generated` label. Reads the picker's `targets_meta.json` sidecar and renders a "Why this file was targeted" section so reviewers see the rationale alongside the test diff. |

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
| **Trigger** | Comment starting with `/testbot` on any PR with the `ai-generated` label |
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
  -f max_uncovered=500 \
  -f max_turns=100 \
  -f model=aws/anthropic/bedrock-claude-opus-4-7
```

### Schedule

Runs automatically on weekdays at 6 AM UTC.

### Review response

Add the `ai-generated` label to your PR, then start an inline review comment with `/testbot <instruction>`. The command must be the first text in the comment. Examples:

```text
/testbot add unit tests for this file
/testbot fix this based on the CodeRabbit suggestion above
/testbot rename test methods to follow test_<behavior>_<condition> convention
/testbot refactor this function to reduce duplication
```

The bot responds only to repo members (OWNER, MEMBER, COLLABORATOR). It will not respond to its own replies or comments from bots.

### Reverting a testbot commit

If the bot's commit isn't what you wanted, revert it and retry:

```bash
git pull && git revert HEAD --no-edit && git push
```

Then post a new `/testbot` comment with clearer instructions.

## Configuration

### Test generation (dispatch inputs)

| Input | Default | Description |
|-------|---------|-------------|
| `max_targets` | `1` | Files to target per run |
| `max_uncovered` | `500` | Uncovered lines cap per target (0 = no cap) |
| `max_turns` | `100` | Claude Code agent turns |
| `timeout_minutes` | `30` | Workflow timeout |
| `model` | `aws/anthropic/bedrock-claude-opus-4-7` | LLM model on API gateway |
| `dry_run` | `false` | Generate without creating PR |

### Review response (CLI args in `testbot-respond.yaml`)

| Arg | Default | Description |
|-----|---------|-------------|
| `--max-turns` | `200` | Claude Code agent turns |
| `--max-responses` | `10` | Max threads to address per trigger |
| `--timeout` | `720` | Claude Code CLI timeout in seconds |
| `--model` | `aws/anthropic/bedrock-claude-opus-4-7` | LLM model |

### Coverage target selection

The selector runs in two stages. Tunables live in `criticality_scorer.py`
(Stage 1) and `select_targets_agent.py` (Stage 2).

**Stage 1 — heuristic (`criticality_scorer.py`):**

| Constant | Value | Description |
|----------|-------|-------------|
| `TIER_PREFIXES` | `lib/`, `utils/`, `runtime/pkg/` = 0; `service/core/` = 1; `cli/`, `runtime/cmd/` = 2; supporting services + `operator/` = 3 | Path-prefix tier (lower = more critical). |
| `Weights` | tier=1.0, fan_in=2.5, churn=0.8 | Default weights for the criticality score. fan_in dominates because dependency centrality is the most durable signal — a hub stays a hub for years, while coverage and churn shift week to week. |
| `CHURN_SINCE` | `6 months ago` | Window for the `git log` churn count. |
| `MIN_LOC` | `30` | Skip files smaller than this — too small to give useful coverage gain. |
| `--shortlist-size` | `20` | Number of candidates handed to the Stage-2 picker. |

Score formula (per file):

```
criticality   =   w_tier   · (DEFAULT_TIER − tier)
                + w_fan_in · log(fan_in + 1) / log(max_fan_in + 1)
                + w_churn  · log(churn  + 1) / log(max_churn  + 1)

coverage_gap  =   (1 − coverage_pct / 100)
                × log(min(uncovered_lines, 500) + 1)

score         =   criticality × coverage_gap
```

Each term:

| Term | Meaning | Range with defaults |
|------|---------|---------------------|
| `w_tier · (DEFAULT_TIER − tier)` | Path-prefix bonus. `DEFAULT_TIER = 4`, so `lib/`/`utils/`/`runtime/pkg/` (tier 0) get +4.0 here, fall-through paths (tier 4) get 0. | `[0, 4.0]` |
| `w_fan_in · log_norm(fan_in)` | Log-normalized reverse-import count. `log_norm(x) = log(x+1)/log(peak+1)` lives in `[0, 1]`, so this term saturates at `w_fan_in` for the most-imported file in the corpus. | `[0, 2.5]` |
| `w_churn · log_norm(churn)` | Log-normalized commit count over the last 6 months, same shape as `fan_in`. | `[0, 0.8]` |
| `(1 − coverage_pct/100)` | Linear coverage gap. A 10%-covered file scales the criticality 9× more than a 90%-covered one. | `[0, 1.0]` |
| `log(min(uncovered, 500) + 1)` | Log-scaled uncovered surface area. Cap means a 5000-line uncovered file doesn't dwarf a 500-line one infinitely. | `[0, log(501) ≈ 6.22]` |

Why **multiplication**, not addition: a perfectly-covered hub scores `0` (nothing to test) and a 0%-covered trivial file scores low (criticality term is small). Both signals must be present for a file to rank high.

Why **log normalization** on `fan_in` and `churn`: without it, OSMO's `lib/utils/common.py` (fan_in=222) would single-handedly drown out everything else. With it, each of those two terms is bounded at its weight.

Used together with the existing `IGNORE_PATTERNS` /
`SKIP_BASENAME_PATTERNS` from `coverage_targets.py` plus extra skips for
generated barrels and vendored code.

**Stage 2 — LLM picker (`select_targets_agent.py`):**

| Setting | Value | Description |
|---------|-------|-------------|
| `ALLOWED_TOOLS` | `Read,Glob,Grep` | Read-only — the picker can never modify anything. |
| `DEFAULT_MAX_TURNS` | `30` | Hard turn cap for the picker subagent. |
| Output contract | JSON `{targets: [{file_path, reason}]}` in a fenced block | Picker can return `[]` to skip a day. |

The picker rejects heavy I/O glue, long-running orchestration, and SDK-call
delegators where unit-test coverage gain would be shallow. When picks are
made, the rationale is surfaced in the resulting PR description so reviewers
can see *why* a file was chosen.

## File Structure

```text
src/scripts/testbot/
├── coverage_targets.py         # Codecov API client + filtering helpers
├── criticality_scorer.py       # Stage 1: heuristic shortlist (fan-in × churn × tier × coverage gap)
├── select_targets_agent.py     # Stage 2: Claude subagent that picks the best test targets
├── SELECT_TARGETS_PROMPT.md    # System prompt for the Stage-2 picker
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
    ├── test_criticality_scorer.py
    ├── test_guardrails.py
    ├── test_respond.py
    └── test_select_targets_agent.py

.github/workflows/
├── testbot.yaml                    # Scheduled test generation
├── testbot-respond.yaml            # /testbot review response
└── testbot-respond-approve.yaml    # Auto-approve for org members
```
