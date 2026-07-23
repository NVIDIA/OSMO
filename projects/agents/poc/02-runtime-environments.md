<!--
Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software without an express license agreement from
NVIDIA CORPORATION is strictly prohibited.
-->

# POC Plan: Runtime Environment Construction

Status: Draft

## Outcome

Build one strong custom agent-runtime image, then run deterministic VDA stages
directly from pinned upstream PAIDF images with custom task bundles. The lead
delegates Swift-backed model-artifact admission to an environment-pipeline
agent. The first POC must not build a new VDA image, start a package manager in
a VDA stage task, or require
Docker-in-Docker or privileged Kubernetes execution.

## Accepted packaging model

```text
custom agent-runtime image
  + frozen lead, environment-pipeline, or video-agent role contract
  -> Codex agent task

pinned upstream PAIDF image
  + frozen stage contract + video-stage bundle
  + verified cache binding
  -> deterministic VDA stage task

pinned model-artifact-materializer base image and downloader entrypoint
  + frozen cache lock
  -> deterministic model-artifact workspace task, on cache miss only
```

The role contract and video-stage bundle are ordinary task files or immutable
input artifacts. They are not OCI layers. A changed video, endpoint reference,
output URL, or non-secret configuration creates a new task contract, not a new
image.

## 1. Agent runtime

The lead, environment-pipeline, and every video-pipeline agent initially share
one custom pinned image.
The image contains only what their actual contracts require:

- `ubuntu:22.04`, resolved to an immutable digest, and system Python `3.10`;
- Node `24.15.0` from the official
  `node-v24.15.0-linux-x64.tar.xz` archive, verified during the image build
  against its published SHA-256 recorded in the runtime lock;
- Codex CLI from npm `@openai/codex` and its container-user-level provider
  configuration;
- the selected NVIDIA model catalog, pinned by content digest;
- existing OSMO CLI/API access; and
- the POC's deterministic plan, capsule, child-admission, result, and
  reconciliation scripts, plus normal shell/core utilities.

Both roles use the `nvidia_inference` custom provider with
`openai/openai/gpt-5.6-terra` at `xhigh` reasoning. The provider uses
`https://inference-api.nvidia.com/v1/`, the Responses wire API, and the
runtime-only `INFERENCE_API_KEY` variable. The image never contains that key.
The lead, environment-pipeline, and video-pipeline capsules receive it through
the OSMO `GENERIC` credential named `nvidia_inference`. Every deterministic
video stage—the original and augmented auto-labeling capsules and the
augmentation capsule—receives that same credential and maps
`INFERENCE_API_KEY` to `NVIDIA_API_KEY` (and any compatible OpenAI-style key
variable) in process before calling the upstream worker. No stage unsets or
persists the key.

The auto-labeling stage's frozen external inference pair is:

| Function | Base URL | Model |
| --- | --- | --- |
| VLM | `https://inference-api.nvidia.com/v1` | `nvidia/meta/llama-3.2-11b-vision-instruct` |
| LLM | `https://inference-api.nvidia.com/v1` | `nvidia/qwen/qwen3-32b` |

The agent-runtime image is published as
`nvcr.io/nvstaging/osmo/agent-runtime:<tag>`. The tag is a build/promotion reference;
workflow capsules use only the resulting
`nvcr.io/nvstaging/osmo/agent-runtime@sha256:<digest>` reference.

The image is built locally with a `linux/amd64` builder and pushed to NVCR before
any workflow submission. OSMO only pulls the resolved digest; it does not build
images, run Docker-in-Docker, or require a privileged task.

All NVCR image pulls use the OSMO `REGISTRY` credential named `ngc_cred`.
It is created with `registry=nvcr.io`, username `$oauthtoken`, and an NGC
API-key `auth` value supplied outside the repository. Workflow capsules record only
the credential name.

The lead, environment pipeline, and video agent differ by frozen role contract,
goal/environment/video inputs, authority, and result destination. They do not
initially require separate image layers or separate images.

## 2. Deterministic VDA stages

The POC uses the following upstream images directly, each pinned by digest
before workflow rendering:

| Stage | Upstream image | Custom packaging |
| --- | --- | --- |
| original label and augmented label | `nvcr.io/nvidia/paidf-auto-labeling@sha256:502c38b95c25d885b4ae56d3ed4b911218d97df4c7d4b640af05587407ec11f7` | stage entrypoint, stage contract, video-stage bundle, result writer |
| augmentation | `nvcr.io/nvidia/paidf-augmentation@sha256:59a14d6f4814245735b8e974be6f5a4dbf1ea8ab4564f7adf36b633ff822e1d1` | stage entrypoint, stage contract, video-stage bundle, result writer |

These digests were resolved from the accepted `:1.0.0` tags. A future image
refresh must resolve and review new digests before changing this lock.
Both resolved images are single `linux/amd64` manifests, matching the POC
platform.

The PAIDF images already provide their VDA application, GPU/CUDA dependencies,
Python environment, `uv`, `python3`, `bash`, `curl`, and necessary shell tools.
The POC supplies its custom integration as files or input artifacts rather than
a derived image layer.

### Dynamic model-artifact workspace

The lead creates the run workspace, then delegates cache admission to the
environment-pipeline agent. That agent computes a cache lock and verifies the
matching `cache-manifest.json` beneath the Swift artifact root. A valid cache is
reused. On a miss or invalid manifest, the environment pipeline submits one
deterministic `model-artifact-materializer-<cache-lock>` capsule, waits for
`cache-result.json`, verifies the resulting manifest, and returns
`environment-ready.json`. Only then does the lead freeze its URLs and digest
into video and VDA-stage contracts.

The materializer task is not an agent and cannot submit work. It can write only
its own content-addressed cache prefix. It uses the pinned Linux amd64 Ubuntu base
`nvcr.io/nvidia/base/ubuntu@sha256:2a9f71d82aa4daac444c1b4b74d5d7b01f93eb23662c1236f89d817f083abecd`
(resolved from `22.04_20240212`) and frozen downloader entrypoint `v1`.
This task alone may install `python3`, `python3-pip`, and `huggingface_hub` at
boot, then download the lock's sources, resolve symlinks, checksum every output,
and publish `cache-manifest.json` and `cache-result.json`. The PAIDF stage images
remain direct, unmodified upstream images and never install packages at boot.

The artifact prefix is durable Swift storage, never a shared node, pod,
container, or filesystem cache. Each PAIDF stage receives the binding as a
declared input and materializes it on its own local disk at the cache paths
required by the upstream application.

The model-artifact materializer alone receives the OSMO `GENERIC` credential `hf_token` as
`HF_TOKEN` to download the accepted Hugging Face model sources. The initial
`e2e` run fixes `superResolution=false` and `seedvrVariant=none`, so it does not
download or require SeedVR.

### Video-stage bundle

Before it submits the first stages, a video agent writes one immutable bundle
for its fixed video. It contains non-secret configuration, helper scripts,
entrypoint version, endpoint references, and checksums. Every stage for that
video receives the same bundle plus its small stage-specific contract and the
lead's verified cache binding.

The custom stage entrypoint runs inside the PAIDF task:

```text
verify contract, bundle, and cache manifest -> materialize scripts/configuration
-> prepare environment and writable cache paths from the binding
-> map `INFERENCE_API_KEY` to in-memory NVIDIA/OpenAI key variables
-> verify declared endpoints and models -> execute PAIDF
-> validate outputs -> write stage-result.json
```

This is initialization of a known application, not environment construction.
It must not install dependencies or mutate the container image.

## Locks

The environment lock records the one custom agent image, both upstream PAIDF
image digests, the Codex provider/model catalog information, model-artifact-materializer
identity, and entrypoint versions. A video-stage bundle manifest records its
own content digest.

```yaml
agentRuntime:
  parent: ubuntu:22.04@sha256:...
  publishReference: nvcr.io/nvstaging/osmo/agent-runtime:<tag>
  image: nvcr.io/nvstaging/osmo/agent-runtime@sha256:...
  registryCredential: ngc_cred
  inferenceCredential: nvidia_inference
  platform: linux/amd64
  node:
    version: 24.15.0
    archive: node-v24.15.0-linux-x64.tar.xz
    archiveSha256: 472655581fb851559730c48763e0c9d3bc25975c59d518003fc0849d3e4ba0f6
  pythonVersion: 3.10
codex:
  package: '@openai/codex'
  version: 0.144.6
  npmIntegrity: sha512-wk+2CWiBNXiJLBoN2D08N9RceWkSBnlgk5g2K1a4CXrP/C0gdlHyRUG7RFzm9y41DCK/7tvCct233JVxyFmznw==
  provider: nvidia_inference
  model: openai/openai/gpt-5.6-terra
  modelCatalogDigest: sha256:...
credentials:
  nvidiaInference:
    name: nvidia_inference
    type: GENERIC
    runtimeKey: INFERENCE_API_KEY
    consumers: [lead-agent, environment-pipeline, video-pipeline, auto-label-original, augment, auto-label-augmented]
  swiftOsmo:
    name: swift_osmo_cred
    type: DATA
    storageRoot: swift://pdx.s8k.io/AUTH_team-osmo/dev/fernandol/agents_poc/
  huggingFace:
    name: hf_token
    type: GENERIC
    runtimeKey: HF_TOKEN
    consumers: [model-artifact-materializer]
vdaEndpoints:
  credential: nvidia_inference
  stageKeyMapping: "INFERENCE_API_KEY -> NVIDIA_API_KEY and compatible OpenAI-style key variables, in process only"
  vlm:
    baseUrl: https://inference-api.nvidia.com/v1
    model: nvidia/meta/llama-3.2-11b-vision-instruct
  llm:
    baseUrl: https://inference-api.nvidia.com/v1
    model: nvidia/qwen/qwen3-32b
stages:
  autoLabelImage: nvcr.io/nvidia/paidf-auto-labeling@sha256:502c38b95c25d885b4ae56d3ed4b911218d97df4c7d4b640af05587407ec11f7
  augmentationImage: nvcr.io/nvidia/paidf-augmentation@sha256:59a14d6f4814245735b8e974be6f5a4dbf1ea8ab4564f7adf36b633ff822e1d1
  entrypointVersion: v1
videoStageBundle:
  manifestDigest: sha256:...
modelArtifactWorkspace:
  runRoot: swift://pdx.s8k.io/AUTH_team-osmo/dev/fernandol/agents_poc/workspaces/vda
  root: swift://pdx.s8k.io/AUTH_team-osmo/dev/fernandol/agents_poc/model-artifacts/vda
  cacheLock: sha256:...
  manifestDigest: sha256:...
  materializer:
    condition: cache-miss-or-invalid-manifest
    image: nvcr.io/nvidia/base/ubuntu@sha256:2a9f71d82aa4daac444c1b4b74d5d7b01f93eb23662c1236f89d817f083abecd
    sourceTag: 22.04_20240212
    entrypointVersion: v1
    bootPackages: [python3, python3-pip, huggingface_hub]
    minimumResources:
      cpu: 4
      memory: 16Gi
      storage: 200Gi
    superResolution: false
    seedvrVariant: none
    sources:
      nvidiaSkillsCommit: 6379b9ce5498d56626caa9e93a8c8a599f90046d
      manifest: model-artifact-materializer/model-artifact-sources-v1.json
      manifestSha256: a588491f689c869f304ecca6f0f536d9636e9fb8d94f27a75606d3e510c41db8
      script: model-artifact-materializer/materialize-model-artifacts.sh
      scriptSha256: cbaa7031eaa58a17c4a1a5216de05f8c84e7c94da5bf24e5e5d7d49cdc54f9d0
```

## Build steps

1. Resolve and record the immutable digest for the accepted `ubuntu:22.04`
   agent-runtime parent.
2. Download the official Node `24.15.0` Linux x64 archive and verify it with
   `sha256sum -c` against the locked published SHA-256 before installing it.
3. Resolve the current latest npm `@openai/codex` release, then record its exact
   version and integrity value in the runtime lock.
4. Build the `linux/amd64` custom agent runtime locally, push its first tag to
   NVCR, resolve its digest, then smoke-test that digest: Node, Codex, OSMO CLI,
   provider configuration, and the POC scripts must be present.
5. Use the locked upstream PAIDF image digests; do not derive them. An
   intentional upstream revision change resolves and reviews replacement
   digests before updating the lock.
6. Define the environment request/ready contract, cache lock, manifest/result
   schema, workspace paths, and one-task model-artifact-materializer capsule.
   Use the pinned Ubuntu base and frozen `v1` downloader script; permit its
   narrowly scoped Python/Hugging Face install only in this cold-cache task.
7. Define the video-stage bundle manifest, stage contracts, and standard
   `init -> execute -> validate -> result` entrypoint.
8. Smoke-test the model-artifact materializer against a fresh cache prefix, then verify its
   manifest and warm-cache reuse path.
9. Smoke-test each VDA stage entrypoint against its selected PAIDF image with a small
   frozen contract.
10. Make the capsule compiler accept only the pinned images, entrypoint version,
   bundle checksum, and non-secret stage contract.

## Validation gates

- The lead, environment pipeline, and video agents run from the same
  agent-runtime digest with distinct frozen role contracts.
- The Node archive hash in the runtime lock matches Node's published SHA-256,
  and the image build fails before installation if the downloaded archive does
  not match it.
- Each capsule that pulls from NVCR references `ngc_cred`; no registry `auth`
  value is present in its YAML, image, lock, or output.
- Lead, environment-pipeline, video-pipeline, and every deterministic video
  stage reference `nvidia_inference`, which supplies `INFERENCE_API_KEY` at
  runtime. Each stage maps it only in process to the key variables required by
  the hosted NVIDIA endpoint; the key is never in an image, bundle, contract,
  lock, prompt, log, or output. No stage targets a local or in-cluster
  inference service.
- Every submitted VDA stage references the pinned upstream PAIDF image digest,
  not a tag alone or a derived image.
- The lead admits video fan-out only after a verified `environment-ready`
  result. On a cold cache, the environment pipeline submits exactly one pinned
  deterministic materializer capsule, which publishes only a new
  content-addressed prefix and a typed cache result.
- The model-artifact materializer is the sole task allowed to install download tooling at
  boot. Its manifest checksums every published cache file before the lead may
  bind the cache; no VDA task may install packages.
- Only the model-artifact-materializer capsule references `hf_token` as `HF_TOKEN`; the
  token is never present in a VDA stage, image, bundle, contract, lock, prompt,
  log, or output.
- Every stage verifies its video-stage bundle before executing and performs no
  package installation at boot, and consumes only a verified cache binding.
- Changing a video/configuration/result destination changes the task contract,
  not an image digest.
- Credentials appear only at runtime and never in an image, bundle, contract,
  lock, prompt, or artifact.

## Exit criterion

The POC can run the lead, one environment-pipeline agent, two video agents, and
all six VDA stages with one custom agent image, two pinned upstream PAIDF
images, auditable per-video stage bundles, and a Swift-backed artifact
workspace. On a cold cache the environment pipeline additionally runs one
pinned deterministic model-artifact-materializer capsule; a warm cache reuses
its immutable manifest.
