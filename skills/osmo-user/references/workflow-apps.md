# Workflow Apps

Use this reference when the user wants to create, inspect, update, submit,
rename, or delete an OSMO workflow app. Apps are reusable workflow templates
stored in OSMO; users launch them with `osmo app submit`.

## Rules

- Ask for confirmation before creating, updating, renaming, deleting, or
  submitting an app unless the user already clearly authorized that action.
- Ask for explicit confirmation before destructive operations. Do not pass
  `--force` unless the user explicitly asked for force or confirmed after you
  described the effect.
- Do not hard-code secrets in app specs. Use `workflow-credentials.md`.
- After `osmo app submit`, monitor the returned workflow with
  `workflow-status.md`.

## Create an App

1. Determine the workflow YAML path.
   - If the user already has a workflow YAML file, use that path.
   - If the app is based on a completed workflow, use the submitted spec file
     from the current workflow cycle, or fetch the original template with
     `osmo workflow spec <workflow_id> --template` and save it to a local YAML
     file before app creation.
   - If there is no local YAML/spec yet, create or fetch one using the relevant
     workflow generation/status reference before creating the app.
2. Decide on a name and description.
   - App names are global in the OSMO instance; suggest a unique, descriptive
     name, often with a team or workflow prefix.
   - If the user explicitly asked to create an app, ask for the name and suggest
     a default derived from the workflow name.
   - If offering post-completion, present a suggested name and one-sentence
     description in a single prompt.
3. After confirmation, run:
   ```bash
   osmo app create <app_name> --description "<description>" --file <workflow_yaml>
   ```
   If no `--file` is provided, the CLI opens an editor; prefer `--file` so the
   app contents are explicit and reviewable.
4. Report the app name, version, URL, or identifier returned by the CLI.

## List and Inspect Apps

```bash
osmo app list [--name <substring>] [--user <user> ...] [--all-users] \
  [--count N] [--order asc|desc] [--format-type json|text]
osmo app info <name[:version]> [--count N] [--order asc|desc] \
  [--format-type json|text]
osmo app show <name[:version]>
osmo app spec <name[:version]>
```

- `list` discovers apps; use `--name` for search and `--all-users` only when
  the user needs workspace-wide discovery.
- `info` shows app and version metadata.
- `show` shows app description and parameters derived from `default-values`.
- `spec` prints the stored workflow spec.
- `name:version` selects a specific version. Without a version, app commands
  generally use the latest version.

## Update an App

```bash
osmo app update <name[:version]> --file <workflow_yaml>
```

Updating creates a new app version. If the user asks to update an app:

1. Fetch current app details first with `osmo app info <name>`.
2. Read the new YAML file or generate the replacement spec.
3. Confirm the target app and intended change.
4. Run `osmo app update ... --file ...`.
5. Report the new version returned by the CLI.

If `--file` is omitted, the CLI opens an editor with the current spec. Prefer
explicit file-based updates for agent-driven changes.

## Submit an App

```bash
osmo app submit <name[:version]> [--pool <pool>] \
  [--set key=value ...] [--set-string key=value ...] [--set-env key=value ...] \
  [--dry-run] [--priority HIGH|NORMAL|LOW] [--local-path <absolute_path>] \
  [--rsync local:remote] [--format-type json|text]
```

Use `--dry-run` when the user asks to inspect rendered YAML before launching.
Use `--set` or `--set-string` for app parameters; these override top-level
`default-values`. Use `--local-path` when the app spec references local files
and the base directory is not the current working directory.

After submission, report every workflow ID returned and continue with
`workflow-status.md` if the user asked for monitoring.

## Rename or Delete an App

```bash
osmo app rename <old_name> <new_name> [--force]
osmo app delete <name:version> [--force]
osmo app delete <name> --all [--force]
```

- `rename` cannot target a specific version; use app names only.
- `delete <name:version>` deletes one app version.
- `delete <name> --all` deletes all versions.
- Ask for explicit confirmation before either operation. Use `--force` only
  when the user has clearly authorized skipping the CLI confirmation.

## App Spec Guidance

- Parameterize reusable values with Jinja variables and document them in
  top-level `default-values`.
- Use descriptive parameter names such as `training_image`, `gpu_count`, and
  `batch_size`; avoid terse names such as `img` or `n`.
- Choose defaults that run successfully for the common case.
- For multi-task design, read `workflow-patterns.md`.
- For valid field shapes, read `workflow-spec.md`.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| App name already exists | App names are global | Choose a unique name, often with a team/workflow prefix. |
| App version is `PENDING` | OSMO is still processing the app | Wait briefly and re-run `osmo app info <name>`. |
| Local file not found on submit | App references files relative to another directory | Re-run with `--local-path <absolute_path>`. |
| Parameter is not substituted | Missing `--set` value and no `default-values` entry | Pass `--set key=value` or add a default. |
| Private image fails to pull | Missing or wrong workflow credential | Read `workflow-credentials.md`. |
