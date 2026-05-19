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

## 3. Install KAI PodGroup CRD (dev shim)

On a cluster without the real KAI Scheduler, install the stripped-down CRD so the
controller can create PodGroup resources. They won't gang-schedule, but Pods will still
run via the default scheduler.

```bash
kubectl apply -f deploy/dev/kai-podgroup-crd.yaml
```

For production, install KAI Scheduler proper from
[github.com/NVIDIA/KAI-scheduler](https://github.com/NVIDIA/KAI-scheduler).

## 4. Apply the full deployment

```bash
kubectl apply -k deploy/
```

This applies, in order:
- Namespaces (`osmo-system`, `osmo-workflows`)
- CRDs (OSMOWorkflow, OSMOTaskGroup, OSMOCluster)
- RBAC (ServiceAccount + ClusterRole + ClusterRoleBinding for both controller and apiserver)
- Controller Deployment
- API Server Deployment + Service

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
| Controller in CrashLoopBackOff | RBAC missing for KAI PodGroup | Apply `deploy/dev/kai-podgroup-crd.yaml` if KAI Scheduler is not installed |
| OSMOWorkflow stays Pending forever | Controller can't reach the workflow CR | Check `kubectl logs -n osmo-system deploy/taskgroup-controller` |
| 401 on API submit | Missing `Authorization: Bearer …` header | StaticTokenAuth needs *any* non-empty bearer token in Phase 1 |
| Pod stuck in Pending | No matching scheduler, no resources | Check `kubectl describe pod` events. On kind, the default scheduler should schedule because we have no real KAI |
| Workflow goes Failed immediately | `cluster:` field set on a group but no multi-cluster routing wired | Phase 1 supports only `cluster: ""` (empty/local). Remove the field from your workflow |
