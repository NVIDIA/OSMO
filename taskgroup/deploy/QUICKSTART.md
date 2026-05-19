<!--
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
-->

# Deploy quickstart

End-to-end: stand up a local cluster, deploy the controller + API server, submit a
workflow via HTTP, watch it run.

## Prerequisites

- `kind` ≥ 0.20 (or any K8s cluster you have admin on)
- `docker`
- `kubectl`
- `curl`

## 1. Build images

From the `taskgroup/` directory:

```bash
docker build -f deploy/Dockerfile.controller -t osmo-taskgroup-controller:v0.1.0 .
docker build -f deploy/Dockerfile.apiserver  -t osmo-taskgroup-apiserver:v0.1.0  .
```

## 2. Spin up a kind cluster and load the images

```bash
kind create cluster --name osmo-tg
kind load docker-image osmo-taskgroup-controller:v0.1.0 --name osmo-tg
kind load docker-image osmo-taskgroup-apiserver:v0.1.0  --name osmo-tg
```

## 3. Install CRDs (must precede the controller)

CRDs need to be Established before the controller's watch starts, otherwise the first
reconcile will error out.

```bash
kubectl apply -f config/crd/
kubectl wait --for=condition=Established crd/osmoworkflows.workflow.osmo.nvidia.com  --timeout=60s
kubectl wait --for=condition=Established crd/osmotaskgroups.workflow.osmo.nvidia.com --timeout=60s
kubectl wait --for=condition=Established crd/osmoclusters.workflow.osmo.nvidia.com   --timeout=60s
```

**Only if you want to run gang-scheduled workflows**, also install KAI:

```bash
# Real install (production):
#   https://github.com/NVIDIA/KAI-scheduler

# Or for dev only (CRD shim — no scheduler, just lets the controller create PodGroups):
kubectl apply -f deploy/dev/kai-podgroup-crd.yaml
```

The sample workflow in this quickstart does **not** require KAI — it leaves
`gangScheduling` unset (default: off), so Pods run via the cluster's default scheduler.

## 4. Apply the rest of the deployment

```bash
kubectl apply -k deploy/
```

(Kustomize applies CRDs again here; that's a no-op since you applied them in step 3.)

Wait for the workloads:

```bash
kubectl -n osmo-system wait --for=condition=Available deploy/taskgroup-controller --timeout=60s
kubectl -n osmo-system wait --for=condition=Available deploy/taskgroup-apiserver  --timeout=60s
```

## 5. Submit a workflow via the API server

Port-forward the API server:

```bash
kubectl -n osmo-system port-forward svc/taskgroup-apiserver 8088:8088 &
```

Submit the sample workflow:

```bash
curl -X POST http://localhost:8088/v1/workflows \
  -H "Authorization: Bearer vivianp@nvidia.com" \
  -H "Content-Type: application/json" \
  -d @deploy/sample-workflow.json
```

Response:

```json
{"id":"wf-abcde","namespace":"osmo-workflows"}
```

## 6. Observe

```bash
# Through the API server:
curl -s -H "Authorization: Bearer vivianp@nvidia.com" \
  http://localhost:8088/v1/workflows | jq .

# Or directly via kubectl (this is the "headless mode" the design enables):
kubectl get osmoworkflow -n osmo-workflows
kubectl get osmotaskgroup -n osmo-workflows
kubectl get pods -n osmo-workflows
```

You should see the workflow CR move through `Pending` → `Running` → `Succeeded`,
its OSMOTaskGroup child do the same, and a Pod from `busybox` echo "hello" and exit 0.

Logs from the running Pod (the API server's log endpoint is stubbed in Phase 1; use
kubectl):

```bash
kubectl logs -n osmo-workflows -l workflow.osmo.nvidia.com/workflow-id=wf-abcde
```

## 7. Tear down

```bash
curl -X DELETE -H "Authorization: Bearer vivianp@nvidia.com" \
  http://localhost:8088/v1/workflows/wf-abcde
# Cascade-deletes the OSMOTaskGroup and its Pods.

# Or to wipe everything:
kubectl delete -k deploy/
kind delete cluster --name osmo-tg
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Controller error: `no matches for kind OSMOTaskGroup` | CRDs weren't Established before controller started | Re-apply CRDs and wait for `kubectl wait --for=condition=Established` |
| Pod stuck in Pending with `schedulerName: kai-scheduler` | Workflow set `gangScheduling: true` but no KAI Scheduler in cluster | Either remove `gangScheduling: true` from the workflow or install KAI Scheduler |
| Pod stuck in Pending (default scheduler) | Insufficient cluster resources, node taints, image pull | Check `kubectl describe pod` events |
| 401 on API submit | Missing `Authorization: Bearer …` header | StaticTokenAuth needs *any* non-empty bearer token in Phase 1 |
| Workflow goes Failed immediately | `cluster:` field set on a group but no multi-cluster routing wired | Phase 1 supports only `cluster: ""` (empty/local). Remove the field from your workflow |
| `kubectl apply -k deploy/` says "no such file" for kustomization | Wrong cwd — kustomization's relative paths assume `taskgroup/` | `cd taskgroup/` first |
