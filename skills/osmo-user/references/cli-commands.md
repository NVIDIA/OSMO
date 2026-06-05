# OSMO CLI Commands

Use this reference for safe end-user OSMO command syntax when no more specific
reference applies. Keep operational procedures in the dedicated workflow,
app, credential, resource, and troubleshooting references.

## Scope

Use this file for:

- Authentication, version, profile, pool, resource, dataset, data, and task
  command lookup.
- Quick routing to the right deeper reference.
- Non-destructive command syntax that helps users inspect or operate their own
  OSMO workflows and data.

Do not use this file to perform server-side admin work. `osmo config`,
`osmo user`, bucket administration, role management, and cluster/Kubernetes
changes are outside `osmo-user`.

## Dedicated References

| Need | Read |
|---|---|
| Workflow subcommands and flags | `references/workflow-commands.md` |
| Submit/generate workflow flow | `references/workflow-submit.md` |
| Workflow status, logs, links, monitoring | `references/workflow-status.md` |
| Private images and workflow credentials | `references/workflow-credentials.md` |
| Workflow YAML field shapes | `references/workflow-spec.md` |
| Workflow app lifecycle | `references/workflow-apps.md` |
| Pool/resource reporting | `references/resource-check-format.md` |
| Failures or stuck workflows | `references/troubleshooting.md` |

## Version and Authentication

```bash
osmo --version
osmo version [--format-type json|text]

osmo login [url] [--method code|password|token|dev]
osmo login https://osmo.example.com
osmo login https://osmo.example.com --method password --username <user> --password-file <path>
osmo login https://osmo.example.com --method token --token-file <path>
osmo logout
```

Prefer browser/device-code login when asking a user to authenticate. Do not ask
the user to paste passwords or tokens into chat.

## Profile

```bash
osmo profile list [--format-type json|text]
osmo profile set pool <pool_name>
osmo profile set bucket <bucket_name>
osmo profile set notifications email true|false
osmo profile set notifications slack true|false
```

Use `profile list` to discover the user's default pool and bucket. Only change a
profile setting when the user explicitly asks to update their default.

## Pools and Resources

```bash
osmo pool list [--pool <pool> ...] [--mode free|used] [--format-type json|text]

osmo resource list [--pool <pool> ...] [--platform <platform> ...] \
  [--all] [--mode free|used] [--format-type json|text]
osmo resource info <node_name> [--pool <pool>] [--platform <platform>]
```

For user-facing capacity answers, use `resource-check-format.md`; it defines
effective availability, grouping, and default-pool annotation.

## Dataset Commands

Use datasets for OSMO-managed inputs and outputs.

```bash
osmo dataset list [--name <substring>] [--user <user> ...] [--bucket <bucket> ...] \
  [--all-users] [--count N] [--order asc|desc] [--format-type json|text]
osmo dataset info <dataset[:tag_or_version]> [--all] [--count N] \
  [--order asc|desc] [--format-type json|text]
osmo dataset inspect <dataset[:tag_or_version]> [--format-type text|tree|json] \
  [--regex <regex>] [--count N]
osmo dataset download <dataset[:tag_or_version]> <path> [--regex <regex>] [--resume]
osmo dataset upload <dataset[:tag]> <path> ... [--desc <description>] \
  [--metadata <yaml> ...] [--labels <yaml> ...] [--regex <regex>] [--resume]
```

Use delete, rename, tag, label, metadata, update, collect, recollect, migrate,
and checksum only when the user specifically asks for that dataset operation.
Ask for confirmation before destructive dataset actions.

```bash
osmo dataset delete <dataset[:tag_or_version]> [--all] [--force]
osmo dataset rename <old_name> <new_name>
osmo dataset tag <dataset[:tag_or_version]> --set <tag> ... --delete <tag> ...
osmo dataset query <query_file> [--bucket <bucket>] [--format-type json|text]
osmo dataset check <dataset[:tag_or_version]> [--access-type <type>] [--config-file <path>]
```

## Direct Data Commands

Use direct data commands for storage URIs such as `s3://...` when the user is
not working through an OSMO dataset name.

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
  [--started-after YYYY-MM-DD] [--started-before YYYY-MM-DD] \
  [--count N] [--offset N] [--order asc|desc] [--verbose | --summary]
```

Use `task list` for fleet-level inspection when workflow-level query/logs are
not enough.

## Admin-Only Commands

Do not run these from `osmo-user`:

- `osmo config ...`
- `osmo user ...`
- server-side role, template, pool/backend, bucket, or token administration
- Kubernetes commands for taints, node labels, secrets, deployments, or storage

If the user asks for those, say the request belongs to the OSMO admin/deploy
surface rather than the end-user workflow skill.
