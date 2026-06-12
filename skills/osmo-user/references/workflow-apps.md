# Workflow Apps

Use this when the user wants to create, inspect, update, submit, rename, or
delete an OSMO workflow app. Apps are reusable workflow templates stored in
OSMO and launched with `osmo app submit`.

## Rules

- Ask for confirmation before create/update/submit/rename/delete unless
  authorized; use `--force` only when clearly authorized.
- Do not hard-code secrets; use `workflow-credentials.md` for generic/data
  secrets and `workflow-registry-credentials.md` for private images.
- After `osmo app submit`, monitor returned workflows with `workflow-status.md`.

## Create

```bash
osmo app create <app_name> --description "<description>" --file <workflow_yaml>
```

Checklist:

- Use the user's YAML, the current submitted spec, or fetch a completed
  workflow template with `osmo workflow spec <workflow_id> --template`.
- Suggest a globally unique app name and one-sentence description.
- Prefer `--file`; without it the CLI opens an editor.
- Report the app name, version, URL, or identifier returned by the CLI.

## List and Inspect

```bash
osmo app list [--name <substring>] [--user <user> ...] [--all-users] \
  [--count N] [--order asc|desc] [--format-type json|text]
osmo app info <name[:version]> [--count N] [--order asc|desc] \
  [--format-type json|text]
osmo app show <name[:version]>
osmo app spec <name[:version]>
```

| Command | Use |
|---|---|
| `list` | Discover apps; use `--name` for search. |
| `info` | Show app and version metadata. |
| `show` | Show description and parameters from `default-values`. |
| `spec` | Print stored workflow spec. |

Use `name:version` to target a specific version; otherwise commands generally
use the latest version.

## Update

```bash
osmo app update <name[:version]> --file <workflow_yaml>
```

Updating creates a new version. Fetch current info first, read or generate the
replacement YAML, confirm the target/change, then report the new version.
Prefer explicit `--file` updates for agent-driven changes.

## Submit

```bash
osmo app submit <name[:version]> [--pool <pool>] \
  [--set key=value ...] [--set-string key=value ...] [--set-env key=value ...] \
  [--dry-run] [--priority HIGH|NORMAL|LOW] [--local-path <absolute_path>] \
  [--rsync local:remote] [--format-type json|text]
```

Use `--dry-run` to inspect rendered YAML. Use `--set` / `--set-string` for
parameters from `default-values`; use `--local-path` when local file references
are relative to a different base directory.

## Rename or Delete

```bash
osmo app rename <old_name> <new_name> [--force]
osmo app delete <name:version> [--force]
osmo app delete <name> --all [--force]
```

- `rename` takes app names only, not versions.
- `delete <name:version>` deletes one version.
- `delete <name> --all` deletes all versions.

## App Spec Guidance

- Parameterize reusable values with Jinja variables and document defaults in
  top-level `default-values`.
- Use descriptive parameter names and defaults that run successfully.
- For workflow fields, read `workflow-spec.md`; for app parameters and
  `default-values`, read `workflow-io-spec.md`.
- For multi-task design, read `workflow-patterns.md`.

## Common Issues

- Name exists: app names are global; choose a unique prefix.
- App is `PENDING`: wait briefly and re-run `osmo app info <name>`.
- Local files missing: submit with `--local-path <absolute_path>`.
- Parameter not substituted: pass `--set key=value` or add `default-values`.
- Private image pull fails: read `workflow-registry-credentials.md`.
