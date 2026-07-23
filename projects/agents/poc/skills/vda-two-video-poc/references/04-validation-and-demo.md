<!--
Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software without an express license agreement from
NVIDIA CORPORATION is strictly prohibited.
-->

# POC Plan: Validation and Demonstration

Status: Draft

## Outcome

Validate the locked VDA `e2e` dynamic-DAG topology through a narrow, repeatable
two-video demonstration before adding UI, service changes, arbitrary tools, or
broader delegation.

## Demonstration scenario

Use one fixed, approved two-video VDA `e2e` batch:

> The lead creates the run workspace and delegates one environment-pipeline
> agent. That agent verifies the model-artifact workspace and, on a cold cache,
> submits one deterministic model-artifact materializer. After its verified
> `environment-ready` result, the lead submits one video-pipeline agent per
> video. Each video agent
> submits original labeling and augmentation in parallel, submits augmented
> labeling after valid augmentation evidence, and writes one typed video result.

This exercises the long-lived lead, meaningful bounded agent loops, dynamic
branching and joins, deterministic GPU work, OSMO submission, result contracts,
and output-contract evaluation without changing OSMO services.

## Test ladder

| Level | What runs | Required proof |
| --- | --- | --- |
| Input-manifest test | first POC demo batch | both mirrored files match the pinned source revision, byte size, and SHA-256 before lead submission |
| Cold-cache admission | lead, environment pipeline, and one deterministic materializer | environment pipeline submits exactly one materializer on a cache miss; cache result and content-addressed manifest validate before `environment-ready` |
| Warm-cache admission | lead and environment pipeline | environment pipeline verifies and reuses the same cache manifest without a materializer workflow |
| Contract tests | lead, environment-pipeline, video-agent, and stage schemas | invalid environment-ready result, duplicate stage request, premature augmented-label request, and malformed stage result are rejected |
| Image tests | custom agent image, model-artifact-materializer base, and pinned upstream PAIDF images | exact digests and required entrypoints recorded |
| Capsule preview | OSMO dry-run and validation-only | rendered workflow is valid before submission |
| Lead/environment/video-agent run | four OSMO agent workflows | lead waits for environment-ready, then submits exactly two video agents and stays alive while they run |
| Dynamic-DAG run | two video agents plus six deterministic stages | parallel first-stage bindings, gated augmented-label bindings, and video results are recoverable |
| Stage-init run | each deterministic stage | verified video-stage bundle, no dependency installation, and typed terminal result |
| Output check | two VDA `e2e` result sets | original labels, augmented videos, and augmented labels meet the output contract |
| Stop run | stop before an augmented-label admission | no new stage is submitted after stop is observed |

## Evidence bundle

Each demonstration run retains:

- approved goal contract, video batch, and one video-agent contract per video;
- custom agent-image digest, upstream PAIDF image digests, and entrypoint smoke
  output;
- environment request/ready binding, model-artifact-materializer capsule and
  terminal result when used, plus the verified cache manifest;
- video-stage bundles and their checksums;
- canonical and rendered OSMO capsule specs plus validation output;
- lead, environment-pipeline, video-agent, and stage submission keys with OSMO
  workflow bindings;
- video results and deterministic stage terminal result envelopes;
- evaluator output mapping evidence to acceptance criteria;
- a compact run summary with deviations, retries, and unresolved risks.

The bundle is a run artifact, not a chat summary. It must explain the lead,
environment pipeline, video agents, and per-stage lineage without relying on a
changed OSMO service or hidden agent context.

## Pass criteria

The POC passes only if all of the following hold:

1. The user can inspect and approve the fixed video batch before the lead starts.
2. The lead creates a run workspace and submits exactly one environment
   pipeline. On a cold cache that pipeline submits exactly one deterministic
   materializer, verifies its manifest, and returns `environment-ready` before
   video fan-out.
3. The lead submits exactly two video-pipeline workflows from the approved
   agent runtime image.
4. Each video agent dynamically submits original labeling and augmentation in
   parallel, then exactly one augmented-label stage after valid augmentation.
5. Every VDA stage verifies its video-stage bundle and cache binding, then runs
   without dependency installation.
6. The model-artifact materializer is the only task that installs downloader
   tooling; it publishes checksums for every cache object before the environment
   pipeline returns its binding.
7. Every stage result and video result is typed, attributable, and backed by
   declared VDA output paths.
8. A duplicate stage request or premature augmented-label request is refused
   safely.
9. Both video result sets satisfy the VDA `e2e` output contract.
10. The final completion statement distinguishes established evidence from open
   assumptions.

## Failure handling

Do not widen the POC when a gate fails. Record the failure in the evidence
bundle, verify whether the affected OSMO workflow or image build needs cleanup,
and repair the narrow contract, resolver, compiler, or admission step that
failed. The owning agent evaluates and retries indefinitely with a new immutable
workflow attempt after reconciling the prior attempt. It requests human
intervention only when the next safe action is genuinely ambiguous; it does not
pause for an approval checkpoint or a retry-count limit.

## Next decision after a pass

After a successful demo, decide whether the next highest-value investment is:

- adding restart/recovery semantics for a failed long-lived lead;
- adding another meaningful VDA augmentation or evaluation stage;
- adding a second curated tool profile;
- adding a chat/inspection UI; or
- broadening policy and credential handling.

That decision should be based on the demonstrated bottleneck, not assumed in
advance.
