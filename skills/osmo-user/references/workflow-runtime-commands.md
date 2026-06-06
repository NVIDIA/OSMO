# OSMO Workflow Runtime Commands

Use this reference for live workflow operations: cancel, exec, port-forward,
rsync, and tags. For submit/list/query/log syntax, read `workflow-commands.md`.

## Safety

- Ask for explicit confirmation before canceling or force-canceling workflows.
- Use runtime access only for workflows that are still running or reachable.
- Prefer workflow query/log/event commands first when the user only wants
  status or failure diagnosis.

## Cancel

```bash
osmo workflow cancel <workflow_id> ... [--message <reason>] [--force] \
  [--format-type json|text]
```

`--force` forces task group pods in the cluster. Use it only when the user
explicitly asks for force cancellation or confirms after that risk is stated.

## Exec

```bash
osmo workflow exec <workflow_id> <task> [--entry <command>] \
  [--connect-timeout <seconds>] [--keep-alive]
osmo workflow exec <workflow_id> --group <group> [--entry <command>] \
  [--connect-timeout <seconds>] [--keep-alive]
```

Use when the user wants an interactive shell or direct task inspection session.
Default entry command is `/bin/bash`.

## Port Forward

```bash
osmo workflow port-forward <workflow_id> <task> --port <local[:remote]> \
  [--host localhost] [--udp] [--connect-timeout <seconds>]
```

Ports may be single values or ranges, such as `8000`, `8000:2000`, or
`8000-8010:9000-9010,8015-8016`. Use for local access to a service running
inside a workflow task.

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
