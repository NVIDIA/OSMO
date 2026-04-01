# Testbot: AI-Powered Test Generation

Testbot analyzes coverage gaps, generates tests via LLM, validates them with bazel/vitest, and opens PRs for human review.

## Architecture

### Test Generation Pipeline

```
Codecov API → analyze → write → validate → review → create_pr
                         ↑         |          |
                         └─────────┴──────────┘  (retry with feedback)
```

| Stage | Description |
|-------|-------------|
| **Analyze** | Fetches coverage from Codecov API, selects lowest-coverage file, caps uncovered lines (default 200) |
| **Write** | Calls LLM to generate tests with quality rules in the prompt |
| **Validate** | Python syntax check, then `bazel test` (Python/Go) or `pnpm test` (UI) |
| **Review** | LLM quality review (PASS/FAIL with feedback) |
| **Create PR** | Branches from HEAD, commits tests + BUILD entries, opens PR against main |

### Review Response

```
PR comment → GraphQL fetch threads → filter unresolved
  → group by file → LLM (with source context)
  → parse JSON {fix, replies, resolve}
  → validate fix → commit+push (if tests pass)
  → reply to each thread → resolve addressed threads
```

- Triggers on inline review comments for PRs with `ai-generated` label
- Batch processes all unresolved threads per file in one LLM call
- LLM decides per-comment: fix code, explain, or flag for human review
- Resolves threads it fully addresses

## Running Locally

### Prerequisites

```bash
pip install -r src/scripts/testbot/requirements.txt
```

Set environment variables:

```bash
export LLM_API_KEY=<your-api-key>
export CODECOV_TOKEN=<your-codecov-token>
```

### Generate tests (dry run)

```bash
PYTHONPATH=src/scripts python -m testbot.main --dry-run
```

### Generate tests with options

```bash
PYTHONPATH=src/scripts python -m testbot.main \
  --max-targets 1 \
  --max-lines 200 \
  --max-retries 3 \
  --provider claude \
  --dry-run
```

### Respond to PR comments locally

```bash
PYTHONPATH=src/scripts python -m testbot.respond \
  --pr-number <PR_NUMBER> \
  --provider claude
```

### Run tests

```bash
PYTHONPATH=src/scripts python -m pytest src/scripts/testbot/tests/ -q
```

## Triggering on GitHub

### Manual dispatch

Go to **Actions → Testbot** → **Run workflow** and configure:

| Input | Default | Description |
|-------|---------|-------------|
| `max_targets` | 1 | Number of files to target |
| `max_lines` | 200 | Max uncovered lines per target |
| `provider` | claude | LLM provider (claude, nemotron) |
| `dry_run` | false | Generate without creating PR |

### Schedule

Runs automatically on weekdays at 6 AM UTC.

### Review response

Triggers automatically when someone posts an inline review comment on a PR with the `ai-generated` label.

## Configuration

| Setting | Default | Env var override |
|---------|---------|-----------------|
| LLM provider | claude | `--provider` |
| LLM model | aws/anthropic/claude-opus-4-5 | `AGENT_MODEL` |
| API base URL | inference-api.nvidia.com/v1 | `AGENT_BASE_URL` |
| API key | — | `LLM_API_KEY` |
| Coverage source | Codecov API | `CODECOV_TOKEN` |

## File Structure

```
src/scripts/testbot/
├── main.py                 # CLI entry point
├── graph.py                # LangGraph pipeline
├── state.py                # TestbotState + TestTarget
├── codecov_client.py       # Codecov API → CoverageEntry
├── lcov_parser.py          # CoverageEntry dataclass
├── respond.py              # PR review comment responder
├── requirements.txt        # pip dependencies
├── nodes/
│   ├── analyze.py          # Coverage analysis + target selection
│   ├── write.py            # LLM test generation + BUILD entry
│   ├── validate.py         # Bazel/vitest test runner
│   ├── review.py           # LLM quality review
│   └── create_pr.py        # Git branch + PR creation
├── plugins/
│   ├── base.py             # LLMProvider ABC
│   └── llm_client.py       # OpenAI-compatible LLM client
├── prompts/                # LLM prompt templates
├── tools/                  # Shell, file, test utilities
└── tests/                  # Unit tests
```
