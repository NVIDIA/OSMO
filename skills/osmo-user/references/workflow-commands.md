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

## Cancel

```bash
osmo workflow cancel <workflow_id> ... [--message <reason>] [--force] \
  [--format-type json|text]
```

Canceling is destructive to running work. Ask for explicit confirmation unless
the user already clearly authorized cancellation. Use `--force` only if the
user explicitly asks for force cancellation or confirms after you explain that
it forces task group pods in the cluster.

## Exec

```bash
osmo workflow exec <workflow_id> <task> [--entry <command>] \
  [--connect-timeout <seconds>] [--keep-alive]
osmo workflow exec <workflow_id> --group <group> [--entry <command>] \
  [--connect-timeout <seconds>] [--keep-alive]
```

Use only for running workflows when the user wants an interactive shell or a
direct task inspection session. Default entry command is `/bin/bash`.

## Port Forward

```bash
osmo workflow port-forward <workflow_id> <task> --port <local[:remote]> \
  [--host localhost] [--udp] [--connect-timeout <seconds>]
```

Ports may be single values or ranges, such as `8000`, `8000:2000`, or
`8000-8010:9000-9010,8015-8016`. Use this only when the user wants local access
to a service running inside a workflow task.

## Rsync

```bash
osmo workflow rsync upload <workflow_id> [task] <local_path>:<remote_path> \
  [--daemon] [--timeout <seconds>] [--upload-rate-limit <bytes_per_second>] \
  [--poll-interval <seconds>] [--debounce-delay <seconds>] \
  [--reconcile-interval <seconds>] [--max-log-size <bytes>] \
  [--verbose] [--no-progress]
osmo workflow rsync download <workflow_id> [task] <remote_path>:<local_path> \
  [--timeout <seconds>] [--no-progress]
osmo workflow rsync status
osmo workflow rsync stop [workflow_id] [--task <task>]
```

If task is omitted, upload/download target the lead task of the first group.
`/osmo/run/workspace` is always available as a remote path.

## Tags

```bash
osmo workflow tag
osmo workflow tag --workflow <workflow_id> ... --add <tag> ...
osmo workflow tag --workflow <workflow_id> ... --remove <tag> ...
```

Use tags only when the user explicitly asks to list or update workflow tags.
