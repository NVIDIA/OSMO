# OSMO Interface Routing

Use this reference to choose and operate one OSMO interface per operation.
Connected MCP schemas and installed CLI help remain authoritative.

## Route contract

- An assigned interface overrides adaptive selection. Pass that lock to
  delegates.
- When unassigned, prefer authenticated CLI for a known one-operation read,
  validation, local operation, MCP capability gap, or protected-file secret
  transport. Prefer MCP for supported typed remote writes, recovery, updates,
  or multi-source diagnosis.
- If neither interface supports the operation, explain and stop.
- Never use both interfaces for one operation, fall back to raw HTTP, or switch
  after an error, capability gap, or authentication failure. A separate phase of
  an unassigned multi-phase request may choose independently.
- Verify an ambiguous write on the same route before another authorized write.

## Intent mapping

`—` means the capability is not available through that interface or is not
documented by this skill.

| Intent | MCP tool | CLI command |
| --- | --- | --- |
| Profile defaults | `osmo_get_profile` | `osmo profile list --format-type json` |
| Update default pool or bucket | `osmo_set_profile` | `osmo profile set pool <pool>` or `osmo profile set bucket <bucket>` |
| Search pools or capacity | `osmo_search_pools` | `osmo pool list --mode free --format-type json` |
| Per-node resources | `osmo_list_resources` or `osmo_get_resource` | `osmo resource list --pool <pool> --format-type json` |
| Recent workflows | `osmo_list_workflows` | `osmo workflow list --format-type json` |
| Workflow status or dashboard link | `osmo_get_workflow` | `osmo workflow query <workflow_id> --format-type json` |
| Workflow logs or events | `osmo_get_workflow_logs` or `osmo_get_workflow_events` | `osmo workflow logs <workflow_id>` or `osmo workflow events <workflow_id>` |
| Workflow spec | `osmo_get_workflow_spec` | `osmo workflow spec <workflow_id> [--template]` |
| Validate workflow YAML | `osmo_validate_workflow` | `osmo workflow validate <file> --pool <pool>` |
| Submit workflow YAML | `osmo_submit_workflow` | `osmo workflow submit <file> --pool <pool>` |
| Restart or cancel workflow | `osmo_restart_workflow` or `osmo_cancel_workflow` | `osmo workflow restart <workflow_id>` or `osmo workflow cancel <workflow_id>` |
| List or inspect apps | `osmo_list_apps`, `osmo_get_app`, or `osmo_get_app_spec` | `osmo app list`, `osmo app info <name[:version]>`, or `osmo app spec <name[:version]>` |
| Create, update, or submit an app | `osmo_create_app`, `osmo_update_app`, or `osmo_submit_app` | `osmo app create`, `osmo app update`, or `osmo app submit` |
| Rename or delete an app | `osmo_rename_app` or `osmo_delete_app` | `osmo app rename` or `osmo app delete` |
| Credential inventory or mutation | `osmo_list_credentials`, `osmo_set_credential`, or `osmo_delete_credential` | `osmo credential list`, `set`, or `delete` |
| Upload or download local data | — | `osmo data upload` or `osmo data download` |
| Exec, rsync, port-forward, tags, login, or version | — | Use the matching installed CLI command |

## MCP execution

Use only advertised OSMO MCP tools and current schemas; never invent a tool or
use raw HTTP. For a workflow status, dashboard, or progress request, call
`osmo_get_workflow` once with the supplied ID. Fetch logs, events, or spec only
when needed.

Read local workflow YAML once and pass its exact text in `workflow_spec`.
Validation is read-only. For submission, pass exactly one of `workflow_spec` or
`workflow_id`, preserve pool and priority, pass Jinja overrides as `key=value`,
set `dry_run=false`, and report the workflow ID.

Follow MCP error and remediation fields. Retry only an explicitly retryable
read once. Permission denial means missing access. Do not expose secrets through
MCP unless the current schema documents redaction and non-retention.

## CLI execution

Use the mapped commands directly and prefer JSON reads. If a required flag is
not documented, inspect only that subcommand's local `--help` once. On an
authentication failure, ask the user to run `osmo login` and stop. Retry a
clearly transient read once; do not change interfaces.

Never put secrets in commands, responses, shell history, or inline payloads.
Use owner-protected `--payload-file` inputs when available and never read their
contents into chat.
