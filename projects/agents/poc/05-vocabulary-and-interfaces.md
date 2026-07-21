<!--
Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software without an express license agreement from
NVIDIA CORPORATION is strictly prohibited.
-->

# POC Reference: Vocabulary and Existing Interfaces

Status: Draft

## Purpose

Define the bounded domain vocabulary for the OSMO-hosted-lead POC and distinguish
interfaces that already exist from the small interfaces the POC must build.

This is terminology, not a list of every grammatical noun or verb used in the
plan. New plans and implementation should use the canonical terms below rather
than inventing near-synonyms.

## Nouns

| Area | Canonical nouns |
| --- | --- |
| Intent | User, Goal, Goal Contract, Goal Plan, Pipeline, Plan Revision, Workstream, Acceptance Criterion, Non-goal, Assumption, Budget, Deadline |
| Coordination | Lead Agent, Environment-Pipeline Agent, Video-Pipeline Agent, Model-Artifact Materializer, Deterministic Stage, Evaluator, Attempt, Node Contract, Join Policy, Video Fan-out Limit, Capability, Authority Envelope |
| Execution | Capsule, Worker Capsule, Child Capsule, OSMO Workflow, Task, Workflow Binding, Submission Key, Idempotency Key, Correlation ID |
| Environment | Environment Lock, Environment Request, Environment-Ready Result, Runtime Base, Role Contract, Video-Stage Bundle, Stage Contract, Cache Lock, Cache Binding, Model-Artifact Workspace, Tool, Skill, MCP Config, MCP Endpoint, MCP Server, Plugin |
| Supply chain | Image, Base Image, Image Digest, Registry, Bundle Manifest, Bundle Digest, Cache Manifest, Smoke Test |
| Durable state | Run Root, Run Workspace, Goal Record, Plan Record, Environment Request, Environment-Ready Result, Cache Request, Cache Result, Video Manifest, Video Result, Stage Result, Event, Event Log, Artifact, Input Artifact, Output Artifact, Result Envelope, Evidence Bundle, Result Destination |
| Controls | Resolver, Capsule Compiler, Plan Validator, Child Admission Check, Policy Check, Evaluator, Reconciler |
| OSMO resources | Pool, Resource Profile, Credential, Registry Credential, Generic Credential, Data Credential, Workflow Input, Workflow Output |

### Strict terms

- **Goal Plan** or **Pipeline**: the versioned, logical user-facing plan. It is
  not an OSMO workflow.
- **Capsule**: one immutable static OSMO workflow compiled from a stable part
  of the plan.
- **Role Contract**: the frozen instructions, authority, inputs, and result
  destination that distinguish the lead, environment-pipeline, and video
  agents using the same agent-runtime image.
- **Video-Stage Bundle**: the immutable non-secret configuration and helper
  scripts a video agent publishes for all deterministic stages of its video.
- **Environment Lock**: the selected custom agent image, pinned upstream PAIDF
  stage images, and entrypoint version for an attempt.
- **Cache Lock**: the content-addressed identity of one reusable PAIDF model
  cache, including source revisions and downloader entrypoint version.
- **Environment-Pipeline Agent**: the bounded child agent that validates the
  model-artifact workspace and returns one typed Environment-Ready Result.
- **Cache Binding**: the verified cache URL and manifest digest returned by the
  environment pipeline and frozen by the lead into a child contract.
- **Model-Artifact Materializer**: the environment-admitted, one-task
  deterministic workflow that creates a new cache-lock prefix only when the
  cache is absent or invalid.
- **Result Envelope**: a worker's one terminal typed result.
- **Child Request**: a persisted proposal for one additional worker capsule.

## Verbs

| Phase | Canonical verbs |
| --- | --- |
| Plan | frame, draft, propose, inspect, revise, approve, reject |
| Package runtime | select, pin, bundle, checksum, smoke-test |
| Model artifacts | create workspace, compute lock, verify manifest, reuse, materialize, bind |
| Build agent image | generate, build, push, smoke-test |
| Construct work | compile, render, dry-run, validate, record, submit, bind |
| Execute | dispatch, run, execute, write result, return evidence |
| Delegate | request child, admit, reserve credit, fan out, gate, join |
| Observe | query, inspect, fetch logs, poll, reconcile, recover |
| Decide | evaluate, accept, complete, retry, restart, replan, block |
| Stop | pause, stop, cancel, clean up |

Agents may **propose**, **request**, and **return**. Deterministic POC
components **resolve**, **validate**, **record**, **submit**, and **admit**.
That division prevents prompt text from becoming implicit authority.

The POC has no human approval gate or numeric retry ceiling. A retry is a new
immutable capsule, reconciled against its prior workflow binding. An agent asks
for human intervention only when it cannot resolve the next action safely.

## Existing interfaces

| Existing interface | POC use |
| --- | --- |
| OSMO-hosted agent task | Runs the long-lived lead plus bounded environment-pipeline and per-video pipeline-agent loops in the user's persistent OSMO environment. |
| OSMO CLI | Submission through `osmo workflow submit`; reconciliation through workflow `list`, `query`, `logs`, `events`, and `spec`; resource discovery through `pool list` and `resource list`. |
| OSMO API | Operational path already available to task containers, including worker-driven child workflow submission. |
| OSMO workflow YAML | Static capsule format: task image, command, inputs, outputs, resources, and credential references. |
| OSMO task IO | `{{input:N}}` for declared inputs and `{{output}}` for durable worker result and evidence artifacts. |
| OSMO data CLI and object storage | `osmo data check`, upload, download, and URL-backed task inputs and outputs. |
| OSMO credential store | Existing `REGISTRY`, `GENERIC`, and `DATA` credentials. This POC uses `ngc_cred` as its `REGISTRY` credential for `nvcr.io`, `nvidia_inference` as its agent and auto-label-stage `GENERIC` credential for `INFERENCE_API_KEY`, `hf_token` as its model-artifact-materializer-only `GENERIC` credential for `HF_TOKEN`, and `swift_osmo_cred` as its `DATA` credential for the Swift POC root; workers reference credential names and never record secret values. |
| Existing OSMO Agent Skills | Start with the existing `osmo-user` skill bundle for workflow creation, status, logs, and recovery guidance. |
| Existing OSMO MCP server | Optional model-facing OSMO tool surface. It does not replace the task container's OSMO CLI/API fan-out path. |
| OCI image registry protocol | Registry used to pull the custom agent image and pinned upstream PAIDF images by digest. |
| OSMO output/data storage | Declared task-output URLs carry plans, bindings, batch manifests, VDA result artifacts, and evidence. |

## New POC interfaces

These are the only new interfaces the POC should introduce:

1. **Lead/environment/video-agent commands**: `plan`, `preview`, `submit`,
   `status`, and `reconcile`, backed by Goal Plan validation and run inside
   custom agent images.
2. **Environment admission**: Environment Request to immutable
   Environment-Ready Result, optionally by submitting one materializer capsule.
3. **Video-stage bundle writer**: frozen video/configuration to immutable
   bundle manifest and checksum.
4. **Stage entrypoint**: stage contract and video-stage bundle to
   `init -> execute -> validate -> result` inside one PAIDF task.
5. **Stage contract files**: frozen stage input, Result Envelope, and artifact
   or evidence references.
6. **Child-admission interface**: Child Request to budget, idempotency, and
   policy check to OSMO submission.
7. **Run-output manifest and reconciler**: workflow bindings, stage results,
   per-video results, and stop state through declared OSMO output paths.

## Boundary summary

The POC reuses OSMO for task execution, workflow validation, credentials,
artifacts, logs, events, API access, and container image pulls. It adds one
custom agent image, task scripts, environment admission, video-stage bundles,
goal-level records, and reconciliation needed to make those existing facilities
work as one inspectable agentic loop.
