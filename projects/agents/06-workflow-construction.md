<!--
Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
-->

# Agentic Goals: Workflow Construction

Status: Draft

## Purpose

Define how the agent control plane turns an approved portion of the execution graph into a static, validated, attributable OSMO workflow capsule.

The workflow constructor is a deterministic compiler and submission adapter. An agent may propose inputs to it, but an agent does not directly produce trusted executable YAML or bypass validation.

## OSMO execution boundary

Use an OSMO workflow capsule when work benefits from one or more of:

- Kubernetes isolation.
- GPU or specialized resource scheduling.
- Multi-node or gang execution.
- Heterogeneous backend selection.
- Long-running computation.
- Large input or output movement.
- Checkpointing.
- Container-specific dependencies.
- OSMO-native logs, events, metrics, shell, or dashboards.

Keep work in the agent control plane when it is:

- Goal framing or planning.
- A lightweight model call.
- Approval routing.
- A low-latency API query.
- A small deterministic transformation.
- Coordinator reconciliation.
- Agent-to-agent message handling.

Do not submit a workflow for every model turn or tool invocation.

## Current OSMO constraints

The constructor must compile to current OSMO semantics:

- A workflow contains either tasks or groups; top-level tasks are normalized into one-task groups.
- Dependencies are static and represented through task inputs.
- Groups are the scheduling dependency unit.
- The complete graph is rendered and validated before submission.
- Jinja loops and conditionals expand at submission time, not at runtime.
- There is no native child-workflow node or in-flight graph expansion.
- There is no runtime branch or general runtime loop primitive.
- Pool and backend placement are fixed when submitted.
- Workflow pause/resume is not available.
- Cross-workflow task inputs require the referenced prior task to be finished.
- Restart creates a new workflow and may reuse completed outputs.
- Workflow and per-user task limits constrain capsule size; the default workflow task cap is currently 20.

See [WorkflowSpec](../../external/src/utils/job/workflow.py), [TaskSpec and TaskGroupSpec](../../external/src/utils/job/task.py), [submission](../../external/src/service/core/workflow/workflow_service.py), and [DAG materialization](../../external/src/utils/job/jobs.py).

## Compiler inputs

The constructor receives an immutable `WorkflowConstructionRequest`:

- Goal, plan revision, node, and attempt IDs.
- Approved execution subgraph.
- Node contracts and dependency edges.
- Resolved input artifacts and immutable versions.
- Selected tool, agent, model, harness, and container image manifests.
- OSMO pool, priority, resource, timeout, credential, and data policies.
- Output artifact contracts and evaluators.
- Authority envelope.
- Client-generated submission idempotency key.

No mutable chat transcript or ambient environment is an implicit compiler input.

## Compiler output

The deterministic result contains:

- Canonical OSMO workflow template.
- Fully rendered dry-run spec.
- Validation result.
- Input and output binding manifest.
- Goal-to-workflow node mapping.
- Required credentials and policy decisions.
- Resource and quota summary.
- Expected cost and time range.
- Source hashes and compiler version.
- Submission idempotency key.

The canonical result is stored before submission and is immutable for the attempt.

## Construction pipeline

```mermaid
flowchart LR
    Select["Select approved subgraph"] --> Freeze["Freeze inputs and manifests"]
    Freeze --> Partition["Partition execution capsules"]
    Partition --> Compile["Compile OSMO template"]
    Compile --> DryRun["Render dry-run"]
    DryRun --> Validate["OSMO and policy validation"]
    Validate --> Record["Record immutable construction"]
    Record --> Submit["Idempotent submit"]
    Submit --> Bind["Bind OSMO workflow ID"]
    Bind --> Reconcile["Reconcile status and artifacts"]
```

### 1. Select

Choose a connected, ready portion of the approved execution graph whose dependencies are satisfied or can be represented inside one static OSMO DAG.

### 2. Freeze

Resolve and pin:

- Input artifact versions and checksums.
- Images and digests.
- Tools, models, skills, and harness versions.
- Commands, arguments, environment, and files.
- Credentials by reference.
- Pool, resource, timeout, priority, retry, checkpoint, and output policy.

### 3. Partition

Split capsules at boundaries such as:

- Different OSMO pools or backends.
- Different security or credential scopes.
- Human approval gates.
- Runtime-discovered fan-out.
- Dynamic agent replanning.
- Cross-region or data residency constraints.
- Distinct failure or cancellation domains.
- Task count and quota limits.
- Long waits that should not occupy a workflow.

Prefer one capsule when tasks form a stable, data-connected DAG and benefit from one submission. Prefer separate capsules when coordination is dynamic or lifecycle ownership differs.

### 4. Compile

Generate a canonical OSMO template using only schema-supported fields. Generated names must be deterministic, Kubernetes-safe, and traceable to goal entities without exposing sensitive content.

### 5. Render and validate

Use OSMO dry-run to render Jinja and variables, then validation-only mode to check workflow structure, pool, resources, credentials, registries, quotas, and platform constraints.

Agentic preview and OSMO dry-run remain distinct:

- Agentic preview describes the known plan and expansion envelope.
- OSMO dry-run validates one known static capsule.

### 6. Record

Persist the template, rendered spec, validation result, hashes, bindings, and authority decision before creating external side effects.

### 7. Submit idempotently

OSMO submission does not expose a general client idempotency key. The control plane therefore maintains a submission ledger:

- Reserve one idempotency key transactionally.
- Submit at most one workflow for that key.
- Record the returned workflow name and UUID.
- On ambiguous failure, reconcile by stored response, deterministic metadata, or operator review before retrying.
- Never create a second attempt under the same key.

### 8. Reconcile

Poll OSMO workflow state, logs, events, and task outputs. Convert OSMO state into attempt events without treating transient query failure as workflow failure.

## Capsule granularity

A capsule should be large enough to amortize Kubernetes and OSMO scheduling overhead but small enough to preserve:

- Independent retry and cancellation.
- Clear artifact contracts.
- Security boundaries.
- Human approval boundaries.
- Dynamic replanning points.
- Resource placement.
- Understandable failure impact.

Candidate heuristics:

- Combine stable deterministic producer/consumer tasks in one capsule.
- Keep runtime agent decision boundaries outside a static capsule unless the complete bounded loop intentionally runs inside one container.
- Do not combine tasks that require different pools.
- Do not hold a capsule open waiting for a human decision.
- Avoid a capsule whose failure would force unrelated completed work to rerun.

## Mapping node classes

### Deterministic job

Compile directly to an OSMO task when cluster execution is warranted.

- Typed inputs become task or URL inputs.
- Command and arguments come from a pinned tool manifest.
- Outputs are written to `{{output}}` and registered as artifacts.
- Exit actions handle known process codes.

### Bounded agent run

Two execution modes are possible:

1. **Control-plane agent**
   - Preferred for planning, lightweight tools, and rapid interaction.
   - May submit separate OSMO capsules through coordinator proposals.

2. **OSMO-hosted agent**
   - Used when the agent requires GPU inference, specialized dependencies, data locality, strong isolation, or long execution.
   - Runs a complete bounded harness in one OSMO task or stable task group.
   - Returns proposals and artifacts to the coordinator; it does not gain unrestricted OSMO credentials.

### Constrained agent-tool loop

Package the harness and approved deterministic tools into a pinned image when execution locality justifies OSMO. Keep dynamic child creation in the external coordinator.

## Dependencies and artifacts

### Inside one workflow

Use task inputs for both data handoff and scheduling dependencies. The producer writes to its output directory; OSMO transfers the output to the consumer.

### Across workflows

The coordinator waits for the producer artifact to become durable and verified before constructing the consumer capsule. It may reference the completed prior task output or a stable external URL/dataset.

Do not use an unfinished cross-workflow reference as a substitute for external coordination.

### Non-data dependencies

OSMO task inputs couple dependency and data movement. If a dependency carries no artifact, the constructor should use a small manifest artifact or split the work into separate capsules coordinated externally rather than inventing unsupported control edges.

## Groups

An OSMO group is a gang-scheduled set of tasks, not an agent team or hierarchy.

Use a group only when tasks must start and execute together, such as distributed training or tightly coupled services. Define the lead task and barrier behavior deliberately; do not map every delegated workstream to a group.

## Generated workflow shape

Illustrative output:

```yaml
version: 2
workflow:
  name: goal-abc-node-def-attempt-01
  timeout:
    exec: 4h
    queue: 1h
  tasks:
  - name: execute
    image: registry.example/approved-tool@sha256:...
    command: ["/app/run"]
    args: ["--input", "{{input:0}}", "--output", "{{output}}"]
    inputs:
    - url: s3://approved-artifacts/input-version
    outputs:
    - url: s3://approved-artifacts/goal-abc/node-def/attempt-01
    environment:
      GOAL_RUN_ID: goal-abc
      NODE_RUN_ID: node-def
      ATTEMPT_ID: attempt-01
```

Goal metadata in environment variables is for traceability, not authorization. The coordinator remains the source of authority.

## Failure and retry

- Map OSMO terminal status to an attempt result, not directly to goal result.
- Use task reschedule only for known transient process outcomes and configured retry limits.
- Use OSMO restart when the same workflow strategy should rerun while reusing completed outputs.
- Generate a new construction request for changed strategy, resources, tools, graph, or outputs.
- Treat cancellation as best effort until OSMO reports a terminal state.
- Preserve logs, events, rendered spec, and partial artifact references for diagnosis.

## Security

- Accept only cataloged image digests and tool manifests.
- Validate `privileged`, `hostNetwork`, mounts, credentials, and network needs against policy.
- Pass credentials by reference and least-privilege injection; never place secret values in generated YAML, prompts, or environment manifests stored as evidence.
- Do not grant an OSMO-hosted agent a general user token when a scoped callback or capability token suffices.
- Redact rendered specs and logs before exposing them to models.
- Sign or hash the canonical construction to detect post-approval changes.

## Observability and lineage

Record:

- Goal, plan, node, and attempt IDs.
- Constructor and schema versions.
- Template and rendered-spec hashes.
- Input and image digests.
- Validation and policy results.
- Submission idempotency key.
- OSMO workflow name, UUID, pool, backend, and task mapping.
- Status transitions.
- Logs, events, outputs, and evaluator references.
- Cancel, restart, resubmit, exec, shell, or other interventions.

## Acceptance criteria

- The same frozen request produces byte-equivalent canonical output.
- No unvalidated workflow can be submitted.
- Every OSMO workflow maps to exactly one attempt and authority envelope.
- Ambiguous submission does not create duplicate workflows.
- Dynamic agent decisions occur outside static OSMO DAGs.
- Cross-workflow consumers cannot start before required artifacts are durable and verified.
- Security-sensitive fields are policy-checked and provenance is retained.
- OSMO failure, restart, and cancellation remain attempt-level events rather than bypassing goal lifecycle.
