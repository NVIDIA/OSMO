# OSMO Workflow IO Spec

Use this for workflow `inputs`, `outputs`, runtime tokens, Jinja variables, and
top-level `default-values`. For core task/resource fields, read
`workflow-spec.md`.

## Inputs

```yaml
inputs:
- task: preprocess
- url: s3://bucket/path/
```

Task inputs create dependencies. URL inputs mount external data. Their paths
are available as `{{input:0}}`, `{{input:1}}`, and so on in input-list order.

## Outputs

```yaml
outputs:
- url: s3://bucket/output/
```

Write artifacts under `{{output}}`. Do not use `{{outputs}}`.

```yaml
tasks:
- name: run
  image: ubuntu:24.04
  command: ["bash", "-c"]
  args: ["mkdir -p {{output}} && echo result > {{output}}/result.txt"]
  outputs:
  - url: s3://bucket/output/
```

## Runtime Tokens

| Token | Meaning |
|---|---|
| `{{output}}` | Task output directory. |
| `{{input:N}}` | Nth input path, zero-indexed. |
| `{{workflow_id}}` | Workflow run ID. |
| `{{host:task-name}}` | Host/IP for a task in the same group. |

Use `{{host:task-name}}` only within grouped tasks that run together.

## Jinja Defaults

`default-values` lives at the top level, not under `workflow`.

```yaml
default-values:
  workflow_name: hello
  image: ubuntu:24.04

workflow:
  name: "{{workflow_name}}"
  tasks:
  - name: run
    image: "{{image}}"
```

Submit overrides:

```bash
osmo workflow submit workflow.yaml --set gpu_count=4
osmo workflow submit workflow.yaml --set-string image=ubuntu:24.04
osmo workflow submit workflow.yaml --set-env HTTP_PROXY=http://proxy
```

Use `--set` when numeric casting is desired, `--set-string` to preserve exact
strings, and `--set-env` for workflow environment variables.
