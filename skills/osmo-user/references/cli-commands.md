# OSMO CLI Commands

Use this for safe end-user command syntax when no dedicated reference applies.
Keep procedures in the workflow, app, credential, resource, and troubleshooting
references.

## Route First

| Need | Read |
|---|---|
| Workflow submit/list/query syntax | `references/workflow-commands.md` |
| Workflow runtime access or rsync | `references/workflow-runtime-commands.md` |
| Submit/generate workflows | `references/workflow-submit.md` |
| Status, logs, monitoring | `references/workflow-status.md` |
| Generic or data credentials | `references/workflow-credentials.md` |
| Private image pulls | `references/workflow-registry-credentials.md` |
| Workflow YAML fields | `references/workflow-spec.md` |
| Workflow inputs, outputs, Jinja | `references/workflow-io-spec.md` |
| Apps | `references/workflow-apps.md` |
| Pool/resource reporting | `references/resource-check-format.md` |
| Failures | `references/troubleshooting.md` |

## Version and Auth

```bash
osmo --version
osmo version [--format-type json|text]
osmo login [url] [--method pkce|code|password|token|dev]
osmo logout
```

`pkce` is the default login method. Use `--method code` explicitly when a
device-authorization flow is required. Do not ask the user to paste passwords
or tokens into chat.

## Profile

```bash
osmo profile list [--format-type json|text]
osmo profile set pool <pool_name>
osmo profile set notifications <email|slack> [true|false]
```

Use `profile list` to discover the default pool and notification preferences.
Change settings only when the user explicitly asks.

## Pools and Resources

```bash
osmo pool list [--pool <pool> ...] [--mode free|used] [--format-type json|text]
osmo resource list [--pool <pool> ...] [--platform <platform> ...] \
  [--all] [--mode free|used] [--format-type json|text]
osmo resource info <node_name> [--pool <pool>] [--platform <platform>]
```

For capacity answers, use `resource-check-format.md`.

## Direct Data

Use direct data commands for storage URIs such as `s3://...`.

```bash
osmo data list <remote_uri> [<local_output_file> | --no-pager] \
  [--prefix <prefix>] [--recursive] [--regex <regex>]
osmo data download <remote_uri> <local_path> [--regex <regex>] [--resume]
osmo data upload <remote_uri> <local_path> ... [--regex <regex>]
osmo data check <remote_uri> [--access-type <type>] [--config-file <path>]
```

For `data list`, omit both output arguments to use an available pager (`less` or
`more`), falling back to stdout if neither is installed. Use `--no-pager` to
print directly to stdout, or give a local output file to save the listing text
(object keys, one per line). This does not download the objects.

The output path must be a new file, not an existing file or directory, and
cannot be combined with `--no-pager`. Choose an existing writable parent
directory; the command does not create parent directories. For example, with
`listing.txt` not already present in the current directory:

```bash
osmo data list s3://my-bucket/ ./listing.txt --prefix results/ --recursive
```

Ask for explicit confirmation before `osmo data delete <remote_uri>`.

## Task Inspection

```bash
osmo task list [--status <status> ...] [--workflow-id <workflow_id>] \
  [--user <user> ... | --all-users] [--pool <pool> ... | --node <node> ...] \
  [--started-after YYYY-MM-DD] [--started-before YYYY-MM-DD] \
  [--priority HIGH|NORMAL|LOW ...] [--aggregate-by-workflow] \
  [--count N] [--offset N] [--order asc|desc] [--verbose | --summary] \
  [--format-type json|text]
```

Use `task list` for fleet-level inspection when workflow-level query/logs are
not enough.

- `--started-after` is inclusive; `--started-before` is exclusive. Dates are
  interpreted at midnight in the user's local timezone and converted to UTC.
  These filter task start times, not workflow submission times.
  `--started-after` alone also includes tasks with no start time yet;
  `--started-before` excludes those tasks.
- `--priority` accepts multiple space-separated values, such as `HIGH NORMAL`.
- `--aggregate-by-workflow` (or `-W`) groups resource requests by workflow,
  not measured resource utilization. Use it without `--summary` when you want
  workflow grouping; summary output takes precedence when both are supplied.
- Default task statuses are `PROCESSING`, `SCHEDULING`, `INITIALIZING`, and
  `RUNNING`. Set `--status` explicitly to inspect completed or failed tasks;
  task status choices differ from workflow status choices.

For example, inspect requested resources by workflow for completed tasks
started on September 1 or 2 at high or normal priority:

```bash
osmo task list --status COMPLETED \
  --started-after 2026-09-01 --started-before 2026-09-03 \
  --priority HIGH NORMAL --aggregate-by-workflow --count 20 --format-type json
```

## Out of Scope

Do not run these from `osmo-user`:

- `osmo config ...`
- `osmo user ...`
- server-side role, template, pool/backend, bucket, or token administration
- Kubernetes commands for taints, node labels, secrets, deployments, or storage
