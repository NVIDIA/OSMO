<!--
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

SPDX-License-Identifier: Apache-2.0
-->

# 04 — Scheduling: capacity-aware placement, Kueue + KAI

Sub-doc of [`PROJ-osmo-workflow-orchestration.md`](./PROJ-osmo-workflow-orchestration.md).
Companion: [`08-future-scheduling.md`](./08-future-scheduling.md) (Phase 8
preemption + cohort lending, extended MultiKueue/OCM rationale).

## Goal

Users describe **what they need**, not **where it runs**. The system decides
which backend cluster to dispatch each workflow to, subject to:

1. The user's entitlements (admin policy).
2. Live capacity on candidate clusters.
3. Workflow-internal constraints (groups in the same workflow must be
   co-located).

If no eligible cluster has capacity right now, the workflow waits until one
does.

## Hard constraint that shapes the design

**Backend clusters do not give the control plane credentials to their K8s API.**
Backends may be on-prem with access to sensitive data, behind NAT, or operated
by customers who refuse standing inbound credentials on principle.

This rules out manager-to-worker federation models (MultiKueue, Karmada, OCM —
each ultimately requires the manager to hold some authenticatable credential to
each worker). The phone-home gRPC ClusterSession in `operator/` is the
transport. See `08-future-scheduling.md` for the extended rationale.

## Mandatory backend install

Every backend cluster runs:

- **Kueue** — authoritative admission engine: queue, quota, priority,
  preemption.
- **KAI Scheduler** — configured **placement-only**: gang scheduling + node
  placement. No queue, no quota, no preemption configured at the KAI layer.

A backend without Kueue is not a supported deployment. The session client
refuses to advertise the cluster as `Connected` until it verifies Kueue's CRDs
are present.

## Architecture in one diagram

```
control cluster                          backend cluster
─────────────────                        ───────────────

OSMOWorkflow Controller                  Kueue (admission/quota/queue)
  uses OSMOCluster.status.capacity         ├─ ClusterQueue (per flavor)
  to pick a cluster for each workflow      ├─ ResourceFlavors (L40/H100/...)
  ├─ stamps Status.AssignedCluster         ├─ LocalQueues (per pool)
  │  (group co-location)                   ├─ WorkloadPriorityClass
  │                                        └─ preempts admitted Workloads
  └─ dispatches OTG via CommandBus       ▲
                                         │ ClusterQueue.status.flavorsUsage,
       gRPC session  ◄─CapacityReport────┤ flavorsReservation, pendingWorkloads
       (phone-home)                      │
       ─────► CreateOTG ─────────────────┼─► backend session client
                                         │      creates OSMOTaskGroup CR
                                         │      with spec.suspend=true
                                         ▼
                                  OSMOTaskGroup Controller (universal)
                                   ├─ if suspend=true: do nothing
                                   │  (Kueue will admit by flipping suspend)
                                   └─ if suspend=false: dispatch to the
                                      runtime selected by spec.runtimeType
                                           │
                                           ▼
                                  Runtime renders runtime-native K8s objects
                                  (e.g. KAI runtime → PodGroup + Pods with
                                  schedulerName: kai-scheduler)
                                           │
                                           ▼
                                  KAI scheduler (placement only)
                                  gang-schedules PodGroup onto nodes
```

Two collaborating planes, two distinct authorities per plane:

- **Control plane**: knows pool policy, multi-tenant bindings, cross-cluster
  capacity reports, workflow co-location. Picks *which* cluster.
- **Backend plane**: Kueue is the authoritative admission engine (queue,
  quota, priority, preemption). KAI is the placement-only scheduler (gang
  scheduling + node placement). Kueue's status reports flow back over the
  session as the capacity hint the control plane uses.

## Why Kueue is authoritative for admission (not KAI)

KAI and Kueue both have queues, quota, priority, and preemption. They look
overlapping at first. The reason we pick Kueue as authoritative:

**KAI's queue only spans Pod+PodGroup workloads.** Other runtimes (NIMService,
RayCluster, JobSet, Dynamo, Grove) don't produce PodGroups; their native
controllers create Deployments / StatefulSets / Jobs directly. KAI's admission
logic never sees them. To make KAI's queue span runtimes would require a
PodGroup-shim per runtime — unbounded ongoing work that fights each runtime's
native controller.

**Kueue's queue spans every runtime via the Workload abstraction.** Each
runtime has a `GenericJob` integration that translates its native CR into a
Workload; Kueue treats them uniformly. One ClusterQueue, one ResourceFlavor
set, one WorkloadPriorityClass governs PodGroups, NIMServices, RayClusters,
JobSets, everything.

Since OSMO's `RuntimeType` field commits us to multi-runtime, the choice is
forced: **Kueue must be the admission authority across runtimes; KAI's queue
becomes redundant.** Concretely:

| Layer | Kueue's job | KAI's job |
|---|---|---|
| Admission ("should this run?") | ✅ owns | — |
| Quota across ResourceFlavors | ✅ owns | — |
| Per-Workload priority + preemption | ✅ owns | — |
| Cohort lending between LocalQueues | ✅ owns | — |
| Gang scheduling (atomic PodGroup placement) | — | ✅ owns |
| Node placement / bin-packing / topology | — | ✅ owns |
| Fair share between PodGroups on the same node pool | — | ✅ owns |

KAI is configured **placement-only**: one flat queue, unlimited capacity, no
preemption policy. Its job is "schedule this PodGroup onto the right nodes."
Everything else moves to Kueue.

### What we lose from KAI by running placement-only

1. **KAI's hierarchical department/project queues** — replaced by Kueue's
   Cohort/ClusterQueue/LocalQueue. Comparable expressive power.
2. **KAI's reservation feature** — Kueue's preempt-on-admit covers the
   equivalent case (free quota by evicting a low-pri Workload).
3. **KAI's running-Pod preemption** — Kueue's Workload-level preemption is
   coarser-grained but matches our gang-scheduling semantics: a gang either
   runs as a whole or doesn't. Sub-gang preemption doesn't make sense.

## User-facing API

`WorkflowGroup` loses `cluster:` from the user contract. It gains a `resources:`
block:

```yaml
groups:
  - name: train
    resources:
      gpu:
        type: H100        # required when count > 0
        count: 8          # required when type set
      cpu: "16"           # K8s quantity, optional
      memory: "128Gi"     # K8s quantity, optional
      disk: "500Gi"       # K8s quantity, optional (ephemeral disk)
    runtimeType: kai
    runtimeConfig: { ... }
```

Topology hints and network class are deliberately out of v1.

The `cluster:` field stays on the type for admin pinning (see *Escape hatch*)
but is rejected by the apiserver when the caller doesn't carry an admin claim.

`OSMOWorkflow.spec.priority` (new) is an int32 mapped at dispatch time to a
small fixed set of Kueue `WorkloadPriorityClass` values:

| `spec.priority` range | Kueue WorkloadPriorityClass |
|---|---|
| 0 (default) | `osmo-normal` (value 100) |
| ≥ 1000 | `osmo-high` (value 1000) |
| ≤ -1000 | `osmo-low` (value 10) |

Values outside this range are clamped. We expand the set only if a tenant
asks for finer granularity.

### Two priority knobs disambiguated

There are two `PriorityClass`-shaped fields in the API. They are not the
same:

| Field | Type | What it controls |
|---|---|---|
| `OSMOWorkflow.spec.priority` *int32* (new) | Maps to Kueue `WorkloadPriorityClass` | Workload **admission** ordering and Kueue preemption decisions |
| `KAIRuntimeConfig.PriorityClassName` *string* (existing, `api/v1alpha1/runtime_kai.go:29`) | Forwarded to `Pod.spec.priorityClassName` | corev1 Pod **placement** priority (used by KAI when binding) |

The first determines *whether* the Workload gets admitted; the second
determines, once admitted, how the Pod competes for a node slot. In
practice the second rarely matters because gang scheduling already binds
the whole group atomically. We keep the field for backward compatibility
but document it as "rarely used; prefer `spec.priority`."

## Admin-facing CRDs

### `OSMOCluster` (extended)

`GPUTypes` already exists at `api/v1alpha1/cluster_types.go:55` — used for
eligibility filtering.

Two new fields:

- `status.capacity` (new) — reported by the backend session client every N
  seconds. Derived from local Kueue's `ClusterQueue.status.flavorsReservation`
  + `ClusterQueue.status.flavorsUsage` + `ClusterQueue.status.pendingWorkloads`.
  Nominal capacity comes from
  `ClusterQueue.spec.resourceGroups[].flavors[].resources[].nominalQuota`.

  Shape:
  ```yaml
  status:
    capacity:
      gpu:
        H100: { total: 64, free: 16, pending: 2 }
        A100: { total: 128, free: 32, pending: 0 }
      cpu:    { total: "512",  free: "180" }
      memory: { total: "8Ti",  free: "2.4Ti" }
      disk:   { total: "100Ti", free: "30Ti" }
      reportedAt: 2026-05-27T18:33:11Z
  ```
- `status.kueueLocalQueue` (new) — name of the Kueue LocalQueue the backend's
  session client has detected on this cluster. The KAI runtime stamps this on
  rendered PodGroups so workloads route to the right LocalQueue.

**Cadence**: report on Kueue status change (watch-driven) **and** every 30s as
a heartbeat. The session is already long-lived so cadence is cheap.

**Staleness**: any report older than 60s makes the cluster ineligible (avoid
scheduling onto a disconnected backend). The session client's reconnect +
`ResyncRequest` flow covers the catch-up path.

### `OSMOPool`

Cluster-scoped, admin-managed. Defines a logical grouping of clusters available
to a set of subjects.

```yaml
apiVersion: workflow.osmo.nvidia.com/v1alpha1
kind: OSMOPool
metadata:
  name: research
spec:
  description: "Research H100/A100 pool"
  clusters:
    - osmo-prod-backend
    - osmo-test-backend
  # Optional: Kueue LocalQueue name to stamp on dispatched OTGs. If empty, the
  # backend's default LocalQueue is used.
  kueueLocalQueue: research
status:
  ready: true
  readyClusters: 2
  totalClusters: 2
```

A dedicated `controller/pool/` reconciler keeps `status.readyClusters`
current — clusters in `spec.clusters` that have no live session count as
not-ready. We chose a dedicated controller (not folding into the workflow
controller) to keep the workflow reconciler focused on DAG + scheduling.

### `OSMOPoolBinding`

Cluster-scoped, admin-managed. Mirrors RoleBinding shape:

```yaml
apiVersion: workflow.osmo.nvidia.com/v1alpha1
kind: OSMOPoolBinding
metadata:
  name: research-team
spec:
  subjects:
    - kind: User
      name: vivianp@nvidia.com
    - kind: Group
      name: osmo-research
  pools:
    - research
    - dev
  default: research        # the pool to fall back to when the user doesn't pin
```

## Scheduling flow

```
┌─────────────────────────────────────────────────────────────┐
│ apiserver.submitWorkflow                                    │
│  1. Authenticate, load PoolBindings for user.               │
│  2. Pool resolution:                                        │
│       - explicit spec.pool wins (if user is bound to it),   │
│       - else binding.default,                               │
│       - else 400.                                           │
│  3. Compute eligibleClusters = pool.spec.clusters           │
│       ∩ clusters whose spec.gpuTypes ⊇ groups[*].resources  │
│         .gpu.type                                           │
│       ∩ clusters whose status.supportedRuntimes ⊇ groups[*] │
│         .runtimeType                                        │
│  4. Reject submit (400) if eligibleClusters is empty AND no │
│     cluster could ever fit (max-headroom check).            │
│  5. Stamp annotation (immutable):                           │
│       workflow.osmo.nvidia.com/eligible-clusters: c1,c2...  │
│       workflow.osmo.nvidia.com/pool: research               │
│  6. Write OSMOWorkflow CR.                                  │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Workflow Controller (scheduler)                             │
│  When a workflow's first group is ready to dispatch:        │
│    1. Pick exactly one cluster from eligibleClusters whose  │
│       live OSMOCluster.status.capacity satisfies the peak   │
│       concurrent resource demand of the DAG.                │
│    2. Stamp Status.AssignedCluster = <chosen>.              │
│    3. Dispatch this group (and all future groups) to that   │
│       same cluster via Status.AssignedCluster — NOT via     │
│       group.Cluster (which is admin-only).                  │
│  When no cluster qualifies:                                 │
│    - Leave the workflow Pending with                        │
│        status.conditions[Scheduled]=False,                  │
│        reason=NoCapacity                                    │
│        message="awaiting capacity for 8x H100".             │
│    - When pool membership changed after submit, use         │
│        reason=PoolMembershipChanged                         │
│        message="<cluster> no longer in pool <name>".        │
│    - Reconcile re-fires on:                                 │
│        a) periodic interval (30s),                          │
│        b) OSMOCluster.status.capacity change (watch).       │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Backend cluster                                             │
│   Session client receives CreateOTG, applies OSMOTaskGroup  │
│   CR locally with spec.suspend=true and Kueue labels set.   │
│   OSMOTaskGroup Controller sees suspend=true and waits.     │
│   Kueue sees the OTG via GenericJob integration, builds a   │
│   Workload, admits when quota+priority allow.               │
│   On admission, Kueue flips spec.suspend=false.             │
│   OSMOTaskGroup Controller invokes the runtime configured   │
│   by spec.runtimeType (e.g. KAI for runtimeType=kai). The   │
│   runtime renders runtime-native K8s objects (PodGroup +    │
│   Pods with schedulerName: kai-scheduler in KAI's case).    │
│   KAI gang-schedules PodGroup onto nodes.                   │
└─────────────────────────────────────────────────────────────┘
```

## Group co-location

**Hard requirement: all groups within a workflow run on the same cluster.**
Rationale: data locality (PVCs, region-local S3) and cross-cluster networking
adds latency to gang barriers.

Implementation:

- `OSMOWorkflowStatus.AssignedCluster string` — set the first time the
  scheduler decides to dispatch any group. Once set, every subsequent group's
  dispatch routes to that cluster only.
- "Peak concurrent resource demand" check at assignment time:
  - Walk the DAG, compute connected-parallel groups (groups whose `dependsOn`
    sets don't transitively block each other).
  - Sum their resources per dimension (gpu type, cpu, memory, disk).
  - The chosen cluster must satisfy the *max* across all such concurrent sets.
  - First-pass implementation: check that the single largest individual group
    fits. Refine to the proper concurrent-set sum after v1.
- If `AssignedCluster` is set but its session has gone away (cluster
  unreachable past the staleness threshold), the workflow stays Pending — we
  don't migrate to a different cluster mid-workflow. Cluster failover is
  future work.

## The OSMO-level queue

**Implicit**: workflows in `Phase=Pending` with `AssignedCluster` unset.

When any `OSMOCluster.status.capacity` changes (free count goes up), the
workflow controller re-evaluates Pending workflows whose
`eligible-clusters` annotation includes the changed cluster.

Implementation:

- The workflow controller adds an explicit `.Watches(&OSMOCluster{}, ...)` in
  `SetupWithManager` (currently absent — `controller/workflow/controller.go:71-87`).
- The watch's mapFunc lists Pending workflows in the same namespace and
  enqueues any whose annotation includes the changed cluster. **Do not reuse
  `remote_status_bridge.findWorkflowForOTG`** — it does O(workflows) per call
  and is correct for OTG status events but inappropriate for capacity events
  which fan-out to many workflows.
- Pending workflows reconcile in `metadata.creationTimestamp` order
  (FIFO, best-effort). controller-runtime's workqueue isn't strictly FIFO; we
  accept "approximately FIFO." Strict ordering is a follow-on.

### Capacity-staleness vs. concurrent reconcile

The Workflow Controller supports `MaxConcurrentReconciles > 1`
(`controller/workflow/controller.go:62-64`). Two reconcilers seeing the same
`status.capacity.free` could both pick the same cluster and over-commit.

Two mitigations, chosen in this order:

1. **Pin the scheduler hot path to MaxConcurrentReconciles=1** for v1.
2. **Soft reservation in memory** (deferred to v2): when the scheduler
   dispatches, subtract the workflow's requested resources from a local copy
   of `status.capacity.free` for that cluster with a TTL of 60s.

## Per-cluster install

### Kueue manager

- Pinned to a currently-supported Kueue release (v0.16+ minimum).
- One `ClusterQueue` per backend cluster, named `default`.
- `ResourceFlavor`s for each GPU SKU (`l40`, `h100`, etc.), plus `cpu-only`.
- One `LocalQueue` per OSMOPool that includes this cluster.
- `WorkloadPriorityClass`es: `osmo-low`, `osmo-normal`, `osmo-high`.
- `ClusterQueue.spec.preemption.withinClusterQueue: LowerPriority`.

### KAI Scheduler (placement-only mode)

- One queue (`default`), no quota, no preemption.
- Default scheduling strategy: gang + topology-aware placement.

### RBAC the session client needs to read Kueue status

```yaml
- apiGroups: ["kueue.x-k8s.io"]
  resources: ["clusterqueues", "resourceflavors", "localqueues"]
  verbs: ["get", "list", "watch"]
```

### How dispatched OTGs become Kueue Workloads

OSMOTaskGroup is registered with Kueue via the `GenericJob` interface in a
new package `controller/kueue/job.go`. The integration provides:

- `PodSets()` — returns the resource shape of each task template.
- `IsSuspended()` / `Suspend()` / `Resume()` — read/write `spec.suspend`.

A **separate** mutating defaulting webhook, in `controller/kueue/webhook.go`,
sets `spec.suspend=true` on OSMOTaskGroup CRs created by the workflow
controller so Kueue's admit-then-unsuspend flow has something to unsuspend.

The suspend gate that prevents the per-runtime reconciler from rendering
K8s objects while `spec.suspend=true` lives at the universal
OSMOTaskGroup controller (`controller/taskgroup/taskgroup.go:91`), not
inside any individual runtime. Every runtime (KAI, future NIM/Ray) gets
Kueue compatibility for free.

KAI runtime, when rendering an OTG's PodGroup, stamps:

```
kueue.x-k8s.io/queue-name: <from OSMOCluster.status.kueueLocalQueue>
kueue.x-k8s.io/priority-class: <derived from OSMOWorkflow.spec.priority>
```

## Admin escape hatch: pinning to a specific cluster

Admins can bypass the scheduler by setting `WorkflowGroup.Cluster` directly.
The apiserver:

- Accepts a non-empty `cluster:` only when the caller's identity carries an
  admin claim.
- Returns 403 for non-admin submits with `cluster:` set.

When admin pins, the scheduler skips eligibility. **Live** capacity is not
checked at dispatch — admin's responsibility. The apiserver's
**max-headroom theoretical-fit check still applies**: a submit asking for
more than any cluster could ever supply is rejected at submit, admin pin or
not.

## CRD changes

```go
// api/v1alpha1/workflow_types.go

type WorkflowGroup struct {
    Name          string
    DependsOn     []string
    Cluster       string               // ADMIN-ONLY; apiserver enforces.
    Pool          string               // OPTIONAL user override.
    Resources     ResourceRequirements // NEW.
    RuntimeType   RuntimeType
    RuntimeConfig runtime.RawExtension
}

type ResourceRequirements struct {
    GPU    *GPURequirement    `json:"gpu,omitempty"`
    CPU    *resource.Quantity `json:"cpu,omitempty"`
    Memory *resource.Quantity `json:"memory,omitempty"`
    Disk   *resource.Quantity `json:"disk,omitempty"`
}

type OSMOWorkflowSpec struct {
    Priority *int32 `json:"priority,omitempty"` // Maps to Kueue WorkloadPriorityClass.
}

type OSMOWorkflowStatus struct {
    AssignedCluster string `json:"assignedCluster,omitempty"` // NEW
}

type OSMOClusterStatus struct {
    Capacity        *ClusterCapacity `json:"capacity,omitempty"`        // NEW
    KueueLocalQueue string           `json:"kueueLocalQueue,omitempty"` // NEW
}

type ClusterCapacity struct {
    GPU        map[string]ResourceBudget `json:"gpu,omitempty"`
    CPU        ResourceBudget            `json:"cpu,omitempty"`
    Memory     ResourceBudget            `json:"memory,omitempty"`
    Disk       ResourceBudget            `json:"disk,omitempty"`
    ReportedAt *metav1.Time              `json:"reportedAt,omitempty"`
}

type ResourceBudget struct {
    Total    resource.Quantity `json:"total"`
    Free     resource.Quantity `json:"free"`
    Reserved resource.Quantity `json:"reserved,omitempty"`
    Pending  resource.Quantity `json:"pending,omitempty"`
}

type OSMOTaskGroupSpec struct {
    Suspend bool `json:"suspend,omitempty"` // NEW
}
```

New CRDs `OSMOPool` and `OSMOPoolBinding`.

New proto envelope `CapacityReport` — see `02-multicluster-transport.md`.

## Implementation order

Each step lands as an independently-mergeable change.

1. **CRDs + DeepCopy**.
2. **`CapacityReport` as a new `ControllerEnvelope.Body` oneof variant** —
   see `02-multicluster-transport.md`.
3. **`pool` package**.
4. **Apiserver wiring** in `submitWorkflow`.
5. **Per-cluster Kueue + KAI install**. Helm charts under
   `deploy/multicluster/kueue/` and `deploy/multicluster/kai/`.
6. **Backend session client: Kueue ClusterQueue watcher** → `CapacityReport`
   envelope. Refuses to advertise `Connected` until Kueue CRDs are present.
7. **Operator service: capacity ingest**.
8. **Workflow Controller: watch OSMOCluster**.
9. **Suspend gate at the universal OTG controller** — gate at
   `controller/taskgroup/taskgroup.go:91`, before the per-runtime
   reconciler. Applies uniformly to every runtime.
10. **Kueue GenericJob registration**. New `controller/kueue/job.go`.
11. **Webhook scaffolding + suspend defaulting**. New
    `controller/kueue/webhook.go`. **This activates Kueue admission.**
12. **KAI runtime label stamping**.
13. **Workflow Controller scheduler + dispatch routing**. Modify
    `dispatcherFor` to read `Status.AssignedCluster` first.
14. **DAG concurrent-set sum** for the co-location check.
15. **Admin escape hatch**.
16. **`controller/pool/` reconciler**.

## Out of scope (deliberately)

- **Cross-cluster workflow failover.** Workflow stalls if the assigned
  cluster disappears.
- **Cross-cluster preemption.** See `08-future-scheduling.md`.
- **Cohort lending across pools.** See `08-future-scheduling.md`.
- **Topology hints / network class.**
- **Cluster cost or budget awareness.**
- **Bin-packing optimization.** First-fit, lex tiebreak.
- **KAI-only or no-Kueue backend configurations.** Not supported.
- **MultiKueue / OCM / Karmada adoption** under the current security
  constraint. See `08-future-scheduling.md`.

## Risks / open questions

- **Capacity report staleness vs. multi-workflow burst.** Mitigated by
  pinning the scheduler hot path to MaxConcurrentReconciles=1 for v1.
- **Kueue version drift.** Track stable releases; CRDs are v1beta1-stable.
- **Genuinely-unschedulable resource ask.** Apiserver rejects at submit by
  max-headroom check.
- **Bootstrap order for Kueue integration (steps 9–12)** — see
  Implementation order. Webhook before GenericJob creates a block-forever
  window; do not swap.
- **ResourceFlavor mismatch between Kueue and KAI.** Drive both configs from
  a single source of truth.
- **Webhook availability.** Run with leader election + 2 replicas.
