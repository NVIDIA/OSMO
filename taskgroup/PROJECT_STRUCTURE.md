<!--
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
-->

# Architectural map

Implements **Architecture B** from the design doc: K8s-native, no Postgres. The control
cluster's etcd holds all operational state. Three custom resources carry it all:

| CRD | Lives where | What it represents |
|---|---|---|
| **OSMOWorkflow**   | Control cluster | A submitted workflow (DAG of groups). Owned by the user; reconciled by the Workflow Controller |
| **OSMOTaskGroup**  | Any cluster     | One node of the DAG, materialized as runtime-native K8s objects (Pods+PodGroup, NIMService, RayCluster, …) by a runtime reconciler |
| **OSMOCluster**    | Control cluster | One row in the cluster registry: identifies a backend cluster, declares its mesh, tracks session liveness |

## Component graph

```
                                ┌──────────────────────────────────────┐
                                │              Control Cluster          │
                                │                                       │
                  HTTP/JSON     │   ┌─────────────────────────────┐   │
   User ───────────────────────▶│   │  API Server (apiserver/)    │   │
                                │   │  - stateless                 │   │
                                │   │  - HTTP → K8s API translator │   │
                                │   │  - JWT auth (StaticTokenAuth │   │
                                │   │    placeholder)              │   │
                                │   └─────────────┬───────────────┘   │
                                │                 │ K8s API            │
                                │                 ▼                    │
                                │       ┌──────────────────┐           │
                                │       │  OSMOWorkflow CR  │           │
                                │       └──┬───────────────┘           │
                                │          │                            │
                                │          │ watch                      │
                                │          ▼                            │
                                │   ┌────────────────────────────────┐ │
                                │   │  Workflow Controller            │ │
                                │   │   (controller/workflow/)        │ │
                                │   │  - DAG resolution               │ │
                                │   │  - Local: creates OSMOTaskGroup │ │
                                │   │  - Remote (Phase 2): sends      │ │
                                │   │    CreateOTG via session stream │ │
                                │   └─────────────┬──────────────────┘ │
                                │                 │                     │
                                │                 ▼                     │
                                │     ┌───────────────────────────┐    │
                                │     │   OSMOTaskGroup CR(s)      │    │
                                │     │   (local cluster)          │    │
                                │     └──────────┬────────────────┘    │
                                │                │ watch                │
                                │                ▼                      │
                                │     ┌───────────────────────────┐    │
                                │     │ TaskGroup Controller       │    │
                                │     │ (controller/, runtimes/)   │    │
                                │     └──────────┬────────────────┘    │
                                │                │ renders              │
                                │                ▼                      │
                                │     ┌───────────────────────────┐    │
                                │     │  Pods + KAI PodGroup       │    │
                                │     │  (NIMService, RayCluster…  │    │
                                │     │   in later phases)         │    │
                                │     └───────────────────────────┘    │
                                │                                       │
                                │              (Phase 2+)               │
                                │   ┌─────────────────────────────┐   │
                                │   │  Operator Service             │   │
                                │   │  (operator/)                  │   │
                                │   │  - accepts bidi gRPC stream   │   │
                                │   │    from each backend cluster  │   │
                                │   │  - dispatches CreateOTG /     │   │
                                │   │    DeleteOTG / GetLogs over   │   │
                                │   │    the right stream           │   │
                                │   └─────────────┬───────────────┘   │
                                └─────────────────┼───────────────────┘
                                                  │ bi-di gRPC, always
                                                  │ initiated outbound
                                                  │ by the controller
                          ┌───────────────────────┼───────────────────────┐
                          ▼                       ▼                       ▼
                   ┌──────────────┐        ┌──────────────┐        ┌──────────────┐
                   │  Backend     │        │  Backend     │        │  Backend     │
                   │  Cluster A   │        │  Cluster B   │        │  Edge (NAT)  │
                   │              │        │              │        │              │
                   │ TaskGroup    │        │ TaskGroup    │        │ TaskGroup    │
                   │ Controller   │        │ Controller   │        │ Controller   │
                   │              │        │              │        │              │
                   │ Reconciles   │        │ Reconciles   │        │ Reconciles   │
                   │ Pods locally │        │ Pods locally │        │ Pods locally │
                   └──────────────┘        └──────────────┘        └──────────────┘
```

## Why this is "stateless"

The API server has **no database**. Every read/write goes to the control cluster's K8s API.
The "current state of every workflow" is just `kubectl get osmoworkflow -A`. The Workflow
Controller's reconcile loop is the orchestration engine. The TaskGroup Controllers each
own their cluster-local runtime details.

When historical queries / cost reporting / multi-month retention become a real need, a
**history projector** can watch terminal-state OSMOWorkflows and write immutable rows to
Postgres. Until then, K8s alone is enough.

## Package layout

| Directory | Purpose |
|---|---|
| `api/v1alpha1/` | All three CRD types: OSMOWorkflow, OSMOTaskGroup, OSMOCluster, plus typed runtimeConfig shapes |
| `config/crd/` | CRD manifests (kubectl-applyable) |
| `controller/` | Top-level **TaskGroup Reconciler**. Owns finalizers, periodic reconcile, runtime dispatch |
| `controller/runtimes/{kai,generic,nim,ray,dynamo,grove}/` | Per-runtime implementations. Only kai is real in Phase 1 |
| `controller/servicediscovery/` | Mesh interface + Submariner/Tailnet/Netmaker stubs |
| `controller/workflow/` | **Workflow Reconciler**. DAG resolution and TaskGroup dispatch |
| `operator/` | gRPC Operator Service — bidi stream for cross-cluster command + status (Phase 2) |
| `operator/proto/` | Source proto files |
| `operator/barrier/` | Phase 4 barrier-service Store interface |
| `apiserver/` | Stateless HTTP API server |
| `cmd/controller/` | Binary that runs both Workflow + TaskGroup controllers |
| `cmd/operator/`   | Binary that runs the Operator Service (skeleton) |
| `cmd/apiserver/`  | Binary that runs the HTTP API server |
| `internal/{k8s,log}` | Shared helpers |
| `test/` | Integration + golden-file tests |

## Extension points (the contract)

These four interfaces are the only seams new phases need to fill in. Everything else
stays untouched.

| Interface | Defined in | Phase 1 impls | Future impls |
|---|---|---|---|
| `runtimes.Runtime` (Reconciler + StatusMapper) | `controller/runtimes/runtime.go` | `kai` | `nim`, `ray`, `dynamo`, `grove` |
| `servicediscovery.Reconciler` | `controller/servicediscovery/discovery.go` | none | `submariner`, `tailnet`, `netmaker` |
| `workflow.Dispatcher` | `controller/workflow/dispatcher.go` | `LocalDispatcher` | `RemoteDispatcher` (over operator-service session stream) |
| `barrier.Store` | `operator/barrier/barrier.go` | none | Postgres-backed (Phase 4) |

## End-to-end request flow

```
1. User: POST /v1/workflows  (JSON body = OSMOWorkflowSpec)
        │
        ▼
2. API Server: validate, set owner, write OSMOWorkflow CR to control cluster
        │
        ▼
3. Workflow Controller: watch fires → resolveReady() returns groups whose
   dependencies are satisfied
        │
        ▼
4. For each ready group:
   - LocalDispatcher (Phase 1) → Client.Create OSMOTaskGroup in control cluster
   - RemoteDispatcher (Phase 2) → CreateOTG via operator-service session stream
        │
        ▼
5. TaskGroup Controller: watch fires → dispatcher.Resolve(spec.runtimeType)
   → KAI reconciler renders Pod + PodGroup
        │
        ▼
6. Pods run. Pod phase changes trigger TaskGroup Controller's StatusMapper
   → updates OSMOTaskGroup.status.phase
        │
        ▼
7. Workflow Controller's watch on OSMOTaskGroup fires → refreshLocalStatuses()
   → updates OSMOWorkflow.status.groups[name]
        │
        ▼
8. rollupPhase() → workflow Phase updates → user sees "Running" / "Succeeded"
   via GET /v1/workflows/{id}
        │
        ▼
9. User: DELETE /v1/workflows/{id}
        │
        ▼
10. API Server deletes OSMOWorkflow CR
       │
       ▼
11. K8s cascade-deletes child OSMOTaskGroup CRs (owner refs)
       │
       ▼
12. TaskGroup Controller's finalizer fires (log collection, etc.), removes
    finalizer, pods cascade-delete
```

## Build & test

- Plain Go modules. `go build ./...` and `go test ./...` from the `taskgroup/` directory.
- Apply CRDs: `kubectl apply -f config/crd/`
- Run all three binaries locally against a kubeconfig (kind, minikube, k3d all work).
