# Testbot: AI-Powered Test Generation & Review Response

Testbot is a GitHub Actions bot backed by Claude Code that:

1. **Generates tests** for low-coverage files on a weekly schedule (opens PRs for review)
2. **Responds to `/testbot` comments** on any PR labeled `ai-generated` (applies fixes, writes tests, addresses CodeRabbit feedback)

## Using testbot

### Generate workflow — manual dispatch

**Actions → Testbot → Run workflow**, or via CLI:

```bash
gh workflow run testbot.yaml --ref main \
  -f max_targets=1 \
  -f max_uncovered=300 \
  -f max_turns=50 \
  -f model=aws/anthropic/claude-opus-4-5
```

### Respond workflow — /testbot comments

Add the `ai-generated` label to your PR, then post an **inline review comment** (on the "Files changed" tab) starting with `/testbot`. Examples:

```text
/testbot add unit tests for this file
/testbot fix this based on the CodeRabbit suggestion above
/testbot rename test methods to follow test_<behavior>_<condition> convention
/testbot refactor this function to reduce duplication
```

The command must be the **first text** in the comment. Only repo members (OWNER, MEMBER, COLLABORATOR) can trigger the bot. It won't respond to its own replies or to other bots.

**Example threads** showing the bot in action on PR #890:
- [Thread r3126197776](https://github.com/NVIDIA/OSMO/pull/890/changes/40b026ff5eb4cb99d697476a49dead9811a9131b#r3126197776)
- [Thread r3126743347](https://github.com/NVIDIA/OSMO/pull/890/changes/40b026ff5eb4cb99d697476a49dead9811a9131b#r3126743347)

### Reverting a testbot commit

If the bot's commit isn't what you wanted:

```bash
git pull && git revert HEAD --no-edit && git push
```

Then post a new `/testbot` comment with clearer instructions.

## System Architecture

```text
                         ┌──────────────────────────────────┐
                         │        Claude Code CLI           │
                         │  (sandboxed — Read/Edit/Write,   │
                         │   bazel test, pnpm test, gh pr)  │
                         └───────────────┬──────────────────┘
                                         ▲
                                         │ --allowedTools, --json-schema
                                         │
  ┌──────────────────────┐     ┌─────────┴──────────┐     ┌──────────────────┐
  │  GENERATE WORKFLOW   │     │     HARNESS        │     │  RESPOND WORKFLOW │
  │  (testbot.yaml)      │────▶│  Python scripts    │◀────│  (testbot-respond │
  │  Weekly cron         │     │  (git, gh, auth,   │     │   .yaml)          │
  │  or dispatch         │     │   guardrails)      │     │  /testbot comment │
  └──────────┬───────────┘     └─────────┬──────────┘     └──────────┬───────┘
             │                           │                           │
             ▼                           ▼                           ▼
       ┌──────────┐             ┌───────────────┐             ┌──────────┐
       │ Codecov  │             │   git push    │             │  GitHub  │
       │   API    │             │   gh pr ...   │             │  API     │
       └──────────┘             └───────────────┘             └──────────┘
```

The architecture separates **what the LLM can do** (read code, run tests) from **what the harness does** (git, GitHub API, auth, guardrails). The LLM is never trusted with write access to branches or the GitHub API.

## Workflow 1: Generate Tests (`testbot.yaml`)

```text
┌─────────────┐  ┌────────────────────────┐  ┌─────────────────────┐  ┌──────────────┐  ┌────────────┐
│  Trigger    │  │ 1. coverage_targets.py │  │ 2. Claude Code CLI  │  │ 3. guardrails│  │ 4. create_ │
│  weekday    │─▶│   Fetch Codecov        │─▶│   Read source       │─▶│   .py        │─▶│    pr.py   │
│  6 AM UTC   │  │   Pick low-cov file    │  │   Write tests+BUILD │  │   Keep tests │  │   Branch,  │
│  or manual  │  │   Emit target list     │  │   Run bazel test    │  │   only       │  │   commit,  │
└─────────────┘  └────────────────────────┘  │   Retry on fail     │  │   Revert src │  │   open PR  │
                                             └─────────────────────┘  └──────────────┘  └────────────┘
```

**Trigger:** Cron `0 6 * * 1-5` (weekdays 6 AM UTC) or `workflow_dispatch`

**Output:** A new branch `testbot/YYYYMMDD-HHMM` and a PR titled `[testbot] Add tests for <source_file>` with the `ai-generated` label

## Workflow 2: Respond to /testbot (`testbot-respond.yaml`)

```text
┌──────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐  ┌────────────────┐
│  Trigger         │  │ 1. auto-approve     │  │ 2. respond.py       │  │ 3. Claude Code │
│  pull_request_   │─▶│   (workflow_run)    │─▶│   GraphQL: fetch    │─▶│   CLI          │
│  review_comment  │  │   Check NVIDIA      │  │   threads + filter  │  │   Read, Edit,  │
│  + ai-generated  │  │   org membership    │  │   for /testbot      │  │   Write, bazel,│
│  label           │  │   Approve env       │  │   trigger + author  │  │   gh pr view   │
└──────────────────┘  └─────────────────────┘  │   assoc (MEMBER+)   │  └────────┬───────┘
                                               │   Build prompt      │           │
                                               └─────────────────────┘           │
                                                         ▲                       │
                                                         │ structured JSON       │
                                                         │ {commit_message,      │
                                                         │  replies[...]}        │
                                                         │                       │
                     ┌─────────────────────┐  ┌──────────┴──────────┐            │
                     │ 5. Post inline      │  │ 4. respond.py       │            │
                     │    replies via      │◀─│   get_changed_files │◀───────────┘
                     │    GitHub API       │  │   commit_and_push   │
                     │    (one per thread) │  │   (retry, detect    │
                     │                     │  │    GH013)           │
                     └─────────────────────┘  └─────────────────────┘
```

**Trigger:** Inline review comment (on "Files changed" tab) that starts with `/testbot` on a PR labeled `ai-generated`

**Output:** A new commit by `testbot[bot]` pushed to the PR branch, plus an inline reply to each addressed comment

## Auto-approver (`testbot-respond-approve.yaml`)

The respond workflow runs under `environment: testbot-respond` (gated by a required reviewer) so it can access the `NVIDIA_NIM_KEY` secret. The auto-approver runs on `main` via `workflow_run` and:

1. Checks if the triggering actor is in the `NVIDIA/osmo-dev` team, OR a trusted bot (`svc-osmo-ci`, `github-actions[bot]`, `coderabbitai[bot]`)
2. If authorized, calls GitHub's `reviewPendingDeploymentsForRun` to approve the deployment

This lets `/testbot` comments from NVIDIA team members run automatically while blocking external contributors and bots that don't need to run the full pipeline.

## Guardrails

| Guardrail | Scope | Implementation |
|-----------|-------|----------------|
| **Tool allowlist** | Both workflows | `--allowedTools` flag restricts Claude Code to `Read,Edit,Write,Glob,Grep,bazel test,pnpm test/validate/format,gh pr view/diff/checks` — no `git`, no `gh api`, no arbitrary bash |
| **Test-file-only filter** | Generate only | `guardrails.py:get_changed_test_files()` reverts non-test file changes before commit |
| **Label gate** | Respond only | Workflow `if:` requires `ai-generated` label on the PR |
| **Fork rejection** | Respond only | Workflow `if:` requires `head.repo == base.repo` (no forks) |
| **Author association** | Respond only | `respond.py` requires the triggering comment author to be `OWNER`, `MEMBER`, or `COLLABORATOR` |
| **Required reviewer** | Respond only | `environment: testbot-respond` blocks unauthorized runs from accessing the API key secret |
| **Org membership check** | Respond only | Auto-approver verifies the actor is in `NVIDIA/osmo-dev` before approving |
| **Commit message sanitization** | Both | `sanitize_commit_message()` enforces `testbot:` prefix, strips git trailers, caps at 500 chars |
| **Push retry with GH013 detection** | Both | `commit_and_push()` retries up to 3x; fails fast on repository ruleset violations |
| **Partial work discard** | Respond only | On timeout or max-turns hit, `respond.py` discards file changes and posts an informative reply (doesn't push half-finished work) |

## Harness responsibilities

Claude Code is intentionally given a **narrow capability surface**. Everything else lives in the Python harness:

| Responsibility | Component |
|----------------|-----------|
| Coverage analysis & target selection | `coverage_targets.py` |
| Prompt construction (shared rules + workflow-specific) | `respond.py`, `TESTBOT_PROMPT.md`, `TESTBOT_RESPOND_PROMPT.md`, `TESTBOT_RULES.md` |
| Git operations (branch, commit, push, retry, revert) | `create_pr.py`, `respond.py` |
| GitHub API (fetch threads, post replies, create PRs) | `create_pr.py`, `respond.py` |
| Guardrail enforcement (file-type filter) | `guardrails.py` |
| Structured output parsing (3-tier fallback) | `respond.py:_extract_replies()` |
| Timeout / max-turns handling | `respond.py:run_claude()` and `main()` |
| Auto-approval of environment deployments | `testbot-respond-approve.yaml` |

## Prompt files

Prompts are **file-based** (not inlined in Python) so they can be edited, diffed, and reviewed independently:

| File | Purpose |
|------|---------|
| `TESTBOT_RULES.md` | **Shared** test quality rules, bug-detection process, verification steps, language conventions. Referenced by both workflows. |
| `TESTBOT_PROMPT.md` | Generate-specific: coverage targets process, BUILD file handling, guardrails. References `TESTBOT_RULES.md`. |
| `TESTBOT_RESPOND_PROMPT.md` | Respond-specific: role framing, PR context guidance, output JSON schema example. References `TESTBOT_RULES.md`. |

## Configuration

### Generate workflow (dispatch inputs)

| Input | Default | Description |
|-------|---------|-------------|
| `max_targets` | `1` | Files to target per run |
| `max_uncovered` | `300` | Uncovered lines cap per target (0 = no cap) |
| `max_turns` | `50` | Claude Code agent turns |
| `timeout_minutes` | `30` | Workflow timeout |
| `model` | `aws/anthropic/claude-opus-4-5` | LLM model on API gateway |
| `dry_run` | `false` | Generate without creating PR |

### Respond workflow (CLI args in `testbot-respond.yaml`)

| Arg | Default | Description |
|-----|---------|-------------|
| `--max-turns` | `75` | Claude Code agent turns |
| `--max-responses` | `10` | Max threads to address per trigger |
| `--timeout` | `900` | Claude Code CLI timeout in seconds |
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
└── testbot-respond-approve.yaml    # Auto-approve for NVIDIA org members
```
