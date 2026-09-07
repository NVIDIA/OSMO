<!--
Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software without an express license agreement from
NVIDIA CORPORATION is strictly prohibited.
-->

# POC Plan: Lead Agent and Pipeline Compiler

Status: Draft

## Outcome

Use a long-lived OSMO-hosted lead agent to turn one VDA `e2e` goal into a
small, reviewable pipeline; submit one bounded environment-pipeline agent; and,
after it returns `environment-ready`, submit one bounded video-pipeline agent
per approved video.

## Deliberate POC shape

The lead is the dynamic decision-maker and runs as an OSMO task for the whole
goal duration. It remains alive while it observes and supervises the separate
environment-pipeline and video-pipeline workflows that it submits. This does
not make an OSMO workflow recursively mutable: each dynamically created
descendant remains a new static workflow capsule.

The initial plan supports seven fixed role forms:

1. One long-lived lead-agent workflow.
2. One bounded environment-pipeline agent workflow per goal run.
3. One conditional deterministic model-artifact-materializer workflow per
   cache lock, submitted only by the environment pipeline.
4. One bounded video-pipeline agent workflow per approved video.
5. One deterministic original-label workflow per approved video.
6. One deterministic augmentation workflow per approved video.
7. One deterministic augmented-label workflow per approved video, admitted only
   after valid augmentation evidence.

The OSMO capsule compiler uses frozen records from the architecture plan:

```text
GoalContract + PlanRevision + EnvironmentLock + InputArtifacts
  -> capsule template -> OSMO dry-run -> policy check -> idempotent submission
```

## Lead responsibilities

For the POC, the lead must:

- Restate the objective, non-goals, acceptance check, and risk-bearing
  assumptions.
- Produce the initial plan for the accepted VDA `e2e` batch.
- Submit exactly one environment-pipeline workflow through the existing OSMO
  CLI/API path and record its workflow ID.
- Validate its typed `environment-ready` result before submitting exactly one
  video-pipeline workflow per approved video.
- Stay alive while it observes the environment and video agents and their
  reported bindings.
- Report material result, failure, or needed decision from declared output
  artifacts and OSMO status.
- Create a new plan revision rather than silently changing dispatched scope.

The lead has no approval checkpoint or numeric retry ceiling. It evaluates a
failed environment or video workflow, reconciles the prior binding, and creates
the next safe immutable attempt. It asks for human intervention only when it
cannot safely resolve an ambiguity from the available contracts, evidence, and
OSMO state.

The lead must not declare a completed goal solely from a worker's natural
language response or bypass a failed dry-run.

## Build steps

1. Define a compact `GoalPlan` schema and a matching human-readable template.
   Require explicit acceptance criteria, non-goals, workstream outputs, and
   evaluator for every node.
2. Build a deterministic plan validator that checks schema, bounded fan-out,
   dependency acyclicity, budgets, and named environment capabilities.
3. Build the capsule compiler from the validated plan and environment lock.
   It accepts only cataloged image digests, commands, and credentials by
   reference.
4. Run OSMO dry-run and validation-only checks before saving the frozen capsule
   and recording its submission key.
5. Provide local commands for `plan`, `preview`, `submit`, `status`, and
   `reconcile`. They may be simple scripts in the first implementation.
6. Teach the OSMO-hosted lead to use those commands and to read only typed status
   summaries and evidence references.

## First demonstration

Use a fixed two-video VDA `e2e` batch. The lead first submits one environment
pipeline, which reuses a verified model-artifact workspace or dynamically
submits one materializer task on a cold cache. After `environment-ready`, the
lead submits one video agent per video. Each video agent dynamically submits
original-label and augmentation workers in parallel, then an augmented-label
worker after valid augmentation. The lead evaluates both video results against
the VDA `e2e` output contract.

## Validation gates

- The same plan and environment lock produce byte-equivalent canonical capsule
  input before OSMO assigns server fields.
- No capsule is submitted when dry-run, policy, image resolution, or artifact
  validation fails.
- Changing a tool, image, evaluator, acceptance criterion, or side-effect
  scope requires a new plan revision.
- The lead remains alive while the environment pipeline, video agents, and
  deterministic stages run.
- The user can inspect the generated plan, image digest, capsule, OSMO binding,
  and evidence without a UI.

## Exit criterion

One OSMO-hosted lead safely completes the two-video demonstration through one
environment-pipeline agent, two meaningful video agents, and six dynamically
submitted deterministic GPU stages, plus one cold-cache materializer when
needed.
