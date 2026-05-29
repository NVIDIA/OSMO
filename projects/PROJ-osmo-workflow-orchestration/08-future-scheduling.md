<!--
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

SPDX-License-Identifier: Apache-2.0
-->

# 08 — Future scheduling: preemption, cohort lending, rejected alternatives

Sub-doc of [`PROJ-osmo-workflow-orchestration.md`](./PROJ-osmo-workflow-orchestration.md).
Companion to [`04-scheduling.md`](./04-scheduling.md).

Material here is either deferred (Phase 8 cross-cluster preemption, cohort
lending) or settled-rejected (MultiKueue, OCM). The 04 doc references this
file but doesn't carry the long-form rationale, to keep the buildable design
uncluttered.

## Why not MultiKueue (extended rationale)

MultiKueue is the K8s SIG project that federates Kueue across multiple
clusters. We considered it seriously and rejected it. The summary version is
in [`04-scheduling.md`](./04-scheduling.md); here's the longer story.

### How MultiKueue is designed to work

MultiKueue runs in **manager-cluster** mode on the control plane:

1. Each backend is declared on the manager as a `MultiKueueCluster` CR.
2. `MultiKueueCluster.spec.kubeConfig.locationName` points at a Secret
   containing a kubeconfig that authenticates to that backend's K8s API.
3. The manager's MultiKueue controller builds a `client.Client` from that
   kubeconfig and uses it to talk to the backend.
4. When a workload is admitted on the manager, MultiKueue replicates a
   `Workload` reservation to every backend in the config (using the per-backend
   `client.Client`). Each backend's local Kueue races to admit; the first
   winner gets the actual job CR dispatched to it.

### Why this conflicts with our security constraints

Two issues:

1. **Manager holds backend credentials.** The kubeconfig Secret on the manager
   is an authenticatable credential to each backend's K8s API. Narrow RBAC
   helps (the SA only needs Workload + the registered job CR verbs in one
   namespace) but doesn't eliminate the exposure — a leaked manager
   secret-store gives an attacker scoped K8s API access on every backend.
   Our deployments include on-prem backends with access to sensitive data
   where this risk is unacceptable.
2. **Manager must dial backends.** Even with valid credentials, the network
   model is wrong: many of our backends are behind NAT, in customer-managed
   VPCs, or have inbound firewall rules that forbid arbitrary connections
   from the control plane. The phone-home gRPC ClusterSession exists
   specifically to invert this.

### Why we considered the "SessionProxy" hack and rejected it

A theoretical workaround: implement enough of `client.Client` over our gRPC
session so MultiKueue thinks it has a kubeconfig but actually goes through
phone-home. The kubeconfig MultiKueue sees points at a localhost proxy on the
control plane, which translates K8s HTTP requests into session envelopes.

We costed this. The honest estimate:

| Piece | LOC |
|---|---|
| HTTP K8s API surface for Workload + OSMOTaskGroup (GET/LIST/POST/PUT/PATCH/DELETE) | 400-600 |
| Watch endpoint with proper SSE/chunked streaming + resourceVersion semantics | 400-600 |
| TLS server, self-signed cert mgmt, kubeconfig generator | 100-150 |
| gRPC session translation + correlation IDs | 200-300 |
| Backend-side allow-list enforcement (GVK + namespace) | 150-200 |
| Error mapping (NotFound/Conflict/Gone over gRPC errors) | 100-150 |
| Tests + integration harness | substantial |

Realistic total: **1500-2000 LOC**, with watch semantics the genuinely hard
part (K8s clients have specific expectations about resourceVersion progression,
bookmarks, 410 Gone behavior).

The implementation cost alone is bigger than the entire centralized-scheduler
approach. And it doesn't give us features MultiKueue can't express:

- **Group co-location.** MultiKueue's algorithm is per-workload; "all groups
  of THIS workflow go to the same cluster" isn't a thing it can do.
- **Pool bindings.** Our multi-tenant pool model doesn't map onto Kueue's
  cohort model cleanly.
- **Data locality / SLA tier routing.** We control the scheduler; expressing
  OSMO-specific routing rules is straightforward in our own code.

The race-to-admit algorithm is also a poor fit even setting aside the
transport problem. MultiKueue replicates Workload CRs to every backend and
wastes the losers. Our centralized capacity-aware placement doesn't.

## Why not OCM (extended rationale)

OCM (Open Cluster Management) ships three addons that together solve "I need
kubeconfig to a backend but I can't ask the admin to issue one":

1. **klusterlet** — agent on each managed cluster, phone-homes to the hub.
2. **managed-serviceaccount** — hub asks the klusterlet (via the phone-home
   stream) to create a ServiceAccount on the managed cluster with declared
   RBAC, generate a token, and send the kubeconfig back to the hub.
3. **cluster-proxy** — long-lived gRPC connection from klusterlet to hub;
   hub-side proxy server tunnels K8s API requests through the klusterlet's
   existing connection. No inbound network needed.

Combined, they let MultiKueue work on top of phone-home: the hub ends up with
a kubeconfig per backend (autogenerated, narrowly scoped, auto-rotated), and
the data plane never requires inbound connectivity to the worker.

### Why we don't adopt OCM

End state matters. After all the automation, **the hub holds a real
ServiceAccount JWT per backend.** Narrowly scoped, auto-rotated, RBAC-bounded
— but it's a real authenticatable credential to backend K8s. Leaked hub
secret store → attacker can call backend K8s within those RBAC scopes
(e.g., spam the backend with Workload CRs to exhaust quota).

Our current ClusterSession holds a SHA-256 *hash* of each backend's token,
never the plaintext. Backends present the plaintext on connect; the hub
verifies via constant-time compare. A compromised hub secret store reveals
nothing usable for authenticating to any backend.

This is a strictly stronger property. Some of our deployment targets demand
it (on-prem clusters with sensitive data, customer-managed clusters where
the customer's security policy forbids any standing credential held by an
outside entity).

Adopting OCM would also be a substantial engineering migration: replace
ClusterSession with klusterlet, retire our auth/registry/bus packages,
relearn the OCM addon framework. We'd give up code we control for code we
don't, and lose security in the bargain.

### What we'd revisit OCM for

If the security calculus changes — for instance, if a future deployment has
all backends in the same VPC as the control plane and the customer accepts
inbound credentials — OCM becomes attractive again because it does solve a
real problem (auto-bootstrap + tunneling) that we'd otherwise reinvent. That
would be a future design pass, not v1.

## Phase 8: cross-cluster preemption

Deferred until a tenant actually asks for it. Today's deployments are
single-team, single-priority. The within-cluster preemption Kueue gives us
for free covers the common case.

### Scenario

A high-priority workflow arrives. Every eligible cluster is full of
lower-priority running workloads. We want to evict one and reclaim its
capacity for the high-priority work.

### Design when this becomes a real ask

1. The Workflow Controller scheduler, when placement fails, runs a
   preemption pass: walk the Pending workflow's eligibleClusters; for each,
   check whether there's a running OSMOWorkflow on that cluster whose
   `spec.priority` is strictly lower than the new one's.
2. Pick a victim by policy (configurable: oldest-first, lowest-progress-first,
   smallest-resource-first). Default: lowest-priority-then-oldest.
3. Send `PreemptOTG(workflow=victim, reason=Preempted)` over the existing
   gRPC session. New proto envelope, `ControllerEnvelope` branch.
4. Backend session client deletes the victim's OSMOTaskGroup CR. Cascade
   (owner refs + finalizer cleanup) removes the PodGroup + Pods. The KAI
   runtime's `Finalize` hook flushes any logs.
5. Preempted workflow re-enters `Phase=Pending` with a `Preempted` status
   condition; it's eligible to dispatch elsewhere or be re-admitted when
   capacity frees.
6. Once the victim's capacity is reported freed (next CapacityReport
   heartbeat), the high-priority workflow dispatches.

### LOC and risk estimate

~500-600 LOC across:
- Scheduler preemption pass (`controller/workflow/scheduler.go`): ~200
- `PreemptOTG` envelope + handlers on both sides: ~150
- Status condition + requeue path: ~100
- Tests: ~150

Risks:
- **Thundering herd.** Multiple high-pri workflows arriving at once could all
  pick the same victim. The scheduler must serialize victim selection (lock
  per cluster or single-threaded scheduler).
- **Victim mid-progress.** If the victim has produced outputs that the rest
  of its DAG depends on, killing it strands those. Either: (a) only preempt
  workflows whose dependent groups haven't started yet, or (b) treat preempted
  workflows as re-runnable from scratch. (b) is simpler; document the
  semantic.

## Phase 8: cross-cluster cohort lending

Deferred. Tightly coupled to multi-team usage which today's deployments don't
have.

### Scenario

Team A has 10x L40 of dedicated quota. Team B has 6x L40 dedicated quota.
Team A is idle. Team B is bursting and wants to use Team A's idle 10 L40s,
subject to a policy where Team A can reclaim within N minutes.

### Design

1. Add `OSMOPoolBinding.spec.borrowFrom []PoolBorrowRule` — declares which
   pools this binding can borrow from, the cap, and the reclaim SLA.
   ```yaml
   borrowFrom:
     - pool: team-a-pool
       maxBorrowFraction: 0.5   # at most 50% of team-a's idle capacity
       reclaimSLA: 10m          # team-a workloads bump borrowers within 10m
   ```
2. Workflow Controller scheduler, at placement time, considers borrowable
   capacity from other pools as eligible (with lower priority than dedicated).
3. When the lending pool's owner submits a workflow that needs its reclaimed
   capacity, the scheduler triggers cross-cluster preemption (above) against
   the borrowed workload, subject to the reclaim SLA.

### LOC estimate

~300-400, mostly in the scheduler's eligibility computation. Reuses
cross-cluster preemption from the previous section.

## When to build Phase 8

When a real tenant asks. Designing the API shape now is cheap; building it
speculatively is not.

Concrete triggers that justify implementation work:
- A second team onboarding to the same OSMO control plane (multi-tenant).
- An SLA tier (e.g., "production training jobs must start within 30 minutes
  or escalate") landing in a customer contract.
- Cluster utilization persistently >85% with workflow wait times >1h —
  signal that capacity is the bottleneck and admission policy matters.
