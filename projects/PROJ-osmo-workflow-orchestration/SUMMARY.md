<!--
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
-->

# OSMO Workflow Orchestration — Summary

**TL;DR**: Replace OSMO's Python pod-spec rendering + Worker + Redis + most-of-PostgreSQL with a Kubernetes-native control plane: three CRDs (`OSMOWorkflow`, `OSMOTaskGroup`, `OSMOCluster`) reconciled by Go controllers, with cross-cluster dispatch over a phone-home gRPC session. Per-cluster **Kueue** becomes the cross-runtime admission authority on every backend; **KAI is reconfigured to placement-only mode** (gang scheduling + node placement, no queue/quota at the KAI layer). Adding new workload runtimes (NIM, Ray, Dynamo) becomes ~200 LOC of Go instead of cross-cutting Python+Go+SQL changes. Multi-cluster workflows become a first-class capability. **Worker, Delayed Job Monitor, and Redis go away.** PostgreSQL is scoped down to a **workflow-history schema** (workflows + groups + curated task events) indexed for fast queries at 10M+ rows — live state lives in etcd; durable history lives in Postgres with a configurable retention cutoff (default 6-12 months) past which monthly partitions are dropped.

Full design: [PROJ-osmo-workflow-orchestration.md](./PROJ-osmo-workflow-orchestration.md). Per-workstream details in sibling sub-docs ([`01-crd-model.md`](./01-crd-model.md) — data model including Postgres projection, [`02-multicluster-transport.md`](./02-multicluster-transport.md), [`03-runtime-plugins.md`](./03-runtime-plugins.md), [`04-scheduling.md`](./04-scheduling.md), [`06-migration-from-existing.md`](./06-migration-from-existing.md), [`07-decommission.md`](./07-decommission.md), [`08-future-scheduling.md`](./08-future-scheduling.md)). Postgres is a cross-cutting concern surfaced in every sub-doc that touches workflow data — there's no standalone history-and-query doc.

## Why we're doing this

Three pressures forcing the architecture change:

1. **Every new runtime is a cross-cutting change today.** Adding NIM or Ray support means touching the Python API server's `K8sObjectFactory`, the gRPC protocol, and the backend Worker. The runtime catalog is growing faster than this can scale.
2. **OSMO needs multi-cluster.** Workflows already want to span AKS + on-prem + neoclouds (CoreWeave, Nebius) + edge (Jetson, Orin). The current "API server renders Pod specs for one cluster" model has no clean way to express this.
3. **The Worker + Redis + Delayed Job Monitor stack predates Kubernetes-native primitives.** It's accumulated retry/dedup/scheduling logic that K8s controllers do better, with less infrastructure.

## What a Custom Resource (CRD) is — and what it lets us delete

For readers more familiar with OSMO's Python stack than with Kubernetes
custom resources: a **CRD** is a way to teach the Kubernetes apiserver about
a new object type. Once registered, your `OSMOWorkflow` and `OSMOTaskGroup`
are first-class K8s objects — `kubectl get osmoworkflow` works, you can
`kubectl apply -f` them, they show up in audit logs, they participate in
RBAC, they have status subresources.

The power isn't the YAML format. The power is everything Kubernetes does
for you automatically once you express your domain as a CR:

- **Storage**: persisted in etcd alongside Pods, Services, ConfigMaps. No
  separate application database needed for live workflow state.
- **Validation**: OpenAPI v3 schema enforced by the apiserver on every
  create/update. No application-layer validation code.
- **Watch / notify**: clients (controllers, kubectl, UI) get push
  notifications on every change via K8s' watch protocol. No Redis pub/sub,
  no message bus.
- **Reconcile loops**: a **controller** is a small Go program that watches
  CRs and converges actual state to desired state. controller-runtime
  handles the queue, retries, leader election, observability. **This is
  the job execution engine** — there's no separate worker pool.
- **TTL, finalizers, owner references**: built-in K8s primitives for
  cascade delete, blocking delete until cleanup completes, and
  time-bounded auto-deletion. No custom cleanup code, no DB rows to
  chase.
- **RBAC and audit**: K8s RBAC controls who can read/write which CRs;
  the K8s audit log records every change. No custom roles/policies
  tables, no application-side audit logger.

### The operator pattern — what runs the jobs

A **controller** is a small Go program that watches one or more CR types
and continuously reconciles actual state to `.spec`. This is called the
**operator pattern** when the controller encodes domain-specific knowledge
about a workload — the NIM Operator manages NIMServices, KubeRay manages
RayClusters, KAI Scheduler manages PodGroups, OSMO's TaskGroup Controller
manages OSMOTaskGroups.

**OSMO composes with these existing operators rather than replacing them.**
Our TaskGroup Controller doesn't render Pods directly — it translates an
OSMOTaskGroup into the right runtime-native CR (`PodGroup` for KAI,
`RayJob` for Ray, `NIMService` for NIM) and the upstream operator takes
it from there. The chain is controllers-all-the-way-down: OSMOTaskGroup →
OSMO Controller → runtime CR → upstream operator → Pods. Adding a new
runtime is ~200 LOC of translation logic, not rebuilding the scheduling /
serving / training engine that operator already provides.

This pattern is strictly safer than a worker+queue model: it's
**level-triggered** (missed events get caught up on the next reconcile),
**crash-safe** (CRs themselves are the durable state — restart and
reconcile from scratch, no durable queue needed), and **idempotent**
(same reconcile can run N times harmlessly). OSMO's Worker exists today
because Python doesn't natively have this primitive — controller loops
give it to us for free.

### What this lets us delete

When you map OSMO's existing services onto this, most of them collapse
into machinery K8s already provides:

| Existing OSMO component | What it does today | Replaced by |
|---|---|---|
| **Worker** (Kombu / Celery + Redis queue) | Job execution engine — picks tasks off a queue and runs them | controller-runtime reconcile loops. **The controllers themselves are the execution engine.** |
| **Redis** (job queue + barriers + event streams + cache) | Async messaging + transient state | etcd watches (notify); controller-runtime informer cache (read cache); workqueues (per-reconcile retry); barriers deferred. |
| **Delayed Job Monitor** | Pokes scheduled-for-later jobs into the queue | controller-runtime's `RequeueAfter` |
| **PostgreSQL: workflow_state / task_state / pool / RBAC / accounting tables** | Live state for workflows, tasks, pools, permissions, usage | etcd via CRDs (workflow + task state); K8s RBAC + OSMOPoolBinding CRD (permissions); Prometheus (accounting). Only one Postgres table survives: the **workflow-history projection** for fast queries past TTL. |
| **Agent + Operator service** (per backend) | Cross-cluster dispatch + status streaming | Backend Session Client (Go) + gRPC ClusterSession |
| **Python `K8sObjectFactory`** | Per-runtime Pod spec rendering inside the API server | Per-runtime Go controller plugin under `controller/runtimes/<runtime>/`, running on the backend |

The net effect: We're replacing
custom infrastructure (Redis, Worker, Delayed Job Monitor, most of
PostgreSQL, custom RBAC) with machinery that's already running in every
Kubernetes cluster and battle-tested at scale. The visible part is ~3 Go
services on top of K8s; the bigger win is the OSMO code we get to
delete because K8s already does the job.

### Speaker notes — explaining this to a non-K8s audience

These analogies are intended to be read aloud or paraphrased when
presenting the design to people who haven't run Kubernetes controllers
themselves.

**For "what's a custom resource (CRD)":**
> Imagine your office accepts certain forms — leave requests, expense
> reports. A CRD is how you teach the office to accept a *new kind* of
> form, say a "training job request," using all the existing intake,
> filing, search, and permissions infrastructure. We're not building a
> new office; we're adding a new form type that the existing office
> already knows how to file, route, and audit.

**For "what's a controller, and why isn't this just a queue":**
> Use a thermostat. A thermostat doesn't have a queue of temperature
> change events. It looks at the current temperature, compares to the
> setpoint, turns the heat on or off. If you lose power for an hour, it
> doesn't try to replay missed events — it just looks at the current
> state and acts. A controller is the same idea: it watches a CRD, looks
> at the current state, takes whatever actions are needed to match
> `.spec`. If the controller crashes and restarts, it just looks at
> every workflow and reconciles. No queue to lose, no job to drop.

**For "the operator pattern":**
> Think of OSMO as a hotel concierge. When you book a workflow, OSMO
> doesn't cook your meal — it tells the kitchen (NIM Operator) what dish
> you want. It doesn't run the spa — it tells the spa (KubeRay) which
> treatment to set up. OSMO orchestrates the booking and the schedule;
> the specialty operators do the actual work in their domain. The big
> win is that we don't have to rebuild Ray's scheduling, NIM's serving,
> or KAI's gang scheduling — those teams already built operators that
> know how to do those things, and we just hand them the right
> instructions.

**For "why not keep Python":**
> The language isn't the issue; the missing primitive is. Python doesn't
> have a reconcile-loop framework on top of a watch-based event store.
> Go does — it's called controller-runtime, and we get it for free.
> Building that primitive in Python is exactly what OSMO's Worker + Redis
> + Delayed Job Monitor combination *is* — we'd be reinventing what K8s
> already provides.

**If asked "is this just K8s lock-in":**
> Every Pod in OSMO already runs on Kubernetes. If K8s is down, no
> workflow can run anyway. We're not adding a new dependency on K8s;
> we're removing the dependencies that compete with primitives K8s
> already gives us — Redis, custom job queues, custom audit tables.
> Fewer moving parts, same blast radius.

**If asked "how is debugging different":**
> Every workflow shows up in `kubectl get osmoworkflow`. You can
> `kubectl describe` it to see status, events, and conditions. You can
> `kubectl logs` the controller that's reconciling it. Standard K8s
> debugging tools work — we don't have a custom CLI to teach people.

## Why OSMO at all — why not `kubectl apply` a RayCluster + NIMService + Job?

A reasonable challenge: if everything's becoming K8s-native CRDs, why does OSMO need to exist? For a single resource on a single cluster, `kubectl apply` works fine — and the CRD design intentionally keeps that path open for dev/CI. But OSMO orchestrates everything *around* the resources, and those things aren't K8s primitives:

- **Workflow DAG** with cross-cluster routing — group A in cluster 1 finishes → group B in cluster 2 starts. No K8s primitive expresses this; a single CR can't span clusters.
- **Submission auth + multi-tenant quotas** — "this user has 100 GPU-hours of budget across these clusters." K8s RBAC handles "can verb resource", not budgets.
- **Cross-cluster status rollup** — one place to see a 3-group workflow with groups on AKS, CoreWeave, and a Jetson.
- **Workflow-level cancel + cleanup** — kill a whole workflow with all its CRs and clean up everything across clusters. Per-resource cascade doesn't cross cluster boundaries.
- **Workflow history, audit, cost attribution** — none of these have K8s-native equivalents.
- **CLI / SDK / UI for non-kubectl users** — most submitters shouldn't have raw cluster access.

OSMO doesn't go away — it gets smaller and more K8s-native. The per-task-group lifecycle (rendering pods, watching status, retries) moves into a standard K8s controller. Workflow-level orchestration (DAG, multi-cluster dispatch, quotas, credentials, history, UI) stays in OSMO because there's no K8s-native alternative. Adding a new runtime becomes a controller plugin (~200 LOC of Go).

The mental model: OSMO is to Kubernetes what Argo/Kubeflow/Flyte are — except with multi-cluster + multi-tenant + data-aware orchestration baked in.

## Why both Workflow AND TaskGroup as CRDs

The split is: **OSMOWorkflow = DAG + lifecycle, lives in the control cluster only. OSMOTaskGroup = one DAG node's runtime config + status, lives in whichever cluster runs it.** Both are CRDs because both are stateful K8s-shaped things — and putting them in K8s lets us reuse K8s machinery instead of reinventing it.

### Why OSMOWorkflow is a CRD

- **A workflow is a real object.** Users submit, list, delete, and reason about workflows. Giving it a CR lets K8s do name resolution, status subresources, finalizers, RBAC, TTL, and audit for us instead of rebuilding any of that outside the K8s model.
- **Status rollup needs a place to live.** A workflow's terminal state is a function of every group's status. That rollup writes to `OSMOWorkflow.status`; there's nowhere else it could go.
- **DAG dependencies need a single owner.** The list of groups + their `dependsOn` edges belongs on the parent, not duplicated across children.
- **Finalizers for cross-cluster cleanup live cleanly at the workflow level.** K8s cascade-deletes can't cross clusters, so the workflow controller's `workflow.osmo.nvidia.com/remote-cleanup` finalizer issues `DeleteOTG` over the session for every remote group. One owner, one place for the logic.

OSMOWorkflow lives only in the control cluster. It is never dispatched to a backend.

### Why OSMOTaskGroup is a separate CRD

- **The boundary that ships across clusters is one DAG node, not the whole workflow.** A workflow can have groups in cluster A, cluster B, and an edge cluster; a single CR can't span clusters because CRs are scoped to one K8s cluster. Each group materializes as a TaskGroup in the cluster that runs it.
- **Each runtime has its own native pod-grouping pattern** (KAI PodGroup, NIMService, RayCluster, Grove PodGangSet). The TaskGroup CR is a thin wrapper that picks one and parameterizes it. The runtime is a discriminator field; adding NIM/Ray/Dynamo is a Go reconciler plugin, not a wire-protocol change.
- **Per-cluster controllers manage only what's local.** The Workflow Controller decides "this group runs in cluster B" and dispatches a TaskGroup CR there over the session. The backend's TaskGroup Controller reconciles it locally with no cross-cluster awareness needed.

### Cross-cluster federation is *not* what we built

A common alternative is "put the workflow CR in one control cluster and have its controller reach across to other clusters to create child resources" — the KubeFed / Open Cluster Management pattern. We explicitly rejected this because it requires the control cluster to hold credentials for every backend cluster (incompatible with NAT'd / edge / customer-managed backends). Instead, the gRPC ClusterSession is **phone-home**: the backend dials the control cluster, authenticates with a per-cluster token, and the operator service dispatches commands and status events over that one bidi stream. No KubeFed, no kubeconfig federation.

### Summary

| Concern | OSMOWorkflow | OSMOTaskGroup | Apiserver |
|---|---|---|---|
| User-submitted DAG + lifecycle | ✅ control cluster | | reads/writes via REST |
| Status rollup, TTL, cancel | ✅ control cluster | | |
| Per-node runtime config (Pods, PodGroup, NIMService, ...) | | ✅ wherever the node runs | |
| Per-node runtime status | | ✅ wherever the node runs | |
| Cross-cluster dispatch + cleanup | (via finalizer) | | (via operator service) |
| Quotas, RBAC, credentials, history | | | ✅ + K8s primitives + logs / Prometheus |

## What the CR gives us

A single Kubernetes resource (`OSMOTaskGroup`) becomes the contract between OSMO and the cluster. The API server writes CRs; a per-cluster Go controller reconciles them into runtime-native Kubernetes objects.

```
API Server  ──gRPC──▶  Operator Service  ──K8s API──▶  OSMOTaskGroup CR
                                                              │
                                                              ▼
                                         Controller (per cluster, Go)
                                                              │
                                                  ┌───────────┼───────────┐
                                                  ▼           ▼           ▼
                                                Pods +     NIMService   RayCluster
                                                PodGroup   (NIM op)     (KubeRay)
                                                (KAI)
```

## Benefits for users (workflow authors)

| Today | After |
|---|---|
| One runtime: KAI Pods + PodGroup | Five: KAI, NIM, Ray, Dynamo, Grove |
| Workflows are cluster-scoped at submit | Per-group `cluster:` field — task groups can target different clusters |
| Inference services live outside the workflow (separately deployed) | First-class `runtimeType: nim` and `runtimeType: ray` task groups |
| Power users can't bypass the API server for testing | `kubectl apply -f workflow.yaml` works for single-cluster dev/CI |
| Status only visible via OSMO CLI / UI | Standard `kubectl get osmotaskgroup` works too — debugging matches the rest of K8s |
| New runtime = file a feature request, wait for OSMO release | Platform teams ship runtimes themselves (~200 LOC reconciler) |

## Benefits for maintainers / admins

| Today | After |
|---|---|
| ~7 Python services (API, Worker, Agent, Router, Logger, Delayed Job Monitor + backend services) | ~3 Python services + per-cluster Go controllers — Worker, Delayed Job Monitor gone |
| Redis required (job queue + barriers + event streams + cache) | **No Redis.** PostgreSQL scoped to a workflow-history schema, indexed for fast queries at 10M+ rows. Etcd for live state; Postgres for durable history (partition-dropped past retention). |
| Every runtime change = API server rollout = shared-blast-radius event | Per-cluster controller upgrade is isolated |
| Cross-cluster status requires API server federation logic | gRPC ClusterSession with phone-home auth; bus → cache → reconcile; standard controller-runtime pattern |
| Pod-spec rendering bugs surface in Python, far from where pods actually run | Rendering lives in the controller in the same cluster as the pods |
| Adding a new K8s admission webhook can silently break OSMO | Standard controller-runtime, predictable interaction with K8s |
| Workflow logs buffered in Redis (TB-scale strain) | Logs land in object storage with lifecycle policies — same place workflow data already lives |
| Backend cluster onboarding requires teaching API server about it | New cluster = install the controller Helm chart, register in API server with `network_config` |

## Key design principles

1. **CR-first.** The CR is the declarative contract. No side channels.
2. **OSMO routes workload, not packets.** API server picks the cluster; cluster mesh handles task-to-task networking. OSMO is never in the data plane.
3. **Etcd is the source of truth for live state.** PostgreSQL holds a history-and-query projection (workflows + groups + curated task events) for fast filter/sort/aggregate over millions of historical workflows; monthly partitions get dropped past the configured retention cutoff.
4. **Controller owns Kubernetes primitives.** API server never sees full Pod specs.
5. **Runtime is pluggable.** New runtime = Go reconciler + status mapper. Nothing else changes.
6. **Multi-cluster is first-class** via a phone-home gRPC session (backend dials control). No KubeFed-style federation.
7. **Fewer moving parts.** Worker, Delayed Job Monitor, and Redis go away. PostgreSQL is scoped down to one history-and-query table.

## What this is NOT

- **Not a rewrite of the workflow concept.** Existing workflow YAML continues to work; `runtimeType: kai` is the implicit default.
- **Not a swap of orchestration engines.** Not adopting Argo / Kubeflow / Flyte. The CR design is OSMO-native.
- **Not a multi-cluster federation layer.** Each cluster reconciles its own CRs; the control plane federates state via the phone-home gRPC session (no kubeconfig federation, no KubeFed).
- **Not a service mesh.** Cross-cluster networking (Submariner / WireGuard / Headscale) is an infra dependency the deployment picks; OSMO integrates but doesn't ship a mesh.

## What this requires

- **Phase 2 (gRPC Operator Service + phone-home session)** — already shipped; underpins the rest. See [`02-multicluster-transport.md`](./02-multicluster-transport.md).
- **Kueue installed on every backend** — mandatory; the session client refuses to advertise the cluster as `Connected` until it verifies Kueue's CRDs are present. See [`04-scheduling.md`](./04-scheduling.md).
- A choice of cluster mesh per deployment (Submariner default, Tailnet for edge, Netmaker for low-latency) — documented but not bundled.
- Standard Kubernetes ≥ 1.27 on backend clusters (CRD v1 + controller-runtime patterns).

## The one-line pitch

> Replace OSMO's runtime-coupled Python orchestration with Kubernetes-native CRDs, making new runtimes a ~200 LOC drop-in, multi-cluster first-class, and the dependency surface smaller (no Redis, no Worker; PostgreSQL scoped to one history table).
