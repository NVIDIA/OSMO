<!--
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
-->

# OSMOTaskGroup — clean-room implementation

Clean-room implementation of the design described in
[`projects/PROJ-taskgroup-crd/`](../projects/PROJ-taskgroup-crd/PROJ-taskgroup-crd.md).
**Architecture B**: K8s-native, no Postgres. The control cluster's etcd holds all
operational state.

This module is intentionally **isolated from the existing OSMO Python codebase**. It
builds from the design as the spec; nothing is ported from `K8sObjectFactory` or related
Python paths.

## Status

| Component | Phase 1 | Notes |
|---|---|---|
| `OSMOWorkflow` CRD + Workflow Controller | ✅ real | DAG resolution, local dispatch, status rollup |
| `OSMOTaskGroup` CRD + TaskGroup Controller | ✅ real | Runtime dispatcher, finalizer, periodic reconcile |
| `OSMOCluster` CRD | ✅ types/manifest | Used by Phase 2+ multi-cluster routing |
| KAI runtime | ✅ real | Pod + PodGroup, status rollup |
| NIM / Ray / Dynamo / Grove runtimes | 🟡 stub | doc.go placeholders, plug in later |
| Service-discovery meshes (Submariner / Tailnet / Netmaker) | 🟡 stub | Phase 2/3/5 |
| Operator Service (gRPC bidi stream) | 🟡 proto only | Phase 2; controllers run standalone today |
| Stateless HTTP API server | ✅ real | Submit / list / get / delete; logs endpoint stubbed |
| Barrier service | 🟡 proto + Store interface | Phase 4 |
| Multi-cluster routing | 🟡 hook exists | `RemoteResolver` nil in Phase 1 |

See [PROJECT_STRUCTURE.md](./PROJECT_STRUCTURE.md) for the architectural map.

## Three binaries

| Binary | What it does | When you run it |
|---|---|---|
| `cmd/controller` | Workflow Controller + TaskGroup Controller | One per cluster (Phase 1: in the same cluster as the API server) |
| `cmd/apiserver`  | Stateless HTTP API server                  | In the control cluster |
| `cmd/operator`   | Operator Service skeleton (Phase 2)        | Not needed for single-cluster Phase 1 |

## Quick start

### Local dev (process against a kubeconfig)

```bash
cd taskgroup
kubectl apply -f config/crd/
kubectl create namespace osmo-workflows
go run ./cmd/controller --kubeconfig ~/.kube/config &
go run ./cmd/apiserver --kubeconfig ~/.kube/config &

curl -X POST http://localhost:8088/v1/workflows \
  -H "Authorization: Bearer me@example.com" \
  -H "Content-Type: application/json" \
  -d @deploy/sample-workflow.json
```

### Live cluster deployment (kind, EKS, AKS, GKE …)

See **[`deploy/QUICKSTART.md`](./deploy/QUICKSTART.md)** for the full kind walkthrough:
build images → load → `kubectl apply -k deploy/` → curl a workflow → observe via kubectl.

## How the pieces talk

```
       ┌─────────────────┐                       ┌─────────────────┐
   ─▶  │  API Server     │ ─── K8s API ──▶      │  K8s control     │
       │  (HTTP)         │ ◀── status reads ─── │  plane (etcd)    │
       └─────────────────┘                       │                  │
                                                  │  OSMOWorkflow CR │
       ┌─────────────────┐                       │  OSMOTaskGroup CR│
       │  Workflow       │ ── watch + writes ──▶│  OSMOCluster CR  │
       │  Controller     │                       └────────┬────────┘
       └─────────────────┘                                 │
                                                           │
       ┌─────────────────┐                                 │
       │  TaskGroup      │ ── watch + writes ──────────────┘
       │  Controller     │                              │
       └────────┬────────┘                              ▼
                │                                ┌────────────────┐
                └─── creates ───────────────▶   │  Pods + KAI    │
                                                 │  PodGroup       │
                                                 └────────────────┘
```

Architecture is **stateless API server, controllers, K8s as the database**. No Postgres,
no Redis, no Kombu, no Worker. The control cluster's etcd is the only persistent store
for Phase 1.

## Design references

- Full design: [PROJ-taskgroup-crd.md](../projects/PROJ-taskgroup-crd/PROJ-taskgroup-crd.md)
- Summary: [SUMMARY.md](../projects/PROJ-taskgroup-crd/SUMMARY.md)
- Companion project: [PROJ-147 Operator Redesign](../projects/PROJ-147-operator-redesign/PROJ-147-operator-redesign.md)
