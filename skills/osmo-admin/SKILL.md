---
name: osmo-admin
version: "1.0.0"
author: NVIDIA
tags: [osmo, admin, service-config]
tools: [filesystem, shell]
description: >
  Use for OSMO config-admin requests that reference or require service values,
  values files, config roots, pools, backends, quotas, roles, templates,
  storage, maintenance, validation rules, or history.
---

# osmo-admin

Use this skill for OSMO configuration administration in a user-provided config
root. Keep this file as a router: load only the reference files needed for the
current request.

## Purpose

Route OSMO config-admin questions to verified service values or local file
diffs. This skill is config-root agnostic: it does not assume a repo layout,
environment name, identity provider, storage backend, approval process, or
deployment mechanism.

## Requirements

- A user-provided config root or values file path containing OSMO service
  config values or docs.
- Permission to read files under the provided config root.
- Permission to edit local files only when the user asks for an admin change.
- Generic example-only requests do not require a config root, but the answer
  must use placeholder names and label the structure as illustrative.

## Activation

Use this skill for OSMO admin questions about:

- pool, backend, platform, quota, maintenance, topology, template, or storage
  desired state
- service, workflow, dataset, backend, role, resource validation, pod template,
  group template, or backend test definitions
- read-only answers such as which pools are in maintenance, which roles grant
  access, which tests attach to a backend, or which mounts a pool resolves to
- local service-values diffs for requested admin changes
- config history or rollback only when history is available in the provided
  config workspace

Do not use this skill for user workflow submission/debugging, live resource
availability, OSMO installation/deployment, generic Kubernetes help, raw cluster
administration, or incident response.

## Core Rules

1. Require an explicit config root or values file path before making
   file-specific claims or edits. Ask for it when missing. Generic example
   requests may be answered without a config root when clearly labeled as
   illustrative.
2. Read `references/service-configs.md` for `services.configs` questions before
   answering or editing.
3. Clarify ambiguous config root, values file, deployment, pool, backend,
   template, role, or local-diff intent before editing.
4. Answer read-only questions from verified config files and cite the source
   file path plus YAML key path.
5. For requested changes, prepare the smallest local file diff and inspect it
   before reporting the change.
6. Do not invent deployment names, file paths, review steps, or config
   relationships. Infer only from provided config files, or use obvious
   placeholder names in clearly labeled examples.
7. Do not treat the working directory as the config root unless the user
   explicitly identifies it as the config root.
8. Never run live mutation commands, including `osmo config` writes, direct
   OSMO API config writes, cluster mutation, deployment sync, or rollout
   commands.
9. Never print secret payloads. Refer only to secret names, key names, and
   reference paths.

## Reference Routing

### `references/service-configs.md`

Read for service-values work itself: discovering config files under the provided
root, `services.configs` key mapping, read-only answers, local edits, history
when available, rollback diffs, safe removals, and admin-flow specifics for
pool/backend/storage/role/template/validation/workflow/dataset/backend-test
values.

## Examples

```text
User: Config root is /workspace/repo. In sample-prod, which backend does the
gpu-prod pool use?
Agent: Read services.configs.pools.gpu-prod.backend and cite the source path
plus YAML key path.
```

```text
User: Config root is /workspace/repo. Show the diff to put gpu-prod in
maintenance.
Agent: Change only services.configs.pools.gpu-prod.enable_maintenance locally,
show the file diff, and stop before any external process.
```

## Limitations

- This skill prepares local config file changes. It does not deploy, sync,
  patch, drain, cancel workflows, or verify live service state.
- If the target config root does not visibly use `services.configs`, say so
  from file evidence instead of substituting another deployment.
- If required deployment-specific details are missing, ask one targeted
  question and stop before editing.

## Troubleshooting

| Problem | Response |
|---|---|
| Config root is missing | Ask for the exact config root or values file unless the user only wants a generic example. |
| Target deployment is ambiguous | Ask for the exact deployment or values file. |
| User asks for `osmo config` | Refuse the live config path and ask for the config root or values file. |
| User asks for live mutation | Refuse the live path and offer a local config diff. |
| Secret payload is requested | Refuse payload output; cite only secret names and keys. |
