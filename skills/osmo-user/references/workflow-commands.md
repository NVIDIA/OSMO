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
| Runtime access, rsync, cancel, tags | `references/workflow-runtime-commands.md` |
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
| `--set-env key=value ...` | Override workflow environment variables. |
| `--dry-run` | Render and print the workflow without submitting. |
| `--priority HIGH|NORMAL|LOW` | Scheduler priority. LOW may be preempted. |
| `--rsync local:remote` | Start a background rsync daemon to the lead task. |
| `--format-type json|text`, `-t` | Output format. |

If the first argument is a workflow ID instead of a file, OSMO treats it as a
resubmission request. In that mode, `--dry-run` and `--set` are not supported.

## Validate

```bash
osmo workflow validate <workflow_file> [--pool <pool>] \
  [--set key=value ...] [--set-string key=value ...]
```

Use validation when the user asks to check a workflow before submitting. It does
not submit or start a workflow.

## Restart

```bash
osmo workflow restart <workflow_id> [--pool <pool>] [--format-type json|text]
```

Use for failed workflows when the user wants a restart rather than editing and
submitting a local YAML file.

## List

```bash
osmo workflow list [--count N] [--offset N] [--name <substring>] \
  [--status <status> ...] [--pool <pool> ...] [--user <user> ... | --all-users] \
  [--order asc|desc] [--submitted-after YYYY-MM-DD] \
  [--submitted-before YYYY-MM-DD] [--tags <tag> ...] \
  [--priority HIGH|NORMAL|LOW ...] [--app <app[:version]>] \
  [--format-type json|text]
```

For recent workflow summaries, prefer `osmo workflow list --format-type json`
and format the answer using `workflow-status.md`.

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
