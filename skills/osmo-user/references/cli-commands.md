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
osmo login [url] [--method code|password|token|dev]
osmo logout
```

Prefer browser/device-code login. Do not ask the user to paste passwords or
tokens into chat.

## Profile

```bash
osmo profile list [--format-type json|text]
osmo profile set pool <pool_name>
osmo profile set bucket <bucket_name>
```

Use `profile list` to discover default pool/bucket. Change settings only when
the user explicitly asks.

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
osmo data list <remote_uri> [--prefix <prefix>] [--recursive] [--regex <regex>] \
  [--no-pager]
osmo data download <remote_uri> <local_path> [--regex <regex>] [--resume]
osmo data upload <remote_uri> <local_path> ... [--regex <regex>]
osmo data check <remote_uri> [--access-type <type>] [--config-file <path>]
```

Ask for explicit confirmation before `osmo data delete <remote_uri>`.

## Task Inspection

```bash
osmo task list [--status <status> ...] [--workflow-id <workflow_id>] \
  [--user <user> ... | --all-users] [--pool <pool> ... | --node <node> ...] \
  [--count N] [--offset N] [--order asc|desc] [--verbose | --summary]
```

Use `task list` for fleet-level inspection when workflow-level query/logs are
not enough.

## Out of Scope

Do not run these from `osmo-user`:

- `osmo config ...`
- `osmo user ...`
- server-side role, template, pool/backend, bucket, or token administration
- Kubernetes commands for taints, node labels, secrets, deployments, or storage
