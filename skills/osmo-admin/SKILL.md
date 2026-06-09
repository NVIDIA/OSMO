---
name: osmo-admin
version: "1.0.0"
author: NVIDIA
tags: [osmo, admin, service-config]
tools: [filesystem, shell]
description: >
  Use only for offline/local OSMO service-config admin requests involving
  explicit config roots or values files, or to ask for one when a file-specific
  config request omits it. Do not inspect the workspace to infer a root. Do not
  use for live workflow support, resource capacity, pod/node diagnostics, or
  cluster operations, except live service-config paths that must be refused.
---

# osmo-admin

Use this skill for OSMO configuration administration in a user-provided config
root. Keep this file as a router: load only the reference files needed for the
current request.

## First Action Gate

Before listing, searching, or reading the workspace:

- If the request is live workflow support, resource availability, pod/node
  diagnostics, events, logs, status, or scheduler troubleshooting, do not use
  this skill. Say it needs live workflow or cluster tooling, such as the
  namespace, kube context, or exported diagnostics. If that tooling is missing,
  ask for the missing access details or exported diagnostics and stop. Do not
  attempt local kubeconfig or workspace discovery as a fallback.
- If the request needs file-specific config data but omits an explicit config
  root or values file path, ask for that path and stop. An environment,
  deployment, pool, backend, template, or role name alone is not a config root.
  Do not name a source file, current value, backend, or target YAML key path
  before reading the provided root. Do not read references or list files first;
  after this router confirms the missing root, the next response is the path
  request.
- If the request includes an explicit config root or values file path, continue
  under that exact root string. Use it for discovery, reads, and citations
  unless a tool requires an internal filesystem remap.

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

For file-specific config questions, first check whether the user provided an
explicit config root or values file. If not, activate only to ask for that path;
do not list, search, or read the working directory.

Before activating, confirm the request is about OSMO service-config desired
state or local service-values files. Do not activate for live workflow support
requests, including submitted or running workloads, stuck or pending workflows,
workflow events/logs/status, workflow exec/port-forward/rsync, live resource or
capacity availability, node/pod/scheduler diagnostics, raw Kubernetes
troubleshooting, live cluster operations for workloads or resources, or
incident response. Route those to live workflow or cluster support instead.
Activate for live OSMO service-config requests such as `osmo config`, direct
config API calls, or service ConfigMap reads/writes only to refuse that live
path and ask for an explicit config root or values file for local config work.
If live workflow terms appear, including workflow IDs, stuck, pending, events,
logs, status, pod/node/scheduler diagnostics, resource availability, or GPU
capacity, stop before reading references or local configs and ask for live
workflow or cluster tooling.

Use this skill for OSMO admin questions about:

- pool, backend, platform, quota, maintenance, topology, template, or storage
  desired state
- service config, workflow config, dataset config, backend, role, resource
  validation, pod template, group template, or backend test definitions
- read-only answers such as which pools are in maintenance, which roles grant
  access, which tests attach to a backend, or which mounts a pool resolves to
- local service-values diffs for requested admin changes
- config history or rollback only when history is available in the provided
  config workspace

If the user asks to read or mutate OSMO admin config through a live path such as
`osmo config`, a direct OSMO API config call, or a Kubernetes ConfigMap, use
this skill only to refuse the live path and ask for an explicit config root or
values file for local config work.

Do not use this skill for user workflow submission/debugging, OSMO
installation/deployment, or generic Kubernetes help.

## Core Rules

1. Require an explicit config root or values file path before making
   file-specific claims or edits. Ask for it when missing. Generic example
   requests may be answered without a config root when clearly labeled as
   illustrative.
   A deployment, environment, pool, backend, template, or role name alone is not
   an explicit config root or values file. Generic target descriptions such as
   `the GPU pool`, `the production backend`, or `the default template` are not
   exact target names. Do not search the working directory to infer missing
   roots or targets.
   If the request needs file-specific config data and the user did not provide
   a config root or values file, stop and ask for that path before listing,
   searching, reading, editing local files, or suggesting source files, current
   values, backends, or target YAML key paths.
2. Preserve the user's config root string exactly. Construct paths under that
   root and cite files using that root or paths relative to it. Never replace it
   with the current working directory or another discovered checkout. If local
   tooling maps the supplied root to another filesystem location, use that
   location only for actual reads; keep that mapping internal and cite the
   supplied root string or a path relative to it in the answer.
3. Read `references/service-configs.md` for `services.configs` questions before
   answering or editing.
4. Clarify ambiguous config root, values file, deployment, pool, backend,
   template, role, or local-diff intent before editing. For edits, the config
   root or values file, target deployment or values file, and exact target name
   must all be unambiguous before any file is changed.
5. Answer read-only questions from verified config files and cite the source
   file path plus YAML key path.
6. For requested changes, prepare the smallest local file diff, inspect it, and
   report the before/after value or diff summary plus local validation output
   when run, or the exact statement that no local validation command was found.
7. Do not invent deployment names, file paths, review steps, or config
   relationships. Infer only from provided config files, or use obvious
   placeholder names in clearly labeled examples.
8. Do not treat the working directory as the config root unless the user
   explicitly identifies it as the config root.
9. Never run `osmo config` commands or direct OSMO API config calls, including
   read-only `show`, `list`, `get`, `history`, or `rollback` commands. Answer
   from an explicit config root or values file, or ask for one.
10. Never run live mutation commands, including cluster mutation, deployment
   sync, or rollout commands.
11. Never run destructive shell cleanup or repo-destructive commands, including
   `rm`, `rm -f`, `rm -rf`, `git clean`, `git reset --hard`, or
   `git checkout --`. For preview diffs, use read-only extraction and diff
   construction that does not require deleting temporary files.
12. Never print secret payloads. Refer only to secret names, key names, and
   reference paths.

## Service Config Procedure

For `services.configs` read-only answers, previews, edits, history, and rollback
diffs, follow only the relevant section of `references/service-configs.md`.
Avoid dumping the whole reference when a bounded section is enough. `rg`,
`grep`, `find`, `ls`, and other listings are locator-only; claims require
direct reads or YAML extraction that include the exact source path, key
path, and value or small subtree. After the required exact evidence is collected,
stop gathering and answer.

## Reference Routing

### `references/service-configs.md`

Read for service-values work itself: discovering config files under the provided
root, `services.configs` key mapping, read-only answers, local edits, history
when available, rollback diffs, safe removals, and admin-flow specifics for
pool/backend/storage/role/template/validation/workflow/dataset/backend-test
values.

## Examples

```text
User: Config root is repo. In sample-prod, which backend does the
gpu-prod pool use?
Agent: Read repo/.../pool-configs.yaml, print
services.configs.pools.gpu-prod.backend, and cite repo/.../pool-configs.yaml at
services.configs.pools.gpu-prod.backend.
```

```text
User: Config root is repo. Show the diff to put gpu-prod in
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
| Target deployment or pool is ambiguous | Ask for the config root or values file plus the exact deployment and target name. |
| User asks for `osmo config` | Refuse the live config path and ask for the config root or values file. |
| User asks for live mutation | Refuse the live path and offer a local config diff. |
| Secret payload is requested | Refuse payload output; cite only secret names and keys. |
