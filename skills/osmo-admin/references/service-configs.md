# OSMO Service Configs

## Scope

This reference covers OSMO `services.configs` values under an explicit
user-provided config root or values file. It is config-root agnostic: discover
source files from that provided location instead of assuming paths, environment
names, pools, backends, storage, or role names.

## Source Of Truth

Use only the config files the user identifies or files reached from the provided
config root. Some deployments render `services.configs` into service runtime
config, but this public skill does not assume a deployment mechanism. Do not use
direct CLI/API config-write paths for this skill.

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

To find the source of truth:

1. Start from the config root or values file supplied by the user. If neither
   is available, ask for it before making file-specific claims.
2. Look for a manifest, Helmfile, Kustomize overlay, values index, application
   file, or local docs that list the active values files.
3. Read the active values files for the target deployment.
4. Search for `services.configs` only as a discovery aid, then verify from the
   actual values files before answering.
5. If the requested deployment has no visible `services.configs` block, say so
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
| `services.configs.dataset` | `dataset` | dataset buckets and default bucket |
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
and runtime availability are live output. Do not add them to service values.

## Read Procedure

1. Identify the config root or target values file from the user's explicit
   request.
2. Read the smallest relevant YAML file, then expand to sibling files only when
   needed to resolve references.
3. Use the `services.configs.<section>` key path.
4. Resolve relationships when answering derived questions:
   - pools reference templates through `common_pod_template` and platform
     `override_pod_template`
   - pools reference validations through `common_resource_validations` and
     platform `resource_validations`
   - pools reference group templates through `common_group_templates`
   - backends reference tests through `tests`
   - roles reference pools/backends through policy `resources`
5. For inventory or reverse lookup, inspect the complete relevant mapping rather
   than relying on partial terminal output.
6. Cite file path and YAML key path in the answer.

## Local Edit Procedure

1. Confirm the config root, target values file, and exact config key.
2. Read current state and related references.
3. Edit the smallest YAML subtree.
4. Preserve sibling fields and unrelated objects.
5. Show the local file diff.
6. Run user-provided or discoverable local validation when available. If no
   validation command is provided or discoverable, report that no local
   validation command was found.

For preview-only requests, do not edit files. Read the target values file and
describe the minimal key/value change or patch that would be made.

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
          containers:
            - name: "{{USER_CONTAINER_NAME}}"
              resources:
                requests:
                  cpu: "{{USER_CPU}}"
                  memory: "{{USER_MEMORY}}"
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
              - dataset:read
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
5. Preserve sibling backends and runtime-only fields.

### Pool Storage Or Mounts

For "Which storage is attached to this pool?":

1. Read `services.configs.pools.<pool>.common_pod_template`.
2. Read the selected platform's `override_pod_template`, if any.
3. Resolve those names under `services.configs.podTemplates`.
4. Inspect `spec.volumes[*].persistentVolumeClaim.claimName`,
   `spec.containers[*].volumeMounts`, and
   `spec.initContainers[*].volumeMounts`.
5. Report claim names and mount paths, and whether each comes from common pool
   config or a platform override.

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

### Dataset Config

Use `services.configs.dataset.default_bucket` and
`services.configs.dataset.buckets`.

- Preserve existing buckets and credential references unless the user asks to
  change them.
- If adding a bucket, ask for required deployment-specific details such as mode
  or credential reference when they are missing.
- Removing a bucket unregisters it from OSMO but does not delete backing
  storage.
- If removing the default bucket, ask for the replacement default first.

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
- Preserve unrelated containers, mounts, selectors, and tolerations.

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
- A conventional pool role name is `osmo-` plus the literal pool name. If the
  pool is named `osmo-dev`, the generated pool role is `osmo-osmo-dev` and its
  resource pattern targets `pool/osmo-dev*`.
- Preserve policies when the user asks only to change external identity mapping.

### Backend Tests

Use `services.configs.backendTests.<test>` and backend `tests` lists.

- Verify every referenced test definition exists before reporting "attached".
- Do not copy parsed or runtime fields into values.
- Removing a backend requires checking pool `backend` fields, role policy
  resources, backend `tests`, and `backendTests.*.backend` references.

### Group Templates

Use `services.configs.groupTemplates.<template>` for Kubernetes resources
created with task groups.

- Template resources need unique runtime-safe names such as group UUID
  placeholders.
- Omit `metadata.namespace`; OSMO sets the namespace at runtime.
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
