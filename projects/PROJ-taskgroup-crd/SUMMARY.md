<!--
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
-->

# OSMOTaskGroup CRD — Summary

**TL;DR**: Replace OSMO's Python pod-spec rendering + Worker + Redis + PostgreSQL with a Kubernetes-native control plane: three CRDs (`OSMOWorkflow`, `OSMOTaskGroup`, `OSMOCluster`) reconciled by Go controllers, with cross-cluster dispatch over a phone-home gRPC session. Adding new workload runtimes (NIM, Ray, Dynamo, Grove) becomes ~200 LOC of Go instead of cross-cutting Python+Go+SQL changes. Multi-cluster workflows become a first-class capability. **Worker, Delayed Job Monitor, Redis, and PostgreSQL all go away** — live state lives in etcd; history goes to structured logs + S3; accounting goes to Prometheus.

Full design: [PROJ-taskgroup-crd.md](./PROJ-taskgroup-crd.md)

## Why we're doing this

Three pressures forcing the architecture change:

1. **Every new runtime is a cross-cutting change today.** Adding NIM, Dynamo, or Ray support means touching the Python API server's `K8sObjectFactory`, the gRPC protocol, and the backend Worker. The runtime catalog is growing faster than this can scale.
2. **OSMO needs multi-cluster.** Workflows already want to span AKS + on-prem + neoclouds (CoreWeave, Nebius) + edge (Jetson, Orin). The current "API server renders Pod specs for one cluster" model has no clean way to express this.
3. **The Worker + Redis + Delayed Job Monitor stack predates Kubernetes-native primitives.** It's accumulated retry/dedup/scheduling logic that K8s controllers do better, with less infrastructure.

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
| Redis required (job queue + barriers + event streams + cache) | **No Redis, no PostgreSQL.** Etcd + Object Storage only |
| Every runtime change = API server rollout = shared-blast-radius event | Per-cluster controller upgrade is isolated |
| Cross-cluster status requires API server federation logic | gRPC ClusterSession with phone-home auth; bus → cache → reconcile; standard controller-runtime pattern |
| Pod-spec rendering bugs surface in Python, far from where pods actually run | Rendering lives in the controller in the same cluster as the pods |
| Adding a new K8s admission webhook can silently break OSMO | Standard controller-runtime, predictable interaction with K8s |
| Workflow logs buffered in Redis (TB-scale strain) | Logs land in object storage with lifecycle policies — same place workflow data already lives |
| Backend cluster onboarding requires teaching API server about it | New cluster = install the controller Helm chart, register in API server with `network_config` |

## Key design principles

1. **CR-first.** The CR is the declarative contract. No side channels.
2. **OSMO routes workload, not packets.** API server picks the cluster; cluster mesh handles task-to-task networking. OSMO is never in the data plane.
3. **Etcd is the source of truth for live state.** History after TTL goes to structured logs + S3 archive. No relational database.
4. **Controller owns Kubernetes primitives.** API server never sees full Pod specs.
5. **Runtime is pluggable.** New runtime = Go reconciler + status mapper. Nothing else changes.
6. **Multi-cluster is first-class** via a phone-home gRPC session (backend dials control). No KubeFed-style federation.
7. **Fewer moving parts.** Worker, Delayed Job Monitor, Redis, and PostgreSQL all go away.

## What this is NOT

- **Not a rewrite of the workflow concept.** Existing workflow YAML continues to work; `runtimeType: kai` is the implicit default.
- **Not a swap of orchestration engines.** Not adopting Argo / Kubeflow / Flyte. The CR design is OSMO-native.
- **Not a multi-cluster federation layer.** Each cluster reconciles its own CRs; the API server federates state in Postgres.
- **Not a service mesh.** Cross-cluster networking (Submariner / WireGuard / Headscale) is an infra dependency the deployment picks; OSMO integrates but doesn't ship a mesh.

## What this requires

- **PROJ-147 (Operator Redesign)** as a hard dependency — the Go gRPC Operator Service is what hosts the new `CreateOTG`/`DeleteOTG`/`BarrierService` endpoints.
- A choice of cluster mesh per deployment (Submariner default, Tailnet for edge, Netmaker for low-latency) — documented but not bundled.
- Standard Kubernetes ≥ 1.27 on backend clusters (CRD v1 + controller-runtime patterns).

## The one-line pitch

> Replace OSMO's runtime-coupled Python orchestration with a Kubernetes-native CRD, making new runtimes a ~200 LOC drop-in, multi-cluster first-class, and the dependency surface smaller (no Redis, no Worker).
