<!--
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

SPDX-License-Identifier: Apache-2.0
-->

# OSMO Workflow Orchestration — Kubernetes-native rewrite of the OSMO orchestration plane

**Author**: [Vivian Pan](https://github.com/vvnpn-nv)<br>
**PIC**: [Vivian Pan](https://github.com/vvnpn-nv)<br>
**Status**: Phase 1 + Phase 2 implemented on staging; phases 3-8 in design.

This is the umbrella design doc. Detailed designs per workstream live in
sibling docs in this directory (`01-crd-model.md`, `02-multicluster-transport.md`,
etc., listed under [Detailed designs](#detailed-designs)).

## 1. Goal

**OSMO orchestrates ML/AI workflows across the heterogeneous Kubernetes
clusters a team or organization owns — some on AWS, some on Nebius or
CoreWeave, some on-prem, some at the edge — so the combined compute
capacity is used efficiently.** Each cluster carries its own GPU SKUs,
CPU/memory/disk capacity, security posture, networking model, and cost
profile. Users describe what their workflow needs (e.g. 8× H100, a NIM
inference service, a Ray training job); OSMO decides which cluster runs
each workload based on live capacity, admin policy, and workflow-internal
constraints like group co-location. If no cluster has capacity right now,
the workflow queues until one does. Capacity that frees up gets reused by
the next eligible workflow without human routing decisions.

Delivering that requires replacing OSMO's Python state-machine workflow
engine with a Kubernetes-native control plane shaped around CRDs and
standard controller-runtime patterns. The rewrite gives us three things
existing OSMO doesn't:

1. **Workflows that span multiple clusters as a first-class concept** — one
   DAG, multiple backends, with the platform deciding which cluster runs
   each node based on live capacity and admin policy.
2. **A runtime-pluggable workload model** — KAI today, NIM / Ray / JobSet /
   Dynamo / Grove tomorrow, behind one CRD shape. Adding a runtime is ~200
   LOC of Go, not a cross-cutting Python+gRPC+SQL change.
3. **A no-credentials-on-the-hub multi-cluster transport** — backends dial
   home; the control plane never holds backend K8s credentials. Required
   for on-prem clusters with sensitive data, NAT'd edges, and
   customer-managed clusters.

By doing the above we drop a stack of components existing OSMO carries
today: the Kombu / Celery **Worker** pool, the **Delayed Job Monitor**,
**Redis** (job queue + barriers + event streams), and **most of PostgreSQL**
(workflow + task state, custom RBAC tables, accounting tables, pool tables).
What stays of PostgreSQL is one **history table** purpose-built for fast
queries over millions of workflows.

### What "done" looks like

- A user can submit a workflow that has one node running KAI on cluster A,
  one running NIM on cluster B, and one running RayJob on cluster C — and
  the platform picks the clusters automatically based on the resources
  requested.
- The platform handles ~10 million historical workflows with sub-second
  query latency on common filters (by user, by GPU type, by time range, by
  pool).
- Backend clusters connect to the control plane without issuing any
  inbound credentials; the control plane never sees a backend kubeconfig.
- Adding a new runtime type (e.g. when SIG-Scheduling ships a new K8s-native
  workload CRD) is a single ~200 LOC plugin under `controller/runtimes/`,
  not a cross-cutting change.
- The Worker, Delayed Job Monitor, Redis, and most of PostgreSQL are
  removed from the production deployment.

### Non-goals

- **Not a service mesh.** Cross-cluster networking (Submariner / WireGuard /
  Headscale) is an infrastructure dependency the deployment picks; OSMO
  integrates but doesn't ship a mesh.
- **Not a federated K8s control plane.** We do not federate kubectl or
  arbitrary CRD propagation across clusters (no KubeFed / Karmada role).
  OSMO federates *its own workflow concept* over a purpose-built transport.
- **Not a multi-runtime registry.** Per-runtime operators (KubeRay, NIM
  Operator, etc.) stay independent K8s components. We integrate with them;
  we don't replace them.
- **Not a replacement for cluster-local schedulers.** KAI keeps doing gang
  scheduling and node placement.

## 2. Architecture

### 2.1 Overview

OSMO splits into two planes that communicate only through a phone-home
gRPC stream. The control plane never holds backend K8s credentials.

```
control cluster                                  backend cluster (one of N)
─────────────────                                ──────────────────────────

apiserver (Go)                                   TaskGroup Controller
  ├ submit / list / query                          │ reconciles OSMOTaskGroup
  ├ Postgres (history)                             │ invokes runtime plugin
  └ etcd (live CRDs)                               │
                                                   ▼
       │                                       runtime plugin
       ▼                                         (KAI today; NIM/Ray/etc next)
  Workflow Controller                              │ renders runtime-native
  ├ DAG resolution                                 │ K8s objects
  ├ scheduler (cluster picker)                     ▼
  ├ status rollup                                Kueue (admission/quota/queue)
  └ TTL + finalizer cleanup                        │ admits Workload
       │                                           ▼
       │                                       KAI Scheduler (placement only)
       ▼                                           │ gang-schedules onto nodes
  Operator Service (gRPC server)                   ▼
       ▲                                       Pods running
       │                                           │
       │   long-lived bidi gRPC                    │ status events
       │ ◄──── phone-home from each ────────       │
       │       backend cluster                     ▼
       │                                       Backend Session Client
       │                                       (dials home, executes commands,
       │                                        streams status, sends
       │                                        capacity reports + heartbeats)
       │                                           ▲
       └───────────────────────────────────────────┘
                  commands ─►   (CreateOTG, DeleteOTG, ResyncRequest)
                  status events ◄─ (StatusEvent, CapacityReport, Heartbeat)
```

Two collaborating planes, two distinct authorities:

- **Control plane**: knows submissions, pool policy, multi-tenant
  bindings, cross-cluster capacity reports, workflow co-location. Picks
  *which* cluster.
- **Backend plane**: Kueue is the authoritative admission engine (queue,
  quota, priority, preemption). KAI is the placement-only scheduler (gang
  scheduling + node placement). Backend reports capacity over the session
  as the hint the control plane uses.

### 2.2 Why CRDs replace the OSMO microservice stack

Before describing the three CRDs themselves, it's worth being explicit about
*why* the rewrite uses CRDs rather than continuing the Python microservice
pattern. This is the structural decision that makes everything else possible.

#### What a CRD is in concrete terms

A **CustomResourceDefinition** registers a new object type with the
Kubernetes apiserver. From the moment the CRD is installed:

- The object type appears in `kubectl api-resources`.
- `kubectl get osmoworkflow`, `kubectl describe`, `kubectl edit`,
  `kubectl apply -f workflow.yaml` all work — no custom CLI needed for
  basic operations.
- The object is persisted in **etcd** (the same store K8s uses for Pods,
  Services, ConfigMaps).
- Field-level validation runs at the apiserver via an OpenAPI v3 schema —
  bad submissions get a 400 with a useful error before any code runs.
- Other components subscribe to changes via the K8s **watch protocol** —
  any controller, sidecar, or `kubectl get -w` gets push notifications on
  every create/update/delete.
- The object has a **status subresource** — controllers can update
  `.status` without bumping `.metadata.generation`, and clients can
  distinguish observed state (the `.status`) from desired state (the
  `.spec`).
- RBAC applies natively — admins can grant a user `osmoworkflow:create`
  in namespace X without granting access to other resources.
- The K8s **audit log** records every change with `who/what/when`.

A **controller** is the other half. It's a small Go program — typically
~500-2000 LOC built on the upstream `controller-runtime` library — that
follows this loop:

1. **Watch**: subscribe to one or more CRD types.
2. **Reconcile**: on every event, fetch the current state of the object
   plus its child resources, compute what the world should look like to
   match `.spec`, and take the minimum set of actions to converge.
3. **Update status**: write the observed state back to `.status` so
   clients see progress.

controller-runtime gives you for free: a per-object workqueue with
exponential backoff, leader election (so multiple controller replicas
don't fight over the same object), informer caches (so reconciles are
fast — no re-fetching from etcd every iteration), metrics, structured
logging, graceful shutdown.

#### What this lets us delete from existing OSMO

OSMO today is ~7 Python services with a stack of supporting infrastructure
that exists *because* there was no platform to delegate to. Mapped onto
the CRD + controller model, most of it collapses into machinery
Kubernetes already provides:

| Existing OSMO component | What it does today | What replaces it | What disappears |
|---|---|---|---|
| **Worker** (Kombu + Celery + Redis queue) | Picks tasks off a Redis-backed queue and runs them, including retries and dedup | controller-runtime reconcile loops. **The controllers are the execution engine** — they `Watches(OSMOTaskGroup{})`, get a reconcile call per change, take action. Per-object workqueue handles retry/dedup. | Worker pods, Kombu task definitions, Celery worker pool, dedup tracking |
| **Redis** | Message bus, job queue, distributed barriers, event streams, status cache | etcd watches (notify), controller-runtime workqueue (queue + retry), informer cache (cache), barriers deferred. The K8s watch protocol fills the message-bus role. | Redis deployment, Redis backup/restore ops, message-bus client code |
| **Delayed Job Monitor** | Polls Redis ZSETs for scheduled jobs that have come due | controller-runtime's `reconcile.Result{RequeueAfter: t}` — built into every reconcile signature | Delayed Job Monitor process, ZSET schema |
| **PostgreSQL: workflow_state, task_state** | Live state for workflows + tasks | etcd via CRDs. State lives where the controllers naturally watch it. | Tables, ORM models, SQL migrations, application-layer locking |
| **PostgreSQL: pool tables** | Pool definitions + cluster memberships | `OSMOPool` CRD (Phase 5) — admin manages with kubectl like any other resource | Tables, CRUD API, schema migrations |
| **PostgreSQL: RBAC (osmo_actions + role_policies + bindings)** | Application-layer permission model | K8s RBAC (Verb × Resource × Subject) — already the K8s permission model. `OSMOPoolBinding` CRD only for the per-user-to-pool layer K8s RBAC can't express natively. | Custom roles + policies + bindings tables, custom permission evaluation code, custom audit logger |
| **PostgreSQL: accounting tables** | Per-workflow resource usage tracking | Prometheus metrics. Counters + histograms on the workflow controller, scraped by Prometheus, aggregated by PromQL. | Accounting tables, write-side accounting hooks, query API for accounting |
| **PostgreSQL: workflow + task history** | Lookback for past workflows | **Kept.** A single Postgres schema (workflows + groups + curated events) projected from etcd via a watch-based projector. The only PostgreSQL workload remaining in the new design. | The other ~6 tables and their CRUD code. |
| **Agent + Operator service** (per-backend) | Cross-cluster dispatch via long-poll WebSocket; backend executes commands locally | gRPC ClusterSession (phone-home bidi stream) + Backend Session Client (Go). See [`02-multicluster-transport.md`](./02-multicluster-transport.md). | Per-backend Agent service, custom WebSocket protocol, all the auth + reconnect glue we built for it |
| **Python `K8sObjectFactory`** (in API server) | Renders Pod specs for KAI from a workflow YAML, centrally | Per-runtime Go controller plugin in `controller/runtimes/<name>/`, running **on the backend** alongside the workload. The API server never sees Pod specs again. | The factory + all the per-runtime branches inside it |
| **Custom retry / dedup / scheduling logic across the above** | Various places | controller-runtime workqueue + idempotent reconciliation. The pattern is "make reconcile cheap and idempotent; let it run as often as needed; the workqueue handles dedup and retry." | All the bespoke retry / scheduling code we built into Worker |

#### Why this is a structural simplification, not a port

If we were just rewriting the existing OSMO from Python to Go but
keeping Worker + Redis + Postgres-for-state, we'd cut wall-clock latency
and improve type safety, but the operational footprint would be the same.
Same number of services to deploy, same number of stateful systems to
back up, same custom retry/dedup logic to maintain.

The CRD + controller pattern is **a different shape**:

- **Stateful systems collapse from 3 (Postgres + Redis + etcd) to ~2 (etcd
  + Postgres-for-history only).** Redis goes away entirely. Postgres is
  scoped down to one query projection.
- **Services collapse from ~7 to ~3** (apiserver, workflow controller,
  per-backend taskgroup controller). Worker, Delayed Job Monitor, Agent,
  and the original Operator all become "code that runs inside a
  controller's reconcile loop."
- **Custom application-layer concerns become K8s primitives.** RBAC,
  audit, watch notifications, retry queues, leader election, cascade
  delete, TTL — all built-in. We stop writing this code; K8s already
  has it.
- **Runtimes become plugins.** Adding NIM, Ray, Dynamo, or Grove means
  writing a ~200 LOC Go reconciler that renders the runtime's native
  CRD. No changes to the apiserver, no protocol changes, no SQL
  migrations.

The new OSMO is **a small amount of Go on top of Kubernetes** rather than
a custom platform that happens to run on Kubernetes. Kubernetes does
most of the work; we add only the parts specific to OSMO's workflow
domain.

#### What stays custom (and why)

CRDs don't replace *everything*. The pieces that remain OSMO-specific:

- **The workflow + DAG semantics** — `dependsOn`, status rollup, TTL.
  These are domain-specific to what a "workflow" means in OSMO.
- **Cross-cluster dispatch** — K8s controllers work within one cluster;
  OSMO workflows span clusters. The phone-home gRPC ClusterSession is
  our addition. See [`02-multicluster-transport.md`](./02-multicluster-transport.md).
- **The runtime plugin abstraction** — Kubernetes doesn't know what a
  "runtime" is. We define the contract; per-runtime plugins implement it.
  See [`03-runtime-plugins.md`](./03-runtime-plugins.md).
- **The capacity-aware scheduler** — picking which cluster a workflow
  runs on, given live capacity and admin policy. Kueue handles per-cluster
  admission; cross-cluster placement is ours. See
  [`04-scheduling.md`](./04-scheduling.md).
- **The submission API + multi-tenant policy** — a thin Go apiserver +
  pool bindings.
- **Workflow history projection** — a watch-based controller that mirrors
  CR state to Postgres for fast queries past etcd's natural scope. See
  [`01-crd-model.md`](./01-crd-model.md).

Everything else is K8s machinery we delegate to.

### 2.3 The three CRDs

Detailed in [`01-crd-model.md`](./01-crd-model.md). Headline shape:

| CRD | Scope | Lives in | Role |
|---|---|---|---|
| **OSMOWorkflow** | Namespaced | Control cluster only | User-submitted DAG. Owns DAG resolution, status rollup, TTL, cross-cluster cleanup finalizer. |
| **OSMOTaskGroup** | Namespaced | Wherever the node runs (control cluster for local groups; backend cluster for remote) | One DAG node materialized. Carries `runtimeType` discriminator + opaque `runtimeConfig`. |
| **OSMOCluster** | Cluster | Control cluster only | Registry of backend clusters. Status carries liveness, supported runtimes, live capacity. |

`OSMOPool` and `OSMOPoolBinding` (multi-tenant policy) are added in
Phase 5; covered in [`04-scheduling.md`](./04-scheduling.md).

### 2.4 Control plane services

| Service | Role | Status |
|---|---|---|
| **apiserver** (Go) | HTTP API for submit / list / query. **Writes only to etcd** (CREATE OSMOWorkflow CR on submit; GETs and LISTs from Postgres for history, with etcd fallback on UID GETs for very-recent submits). Replaces existing Python FastAPI apiserver. | Phase 1 |
| **Workflow Controller** | Reconciles OSMOWorkflow → dispatches OSMOTaskGroups. DAG resolution, status rollup, TTL, scheduler (Phase 5). **Writes only to etcd; does not write Postgres.** | Phase 1 |
| **Projector Controller** | New Phase 4 controller. **Sole writer to `osmo_workflows` + `osmo_workflow_groups`.** Watches OSMOWorkflow CRs via standard controller-runtime informer; UPSERTs the Postgres row on Added/Modified events; finalizes on Deleted. K8s `List + Watch` handles recovery on restart automatically; no orphan-sweeper is required for correctness. See [`01-crd-model.md`](./01-crd-model.md). | Phase 4 |
| **Operator Service** | gRPC server for the phone-home ClusterSession. Accepts incoming `Connect` streams from backends. Bus + Registry for commands and status. | Phase 2 |
| **Defaulting webhook** | Mutates `OSMOTaskGroup.spec.suspend = true` on create from the workflow controller, so Kueue's admit-then-unsuspend flow works. | Phase 5 |
| **Pool Reconciler** | Reconciles OSMOPool readiness from OSMOCluster session state. | Phase 5 |
| **Retention pruner** | CronJob that drops `osmo_workflow_events` monthly partitions and deletes `osmo_workflows` rows past the configured retention cutoff (default 6-12 months). | Phase 4 |
| **WorkflowEventIngest** | Operator-service pipeline that ingests `WorkflowTaskEventBatch` envelopes from backends into `osmo_workflow_events` via batched COPY. Events live only in Postgres; no dual-write. | Phase 4 |
| **Postgres (control plane data store)** | Three-table schema (`osmo_workflows` + `osmo_workflow_groups` + `osmo_workflow_events`) for workflow + event history. Source of truth for **historical** query (etcd is source of truth for **live** state). Populated by the Projector (workflows) and WorkflowEventIngest (events). See [`01-crd-model.md`](./01-crd-model.md). | Phase 4 |

### 2.5 Backend cluster services

| Service | Role | Status |
|---|---|---|
| **TaskGroup Controller** | Reconciles OSMOTaskGroup → invokes the configured runtime plugin. Universal across runtimes. Houses the `spec.suspend` gate. | Phase 1 |
| **Backend Session Client** | Dials home, executes commands, streams status, sends capacity reports + heartbeats. Watches local Kueue ClusterQueue to derive capacity. | Phase 2 |
| **Runtime plugins** | One per `runtimeType`. KAI today; NIM and Ray in Phase 3; JobSet / Dynamo / Grove later. | Phase 1 (KAI) / Phase 3 (NIM, Ray) |
| **Kueue manager** | Authoritative admission engine: ClusterQueue, ResourceFlavor, LocalQueue, WorkloadPriorityClass. Watches OSMOTaskGroup via GenericJob; admits → flips `spec.suspend=false`. | Phase 5 |
| **KAI Scheduler (placement-only)** | Reconfigured from "queue + quota + preempt + place" to "place only." Gang-schedules admitted PodGroups onto nodes. | Phase 5 |

### 2.6 Deep dive: phone-home transport (gRPC ClusterSession)

The single piece of infrastructure that makes the no-credentials-on-the-hub
property work. Existing OSMO has nothing comparable — the closest analogue
in the K8s ecosystem is OCM's klusterlet, but we built a smaller, simpler
custom one to keep the auth model (SHA-256 hash) stronger than klusterlet's
ServiceAccount-JWT model. Full design in
[`02-multicluster-transport.md`](./02-multicluster-transport.md).

**Two components**:

- **Operator Service** (control plane): gRPC server. Accepts incoming
  bidirectional streams from backends. Runs a `ClusterRegistry` of
  authenticated sessions, a `CommandBus` for dispatching outbound
  commands, and a `StatusBus` for fanning out inbound status events.
- **Backend Session Client** (one per backend cluster): dials home with
  `Hello` + plaintext bearer token, runs the bidi stream, executes
  incoming commands against local K8s, streams status events back.

**The wire protocol** (one bidi stream per backend):

| Backend → Control | Control → Backend |
|---|---|
| `Hello` (auth handshake with plaintext token) | `HelloAck` (session accepted / rejected) |
| `Heartbeat` (liveness, every N seconds) | — |
| `StatusEvent` (OSMOTaskGroup phase transitions) | `CreateOTG` (dispatch a TaskGroup) |
| `CapacityReport` (Kueue ClusterQueue snapshot) | `DeleteOTG` (cascade delete) |
| `ResyncRequest` (on reconnect, request command replay) | (Phase 8) `PreemptOTG` |
| `Ack` (command result) | |

**Auth model** (purposely stronger than OCM's):

```
on the backend cluster                   on the control plane
──────────────────────                   ────────────────────
K8s Secret holds                         K8s Secret holds
  plaintext bearer token                   SHA-256 hash of the token
        │                                       ▲
        │                                       │
        │   Hello { token: <plaintext> }        │ constant-time compare
        └──────────────────────────────────────►│ against stored hash
                                                │
                                                └─► accept / reject
```

A compromised control plane secret store reveals only **hashes**. There's
no path from a leaked hash back to authenticating with a backend. Compare
to OCM's `managed-serviceaccount` model, where the hub holds the actual
JWT and a leaked secret store gives an attacker scoped K8s API access on
every backend.

**Failure modes covered**:

- **Reconnect**: backend client exponentially backs off; resets backoff on
  successful `Hello`. Stream disconnect doesn't lose commands — they're
  retried after reconnect.
- **Resync**: on reconnect, backend sends `ResyncRequest`; control plane
  replays any commands the backend missed.
- **Stale session**: control plane marks the cluster `Disconnected` if no
  Heartbeat for 60s. The session client's reconnect+resync flow handles
  catch-up.

**Why we built this instead of adopting OCM**: OCM's klusterlet +
managed-serviceaccount + cluster-proxy stack is the closest off-the-shelf
equivalent. We pass on it for two reasons:
1. The auto-bootstrap delivers a real ServiceAccount JWT to the hub —
   strictly weaker than our SHA-256 hash model. Critical for our on-prem
   tenants.
2. Adopting OCM means replacing our existing transport, auth, registry,
   and bus packages with OCM's framework. The migration cost is large and
   the security regression is real.

Rationale fully covered in [`08-future-scheduling.md`](./08-future-scheduling.md) (alternatives appendix).

### 2.7 Deep dive: per-cluster Kueue + KAI placement-only

This is the second new piece of infrastructure that existing OSMO doesn't
have. Today's OSMO has KAI as the per-cluster queue / quota / preemption
authority. The new model uses Kueue as the multi-runtime admission
authority and reconfigures KAI to placement-only mode. Full design in
[`04-scheduling.md`](./04-scheduling.md).

**Why we need it**: KAI's queue is Pod+PodGroup-shaped. Other runtimes
(NIMService, RayCluster, JobSet) don't produce PodGroups; their native
controllers create Deployments / StatefulSets / Jobs directly. KAI's
admission logic never sees them. To make KAI's queue span runtimes would
require a PodGroup-shim per runtime — unbounded ongoing work that fights
each runtime's native controller.

Kueue solves this via the `Workload` abstraction: every runtime has a
`GenericJob` integration; Kueue treats them uniformly. One ClusterQueue,
one ResourceFlavor set, one WorkloadPriorityClass governs PodGroups,
NIMServices, RayClusters, JobSets, everything.

**Two collaborating components per backend** (both new, or new-config in
KAI's case):

| Component | What it owns | What changes |
|---|---|---|
| **Kueue manager** | Admission, quota, queue, priority, preemption | NEW. Installed on every backend via a Helm chart. |
| **KAI Scheduler** | Gang scheduling, node placement, topology | EXISTING but **reconfigured**: single flat queue, no quota, no preemption. |

**The handoff** (clearer than today's KAI-does-everything model):

```
1. Control plane dispatches OSMOTaskGroup with spec.suspend=true.
2. Backend OSMOTaskGroup Controller sees suspend=true → does nothing
   (gate at the universal layer, before invoking any runtime).
3. Kueue's GenericJob integration sees the OTG → builds a Workload CR.
4. Workload queued in the ClusterQueue.
5. Kueue admits (quota + priority) → flips spec.suspend=false.
6. OSMOTaskGroup Controller sees suspend=false → invokes the runtime
   plugin matching spec.runtimeType.
7. Runtime (e.g. KAI) renders runtime-native K8s objects (PodGroup +
   Pods with schedulerName: kai-scheduler).
8. KAI Scheduler gang-places the PodGroup.
9. Pods run.
```

**What we get from Kueue, for free** (we don't build):

- Cross-runtime queue: PodGroup, NIMService, RayCluster all in the same
  Workload type.
- Workload-level priority + preemption.
- Cohort lending between LocalQueues (Phase 8 territory but the primitive
  is there from Phase 5).
- ProvisioningRequest hooks for cluster autoscalers.
- Standard CNCF observability for admission decisions.

**What it costs**:

- A new Helm chart on every backend cluster (`deploy/multicluster/kueue/`).
- KAI reconfigured to placement-only (existing customers running KAI's
  hierarchical queues need migration — Phase 6 concern).
- A mutating defaulting webhook on the control plane (sets
  `spec.suspend=true` on creation by the workflow controller).
- GenericJob integration package, ~250 LOC of Go.

**What's mandatory**: Kueue must be installed on every backend. KAI-only
fallback configurations are not supported — the session client refuses to
advertise the cluster as `Connected` until it verifies Kueue's CRDs are
present.

### 2.8 What's removed, kept, reconfigured, or new vs existing OSMO

| Existing component | Fate | Notes |
|---|---|---|
| Apiserver (Python FastAPI) | **Replaced** | New Go apiserver, thinner; no Postgres for workflow state, only history. |
| Worker (Kombu / Celery on Redis) | **Removed** | Reconcile loops in Workflow Controller. |
| Delayed Job Monitor | **Removed** | Periodic reconcile in Workflow Controller. |
| Agent (per-backend) | **Replaced** | Backend Session Client, smaller, Go, phone-home. |
| Operator service (per-backend) | **Replaced** | TaskGroup Controller + Session Client; split responsibilities. |
| Logger | **Kept** | Unchanged. |
| Router | **Kept (simplified)** | Loses Postgres-driven routing rules. |
| Authz sidecar | **Kept** | Unchanged. |
| Redis (job queue + barriers + events) | **Removed** | Job queue is the gRPC stream. Barriers Phase 8. |
| PostgreSQL (workflow/task/datasets/RBAC/pools) | **Mostly removed** | Datasets deprecated separately. Custom RBAC replaced by K8s RBAC + OSMOPoolBinding. Pools become CRDs. **One table kept: workflow history (query index for millions of workflows).** |
| KAI Scheduler | **Reconfigured** | From queue+quota+preempt+place to place-only. |
| — | **NEW**: Kueue manager (per backend) | Multi-runtime admission engine. |
| — | **NEW**: gRPC ClusterSession (Operator Service + Backend Session Client) | Phone-home transport. |
| — | **NEW**: Defaulting webhook | Sets `spec.suspend=true` on new OTGs. |
| — | **NEW**: Postgres workflow-history table | Indexed for fast query at 10M+ scale. |
| — | **NEW**: Retention pruner | Drops Postgres monthly partitions past the retention cutoff. |

## 3. Why not existing open-source stacks

We considered each of these. None covers OSMO's specific intersection of
constraints. Detailed per-candidate breakdown follows; the composition
analysis at the end explains why "just glue several together" still leaves
us building most of OSMO.

Scope of comparison: **Kubernetes-native** workflow / scheduling /
federation projects. Non-K8s engines (Temporal, Cadence, AWS Step
Functions, Azure Durable Functions) are out of scope — OSMO is a K8s
control plane.

### 3.1 Argo Workflows

Mature DAG engine, K8s-native, defines a `Workflow` CRD with templates.
The closest off-the-shelf DAG layer.

**Gaps for OSMO**:
- **Single-cluster only.** The Argo controller manages everything in the
  cluster it runs in. Argo's `Resource` template *can* `kubectl apply` an
  arbitrary CRD (NIMService, RayCluster, anything) and map status via
  `successCondition` / `failureCondition` JSONPaths — but only on the
  Argo controller's cluster. Multi-cluster dispatch is the missing piece,
  not the template shape.
- **No admission / quota** beyond raw resource requests on Pods. Kueue
  integration would still be ours to build.
- **Status model assumes everything is local.** Cross-cluster status
  rollup would require new infrastructure on top.

We'd still own multi-cluster dispatch, runtime-plugin abstraction,
admission integration, history at scale, multi-tenant policy. ~60-70% of
OSMO's surface remains.

### 3.2 Flyte

Strong DAG, multi-tenant, type system, Python SDK. ML-focused.

**Gaps**:
- Heavy footprint.
- "Data plane clusters" exist but the model is "send a workflow to one
  cluster," not "different tasks to different clusters in one DAG."
- Python SDK is the primary interface. We want a thinner K8s CRD that's
  usable from any client.
- Opinionated about workflow versioning + caching that doesn't match our
  needs.

### 3.3 Kubeflow Pipelines

DAG, ML-focused, runs on Argo or Tekton.

**Gaps**: same as Argo + ML-pipeline-specific shape (steps must be
containers). No multi-cluster.

### 3.4 Tekton Pipelines

Pipelines + Tasks CRDs, K8s-native.

**Gaps**: container-only templates; no runtime-pluggable abstraction; no
multi-cluster; no admission / quota.

### 3.5 Karmada / KubeFed / OCM (Open Cluster Management)

Federation layers. Propagate K8s objects from a hub to many workers.

**Gaps for OSMO**:
- All require the hub to hold credentials (kubeconfig or auto-generated
  ServiceAccount token) for each worker. Our hard constraint is **no**
  backend credentials on the hub.
- No DAG / workflow concept — just CR propagation.
- Even if we accepted the credential model, we'd still build the DAG
  engine, runtime plugins, history, multi-tenant policy on top.

OCM specifically: `klusterlet` + `managed-serviceaccount` + `cluster-proxy`
automates the credential bootstrap and tunnels traffic so the hub doesn't
need direct network access to backends. **End state**: the hub still holds
a real ServiceAccount JWT per backend. Narrowly scoped, auto-rotated —
but a leaked hub secret store gives an attacker scoped K8s API access on
backends. Our SHA-256 hash model is strictly stronger.

### 3.6 MultiKueue

Cross-cluster Kueue federation. The most direct overlap with our scheduling layer.

**Gaps**:
- Same kubeconfig requirement: each `MultiKueueCluster` references a
  Secret containing a kubeconfig that authenticates to the worker
  cluster's K8s API. Hard-constraint blocker.
- MultiKueue replicates Workload CRs to every backend and wastes the
  losers; our centralized capacity-aware placement doesn't. Race-to-admit
  also offers no place to express OSMO-specific central policy (pool
  bindings, group co-location, SLA tiers).

We considered building a `SessionProxy` that gives MultiKueue a fake
`client.Client` backed by our gRPC session, costing ~1500-2000 LOC.
Rejected: bigger than the equivalent in-house scheduler, and the in-house
path gives us features MultiKueue can't express (group co-location, pool
bindings). Full rationale in [`08-future-scheduling.md`](./08-future-scheduling.md).

### 3.7 Per-runtime operators (KubeRay, NIM Operator, Kueue's job-integration zoo)

Each does exactly one runtime well.

**Gaps**: none handles DAG, multi-cluster, multi-tenant routing, or
workflow-level lifecycle. We *use* these — they're what our runtime
plugins call into. They're complementary to OSMO, not alternatives.

### 3.8 SkyPilot

UC Berkeley project; orchestrates ML/AI jobs across multiple K8s
clusters and clouds; popular for cost-optimized GPU placement. Python
SDK + YAML tasks.

**What it does well**: cross-cloud GPU shopping ("where's the cheapest
A100 available right now"); spot/preemption-aware retry; mature Python
SDK; supports K8s as one of N backends.

**Gaps for OSMO**:
1. Kubeconfig-based. SkyPilot's controller dials each K8s cluster
   directly using credentials provided at setup. Same blocker as
   MultiKueue.
2. Client-driven, not CRD-native. Workflow state lives on the launcher
   side; SkyPilot creates Pods/Jobs/Services via API calls, doesn't
   define a workflow CRD. We want workflows to be first-class K8s
   objects.
3. Cost-optimized, not capacity-and-policy-optimized. SkyPilot picks
   clusters by cheapest free GPU; OSMO needs multi-tenant pool policy,
   cohort lending, SLA tiers, group co-location.
4. DAG is supported (`sky.Dag`, `Pipeline`) but isn't the primary
   primitive — the platform is built around `sky launch` for single
   tasks, and the DAG abstraction is comparatively shallow vs Argo /
   Flyte / OSMO.
5. No multi-tenant model. Assumes one operator owns all credentials and
   accounting.

If "cheapest GPU across clouds" were OSMO's goal, SkyPilot would be a
serious contender. It's not.

### 3.9 Composition: Argo + MultiKueue + per-runtime operators + custom glue

The most credible "just use OSS" path. Costed honestly:

| Piece | Off-the-shelf contribution | What we'd still build |
|---|---|---|
| Argo Workflows (DAG) | ~30% of OSMO surface | The integration |
| MultiKueue (cross-cluster admit) | blocked (kubeconfig requirement) | full replacement (SessionProxy or custom scheduler) |
| Per-runtime operators (KubeRay, NIM) | runtime layer ✓ | runtime-plugin abstraction (~1000 LOC) |
| Argo `Resource` template → our gRPC dispatch | conceptually | ~3000 LOC of glue |
| Argo Workflow status reconciliation | single-cluster only | ~1500 LOC cross-cluster |
| Submission UX + multi-tenant policy | Argo's UI is workflow-author-centric | ~2000 LOC |
| History at 10M+ scale | Argo's etcd-only model doesn't scale | full new history layer (Phase 4) |

Saves ~30% of the work, adds ~70% of integration complexity, fights
Argo's assumptions at every layer. The composition becomes its own
load-bearing piece of infrastructure to maintain — Argo upgrades,
integration testing, hybrid bug triage. Net negative.

### 3.10 The specific gap OSMO fills

**OSMO is the workflow orchestration platform for environments where all
four of these are simultaneously true**:

1. **Backends are operated by parties who refuse inbound credentials.**
   On-prem with sensitive data; NAT'd edge; customer-managed; neoclouds
   with strict outbound-only policies. Rules out Karmada, OCM, KubeFed,
   MultiKueue, SkyPilot.
2. **Workloads span heterogeneous K8s-native runtime types.** PodGroup
   (KAI), NIMService (NIM Operator), RayCluster (KubeRay), JobSet,
   Dynamo, Grove — as first-class task types in a single workflow. Rules
   out per-runtime operators alone; rules out Tekton's container-only
   model.
3. **One workflow's tasks may run on different clusters.** Workflow A is
   a DAG with `train` on a GPU-rich cluster, `evaluate` on a CPU cluster,
   `deploy` on an edge cluster — platform decides the routing. Rules out
   single-cluster engines like Argo, Flyte, Tekton.
4. **The platform must offer first-class submission UX, history, audit,
   multi-tenant policy.** Most submitters don't get raw kubectl access.
   Listing "my workflows in pool X using A100 last month" must be fast
   at 10M+ rows. Rules out raw Argo/Flyte/Tekton without significant
   additional infrastructure.

No single OSS project covers all four. The closest composition
(Argo + MultiKueue + per-runtime operators) is blocked by (1) and would
still leave us building 60%+ of OSMO's surface. The phone-home
constraint is the structural factor that makes off-the-shelf adoption
infeasible.

## 4. Phase plan

Eight phases mapped to user-facing needs. Each gets its own detailed
sub-doc.

| # | User-facing need | What ships | Status |
|---|---|---|---|
| **1** | Workflows are typed K8s objects with feature parity vs today on one cluster | 3 CRDs + Workflow + TaskGroup controllers + KAI runtime + single-cluster apiserver. See [`01-crd-model.md`](./01-crd-model.md), [`03-runtime-plugins.md`](./03-runtime-plugins.md) | ✅ done |
| **2** | A workflow runs on a different cluster than the control plane, with no kubeconfigs on the hub | gRPC ClusterSession + operator + backend session client + RemoteDispatcher + status bridge + SHA-256 auth. See [`02-multicluster-transport.md`](./02-multicluster-transport.md) | ✅ done |
| **3** | Support NIM and Ray workloads as first-class workflow nodes — `runtimeType: nim` and `runtimeType: ray` work end-to-end alongside `runtimeType: kai` | Runtime-plugin interface hardening, NIM plugin (renders NIMService), Ray plugin (renders RayCluster + RayJob), per-runtime status mapping. JobSet / Dynamo / Grove deferred to a later phase. See [`03-runtime-plugins.md`](./03-runtime-plugins.md) | next |
| **4** | Query 10M historical workflows + per-task events by user / GPU / date / reason in <100ms | Postgres infrastructure (Helm chart + migrations), `osmo_workflows` + `osmo_workflow_events` tables, controller projection, transport's `WorkflowEventIngest` pipeline, query API with cursor pagination, retention pruner (monthly partition drop), UI filter integration against the existing OSMO UI. **Postgres is the durable home for workflow + task-event history; live state stays in etcd via CRDs.** Schema and lifecycle in [`01-crd-model.md`](./01-crd-model.md); ingest path in [`02-multicluster-transport.md`](./02-multicluster-transport.md); per-runtime EventCurator in [`03-runtime-plugins.md`](./03-runtime-plugins.md). | parallel with 3 |
| **5** | Users describe what they need (8× A100); OSMO picks the cluster, queues if none have capacity, runs when capacity frees | Per-backend Kueue + KAI placement-only install; `spec.suspend` + GenericJob + defaulting webhook; CapacityReport over session; central scheduler; OSMOPool + OSMOPoolBinding. See [`04-scheduling.md`](./04-scheduling.md) | follows 1+2 |
| **6** | Existing OSMO users migrate without losing access to workflow history | Dual-write window: new workflows go through CRD path; legacy reads continue from old Postgres; API compatibility shim; ETL backfill of relevant history into new schema; cutover plan + rollback story. See [`06-migration-from-existing.md`](./06-migration-from-existing.md) | follows 3+4+5 |
| **7** | Old OSMO components removed: Worker, Redis, Kombu, most of Postgres | Decommission of dead code paths; ArgoCD/Helm cleanup; docs/runbook trimming. See [`07-decommission.md`](./07-decommission.md) | distributed |
| **8** | Multi-tenant fairness: team A's idle quota can be borrowed by team B; high-pri workloads preempt low-pri ones across clusters | Cross-cluster preemption protocol; OSMOPoolBinding.borrowFrom; admin policy knobs. See [`08-future-scheduling.md`](./08-future-scheduling.md) | future |

### Engineer staffing for 8 engineers across phases 3-8

Phases 1 and 2 are shipped. Remaining workstreams running concurrently:

| Engineers (illustrative) | Months 1-3 | Months 4-6 | Months 7-9 | Months 10-12 |
|---|---|---|---|---|
| E1 | P3 NIM plugin | P3 NIM polish + observability stand-up (Prometheus metrics, Grafana dashboards for the new control + backend planes) | P5 capacity-report + Kueue glue | P7 Redis removal |
| E2 | P3 Ray plugin | P5 Kueue + webhook | P5 dispatch routing | P8 design |
| E3 | P3 runtime-plugin interface hardening + per-runtime status mapping | P5 scheduler logic | P7 ArgoCD trimming + dead-code removal | P7 Kombu removal |
| E4 | P4 schema + migrations | P4 retention pruner | P6 cutover plan | P6 cutover |
| E5 | P4 query API + cursor pagination | P5 eligibility filter | P6 compat shim | P6 cutover |
| E6 | P4 projection (controller UPSERT) | P5 scheduler / dispatch routing | P6 ETL backfill | P6 cutover |
| E7 | P4 UI filters against existing OSMO UI | P6 design | P5 polish + scheduler hardening | P6 cutover |
| E8 | P5 Kueue spike | P5 OSMOPool CRDs | P5 scheduler + pool reconciler | P5 polish + scheduler hardening |

Assignments are illustrative — the real schedule depends on team interest
and skill match. The point is: each phase has 2-4 engineer-months per
calendar quarter, and every engineer has continuous work.

## 5. Detailed designs

Each linked doc carries its own Goal, Detailed Design, Implementation
Plan, Risks, and Out-of-Scope sections. They evolve independently of this
umbrella doc.

- [`01-crd-model.md`](./01-crd-model.md) — The full data model: three CRDs
  (lifecycles, fields, finalizers) **plus the Postgres projection schema**
  (`osmo_workflows`, `osmo_workflow_groups`, `osmo_workflow_events`),
  query patterns, write ordering, retention lifecycle.
- [`02-multicluster-transport.md`](./02-multicluster-transport.md) — gRPC
  ClusterSession protocol, auth, registry, bus, failure modes; envelope
  types for OTG status, capacity reports, **and `WorkflowTaskEventBatch`
  for events bound to Postgres**.
- [`03-runtime-plugins.md`](./03-runtime-plugins.md) — Runtime-plugin
  interface (Reconciler, StatusMapper, **EventCurator**, Finalize); KAI
  implementation; NIM and Ray design.
- [`04-scheduling.md`](./04-scheduling.md) — Capacity-aware placement,
  Kueue + KAI integration, OSMOPool / OSMOPoolBinding.
- [`06-migration-from-existing.md`](./06-migration-from-existing.md) —
  Migration from existing OSMO; dual-write, compat shim, ETL, cutover;
  **mapping old Postgres schema to the new tables**.
- [`07-decommission.md`](./07-decommission.md) — What's removed (old OSMO
  Postgres tables, Worker, Redis, etc.); **what stays of Postgres (the
  new history + events tables)**.
- [`08-future-scheduling.md`](./08-future-scheduling.md) — Cross-cluster
  preemption, cohort lending, extended MultiKueue/OCM rationale.

**Postgres is mentioned in every sub-doc that touches workflow data** —
data model (01), event ingest path (02), per-runtime EventCurator output
(03), pool history projection (04), migration backfill (06), what's kept
on decommission (07). The previously separate `05-history-and-query.md`
sub-doc was removed; its content lives in the docs that actually own each
piece of the lifecycle.

## 6. Open questions

- **Phase 4 query patterns.** We've designed for "by user, GPU type, date
  range." What's the actual top-5 query pattern? (Affects index choices.)
- **Phase 6 migration timeline.** Cut over once new OSMO has feature
  parity, or gradually (some clusters new, others old)?
- **Phase 3 runtime priority within NIM and Ray.** Which lands first if
  resourcing forces a sequence? Other runtimes (JobSet, Dynamo, Grove)
  are deferred — when does a future phase pick them up?
- **Postgres deployment shape.** Single instance with backups, or HA
  primary + standby with PgBouncer? Default in the design: HA pair.
- **Defaulting webhook availability.** It's in the hot path for OTG
  creation. 2 replicas + leader election the default; could be relaxed
  for non-production deployments.
