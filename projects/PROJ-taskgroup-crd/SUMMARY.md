<!--
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
-->

# OSMOTaskGroup CRD — Summary

**TL;DR**: Replace OSMO's Python pod-spec rendering + Worker + Redis with a Kubernetes CRD reconciled by per-cluster Go controllers. Adding new workload runtimes (NIM, Ray, Dynamo, Grove) becomes ~200 LOC of Go instead of cross-cutting Python+Go+SQL changes. Multi-cluster workflows become a first-class capability. Worker, Delayed Job Monitor, and Redis go away.

Full design: [PROJ-taskgroup-crd.md](./PROJ-taskgroup-crd.md)

## Why we're doing this

Three pressures forcing the architecture change:

1. **Every new runtime is a cross-cutting change today.** Adding NIM, Dynamo, or Ray support means touching the Python API server's `K8sObjectFactory`, the gRPC protocol, and the backend Worker. The runtime catalog is growing faster than this can scale.
2. **OSMO needs multi-cluster.** Workflows already want to span AKS + on-prem + neoclouds (CoreWeave, Nebius) + edge (Jetson, Orin). The current "API server renders Pod specs for one cluster" model has no clean way to express this.
3. **The Worker + Redis + Delayed Job Monitor stack predates Kubernetes-native primitives.** It's accumulated retry/dedup/scheduling logic that K8s controllers do better, with less infrastructure.

## Why OSMO at all — why not `kubectl apply` a RayCluster + NIMService + Job?

A reasonable challenge to the CRD direction: if everything's becoming K8s-native CRDs, why does OSMO need to exist? Couldn't a sophisticated user just `kubectl create` the resources they need and glue them together with a shell script?

For a single resource on a single cluster, **yes — and the CRD design intentionally makes that possible** (`kubectl apply -f my-taskgroup.yaml` works for dev/CI). But OSMO orchestrates everything *around* the resources, and that's not what `kubectl` provides:

| What OSMO does | Raw `kubectl` equivalent |
|---|---|
| **Workflow DAG** — group A finishes → group B starts → group C starts | Write a shell script. Hope it handles failures correctly. Lose state on script crash. |
| **Multi-cluster routing** — pick which cluster runs which group, dispatch CRs across cluster boundaries | One kubeconfig context = one cluster. Build your own dispatcher. |
| **Multi-tenant quotas + pools** — "this user has 100 GPU-hours in this pool, this dataset is restricted to this team" | K8s RBAC handles "can verb resource", not "has budget X in pool Y". |
| **Credential management** — NGC keys, HF tokens, Swift creds injected per cluster, rotated centrally | Create Secrets in every cluster manually. Rotate manually. |
| **Data plane** — inputs and outputs as Swift/S3 URLs, downloaded into pods automatically by osmo_ctrl, uploaded back at end of task | Bake `aws s3 cp` / `swift download` into every pod's command. Re-implement retry, partial-failure, checkpointing each time. |
| **Workflow history + lineage** — "show me every run by this user last week, what they cost, what they output" | Lost as soon as the CRs are garbage collected. Build your own audit log. |
| **Cost attribution** — GPU-hours per user / per pool / per project | Not in K8s primitives at all. Build a separate accounting service. |
| **Workflow-level cancel / timeout / retry** — kill a whole workflow with all its CRs and clean up everything | Per-resource semantics; cancellation across N CRs is your problem. |
| **Cross-task barriers** — "stage 2 starts when all 4 workers in stage 1 finish" | Write your own coordinator. |
| **CLI / SDK / UI** — `osmo workflow submit`, exec into a running task, tail logs across a 12-task workflow, web UI for researchers who shouldn't have to kubectl | The CLI is `kubectl`. There is no workflow-level UX. |
| **Federated status across clusters** — one place to see "this workflow has 3 groups, 1 on AKS, 1 on CoreWeave, 1 on a Jetson, and here's the rolled-up state" | `kubectl get` in N clusters separately. |
| **Backend cluster onboarding** — register a cluster once, OSMO knows pools, quotas, GPU types, credentials | Configure kubeconfig context manually, provision Secrets manually, document GPU SKUs in a wiki. |

### What the CRD design actually changes

OSMO doesn't go away — it gets *smaller and more Kubernetes-native*:

- The **per-task-group lifecycle** (rendering Pods, watching status, handling retries) moves into a standard K8s controller. That's the part that today is bespoke Python in `K8sObjectFactory` + Worker + Agent.
- The **workflow-level orchestration** (DAG, multi-cluster routing, quotas, credentials, data plane, history, cost, UI) stays in OSMO. There's no K8s-native alternative for any of these.
- **Power users gain `kubectl`-level access** for single-task-group operations — dev/CI/debugging — without having to stand up the whole OSMO stack.
- **Adding a new runtime becomes a controller plugin (~200 LOC of Go)** instead of a fork-the-API-server exercise.

The mental model: OSMO is to Kubernetes what Argo/Kubeflow/Flyte are — except with multi-cluster + multi-tenant + data-aware orchestration baked in. The CRD makes OSMO use K8s primitives the same way those projects do, instead of layering its own RPC protocol on top.

### What you'd give up by going raw `kubectl`

A team that's seriously considered "just use kubectl + scripts" usually ends up rebuilding the boxes above poorly. The common failure modes:

- Pipelines that work for one user, break for the second user, get rewritten for the third
- "We have a workflow engine" turns into 2000 lines of bash and a SQLite database in someone's home directory
- Multi-cluster becomes "ssh + bastion + kubectl" with credential leaks
- No one knows what ran last quarter or what it cost
- A new model runtime requires every team to update their scripts

OSMO exists to make those boxes work consistently. The CRD project doesn't change *what* OSMO does — it changes *how OSMO interacts with Kubernetes* so the OSMO surface is smaller, more debuggable, and faster to extend.

## Why TaskGroup as the CRD, not the whole Workflow

A reasonable alternative we considered and rejected: make `OSMOWorkflow` the top-level CR and have it own its TaskGroups, mirroring how Argo Workflows or Tekton Pipelines model a pipeline as one resource.

We chose **TaskGroup** as the unit because the workflow boundary doesn't map cleanly onto Kubernetes.

### Workflows are cross-cluster; CRs live in one cluster

A workflow can have groups in cluster A, cluster B, and an edge cluster — that's the point. A single CR can't represent that because CRs are namespaced to one Kubernetes cluster. To put the workflow in one CR you'd have to either:

- **Pick one "control" cluster to hold the workflow CR**, then have its controller reach across to other clusters to create TaskGroup resources. That requires a controller with credentials for every backend cluster — which is exactly KubeFed / Open Cluster Management style federation that we [explicitly rejected](./PROJ-taskgroup-crd.md#alternatives-considered).
- **Replicate the workflow CR to every participating cluster** and coordinate via federation. Same problem, more synchronization issues.

By keeping TaskGroup as the unit, each cluster's controller manages only what's local to it. The API server decides "this group runs in cluster B" and writes a TaskGroup CR there — clean, no cross-cluster controller required.

### Workflow concerns are cross-cutting; controllers manage local state

The things a workflow contains — RBAC for the submitter, pool quotas, credential bindings, dataset lineage, cost attribution, audit log, multi-step DAG orchestration — are inherently shared, cross-team, and cross-cluster concerns. They belong in a central service with a relational database. They don't belong in 17 Kubernetes clusters each holding their own opinions.

Kubernetes controllers are designed for *single-cluster, single-resource* reconciliation. Forcing workflow-level logic into them either (a) duplicates it across every cluster, (b) requires cluster-to-cluster RPCs to stay consistent, or (c) makes one cluster a federation hub. None of these are improvements over what the API server does today.

### TaskGroup is the natural Kubernetes unit

A "group of pods that runs together" — gang-scheduled batch, an inference service, a Ray cluster, a NIMService — maps cleanly onto Kubernetes primitives. Each runtime already has its own CRD or pod-grouping pattern. The TaskGroup CR is a thin wrapper that picks one and parameterizes it.

A "workflow" is not a Kubernetes thing. There's no standard K8s pattern for "DAG of resources with credential injection, pool quotas, multi-cluster dispatch, and cost attribution." Building it from scratch would mean reinventing what the OSMO API server already does well, just in CRD form.

### What we give up — and what we don't

**Give up:** a single `kubectl apply -f workflow.yaml` for an end-to-end multi-step workflow. To run a workflow in headless mode today, you'd `kubectl apply` each TaskGroup CR in order — workable for one or two groups, tedious for more.

**Keep:** the most common headless use cases. Dev/CI runs typically test one TaskGroup at a time; that's a single `kubectl apply`. Single-cluster workflows can also be wrapped in a simple bash loop without losing anything important.

**Future option:** if there's strong demand later for an `OSMOWorkflow` CR for single-cluster pipelines, it can be added as a *thin* orchestration layer on top of TaskGroup CRs — purely a coordination object, no rewriting of TaskGroup logic. The reverse (start with Workflow CR, retrofit per-cluster TaskGroups later) is much harder because you'd have to split a federated controller back into local ones.

### Summary

| Concern | Belongs in CR? | Belongs in API server? |
|---|---|---|
| Pod / NIMService / RayCluster lifecycle in one cluster | ✅ TaskGroup CR | |
| Status of those resources | ✅ TaskGroup status | (mirrored to Postgres) |
| Workflow DAG (group A → group B) | | ✅ API server orchestration |
| Multi-cluster routing | | ✅ API server dispatch |
| Pool quotas, RBAC, credential bindings | | ✅ API server + authz |
| Cost / audit / history | | ✅ Postgres |
| UI / CLI / SDK | | ✅ API server |

TaskGroup is the *Kubernetes* unit. Workflow is the *OSMO* unit. The CRD project makes the Kubernetes layer Kubernetes-native; the workflow layer stays in OSMO where it belongs.

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
| Redis required (job queue + barriers + event streams + cache) | **No Redis.** PostgreSQL + Object Storage only |
| Every runtime change = API server rollout = shared-blast-radius event | Per-cluster controller upgrade is isolated |
| Cross-cluster status requires API server federation logic | Postgres ↔ CR periodic reconciliation; standard pattern |
| Pod-spec rendering bugs surface in Python, far from where pods actually run | Rendering lives in the controller in the same cluster as the pods |
| Adding a new K8s admission webhook can silently break OSMO | Standard controller-runtime, predictable interaction with K8s |
| Workflow logs buffered in Redis (TB-scale strain) | Logs land in object storage with lifecycle policies — same place workflow data already lives |
| Backend cluster onboarding requires teaching API server about it | New cluster = install the controller Helm chart, register in API server with `network_config` |

## Key design principles

1. **CR-first.** The CR is the declarative contract. No side channels.
2. **OSMO routes workload, not packets.** API server picks the cluster; cluster mesh handles task-to-task networking. OSMO is never in the data plane.
3. **PostgreSQL is the source of truth across clusters.** Periodic reconciliation backstops every push.
4. **Controller owns Kubernetes primitives.** API server never sees full Pod specs.
5. **Runtime is pluggable.** New runtime = Go reconciler + status mapper. Nothing else changes.
6. **Multi-cluster is first-class.** Built into Phase 1, not deferred.
7. **Fewer moving parts.** Worker, Delayed Job Monitor, Redis all go away.

## What this is NOT

- **Not a rewrite of the workflow concept.** Existing workflow YAML continues to work; `runtimeType: kai` is the implicit default.
- **Not a swap of orchestration engines.** Not adopting Argo / Kubeflow / Flyte. The CR design is OSMO-native.
- **Not a multi-cluster federation layer.** Each cluster reconciles its own CRs; the API server federates state in Postgres.
- **Not a service mesh.** Cross-cluster networking (Submariner / WireGuard / Headscale) is an infra dependency the deployment picks; OSMO integrates but doesn't ship a mesh.

## What this requires

- **PROJ-147 (Operator Redesign)** as a hard dependency — the Go gRPC Operator Service is what hosts the new `CreateOTG`/`DeleteOTG`/`BarrierService` endpoints.
- A choice of cluster mesh per deployment (Submariner default, Tailnet for edge, Netmaker for low-latency) — documented but not bundled.
- Standard Kubernetes ≥ 1.27 on backend clusters (CRD v1 + controller-runtime patterns).

## Phasing (no time estimates)

Phase 1 is intentionally narrow. The controller architecture is built generically from day 1 (dispatcher + `Reconciler` / `StatusMapper` / Generic CRD Reconciler / `ServiceDiscoveryReconciler` interfaces all defined), but only the KAI runtime is implemented and only against a single cluster. Subsequent phases plug into the architecture without revisiting Phase 1 code.

0. **Phase 0** (prerequisite): refactor Python `K8sObjectFactory` + relevant `task.py` rendering into a pure function with golden-file fixtures, so the Go KAI reconciler has something verifiable to diff against
1. **Phase 1**: CRD + generic controller architecture + KAI reconciler + single-cluster + dual-write with the legacy path
2. **Phase 2**: Multi-cluster dispatch + first service-discovery mesh (Submariner)
3. **Phase 3**: NIM + Ray runtimes + Tailnet mesh for edge
4. **Phase 4**: Service consolidation — eliminate Worker, Delayed Job Monitor, Redis. Move logs to object storage. New gRPC barrier service. Each Redis call site is its own migration.
5. **Phase 5**: Dynamo + Grove + Netmaker mesh
6. **Phase 6**: Remove the legacy Python pod-rendering path entirely

## The one-line pitch

> Replace OSMO's runtime-coupled Python orchestration with a Kubernetes-native CRD, making new runtimes a ~200 LOC drop-in, multi-cluster first-class, and the dependency surface smaller (no Redis, no Worker).
