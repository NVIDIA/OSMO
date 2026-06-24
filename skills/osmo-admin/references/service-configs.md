# OSMO Service Configs

## Scope

This reference covers OSMO `services.configs` values under an explicit
user-provided config root or values file. It is config-root agnostic: discover
source files from that provided location instead of assuming paths, environment
names, pools, backends, storage, or role names.

## Critical Gates

- If no config root or values file was provided for a file-specific question,
  stop and ask for it. Do not inspect the working directory to infer one.
- Use the user-provided root string for source paths in answers. A tool may run
  from another working directory, but do not present that directory as the
  user's config root.
- Keep reads bounded: read the relevant section, source file, or YAML key path
  instead of dumping this whole reference or whole values files.
- For scalar answers, report the source path, exact `services.configs...` key
  path, and value.
- For derived pod-template or resource-validation answers, report each pool
  reference key and each referenced definition key. The answer must name all
  resolved templates and validations and cite exact keys on both sides of the
  reference.
- For local edits, inspect the file diff and discover a local validation command
  when one is provided or declared in the config root. If none is found, say
  exactly that no local validation command was found.
- Never use live CLI/API config paths, cluster mutation commands, destructive
  cleanup, or repo-destructive git commands.

## Source Of Truth

Use only the config files the user identifies or files reached from the provided
config root. Some deployments render `services.configs` into service config
data, but this public skill does not assume a deployment mechanism. Do not use
direct CLI/API config paths for this skill, including read-only `osmo config`
show/list/get/history/rollback commands.

## Canonical Schema Source

Use the public OSMO docs as the canonical source for config shapes, especially
Deployment Guide > References > Configuration API:

- `pool`: https://nvidia.github.io/OSMO/main/deployment_guide/references/configs_definitions/pool.html
- `pod_template`: https://nvidia.github.io/OSMO/main/deployment_guide/references/configs_definitions/pod_template.html
- `resource_validation`: https://nvidia.github.io/OSMO/main/deployment_guide/references/configs_definitions/resource_validation.html
- Resource pools: https://nvidia.github.io/OSMO/main/deployment_guide/advanced_config/pool.html
- Roles and policies: https://nvidia.github.io/OSMO/main/deployment_guide/appendix/authentication/roles_policies.html

Use the user-provided config root or values file as the source for current
deployment values. If public docs and local files conflict, cite the docs for
schema expectations and the local file for the current value. Do not invent
fields.

Preserve the exact config root string the user provides. Build paths under that
string and cite results with that root or paths relative to it. If local tooling
maps the same root through another real filesystem path, use that mapped path
only to read files; do not call it the config root or cite it as the source root
unless the user supplied it. In reported output, preserve the
user-root-relative path, such as `repo/...`. When a tool can read through the
user-provided root string directly, prefer that form for discovery and read
commands too. If a mapped filesystem path is required for the read, keep that
mapping internal and translate reported source paths back to the user-provided
root.

To find the source of truth:

1. Start from the config root or values file supplied by the user. If neither
   is available, stop and ask for it before listing, searching, reading, editing,
   or making file-specific claims.
   Do not substitute the current working directory, an unrelated checkout, or a
   sibling directory for the supplied root.
2. Look for a manifest, Helmfile, Kustomize overlay, values index, application
   file, or local docs that list the active values files.
3. Read the active values files for the target deployment.
4. Search for `services.configs` only as a discovery aid. `rg`, `grep`, `find`,
   `ls`, and file listings may locate candidate files or lines, but they are
   never evidence for an answer. Verify by reading the exact value subtree from
   the active values file before answering.
5. If the requested deployment has no available `services.configs` block, say so
   and do not silently answer from another deployment.

Useful generic evidence includes:

- chart templates that render `services.configs` into config data
- chart default values that define empty `services.configs` sections
- deployment values files that set `services.configs.<section>`
- local docs that identify active values files or environment conventions

Do not duplicate full schema docs in the answer. Use the public docs above when
field-level detail is needed.

## Schema Map

Top-level `services.configs` sections mix names that already match mounted
config keys with names the chart converts from camelCase to snake_case. Preserve
the spelling used in the source values file.

| Helm values key | Mounted config key | Use |
|---|---|---|
| `services.configs.service` | `service` | CLI version pins, auth metadata, queues |
| `services.configs.workflow` | `workflow` | workflow defaults, plugins, limits, timeouts |
| `services.configs.pools` | `pools` | pool quotas, templates, platforms, maintenance |
| `services.configs.podTemplates` | `pod_templates` | task pod overlays and mounts |
| `services.configs.resourceValidations` | `resource_validations` | submit-time assertions |
| `services.configs.backends` | `backends` | scheduler, router, dashboard, node metadata |
| `services.configs.backendTests` | `backend_tests` | backend validation definitions |
| `services.configs.groupTemplates` | `group_templates` | task-group Kubernetes resources |
| `services.configs.roles` | `roles` | role policies and external identity mappings |

`secretRefs` is Helm-values-only metadata used to mount or name Kubernetes
Secrets. It is not a normal mounted config section. Cite secret reference names
and keys only; never print secret payloads.

Computed fields such as parsed templates, parsed validations, heartbeat, status,
and live availability are live output. Do not add them to service values.

## Read Procedure

1. Identify the config root or target values file from the user's explicit
   request. If it is missing, ask for it and do not inspect the working
   directory to infer a default.
2. Read the smallest relevant YAML file, then expand to sibling files only when
   needed to resolve references.
3. Use the `services.configs.<section>` key path.
4. When answering from a YAML entry, collect compact exact evidence: source
   file, key path, and the relevant value or small subtree.
   Use direct file reads with bounded YAML extraction when possible. Prefer
   focused extraction over full-file dumps; do not rely on truncated output,
   broad `rg` or `grep` matches, `find` or `ls` output, or isolated line
   snippets for claims.
   Keep discovery scoped to the supplied config root. Do not search unrelated
   directories, hidden repository metadata, or sibling copies unless the user
   explicitly identifies one of those as the config root.
   For any scalar value, including pool `backend` or `enable_maintenance`, first
   print the source path, exact full key path, and value from a bounded direct
   read or YAML extraction. If output truncates or shows only a matching source
   line, retry with a smaller extraction before answering.
5. Resolve relationships when answering derived questions:
   - pools reference templates through `common_pod_template` and platform
     `override_pod_template`
   - pools reference validations through `common_resource_validations` and
     platform `resource_validations`
   - pools reference group templates through `common_group_templates` when the
     question asks for group templates or all pool references
   - backends reference tests through `tests`
   - roles reference pools/backends through policy `resources`
6. For derived pool/template/validation questions, first read and record only
   the exact pool key paths needed for the answer from the values file
   containing that pool. For template and validation questions, those usually
   include `services.configs.pools.<pool>.common_pod_template`,
   `services.configs.pools.<pool>.common_resource_validations`,
   `services.configs.pools.<pool>.platforms.<platform>.override_pod_template`,
   and
   `services.configs.pools.<pool>.platforms.<platform>.resource_validations`.
   Add `services.configs.pools.<pool>.common_group_templates` only when the
   answer needs group templates.
   Do not dump large files, entire pools, or whole values files when exact keys
   are enough.
7. Read and record compact definition evidence for each referenced
   `services.configs.podTemplates.<template>`,
   `services.configs.resourceValidations.<validation>`, and, when relevant,
   `services.configs.groupTemplates.<template>` entry from the values files that
   define them before answering. In split files, this usually means reading the
   exact definition key paths in `template-configs.yaml` after reading pool
   references from `pool-configs.yaml`. Record the exact entry path plus the
   relevant fields or a small subtree; paths and reference names alone are not
   enough. Raw full-section dumps are not required. If the
   answer depends on backend details or reports backend-derived fields beyond
   the backend name, read the full `services.configs.backends.<backend>` entry
   too. Backend-name-only questions may cite
   `services.configs.pools.<pool>.backend` without reading the backend entry.
   Do not answer from reference names alone.
   For definitions split across files, such as pool references in
   `pool-configs.yaml` and template or validation definitions in
   `template-configs.yaml`, read the definition file by exact key path before
   citing the definition.
8. Before answering derived pool/template/validation questions, verify that
   the collected evidence includes each exact pool reference key and every
   referenced podTemplate and resourceValidation entry used in the answer.
   Include groupTemplate evidence only when group templates are part of the
   question or answer.
9. Verify the response includes every resolved pod template and resource
   validation name, its common or platform-specific origin, and file/key-path
   citations for both the pool reference and the referenced definition.
10. For inventory or reverse lookup, inspect the complete relevant mapping rather
   than relying on partial terminal output.
11. Cite file path and YAML key path in the answer.

Focused evidence pattern, replacing names and paths with the target entries.
Use a YAML-aware parser or a short bounded read to fill in the values; the point
is to show exact keys and compact values, not whole parent files:

```text
<user-root>/<pool-values.yaml>
  services.configs.pools.<pool>.common_pod_template
  services.configs.pools.<pool>.common_resource_validations
  services.configs.pools.<pool>.platforms.<platform>.override_pod_template
  services.configs.pools.<pool>.platforms.<platform>.resource_validations

<user-root>/<template-values.yaml>
  services.configs.podTemplates.<template>
  services.configs.resourceValidations.<validation>
```

Report exact paths for both sides of each reference, for example
`services.configs.pools.<pool>.common_pod_template[]` and
`services.configs.podTemplates.<template>`. For platform-derived references,
also cite exact paths such as
`services.configs.pools.<pool>.platforms.<platform>.override_pod_template[]`
and
`services.configs.pools.<pool>.platforms.<platform>.resource_validations[]`.
After the required exact key evidence is collected, stop investigating and answer.

Final answers must use this compact structure for every reported item:

```text
Source: <user-root-relative path>
Key: <exact services.configs... YAML key path>
Name/value: <reported name or scalar value>
```

For derived template or resource-validation answers, report both the pool
reference and the referenced definition:

```text
Pool reference: <path> | <exact pool reference key> | <template/validation name>
Definition: <path> | <exact podTemplates/resourceValidations key> | <name>
```

For previews or edits, also state whether validation was attempted:

```text
Validation: <command and relevant output>, or No local validation command was found.
```

## Local Edit Procedure

1. Confirm the config root, target values file, and exact config key.
   Generic descriptions such as `the GPU pool` are not exact target names; ask
   for the config root or values file, deployment, and literal pool/backend/etc.
   name before editing.
2. Read current state and related references.
3. Edit the smallest YAML subtree.
4. Preserve sibling fields and unrelated objects.
5. Inspect the local diff before reporting the change.
6. Do not run destructive cleanup or repo-destructive commands such as `rm`,
   `rm -f`, `rm -rf`, `git clean`, `git reset --hard`, or `git checkout --`.
   Use the agent's normal file-edit tool when available instead of shell edit
   sessions that require cleanup.
7. For an existing scalar value, edit only that scalar with the normal file edit
   tool available in the environment; then run `git diff -- <file>` or
   `git -C <config-root> diff -- <file>` so the diff records the exact edit.
8. Run user-provided or discoverable local validation when available. Discover
   only from the provided config root, target repo files, or local instructions;
   do not invent repo-specific validation commands. If no validation command is
   provided or discoverable, report exactly that no local validation command was
   found. Use read-only file discovery under the supplied config root for the
   validation-discovery attempt.
9. In the final response, report files changed, YAML key paths changed, the
   before and after value or concise diff summary, and either validation command
   output or the exact no-validation-found statement.

For preview-only requests, do not edit files. Read the target values file and
describe the minimal key/value change or patch that would be made. Do not use
temporary-file cleanup commands to build the preview.

## Generic Examples

For generic example requests, no config root is required. Label the answer as an
illustrative `services.configs` structure, use placeholder names, and state that
real backend names, node labels, identity-provider mappings, config paths, and
validation commands come from the admin's environment.

For an arm64 CPU-only pool restricted to mapped users or groups, include these
concepts:

- `services.configs.pools.<pool>` with only CPU quota under `resources`
- `services.configs.podTemplates.<template>` with arm64 node selection and no
  `nvidia.com/gpu` request
- `services.configs.resourceValidations.<validation>` as an array of validation
  rules requiring zero GPUs
- `services.configs.roles.<role>` with `external_roles` and policy resources
  limited to the pool and its backend

Example:

```yaml
services:
  configs:
    pools:
      example-arm64-cpu:
        backend: example-backend
        enable_maintenance: false
        common_pod_template:
          - example-arm64-cpu-node
        common_resource_validations:
          - example-cpu-only
        resources:
          cpu:
            guarantee: 0
            maximum: 128
            weight: 10
    podTemplates:
      example-arm64-cpu-node:
        spec:
          nodeSelector:
            kubernetes.io/arch: arm64
    resourceValidations:
      example-cpu-only:
        - operator: EQ
          left_operand: "{{USER_GPU}}"
          right_operand: "0"
          assert_message: This pool does not allow GPU requests.
    roles:
      osmo-example-arm64-users:
        description: Example access for the arm64 CPU pool
        immutable: false
        sync_mode: import
        external_roles:
          - example-arm64-users
        policies:
          - actions:
              - workflow:*
              - resources:Read
            resources:
              - pool/example-arm64-cpu*
              - backend/example-backend
```

## Common Admin Flows

### Pool Backend

For "Which backend does this pool use?":

1. Find `services.configs.pools.<pool>.backend`.
2. If needed, read `services.configs.backends.<backend>` for scheduler, router,
   dashboard, node condition, or test details.
3. Return backend name, source file, and key path.

### Backend Config

For scheduler, router, dashboard, node-condition, or test questions:

1. Locate `services.configs.backends.<backend>`.
2. Read the full backend mapping before reporting or editing individual fields.
3. Report exact `scheduler_settings.scheduler_type`,
   `scheduler_settings.scheduler_name`, `scheduler_settings.scheduler_timeout`,
   and `router_address` values. If a field is absent, say it is absent.
4. For backend metadata updates, write only user-provided values or values
   derived from an unambiguous existing config convention. Ask one targeted
   question if required details are missing.
5. Preserve sibling backends and computed fields.

### Pool Storage Or Mounts

For "Which storage is attached to this pool?":

1. Read the exact `services.configs.pools.<pool>.common_pod_template` key and
   the selected platform's `override_pod_template`, if any, following the
   derived question read rule above.
2. Collect the referenced template names from those exact keys.
3. Read the full `services.configs.podTemplates.<template>` entry for every
   resolved template name before inspecting mount fields.
4. Inspect `spec.volumes[*].persistentVolumeClaim.claimName` and the pod
   workload/init mount lists.
5. Report claim names and mount paths, and whether each comes from common pool
   config or a platform override, with source file and key-path citations.

Do not infer storage only from template names. Verify volumes or mounts.

### Add Storage Or A Template To A Pool

1. Read the pool and its template chain.
2. Check whether the desired storage already appears in any referenced template.
   If it is already attached, report that no service config edit is needed.
3. If an existing template already contains the desired mount, prefer adding
   that template name to the pool or platform reference list.
4. If no template exists, add a minimal `services.configs.podTemplates.<name>`
   entry with the required volume and mount pattern used by neighboring
   templates.
5. Preserve template order and unrelated mounts.

### Pool Maintenance

1. Read `services.configs.pools.<pool>.enable_maintenance`.
2. Change only that boolean to `true` or `false` as requested.
3. Do not modify backend, resources, platforms, templates, validations, or
   roles.
4. Explain that local config changes affect service behavior only after the
   user's own rollout process applies them; it is not a live pod drain.

### Workflow Config

Use `services.configs.workflow` for plugin settings, backend image defaults,
storage, per-user limits, allowed paths, and timeouts.

- Preserve sibling plugin fields.
- Convert units explicitly when the user gives human-readable values.
- Running workflows keep the config they started with; desired-state changes
  affect workflows after deployment and restart boundaries.

### Pod Templates

Use `services.configs.podTemplates.<template>` for mounts, host aliases, env
vars, resources, security context, node selectors, affinity, tolerations,
annotations, `/dev/shm`, and image pull secrets.

- Check which pools reference a shared template before editing it.
- For pool-scoped additions, prefer a small overlay template wired into the
  target pool or platform instead of mutating a widely shared base template.
- Preserve unrelated workload specs, mounts, selectors, and tolerations.

### Resource Validations

Use `services.configs.resourceValidations`.

- When wiring a validation to a pool, edit the pool's
  `common_resource_validations` or platform-specific `resource_validations`
  without removing existing entries.
- When changing an existing validation, preserve the other assertions.
- Cross-check references so pools do not point to missing validation names.

### Roles

Use `services.configs.roles.<role>`.

- Translate `actions`, `resources`, and `external_roles` in plain language.
- Do not use per-user role commands or token commands.
- A role definition does not assign the role to users. User or group assignment
  is owned by the deployment's identity provider or separate admin process.
- One common pool-role convention is `osmo-` plus the literal pool name. If the
  pool is named `osmo-dev`, that convention uses `osmo-osmo-dev` and its
  resource pattern targets `pool/osmo-dev*`.
- Preserve policies when the user asks only to change external identity mapping.

### Backend Tests

Use `services.configs.backendTests.<test>` and backend `tests` lists.

- Verify every referenced test definition exists before reporting "attached".
- Do not copy parsed or computed fields into values.
- Removing a backend requires checking pool `backend` fields, role policy
  resources, backend `tests`, and `backendTests.*.backend` references.

### Group Templates

Use `services.configs.groupTemplates.<template>` for Kubernetes resources
created with task groups.

- Template resources need unique generated names such as group UUID
  placeholders.
- Omit `metadata.namespace`; OSMO sets the namespace automatically.
- Call out when backend worker RBAC may be required for a new resource kind.

## History And Rollback

For "When did this config change?":

1. Locate the values file and key.
2. If the config root has git history, use read-only git commands such as
   `git log --follow -- <path>`, `git log -G '<key-or-name>' -- <path>`,
   `git blame <path>`, or `git show <commit> -- <path>`.
3. Summarize dates, authors, commit subjects, and config fields changed.

For rollback:

1. Identify the current value, previous value, commit, date, author, and
   subject.
2. Prepare the smallest reverse diff for the requested key or object.
3. Do not revert unrelated fields from the same commit.
4. Show the local diff and stop before any external review or rollout process
   unless the user provides that process and explicitly asks.

Do not use `osmo config history`, `osmo config rollback`, live API writes, or
cluster mutation.
