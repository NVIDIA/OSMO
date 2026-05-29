<!--
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
-->

# 03 — Runtime plugins

Sub-doc of [`PROJ-osmo-workflow-orchestration.md`](./PROJ-osmo-workflow-orchestration.md).
Status: Phase 1 ships KAI. Phase 3 (next) adds NIM and Ray. JobSet, Dynamo,
and Grove are deferred to a later phase.

## Goal

`OSMOTaskGroup.spec.runtimeType` is a discriminator over a registered set of
runtime plugins. Each plugin owns:

1. **Reconciler** — renders `OSMOTaskGroup` → runtime-native K8s objects
   (PodGroup + Pods for KAI; NIMService for NIM; RayCluster + RayJob for
   Ray; etc.).
2. **StatusMapper** — maps runtime-native status back to a uniform
   `OSMOTaskGroup.status` (phase + message + conditions). Coarse aggregate
   only — Pod-level detail does not flow through this.
3. **EventCurator** — watches the runtime's K8s Events (and Pod status) for
   meaningful conditions (OOMKilled, ImagePullBackOff, FailedScheduling,
   etc.), aggregates repeats, and emits `WorkflowTaskEvent` records that
   flow to the control plane's Postgres history store via the transport.
   See [`02-multicluster-transport.md`](./02-multicluster-transport.md) for
   the envelope and [`01-crd-model.md`](./01-crd-model.md) for the
   `osmo_workflow_events` schema.
4. **Finalize** — optional cleanup on delete (e.g., flush logs).

The universal OSMOTaskGroup controller dispatches to the right plugin and
houses the `spec.suspend` gate (Phase 5; see
[`04-scheduling.md`](./04-scheduling.md)) so plugins don't need Kueue
awareness.

## Detailed design

### Plugin interface

```go
// controller/runtimes/runtimes.go (existing)

type Runtime struct {
    Reconciler   Reconciler     // renders runtime-native K8s objects
    StatusMapper StatusMapper   // reads back to OSMOTaskGroup.status
    Watches      func(*builder.Builder) *builder.Builder  // optional extra watches
}

type Reconciler interface {
    Reconcile(ctx, *v1alpha1.OSMOTaskGroup) (reconcile.Result, error)
    Finalize(ctx, *v1alpha1.OSMOTaskGroup) error
}

type StatusMapper interface {
    MapStatus(ctx, *v1alpha1.OSMOTaskGroup) (v1alpha1.OSMOTaskGroupStatus, error)
}
```

The universal `controller/taskgroup/taskgroup.go` reconciler resolves the
plugin by `spec.runtimeType` (today via a registry; tomorrow via a factory
map), checks `spec.suspend`, then calls `rt.Reconciler.Reconcile`.

### KAI runtime (Phase 1, shipped)

- `controller/runtimes/kai/reconciler.go` renders PodGroup + Pods.
- `controller/runtimes/kai/status.go` maps PodGroup phase → OTG status.
- Owner refs: Pods owned by PodGroup; PodGroup owned by OSMOTaskGroup.
  Cascade delete handles cleanup.
- `controller/runtimes/kai/eventcurator.go` (Phase 3/4 add): watches Pod
  Events for the gang; allow-lists Pod-level reasons. KAI-relevant
  allow-list:
  - `FailedScheduling` (with KAI's specific reason: gang quota, topology, etc.)
  - `Preempted` (when KAI preempts a Pod for a higher-pri gang)
  - `OOMKilled`, `Evicted`, `BackOff`, `Failed`, `FailedMount`,
    `FailedCreatePodSandBox`
  - `Scheduled`, `Started`, `Completed` (state transitions, lower weight)
  - First `Pulled` (informational); skip repeats.
- EventCurator aggregates repeats within a 30s window before pushing.

### NIM runtime (Phase 3)

_To be filled in. Initial sketch_:

- Renders `NIMService` CR (NIM Operator's primary type).
- Status mapping: NIMService.status.phase → OTG phase.
- EventCurator allow-list: NIMService-specific reasons (model load
  failures, readiness probe failures with persistence, image pull
  failures), plus standard Pod-level events from the NIM Operator's
  managed Pods.
- Open question: how to express "this NIM task is part of a workflow" in
  the NIMService spec for reverse lookup?

### Ray runtime (Phase 3)

_To be filled in. Initial sketch_:

- Renders `RayCluster` + `RayJob` CRs.
- Status mapping: RayJob.status.jobStatus → OTG phase.
- EventCurator allow-list: RayJob status transitions, RayCluster
  autoscaler errors, head Pod failures, worker preemptions.
- Open question: does each OTG own a fresh RayCluster, or do they share
  long-lived RayClusters across the workflow's tasks?

### JobSet runtime (deferred)

_Deferred until after Phase 3. Initial sketch_:

- Renders `kubernetes-sigs/jobset.JobSet` CR.
- Status mapping: JobSet conditions → OTG phase.

### Future runtimes (deferred)

Dynamo, Grove, and any new K8s-native workload type that ships. Each is
~200 LOC of Go in `controller/runtimes/<name>/` plus a registry entry.
Reactivated as customer demand justifies.

## Implementation plan

Phase 1 ships KAI. Phase 3 ships NIM + Ray. Per-runtime work breakdown:

1. **Stabilize the plugin interface** so adding a runtime doesn't require
   changes to shared code. Today's interface is mostly there; the
   Phase 5 suspend gate moves OUT of runtimes into the universal layer,
   simplifying plugins.
2. **NIM plugin** (~1 month per engineer).
3. **Ray plugin** (~1 month per engineer).
4. **(Deferred)** JobSet plugin (~3 weeks per engineer — JobSet is simpler).

## Risks / open questions

- **Plugin loading model.** Compiled-in plugins (today) vs out-of-tree
  plugins (future)? Compiled-in is simpler; out-of-tree opens
  customer-supplied runtimes.
- **Status mapping fidelity.** Some runtimes have richer status models than
  OSMOTaskGroup's 5-phase model. How do we surface details without
  bloating OTG status?
- **Per-runtime CRD versioning.** NIM/Ray/etc. ship their own CRDs at
  different versions. We pin against specific upstream versions; track
  upgrade cadence.

## Out of scope

- Adding non-K8s-native runtimes (Slurm, raw VMs). OSMO is K8s-native.
- Building runtimes from scratch when upstream operators exist.
