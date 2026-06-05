# OSMO Workflow Spec

Use this as a compact field map for OSMO workflow YAML. It answers where fields
belong and what shape they take. For examples and procedures, route to
`workflow-patterns.md`, `workflow-advanced-patterns.md`,
`workflow-submit.md`, `workflow-commands.md`, or `workflow-credentials.md`.

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
    args: ["mkdir -p {{output}} && echo hello > {{output}}/result.txt"]
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
| `inputs` / `outputs` | list | Data dependencies and produced artifacts. |
| `credentials` | map | Secret mounts or env projection. |
| `checkpoint` | list | Periodic upload rules; see advanced patterns. |
| `exitActions` | map | Exit-code handling; see advanced patterns. |

Advanced task fields include `privileged`, `hostNetwork`, `volumeMounts`,
`downloadType`, `cacheSize`, and `backend`.

## Inputs

```yaml
inputs:
- task: preprocess
- url: s3://bucket/path/
```

Task inputs create dependencies. Their paths are available as `{{input:0}}`,
`{{input:1}}`, and so on in input-list order.

## Outputs

```yaml
outputs:
- url: s3://bucket/output/
```

Write artifacts under `{{output}}`. Do not use `{{outputs}}`.

## Credentials

```yaml
credentials:
  nvcr:
    NGC_CLI_API_KEY: auth
```

For private images, the credential name must match an OSMO `REGISTRY`
credential. For full setup, read `workflow-credentials.md`.

## Groups

```yaml
workflow:
  name: grouped
  groups:
  - name: workers
    tasks:
    - name: leader
      lead: true
      image: ubuntu:24.04
      command: ["sleep", "300"]
    - name: worker
      image: ubuntu:24.04
      command: ["bash", "-c", "echo {{host:leader}}"]
```

Every group must have exactly one `lead: true` task. The group completes when
the lead exits, so the lead must outlive siblings that need to keep running.
For full group patterns, read `workflow-patterns.md`.

## Tokens and Jinja

| Token | Meaning |
|---|---|
| `{{output}}` | Task output directory. |
| `{{input:N}}` | Nth input path, zero-indexed. |
| `{{workflow_id}}` | Workflow run ID. |
| `{{host:task-name}}` | Host/IP for a task in the same group. |

Template defaults:

```yaml
default-values:
  workflow_name: hello
  image: ubuntu:24.04
```

Submit overrides with `--set`, `--set-string`, or `--set-env`; see
`workflow-commands.md`.
