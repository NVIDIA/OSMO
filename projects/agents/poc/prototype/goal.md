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

## Execution target

Use OSMO pool `isaac-dev-l40-03` and platform `ovx-l40` for the lead and every
child workflow capsule in this run. Include `--pool isaac-dev-l40-03` whenever
submitting a capsule and set each capsule's resource platform to `ovx-l40`.

Use no other pool or platform in this run without human direction. If a task
does not schedule or cannot reach a required endpoint, preserve the failure
evidence and ask the human operator to resolve that environment prerequisite;
do not alter OSMO service configuration or silently select another target.

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
