<!--
Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software without an express license agreement from
NVIDIA CORPORATION is strictly prohibited.
-->

# Locked POC Topology

Status: Accepted for the first prototype

## Objective

Demonstrate one overarching video-data-augmentation (VDA) `e2e` goal with one
long-lived lead agent, one meaningful video-pipeline agent per approved video,
and dynamic fan-out to deterministic GPU stages. The workload target is the VDA
`e2e` result contract, not the reference VDA workflow YAML itself.

## Fixed platform boundary

- Run in the user's persistent `fernandol-dev.osmo.nvidia.com` environment.
- Do not change OSMO services or introduce a new OSMO control-plane feature.
- Use one custom agent-runtime image plus custom workflow YAML and task scripts.
  The deterministic VDA stages use the selected upstream PAIDF images directly,
  pinned by digest; the POC does not derive VDA worker images.
- The first prototype pins
  `nvcr.io/nvidia/paidf-auto-labeling@sha256:502c38b95c25d885b4ae56d3ed4b911218d97df4c7d4b640af05587407ec11f7`
  for both label stages and
  `nvcr.io/nvidia/paidf-augmentation@sha256:59a14d6f4814245735b8e974be6f5a4dbf1ea8ab4564f7adf36b633ff822e1d1`
  for augmentation.
- Publish the custom agent-runtime image under
  `nvcr.io/nvstaging/osmo/agent-runtime:<tag>`. After publication, every
  submitted workflow references that image by its resolved immutable digest.
- Build that image locally for `linux/amd64`, push it to NVCR, and then resolve
  its pushed digest for workflow use. Image construction is outside OSMO; the
  POC does not use Docker-in-Docker, privileged tasks, or an in-cluster image
  builder.
- Use the OSMO `REGISTRY` credential named `ngc_cred` for every NVCR image
  pull. It represents `registry=nvcr.io`, username `$oauthtoken`, and an NGC
  API-key `auth` value; only its name is referenced by workflow capsules.
- Use the existing `osmo` CLI and OSMO API from task containers for submission,
  query, logs, events, and output retrieval.
- Use the OSMO `DATA` credential named `swift_osmo_cred` for the Swift-backed
  storage root `swift://pdx.s8k.io/AUTH_team-osmo/dev/fernandol/agents_poc/`.
  No secret values are written into workflow YAML, plans, logs, or output
  artifacts.
- For this POC, the lead's task context has full existing-cluster OSMO access:
  it may discover all visible pools and resource profiles and submit work to any
  viable one. It does not create, edit, or delete pools, profiles, quotas, or
  credentials.

## Accepted agent runtime

- The `lead-agent` and `video-pipeline-<video>` agent roles use Codex for their
  agentic loops. They may initially share one custom agent-runtime image; the
  role is a frozen contract, not a requirement for a separate image.
- Both loops use `openai/openai/gpt-5.6-terra` with `xhigh` reasoning through
  the same custom inference endpoint for the duration of the POC. Model
  comparison, routing, and fallback are out of scope.
- The custom inference key is injected only at task runtime. It populates the
  environment variable selected by Codex's custom model-provider configuration;
  it is never baked into an image or written to an artifact.
- The lead and video-pipeline capsules reference the OSMO `GENERIC` credential
  named `nvidia_inference`. Its `INFERENCE_API_KEY` entry supplies that runtime
  variable. The two auto-labeling stage capsules also receive it; their
  entrypoint maps it in-memory to `NVIDIA_API_KEY` immediately before invoking
  the upstream PAIDF worker. Augmentation capsules do not receive it.
- The provider configuration is container-user-level Codex configuration. It
  must not depend on a project `.codex/config.toml`, because that surface cannot
  select a provider or redirect provider authentication.
- The runtime lock records the provider and endpoint contract below, but never
  the inference-key value.

```toml
model = "openai/openai/gpt-5.6-terra"
model_provider = "nvidia_inference"
model_reasoning_effort = "xhigh"

[model_providers.nvidia_inference]
name = "Nvidia Inference (Codex)"
base_url = "https://inference-api.nvidia.com/v1/"
env_key = "INFERENCE_API_KEY"
wire_api = "responses"
requires_openai_auth = false
```

The custom image also carries the compatible Codex model catalog currently used
by the selected provider. Its path and content digest are recorded in the
runtime lock.

The VDA auto-labeling stages use NVIDIA Inference directly, without in-cluster
NIMs:

```text
VLM: https://inference-api.nvidia.com/v1
     nvidia/meta/llama-3.2-11b-vision-instruct
LLM: https://inference-api.nvidia.com/v1
     nvidia/qwen/qwen3-32b
```

The entrypoint performs bounded endpoint/model readiness checks before it runs
PAIDF. It never writes the key into the stage bundle, contract, log, or result.

The custom agent-runtime parent is `ubuntu:22.04`, resolved to an immutable
digest when the image is built. Codex is installed from the npm
`@openai/codex` package and runs on Node `24.15.0`. The image build downloads
the official `node-v24.15.0-linux-x64.tar.xz` archive and verifies its
published SHA-256 against the value in the runtime lock before installation.
Each intentional image refresh resolves the latest Codex release, then records
its exact package version and npm integrity value in the runtime lock;
submitted agent images remain immutable by digest. The current resolved Codex
release is `0.144.6`. The agent runtime uses Ubuntu 22.04's Python `3.10` for
its deterministic POC wrappers and targets `linux/amd64`; the PAIDF stage
images retain their own Python environments.

## Accepted hierarchy

```text
one OSMO workflow: lead-agent
  one long-lived agentic loop for the entire batch goal
  creates the run workspace and freezes batch scope
  submits one environment-pipeline agent and waits for its environment-ready
  result before admitting video work
  submits one video-pipeline agent per approved video, then joins their
  terminal video results

  one OSMO workflow: environment-pipeline-<run-id>
    one bounded agentic loop for the frozen environment request
    verifies the versioned model-artifact workspace; on a cache miss or invalid
    manifest, submits exactly one deterministic materializer and reconciles it
    returns environment-ready with the verified artifact binding

    one OSMO workflow: model-artifact-materializer-<cache-lock> (conditional, cache miss only)
    one deterministic task; no agent loop and no delegation authority
      materializes the declared PAIDF model caches into a new Swift artifact
      prefix, verifies them, then writes cache-manifest.json and cache-result.json

  one OSMO workflow: video-pipeline-<video-a>
    one bounded agentic loop for exactly video A
    validates its video/configuration, then submits in parallel:
      auto-label-original-<video-a>      deterministic GPU task
      augment-<video-a>                  deterministic GPU task
    after a valid augmentation result, submits:
      auto-label-augmented-<video-a>     deterministic GPU task
    joins original and augmented label results into video-result-A

  one OSMO workflow: video-pipeline-<video-b>
    ... identical bounded state machine for video B

  ... one video-pipeline agent for each additional approved video
```

OSMO does not provide a dynamic parent/child workflow graph. The hierarchy is
therefore a control relationship: the still-running parent agent records and
reconciles the workflow IDs it submits through the existing CLI/API.

## Accepted first input batch

The first executable proof uses the official VDA demo dataset, mirrored once to
the active OSMO data backend as dataset `vda-poc-two-video`. The pinned source
is Hugging Face `nvidia/video-data-augmentation-demo` at revision
`0b914ba2d32bd6991e73e31f0de7c9d381076e17`. Its exact input manifest is:

| Video | Bytes | SHA-256 |
| --- | ---: | --- |
| `03_IllegalOccupation_020_10FPS.mp4` | 553,882 | `2dd910428c16c264c7eff6882ae6f71559950981b4cd32c5f99e37163c808c1b` |
| `goal_0086_0hz_6sec.mp4` | 5,636,273 | `2c5f0beff432de6cdcd32af8fb3497ae4eb5ee5d732e91ebd577899bbfadd5bb` |

The data-backend root and its required layout are:

```text
swift://pdx.s8k.io/AUTH_team-osmo/dev/fernandol/agents_poc/datasets/vda-poc-two-video/<the two input videos>
swift://pdx.s8k.io/AUTH_team-osmo/dev/fernandol/agents_poc/datasets/vda-poc-two-video-outputs/run-<uuid>/
  outputs/...
  agent/lead/...
  agent/videos/<video>/...
```

The one-time demo mirror verifies this manifest before upload. It is input
provisioning outside the lead workflow, not a setup workflow or task-stage
initialization. Lead and video agents receive only the immutable OSMO data URLs
and checksums.

## Dynamic model-artifact workspace

The lead creates a durable Swift-backed run workspace and delegates artifact
admission to one environment-pipeline agent. That agent reuses or, on a cold
cache, materializes the separate content-addressed model-artifact workspace:

```text
swift://pdx.s8k.io/AUTH_team-osmo/dev/fernandol/agents_poc/workspaces/vda/<run-id>/
  goal-plan.json
  cache-request.json
  cache-binding.json
  videos/<video>/video-stage-bundle.tar.gz
  videos/<video>/video-result.json

swift://pdx.s8k.io/AUTH_team-osmo/dev/fernandol/agents_poc/model-artifacts/vda/<cache-lock>/
  cosmos_transfer/...
  auto_labeling/...
  cache-manifest.json
  cache-result.json
```

The cache lock covers the selected cache source revisions, downloader entrypoint
version, checksum policy, and `superResolution=false`. The first `e2e` POC does
not fetch or use SeedVR. The environment-pipeline agent first verifies
`cache-manifest.json`. On a miss or failed verification, it dynamically submits
one typed `model-artifact-materializer` capsule, waits for its terminal
`cache-result.json`, verifies the manifest, and returns `environment-ready.json`
with the cache URLs and digest. The lead freezes that verified binding into every
video-agent and stage contract. The materializer may write only its own
`<cache-lock>` prefix; it never mutates a prior cache or a run workspace.

The Swift prefix is durable object storage, not a shared pod, container, node,
or filesystem cache. Every downstream PAIDF task receives the verified binding
as a declared input and materializes the required model files on its own local
disk at the PAIDF-required cache paths.

The model-artifact materializer is one deterministic task from
`nvcr.io/nvidia/base/ubuntu@sha256:2a9f71d82aa4daac444c1b4b74d5d7b01f93eb23662c1236f89d817f083abecd`
(the pinned `22.04_20240212` image). Its frozen `v1` downloader script is the
only POC task permitted to install tooling at boot: it installs `python3`,
`python3-pip`, and `huggingface_hub`; downloads the locked cache sources with
`HF_TOKEN`; resolves cache symlinks into Swift-safe files; writes file checksums
to `cache-manifest.json`; then writes `cache-result.json` and exits. It is not
the reference VDA cache workflow and does not create other workflows.
The lead selects a visible profile meeting the materializer minimum of 4 CPU,
16 GiB memory, and 200 GiB local storage before it admits this capsule.
Its source manifest and script are pinned from NVIDIA Skills commit
`6379b9ce5498d56626caa9e93a8c8a599f90046d` at
[`model-artifact-sources-v1.json`](model-artifact-materializer/model-artifact-sources-v1.json)
and
[`materialize-model-artifacts.sh`](model-artifact-materializer/materialize-model-artifacts.sh).
Their SHA-256 values are recorded in the environment lock.

## Role contracts

| Capsule | Type | May submit | Must return |
| --- | --- | --- | --- |
| `lead-agent` | long-lived agentic loop | exactly one `environment-pipeline-<run-id>`, then exactly one `video-pipeline-<video>` workflow per approved video after `environment-ready` | goal plan with selected capacity, environment and video-agent bindings, material status, and final batch evaluation |
| `environment-pipeline-<run-id>` | bounded agentic loop | at most one `model-artifact-materializer-<cache-lock>` when its cache verification fails | verified artifact binding and `environment-ready.json` |
| `model-artifact-materializer-<cache-lock>` | deterministic one-task workflow | nothing | verified model-artifact workspace, cache manifest, and terminal cache result |
| `video-pipeline-<video>` | bounded agentic loop | two first-stage workers, then one augmented-label worker only after valid augmentation | stage bindings, stage results, and one video result |
| `auto-label-original-<video>` | deterministic one-task workflow | nothing | original-video pseudo-label artifacts and a terminal result |
| `augment-<video>` | deterministic one-task workflow | nothing | augmented-video artifacts and a terminal result |
| `auto-label-augmented-<video>` | deterministic one-task workflow | nothing | augmented-video pseudo-label artifacts and a terminal result |

Each video agent's authority is intentionally narrow: one fixed video, fixed
stage image/profile references, a fixed join policy, and no changes to
credentials, resource classes, or the batch goal. It may submit its augmented
label worker only after the augmentation result satisfies its frozen gate.
The lead discovers and selects the pool, resource profile, and batch concurrency
limit before it delegates. The environment pipeline owns artifact admission;
the lead only binds its verified result into the child contracts. The
materializer has no authority beyond publishing its own immutable cache prefix.

## Video initialization and stage entrypoint

Each video agent performs one deterministic **video initialization** inside its
own agent task before submitting any stage. It validates the fixed video and
configuration, then writes one immutable video-stage bundle containing the
non-secret configuration, helper scripts, entrypoint version, endpoint
references, and checksums needed by all stages for that video.

Each child is still a one-task OSMO workflow. Its custom stage entrypoint runs
this sequence inside the selected upstream PAIDF image:

```text
verify frozen stage contract and video-stage bundle
  -> materialize scripts/configuration at expected paths
  -> set environment and writable cache paths
  -> map `INFERENCE_API_KEY` to the PAIDF process's `NVIDIA_API_KEY`
  -> verify or wait for declared inference endpoints and models
  -> execute the installed PAIDF application
  -> validate declared outputs and write stage-result.json
```

This is task initialization, not package initialization: no VDA stage runs
`apt`, `pip`, `uv sync`, or any other dependency installation at boot. The stage
bundle and verified cache binding are task inputs; they do not alter the PAIDF
image.

## Workflow count and topology estimate

For `N` approved videos:

| Measure | Value |
| --- | --- |
| Total OSMO workflows, warm cache | `2 + 4N`: lead, one environment pipeline, `N` video agents, and `3N` deterministic VDA stages |
| Total OSMO workflows, cold cache | `3 + 4N`: warm-cache topology plus one model-artifact-materializer workflow |
| Agentic-loop workflows | `2 + N`: one lead, one environment pipeline, and one video agent per approved video |
| Deterministic GPU workflows | `3N`: original label, augmentation, and augmented label per video |
| Deterministic cache workflows | `0` warm; `1` cold, with no agent loop or delegation |
| Dynamic submissions by the lead | `1 + N` in either case: one environment pipeline, then one video pipeline per approved video after `environment-ready` |
| Dynamic submissions by the environment pipeline | `0` warm; `1` cold: one materializer only when cache verification fails |
| Dynamic submissions by each video agent | 2 immediately, then 1 after valid augmentation |
| Delegation depth below lead | 2 levels: environment/video agent, then deterministic materializer/VDA stage |
| Meaningful fan-out width | `N` at the lead; 2 parallel first-stage workers per video agent |
| Peak GPU tasks | up to `2N`, subject to the frozen concurrency limits |

With one video, this is six warm-cache or seven cold-cache workflows and proves
a genuine branch, dependency gate, join, and conditional recursive materializer.
With two videos, it is ten warm-cache or eleven cold-cache workflows and proves
both environment preparation and recursive agent delegation without an
artificial agent.

## Worker output contract

Each deterministic stage uses its pinned upstream PAIDF image and the custom
task entrypoint with frozen video/configuration, output URL, and GPU request.
The per-video result must contain the VDA `e2e` output layout:

```text
<run-root>/outputs/pseudo_labeled/<video>/
<run-root>/outputs/augmented/<video>_aug0/
<run-root>/outputs/pseudo_labeled_augmented/<video>_aug0/
```

The video agent writes `video-result.json` only after applying its frozen join
policy to the original and augmented pseudo-label results. The acceptance
criterion is output-contract equivalence: required layout, result schema, and
successful labeling semantics. It is not byte-for-byte identity, because model
inference and generated labels can vary between otherwise equivalent runs.

## Explicit exclusions

- No preflight workflow. Preflight is a deterministic action within the lead or
  the relevant video-pipeline task.
- No static or platform-managed setup workflow. The goal-specific environment
  pipeline is a bounded agentic child of the lead and may submit the conditional
  deterministic materializer after it detects a missing or invalid cache. Video
  initialization remains an action within the video agent; stage initialization
  remains an action within its one deterministic task.
- No static task fan-out is used to simulate dynamic delegation.
- No deterministic stage is an agent or may submit another workflow.
- No VDA-stage image derivation or package installation at task boot in the
  first proof.
- No rewrite or reuse of the reference VDA workflow as the POC implementation.
- No OSMO service mutation, custom scheduler, or new workflow primitive.
- No aggregate spend limit, storage-retention policy, or human approval gate in
  the first POC.

## Operational policy

- Agents proceed without a human checkpoint. They request human intervention
  only when an ambiguity cannot be resolved safely from the frozen contracts,
  declared evidence, and OSMO state.
- There is no numeric retry ceiling. The owning lead, environment-pipeline, or
  video-pipeline agent evaluates a failed workflow, repairs or re-renders the
  next safe attempt when needed, and retries indefinitely.
- A retry is always a new immutable OSMO workflow capsule with its own
  submission key and workflow binding. The agent reconciles the prior attempt
  before submitting the next one; it never treats an ambiguous submit as a
  license to duplicate work.
- Individual capsules retain their frozen resource and timeout settings. The
  absence of a total spend cap does not permit mutation of pools, profiles,
  quotas, or credentials.

## Lifecycle

1. The user starts the `lead-agent` workflow with the goal and accepted VDA
   `e2e` batch scope.
2. The lead creates the versioned run workspace, lists the visible pools and
   resource profiles, chooses viable capacity, and freezes the selected pool,
   resource profile, and batch
   concurrency limit into the batch plan.
3. The lead submits exactly one `environment-pipeline-<run-id>` agent with the
   frozen environment request. That agent computes the cache lock, verifies the
   matching model-artifact workspace, and on a miss or invalid manifest submits
   exactly one materializer workflow. It reconciles the terminal result and
   returns a verified `environment-ready.json` binding.
4. The lead validates `environment-ready.json`, freezes the verified binding
   into the batch plan, validates representative capsules, then submits one
   `video-pipeline-<video>` agent per approved video.
5. Each video agent validates its fixed video/configuration and publishes its
   immutable video-stage bundle. A failed validation writes a typed video result;
   it does not create a setup workflow.
6. Each ready video agent submits `auto-label-original-<video>` and
   `augment-<video>` in parallel and records both bindings.
7. Each stage initializes from the frozen stage contract, video-stage bundle,
   and cache binding, executes the installed PAIDF application, validates its
   output, and writes a typed stage result.
8. After a valid augmentation result, that video agent submits exactly one
   `auto-label-augmented-<video>` workflow.
9. The video agent reconciles its original and augmented label results, writes
   `video-result.json`, and returns it to the lead.
10. The lead joins all video results and evaluates the batch against the `e2e`
   output contract before reporting completion. It retries unresolved failures
   under the operational policy, requesting a human decision only for a
   safe-unresolvable ambiguity.

## Prototype gate

The first executable prototype is accepted when a two-video batch shows:

1. on a cold cache, one lead dynamically submitting exactly one environment
   pipeline, which dynamically submits exactly one materializer workflow,
   validates its immutable cache manifest, and returns `environment-ready`
   before the lead submits exactly two per-video pipeline agents;
2. each video agent dynamically submitting two parallel first-stage workers,
   then one augmented-label worker only after valid augmentation evidence;
3. each VDA stage executing its initialization sequence from the video-stage
   bundle and verified cache binding without installing dependencies;
4. all stage bindings and video results recoverable from declared outputs; and
5. both videos producing valid original and augmented VDA pseudo-label outputs.
