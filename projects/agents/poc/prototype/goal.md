# VDA two-video POC

Complete the locked VDA `e2e` demonstration for exactly the two inputs below.
Follow the accepted topology and contracts in
`projects/agents/poc/locked-topology.md`,
`projects/agents/poc/00-architecture-and-contracts.md`, and
`projects/agents/poc/02-runtime-environments.md`. Do not change those
constraints or substitute inputs, models, images, or storage locations.

## Immutable inputs

| Video | OSMO data URL | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `03_IllegalOccupation_020_10FPS.mp4` | `swift://pdx.s8k.io/AUTH_team-osmo/dev/fernandol/agents_poc/datasets/vda-poc-two-video/03_IllegalOccupation_020_10FPS.mp4` | 553882 | `2dd910428c16c264c7eff6882ae6f71559950981b4cd32c5f99e37163c808c1b` |
| `goal_0086_0hz_6sec.mp4` | `swift://pdx.s8k.io/AUTH_team-osmo/dev/fernandol/agents_poc/datasets/vda-poc-two-video/goal_0086_0hz_6sec.mp4` | 5636273 | `2c5f0beff432de6cdcd32af8fb3497ae4eb5ee5d732e91ebd577899bbfadd5bb` |

The input source is Hugging Face
`nvidia/video-data-augmentation-demo` at
`0b914ba2d32bd6991e73e31f0de7c9d381076e17`; the Swift mirror has already
been verified against this manifest.

## Scheduling and recovery policy

Every agent that submits a capsule must inspect all OSMO pools and resource
profiles accessible to the user with the OSMO CLI before that submission. From
the compatible eligible choices, select the best-fit pool and platform for its
specific capsule based on its declared resource profile, pinned-image platform
compatibility, and current observed scheduling evidence. The creator's pool is
not a default or a constraint on a child. Record the considered eligible
choices, selected pool, platform, priority, workflow ID, output URL, and reason
for the selection in durable evidence. A selection is frozen for that immutable
capsule only; a later replacement repeats this selection and may use a different
verified eligible pool or platform.

Set the priority from the capsule's declared resource profile: submit every
CPU-only capsule at `HIGH` priority (the lead, environment pipeline,
per-video pipelines, CPU-only materializer, and equivalent CPU-only work), and
submit every GPU-requesting deterministic VDA capsule at `LOW` priority
(PAIDF auto-labeling, PAIDF augmentation, and equivalent GPU work). Low
priority is intentionally allowed to bypass normal quota when physical capacity
is idle and may be preempted. Do not alter OSMO pools, profiles, quotas,
credentials, or service configuration.

There is no numeric retry or resubmission limit for this run. A pending task,
temporary capacity or quota block, preemption, or failed child is a known
non-terminal condition: preserve the evidence, reconcile the existing
workflow, then recover or retry. If a non-running child is demonstrably blocked
and a different verified eligible pool could make progress, you are authorized
to cancel that child without `--force`, wait for its terminal state, and submit
a new immutable replacement. Never cancel a running child merely to chase
capacity, and never submit a replacement before the prior attempt is terminal.
If no safe replacement exists yet, return `Retrying` and reconcile again after
the runtime's controlled delay. Ask the human only when the next safe action is
genuinely ambiguous after inspecting the frozen contracts, evidence, and OSMO
state.

## Immutable recovery rules for this run

Use a new `RUN_ID` and a new content-addressed cache lock for this run. Never
reuse, overwrite, or repair the earlier cache generation. The cache lock must
cover the current source-manifest SHA-256, materializer-script SHA-256,
consumer-readiness-verifier SHA-256, and consumer-ready publication policy.

The VDA-specific source of truth is the static repository at this task's exact
`STATIC_REPOSITORY_REF`:

```text
projects/agents/poc/model-artifact-materializer/
  model-artifact-sources-v1.json
  materialize-model-artifacts.sh
  verify-vda-cache.py
```

The task's static-kit subdirectory may not include those sibling files. When
their bytes are needed, clone `STATIC_REPOSITORY_URL` at exactly
`STATIC_REPOSITORY_REF`, verify the detached commit, and use those files. Do
not replace them with copied, invented, or differently-versioned inline code.

The environment pipeline may issue `environment-ready.json` only after it has
verified the materializer's root-level `cache-manifest.json` and
`cache-result.json`, their SHA-256 values, and the remote object inventory
required by the v2 manifest. The v2 manifest intentionally excludes only the
declared transient Hugging Face metadata; do not require excluded `.locks`,
`xet`, `.agent_harnesses.json`, `.no_exist`, or `trees/*.json` objects.

Write `environment-ready.json` with these exact, explicit fields:

```json
{
  "schemaVersion": "v2",
  "outcome": "Completed",
  "cacheLock": "<content-addressed-lock>",
  "artifactRootUrl": "swift://.../model-artifacts/vda/<cache-lock>/",
  "payloadUrl": "swift://.../model-artifacts/vda/<cache-lock>/",
  "manifestUrl": "swift://.../model-artifacts/vda/<cache-lock>/cache-manifest.json",
  "manifestSha256": "<64-lowercase-hex>",
  "resultUrl": "swift://.../model-artifacts/vda/<cache-lock>/cache-result.json"
}
```

`artifactRootUrl` and `payloadUrl` are both explicit even when this v2 layout
uses the same prefix. Downstream code must use the values as written; it must
not append `cache/`, rebuild a URL from the lock, or copy their values from a
parent's prose.

The lead passes each video child only `environmentReadyUrl` and
`environmentReadySha256`. Each video child downloads and verifies that document
before using its exact fields. It repeats the same reference-only rule for
every deterministic stage contract.

Before running PAIDF inference, each deterministic stage must materialize its
declared cache payload locally, verify its manifest binding, and execute the
pinned `verify-vda-cache.py` from its stage bundle inside the PAIDF image:

```text
auto-label stages: verify-vda-cache.py --component auto-labeling
augmentation stage: verify-vda-cache.py --component augmentation
```

The stage bundle records the verifier SHA-256 and it must equal the
`consumerReadinessVerifier.sha256` in the verified cache manifest. A failed
consumer-readiness check is a typed stage failure and must not start expensive
inference.

The video-stage bundle must materialize each application configuration at the
path selected by its worker, and record that resolved path in the immutable
stage contract. In particular, an augmentation worker must not infer a
per-video `configs/<video>_aug<index>.yaml` filename when the bundle publishes
the canonical `configs/augmentation/augmentation.yaml`. Pass the verified
canonical path explicitly (for example through `AUGMENT_CONFIG`), have the
worker use that value, and checksum it as part of the bundle. This keeps a
stage capsule portable across the two fixed inputs while preserving its frozen
configuration binding.

A missing configured file is a terminal result only for that immutable
capsule. Its owning video agent must reconcile that evidence, correct the
next immutable bundle/contract, re-inspect accessible pools, and submit one
replacement at `LOW`; it is not a reason to stop after a fixed retry count.

Use the accepted OpenAI-compatible VLM and LLM endpoint
`https://inference-api.nvidia.com/v1` with the existing runtime inference
credential mapped only in memory. Every deterministic video stage—including
augmentation caption/prompt inference—receives the `nvidia_inference`
credential and maps it only in-process to the upstream PAIDF worker's
NVIDIA/OpenAI-compatible key variables; it must not unset that key before an
inference call. Do not replace the hosted endpoint with an unverified
in-cluster `*.svc.cluster.local` or `localhost` URL. A retry after an
endpoint-readiness failure must re-read and enforce this frozen endpoint
contract before it submits another stage capsule.

The pinned PAIDF images may expose only `python` rather than `python3`. Every
stage entrypoint must resolve and require an interpreter with
`command -v python3 || command -v python`, then use that resolved executable
for the verifier and any inline Python helper. Do not install packages, add a
Python runtime, or derive an image to work around an interpreter name.

## Goal and acceptance

Use the existing OSMO CLI and the public, commit-pinned static kit to plan and
complete the accepted recursive topology: one environment pipeline, then one
bounded video pipeline per frozen video, with the deterministic VDA stages
specified by the locked topology. The environment pipeline must conditionally
materialize the locked model cache and return `environment-ready` before video
fan-out.

For the run ID supplied in the lead task, write all durable artifacts below:

```text
swift://pdx.s8k.io/AUTH_team-osmo/dev/fernandol/agents_poc/datasets/vda-poc-two-video-outputs/run-<RUN_ID>/
```

Return a final batch result that proves both videos produced valid original
pseudo-labels, augmented videos, and augmented-video pseudo-labels. Record
every dynamically submitted workflow ID and output URL as durable evidence.
Never place credential values in a workflow, prompt, result, or artifact.
