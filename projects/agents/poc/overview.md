<!--
Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software without an express license agreement from
NVIDIA CORPORATION is strictly prohibited.
-->

# POC Workflow Overview

Status: Draft

## Scope

This document defines only the static OSMO workflow capsule used by the POC:
its rendered YAML, existing OSMO CLI commands, and the construction-to-result
sequence. The OSMO-hosted lead, video-stage bundle writer, stage entrypoint, and
child-admission policy are specified elsewhere; this document consumes their
frozen outputs.

The first capsule contains one `worker` task. A child worker is a new capsule
that follows this same document; it is not added to an already submitted
workflow.

## Frozen compiler inputs

Before a workflow is rendered, the POC must have these values:

| Input | Workflow use |
| --- | --- |
| workflow name | `workflow.name`; deterministic and Kubernetes-safe |
| pool | passed to OSMO with `--pool` |
| image digest | `tasks[].image`; immutable OCI reference |
| resource profile | `workflow.resources` and `tasks[].resource` |
| execution and queue limits | `workflow.timeout.exec_timeout` and `workflow.timeout.queue_timeout` |
| worker contract | inline `files` entry or immutable input artifact |
| stage entrypoint and stage contract | custom task script and small non-secret contract file |
| video-stage bundle URL | declared `tasks[].inputs` artifact shared by all stages for one video |
| cache binding URL and manifest digest | declared `tasks[].inputs` shared by all stages for one batch |
| input artifact URLs | `tasks[].inputs` |
| result and evidence URL | `tasks[].outputs` |
| non-secret correlation fields | `tasks[].environment` |

Credentials are referenced through OSMO's existing credential mechanism. Secret
values never enter the workflow file, inline worker contract, environment lock,
or result artifact.

For the custom runtime and upstream PAIDF images, create the NVCR pull
credential once in the persistent environment. Substitute the API-key value
locally; do not paste it into this document or a workflow file.

```bash
osmo credential set ngc_cred \
  --type REGISTRY \
  --payload \
  registry=nvcr.io \
  username='$oauthtoken' \
  auth='<ngc-api-key>'
```

Each NVCR-backed capsule then references `ngc_cred` by name only.

Create the Codex inference credential separately. Only the lead,
environment-pipeline, and video-pipeline agent capsules and the two
auto-labeling stage capsules reference it; it is injected as
`INFERENCE_API_KEY` at task runtime. The auto-label entrypoint maps it to
`NVIDIA_API_KEY` only in its process environment because the upstream PAIDF
worker accepts that conventional key name. The OSMO credential still has exactly
one secret entry.

```bash
osmo credential set nvidia_inference \
  --type GENERIC \
  --payload INFERENCE_API_KEY='<inference-api-key>'
```

The frozen VDA endpoint pair is:

```text
vlm_url=https://inference-api.nvidia.com/v1
vlm_model=nvidia/meta/llama-3.2-11b-vision-instruct
llm_url=https://inference-api.nvidia.com/v1
llm_model=nvidia/qwen/qwen3-32b
```

Create the Swift `DATA` credential once in the persistent environment. Supply
the access key only from a local secret source.

```bash
osmo credential set swift_osmo_cred \
  --type DATA \
  --payload \
  access_key_id='fernandol:AUTH_team-osmo' \
  access_key='<swift-access-key>' \
  endpoint='swift://pdx.s8k.io/AUTH_team-osmo' \
  region=us-east-1
```

Create the Hugging Face credential after accepting model terms. Only the
conditional model-artifact-materializer capsule references it.

```bash
read -s "HF_TOKEN?Paste Hugging Face read token: "; echo
osmo credential set hf_token \
  --type GENERIC \
  --payload "HF_TOKEN=$HF_TOKEN"
unset HF_TOKEN
```

## First POC input batch

Use the two-video official VDA demo batch, not arbitrary sample media. Its
source is Hugging Face `nvidia/video-data-augmentation-demo` at revision
`0b914ba2d32bd6991e73e31f0de7c9d381076e17`:

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `03_IllegalOccupation_020_10FPS.mp4` | 553,882 | `2dd910428c16c264c7eff6882ae6f71559950981b4cd32c5f99e37163c808c1b` |
| `goal_0086_0hz_6sec.mp4` | 5,636,273 | `2c5f0beff432de6cdcd32af8fb3497ae4eb5ee5d732e91ebd577899bbfadd5bb` |

Before the first lead submission, mirror and verify the files at:

```text
https://pdx.s8k.io/v1/AUTH_team-osmo/dev/fernandol/agents_poc/datasets/vda-poc-two-video/
```

The lead generates `run-<uuid>` and places VDA results and agent records under:

```text
https://pdx.s8k.io/v1/AUTH_team-osmo/dev/fernandol/agents_poc/datasets/vda-poc-two-video-outputs/run-<uuid>/
```

This is the backend-native root for `swift_osmo_cred`. The mirror is a one-time
input-provisioning action, not an OSMO workflow or a task bootstrap step.

## Model-artifact workspace admission

Before video fan-out, the lead creates:

```text
https://pdx.s8k.io/v1/AUTH_team-osmo/dev/fernandol/agents_poc/workspaces/vda/<run-id>/
```

The lead submits `environment-pipeline-<run-id>` with this workspace as a
frozen input. The environment pipeline computes a cache lock and checks the
corresponding immutable manifest under:

```text
https://pdx.s8k.io/v1/AUTH_team-osmo/dev/fernandol/agents_poc/model-artifacts/vda/<cache-lock>/cache-manifest.json
```

If the manifest is missing or fails verification, the environment pipeline
renders, dry-runs, validates, and submits exactly one
`model-artifact-materializer-<cache-lock>` capsule. It waits for
`cache-result.json`, verifies the manifest, and writes `environment-ready.json`.
The lead freezes that result's cache binding into all video and VDA-stage
contracts. The materializer has one deterministic task, may write only its own
cache-lock prefix, and cannot submit another workflow. Its initial contract
fixes `superResolution=false` and `seedvrVariant=none`. It runs from
`nvcr.io/nvidia/base/ubuntu@sha256:2a9f71d82aa4daac444c1b4b74d5d7b01f93eb23662c1236f89d817f083abecd`
with frozen downloader entrypoint `v1`; it alone installs Python and
`huggingface_hub` at boot, then checksums and publishes the cache manifest.
The environment pipeline validates that the lead-selected profile has at least
4 CPU, 16 GiB memory, and 200 GiB local storage for this one task.
The frozen source manifest and script are
[`model-artifact-sources-v1.json`](model-artifact-materializer/model-artifact-sources-v1.json)
and
[`materialize-model-artifacts.sh`](model-artifact-materializer/materialize-model-artifacts.sh),
derived from NVIDIA Skills commit `6379b9ce5498d56626caa9e93a8c8a599f90046d`.

This prefix is durable Swift object storage, not a shared node, pod, container,
or filesystem cache. Every PAIDF task receives the binding as a declared input
and materializes it on that task's own local disk at the upstream-required cache
paths.

The generated model-artifact-materializer capsule maps the secret without embedding it:

```yaml
credentials:
  hf_token:
    HF_TOKEN: HF_TOKEN
```

## Initial workflow specification

```yaml
version: 2
workflow:
  name: goal-<goal-id>-worker-<attempt-id>
  timeout:
    queue_timeout: 10m
    exec_timeout: 30m
  resources:
    worker:
      cpu: 2
      memory: 4Gi
      storage: 10Gi
  tasks:
  - name: worker
    image: nvcr.io/nvstaging/osmo/agent-runtime@sha256:<image-digest>
    command: ["/opt/osmo-agent/run"]
    args:
    - "--contract"
    - "/run/osmo/worker-contract.yaml"
    - "--result"
    - "{{output}}/result.json"
    resource: worker
    environment:
      GOAL_ID: <goal-id>
      PLAN_REVISION: <plan-revision>
      ATTEMPT_ID: <attempt-id>
      CORRELATION_ID: <correlation-id>
    files:
    - path: /run/osmo/worker-contract.yaml
      contents: |
        # Frozen worker contract; no secrets.
        output: "{{output}}/result.json"
    inputs:
    - url: s3://<artifact-store>/<goal-id>/inputs/
    outputs:
    - url: s3://<artifact-store>/<goal-id>/attempts/<attempt-id>/
```

### Workflow rules

- Use `version: 2`.
- Use exactly one of `workflow.tasks` or `workflow.groups`. The initial POC
  uses one task, not a group.
- Use binary resource units such as `Gi` and `Mi`.
- Pin `image` by digest before rendering.
- `{{input:N}}` refers to task inputs by list order; `{{output}}` is the task
  output directory.
- `files` carries only a small frozen contract. Large inputs use an artifact
  URL.
- `environment` is for traceability and non-secret runtime configuration, not
  credentials or authority.
- A workflow is immutable after submission. A changed image, command,
  resource, input, output, or timeout produces a new capsule and attempt.

### E2E stage initialization

Each deterministic VDA `e2e` stage is a one-task capsule using the selected
upstream PAIDF image by digest. Its command invokes the custom stage entrypoint
from the task files or a declared input artifact. The entrypoint runs inside the
same task, in this order:

```text
verify stage contract, video-stage bundle, and cache binding -> materialize
scripts/config -> prepare writable cache paths from the verified binding
-> map `INFERENCE_API_KEY` to `NVIDIA_API_KEY` for auto-labeling only
-> verify declared endpoints and models -> execute PAIDF
-> validate outputs -> write stage-result.json
```

The video-stage bundle is produced by the parent video agent before stage
submission and is a declared child input. The lead-provided cache binding is a
second declared child input. Initialization must not install dependencies or
mutate the PAIDF image.

## Existing OSMO commands

The POC wraps or invokes these existing commands. No new user-facing CLI name
is chosen yet.

### Discover the target

```bash
osmo pool list --format-type json
osmo resource list --pool <pool> --format-type json
```

At the start of the batch, the lead runs this discovery, evaluates every pool
and resource profile visible to its task context, and selects viable capacity.
It records the selected pool, resource profile, and batch concurrency limit in
the goal plan, then freezes them into child contracts. The POC grants this
selection and submission authority without a static allowlist; it does not
grant mutation of cluster resources, quotas, or credentials.

### Render and validate before submission

```bash
# Render the fully substituted workflow without submitting it.
osmo workflow submit <capsule.yaml> --pool <pool> --dry-run \
  --format-type json

# Validate workflow shape, pool, resources, credentials, and image access
# without starting it.
osmo workflow validate <capsule.yaml> --pool <pool>
```

### Submit and record the binding

```bash
osmo workflow submit <capsule.yaml> --pool <pool> --format-type json
```

The local POC records the submission key before this command, then records the
workflow ID and UUID returned by OSMO. It must reconcile an ambiguous command
failure before trying another submission.

### Reconcile a submitted workflow

```bash
osmo workflow query <workflow-id> --format-type json
osmo workflow logs <workflow-id> -n 10000
osmo workflow events <workflow-id>
osmo workflow spec <workflow-id> --template
```

When the worker's output is in object storage, retrieve it only after OSMO
reports a terminal state:

```bash
osmo data download <result-output-url> <local-result-dir>
```

Cancellation is a separate, explicit action:

```bash
osmo workflow cancel <workflow-id> --message <reason> --format-type json
```

## Workflow sequence

| Step | Action | Output and gate |
| --- | --- | --- |
| 0. Environment admission | The lead creates the run workspace and submits one environment-pipeline capsule. That agent verifies the cache manifest and, on a miss, executes this same sequence once for a materializer capsule. | A verified `environment-ready` binding exists before video fan-out. |
| 1. Freeze | Read the selected image digest, resource profile, stage contract, video-stage bundle URL, cache binding, artifact URLs, pool, and timeout values. | All inputs are versioned and non-secret. |
| 2. Render | Generate `capsule.yaml` from the frozen inputs. | One-task static workflow; no runtime package installation or dynamic graph fields. |
| 3. Dry-run | Run `osmo workflow submit ... --dry-run`. | Record rendered output; stop if rendering fails. |
| 4. Validate | Run `osmo workflow validate`. | Stop if schema, pool, quota, credential, or registry validation fails. |
| 5. Reserve | Persist one submission key and the canonical capsule hash. | A retry uses reconciliation, not a second untracked submit. |
| 6. Submit | Run `osmo workflow submit`. | Record the returned workflow binding. |
| 7. Reconcile | Query status and, when needed, fetch logs and events. | Convert OSMO state to the attempt state; do not infer terminal state from silence. |
| 8. Collect | Read the terminal result and referenced evidence from the declared output URL. | Reject a missing or schema-invalid result, including cache results. |
| 9. Evaluate | Check the result against the capsule's declared acceptance criterion. | Record pass, fail, or unresolved; only a pass permits completion. |

For a child request, child admission freezes a new set of inputs and restarts at
step 1. It never modifies the parent workflow or skips dry-run and validation.

## Local wrapper operations to build

The POC implementation needs thin local wrappers around the preceding commands:

| Operation | Uses |
| --- | --- |
| `render` | frozen inputs -> `capsule.yaml` |
| `preview` | OSMO dry-run -> rendered record |
| `validate` | OSMO validation -> validation record |
| `submit` | reserve key -> OSMO submit -> workflow binding |
| `reconcile` | OSMO query/logs/events -> attempt event |
| `collect` | output URL -> Result Envelope and evidence references |

These operations are deterministic adapters. The agent proposes work and reads
their records; it does not author unvalidated executable YAML or invoke an
unrecorded submission.
