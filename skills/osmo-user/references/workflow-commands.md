# OSMO Workflow Commands

Use this reference for `osmo workflow` command syntax and flags. For the actual
submit process, monitoring loop, troubleshooting, or YAML schema, route to the
dedicated references named below.

## Routing

| Need | Read |
|---|---|
| Generate, choose pool, submit | `references/workflow-submit.md` |
| Status, logs, links, monitoring | `references/workflow-status.md` |
| Failed, stuck, sparse logs | `references/troubleshooting.md` |
| Workflow YAML fields | `references/workflow-spec.md` |
| Runtime access, rsync, cancel | `references/workflow-runtime-commands.md` |
| Apps | `references/workflow-apps.md` |
| Workflow credentials | `references/workflow-credentials.md` |

## Submit

```bash
osmo workflow submit <workflow_file_or_workflow_id> [flags]
```

Common flags:

| Flag | Meaning |
|---|---|
| `--pool`, `-p` | Target pool. Uses profile default if omitted. |
| `--set key=value ...` | Override Jinja defaults; values may be cast to number. |
| `--set-string key=value ...` | Override Jinja defaults as strings. |
| `--label KEY=VALUE` | Override a submission label. Repeat for multiple keys. |
| `--set-env key=value ...` | Override workflow environment variables. |
| `--dry-run` | Render and print the workflow without submitting. |
| `--priority HIGH|NORMAL|LOW` | Scheduler priority. LOW may be preempted. |
| `--rsync local:remote` | Start a background rsync daemon to the lead task. |
| `--format-type json|text`, `-t` | Output format. |

If the first argument is a workflow ID instead of a file, OSMO submits the
saved spec as a new full run. Use this only when the user explicitly asks to
submit the saved spec anew. In that mode, `--dry-run` and `--set` are not
supported.

## Validate

```bash
osmo workflow validate <workflow_file> [--pool <pool>] \
  [--set key=value ...] [--set-string key=value ...] [--label KEY=VALUE]
```

Use validation when the user asks to check a workflow before submitting. It does
not submit or start a workflow.

## Restart

```bash
osmo workflow restart <workflow_id> [--pool <pool>] [--format-type json|text]
```

For a failed or `FAILED_CANCELED` workflow that the user wants to run again
as-is, use `restart` as the normal retry path after confirming the failure is
not deterministic. Restart is partial recovery: it can retain successful work
from the previous run. For a deterministic failure, fix and validate a local
YAML file, then run `osmo workflow submit <workflow_file>`; do not retry with
`restart` or `submit <workflow_id>`.

## List

```bash
osmo workflow list [--count N] [--offset N] [--name <substring>] \
  [--status <status> ...] [--pool <pool> ...] [--user <user> ... | --all-users] \
  [--order asc|desc] [--submitted-after YYYY-MM-DD] \
  [--submitted-before YYYY-MM-DD] [--label KEY=SELECTOR] [--no-label KEY] \
  [--priority HIGH|NORMAL|LOW ...] [--app <app[:version]>] \
  [--format-type json|text]
```

For recent workflow summaries, prefer `osmo workflow list --format-type json`
and format the answer using `workflow-status.md`.

`--status` and `--priority` accept multiple values, e.g.
`--status RUNNING PENDING --priority HIGH NORMAL`. Workflow statuses:

```text
RUNNING, FAILED, COMPLETED, PENDING, WAITING,
FAILED_EXEC_TIMEOUT, FAILED_SERVER_ERROR, FAILED_QUEUE_TIMEOUT,
FAILED_SUBMISSION, FAILED_CANCELED, FAILED_BACKEND_ERROR, FAILED_IMAGE_PULL,
FAILED_EVICTED, FAILED_START_ERROR, FAILED_START_TIMEOUT, FAILED_PREEMPTED
```

## Labels

In 6.4, the workflow tag command and list tag filter are removed. Use labels to
classify new workflows: set `workflow.labels` in the spec or pass repeated
`--label KEY=VALUE` overrides to submit or validate. Label keys and values must
follow the workflow label rules; arbitrary legacy tags cannot be automatically
converted to labels.

List filters accept exact values, `*` wildcards, and `(VALUE|VALUE)` alternatives,
for example `--label 'project=(sim_*|hil_*)'`. Repeat `--label` to require all
selectors. Use `--no-label KEY` to find workflows without a key; repeat it to
require every listed key to be absent.

Labels cannot be changed on existing runs. Do not silently resubmit a workflow
to add labels; submission needs an explicit user request.

## Query, Logs, Events, and Spec

```bash
osmo workflow query <workflow_id> [--verbose] [--format-type json|text]
osmo workflow logs <workflow_id> [--task <task>] [--retry-id <n>] [--error] [-n <lines>]
osmo workflow events <workflow_id> [--task <task>] [--retry-id <n>]
osmo workflow spec <workflow_id> [--template]
```

- `query` returns detailed workflow state, task state, Grafana URL, and
  Kubernetes dashboard URL.
- `logs` reads task logs. Use `-n 10000` for failure diagnosis unless a
  reference says otherwise.
- `events` reads Kubernetes events and is especially useful for PENDING or
  image-pull failures.
- `spec --template` returns the original templated YAML.
