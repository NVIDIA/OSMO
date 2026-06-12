# OSMO Workflow Spec

Use this as a compact field map for OSMO workflow YAML. It answers where fields
belong and what shape they take. For examples and procedures, route to
`workflow-patterns.md`, `workflow-advanced-patterns.md`,
`workflow-submit.md`, `workflow-commands.md`, or `workflow-io-spec.md`.

## Minimal Shape

```yaml
workflow:
  name: example
  resources:
    default:
      cpu: 4
      gpu: 1
      memory: 16Gi
      storage: 50Gi
  tasks:
  - name: run
    image: ubuntu:24.04
    command: ["bash", "-c"]
    args: ["echo hello"]
```

## Top Level

| Field | Shape | Notes |
|---|---|---|
| `version` | integer | Optional; use `2` when present. |
| `workflow` | map | Required workflow body. |
| `default-values` | map | Jinja defaults; top-level, not under `workflow`. |

## `workflow`

| Field | Shape | Notes |
|---|---|---|
| `name` | string | Workflow name. |
| `pool` | string | Usually passed with `--pool`. |
| `resources` | map | Named resource profiles. |
| `tasks` | list | Flat tasks. Mutually exclusive with `groups`. |
| `groups` | list | Grouped tasks. Mutually exclusive with `tasks`. |
| `timeout` | map | Optional `exec_timeout` / `queue_timeout`. |

Use exactly one of `tasks` or `groups`.

## Resource Profiles

Resource profiles live under `workflow.resources`.

```yaml
resources:
  default:
    cpu: 8
    gpu: 2
    memory: 32Gi
    storage: 100Gi
    platform: dgx-h100
    nodesExcluded: [node-name]
    topology:
    - key: gpu-clique
      group: default
      requirementType: required
```

Memory and storage must use binary units such as `Gi` or `Mi`. Tasks select a
profile with `resource: <name>`; omitted `resource` means `default`. For
`nodesExcluded` and `topology`, read `workflow-advanced-patterns.md`.

## Tasks

Common task fields:

| Field | Shape | Notes |
|---|---|---|
| `name` | string | Unique task name. |
| `image` | string | Container image. |
| `command` / `args` | list | Entrypoint and arguments. |
| `resource` | string | Resource profile name. |
| `lead` | bool | Required in groups; exactly one lead per group. |
| `environment` | map | Environment variables. |
| `files` | list | Inline files with `path`, `contents`, optional `base64`. |
| `inputs` / `outputs` | list | See `workflow-io-spec.md`. |
| `checkpoint` | list | Periodic upload rules; see advanced patterns. |
| `exitActions` | map | Exit-code handling; see advanced patterns. |

Advanced task fields include `privileged`, `hostNetwork`, `volumeMounts`,
`downloadType`, `cacheSize`, and `backend`.

## Groups

Group workflows use `workflow.groups[].tasks`. Every group must have exactly
one `lead: true` task. The group completes when the lead exits, so the lead
must outlive siblings that need to keep running. For full group patterns, read
`workflow-patterns.md`; for host/runtime tokens, read `workflow-io-spec.md`.
