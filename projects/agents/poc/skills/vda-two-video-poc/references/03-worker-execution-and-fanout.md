<!--
Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software without an express license agreement from
NVIDIA CORPORATION is strictly prohibited.
-->

# POC Plan: Video Pipeline Execution and Fan-Out

Status: Draft

## Outcome

Run one bounded video-pipeline agent per input video in an OSMO task and
demonstrate its controlled dynamic execution of the VDA `e2e` branch and join.

Task containers already have OSMO and API access, so the POC does not need to
invent another workflow transport. It must still establish attribution,
idempotency, and fan-out bounds before treating worker-driven submission as a
safe coordination mechanism.

## Video-pipeline-agent contract

Each video-pipeline agent receives only:

- frozen goal, plan, video sub-goal, and attempt IDs;
- the node contract and permitted environment lock;
- the lead-selected pool and stage resource profile;
- one verified immutable cache binding returned by the environment pipeline and
  frozen by the lead;
- one explicit input-video artifact reference and common configuration;
- a deadline, step/tool limit, and fixed stage-concurrency limit;
- a result destination and correlation ID;
- the OSMO/API access already supplied to the task.

It returns one `video-result.json` envelope. It does not edit the parent plan,
select a different image, create a child for another video, or mark the batch
goal complete.

Before it submits a child, the video agent writes one immutable video-stage
bundle for its video. The bundle supplies the common non-secret configuration,
helper scripts, entrypoint version, endpoint references, and checksums to every
stage. It is an output artifact of the video-agent task and a declared input to
each child capsule alongside the environment-derived cache binding; it is not a
setup workflow.

## Deterministic stage submission contract

Each permitted stage is expressed as a typed request, persisted before
submission. The original-label and augmentation requests are independent;
the augmented-label request is admitted only after the augmentation result
satisfies the frozen gate.

```yaml
parentAttempt: video-agent-a-attempt-01
childKey: augment-video-a-v1
capability: vda-augment/v1
inputs:
  - video-a.mp4
expectedResult: vda-augmentation-result/v1
budget:
  wallTime: 15m
  maxChildren: 0
```

The POC admission check verifies:

- the parent attempt is active and has unused child credit;
- the request matches the fixed stage image and capability;
- the child key has not already been submitted;
- the deadline and resource allocation fit the parent envelope;
- an `auto-label-augmented` request has valid augmentation evidence for this
  same video;
- the requested stage includes the matching video-stage bundle and its checksum;
- the requested stage includes the matching verified cache binding and manifest
  digest;
- the resulting OSMO capsule passes the same construction validation as every
  other dynamically submitted capsule.

Direct OSMO access is the task's execution path, but a child request must be
recorded and admitted before the video agent invokes that path.

## Build steps

1. Package the bounded harness, result writer, and child-request client into
   the agent runtime image.
2. Define input, stage-result, child-request, and video-result schemas.
3. Define the video-stage bundle and standard stage-entrypoint contract.
4. Compile one-task capsules for original labeling, augmentation, and augmented
   labeling from the pinned upstream PAIDF stage images.
5. Submit two video-pipeline agents and reconcile their video results into the
   lead's declared outputs.
6. Implement a child-admission command that atomically records each stage
   request and reserves its idempotency key.
7. Have each video agent publish its bundle, submit original labeling and
   augmentation in parallel, then submit augmented labeling only after
   augmentation evidence is valid.
8. Make cancellation stop new stage admission before attempting best-effort
   cancellation of active OSMO workflows.

## Validation gates

- Every deterministic stage runs from frozen video input, pinned upstream PAIDF
  image digest, video-stage bundle, verified cache binding, and output URL; it
  requires no agent context.
- Every stage runs the standard `init -> execute -> validate -> result`
  entrypoint sequence without installing packages.
- Re-delivering the same stage request produces one workflow binding.
- A video agent cannot exceed its fixed video, stage image, deadline, or
  resource envelope, and cannot submit augmented labeling before augmentation
  passes its output contract.
- Each stage workflow is traceable to video-agent attempt, goal plan revision,
  image digest, video input, and child-request key.
- A failed stage becomes a typed video-agent-visible result; it cannot strand
  the lead in an ambiguous waiting state.
- Stopping the goal prevents a video agent from submitting a new stage after the
  stop record is visible.

## Exit criterion

Two video-pipeline agents run in OSMO. Each creates two parallel first-stage
workflows and one conditional augmented-label workflow, writes a typed video
result, and lets the lead reconstruct the complete batch outcome from declared
results.
