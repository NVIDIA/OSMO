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
