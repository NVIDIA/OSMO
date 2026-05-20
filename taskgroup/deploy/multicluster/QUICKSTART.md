<!--
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
-->

# Multi-cluster QUICKSTART

Two-cluster topology: API Server + Workflow Controller + Operator Service in **cluster A
(control)**; TaskGroup Controller in **cluster B (backend)**. Cluster B connects outbound
to cluster A's Operator Service over gRPC. No inbound exposure of cluster B is needed —
works for NAT'd, private, or edge clusters.

Pre-reqs:
- Two kubeconfig contexts (`KUBECONFIG_A`, `KUBECONFIG_B`)
- Built and pushed images: `nvcr.io/nvstaging/osmo/taskgroup-controller:v0.1.0` and
  `nvcr.io/nvstaging/osmo/taskgroup-apiserver:v0.1.0`
- Cluster A's Operator Service must be reachable from cluster B over gRPC (LoadBalancer
  IP, NodePort, or Ingress + TLS termination — the manifest defaults to LoadBalancer)

## 1. Generate the cluster bearer token

```bash
TOKEN=$(openssl rand -hex 32)
TOKEN_HASH=$(echo -n "${TOKEN}" | sha256sum | awk '{print $1}')
echo "TOKEN     = ${TOKEN}"
echo "TOKEN_HASH = ${TOKEN_HASH}"
```

The plain `TOKEN` goes into cluster B. The `TOKEN_HASH` goes into an OSMOCluster
registration in cluster A.

## 2. Cluster A — control plane

Set `kubectl` context to cluster A.

```bash
# CRDs + namespaces + RBAC + apiserver
kubectl --context=cluster-a apply -f config/crd/
kubectl --context=cluster-a wait --for=condition=Established crd/osmoworkflows.workflow.osmo.nvidia.com  --timeout=60s
kubectl --context=cluster-a wait --for=condition=Established crd/osmotaskgroups.workflow.osmo.nvidia.com --timeout=60s
kubectl --context=cluster-a wait --for=condition=Established crd/osmoclusters.workflow.osmo.nvidia.com   --timeout=60s

kubectl --context=cluster-a apply -f deploy/namespace.yaml
kubectl --context=cluster-a apply -f deploy/rbac.yaml
kubectl --context=cluster-a apply -f deploy/apiserver.yaml
kubectl --context=cluster-a apply -f deploy/multicluster/control-cluster.yaml
```

Register cluster B and store its token hash:

```bash
kubectl --context=cluster-a create secret generic cluster-b-token-hash \
  -n osmo-system --from-literal=tokenHash="${TOKEN_HASH}"

kubectl --context=cluster-a apply -f - <<EOF
apiVersion: workflow.osmo.nvidia.com/v1alpha1
kind: OSMOCluster
metadata:
  name: cluster-b
spec:
  region: example
  provider: example
  network: {type: ""}
  tokenSecretRef:
    name: cluster-b-token-hash
    namespace: osmo-system
EOF
```

Verify the Operator Service is reachable (get the LB external IP/hostname):

```bash
kubectl --context=cluster-a -n osmo-system get svc taskgroup-operator-service
# Note the EXTERNAL-IP; this is the OPERATOR_ENDPOINT for cluster B below.
```

## 3. Cluster B — backend

Set the operator endpoint and cluster id placeholders, then provision the bearer token
and apply:

```bash
# Replace these:
OPERATOR_ENDPOINT="LB-IP-FROM-STEP-2"     # e.g. 10.42.42.42
CLUSTER_ID="cluster-b"

kubectl --context=cluster-b apply -f deploy/namespace.yaml
kubectl --context=cluster-b apply -f config/crd/workflow.osmo.nvidia.com_osmotaskgroups.yaml

kubectl --context=cluster-b create secret generic taskgroup-cluster-token \
  -n osmo-system --from-literal=token="${TOKEN}"

# Render the manifest with substitutions:
sed -e "s|CHANGEME_OPERATOR_ENDPOINT|${OPERATOR_ENDPOINT}|" \
    -e "s|CHANGEME_CLUSTER_ID|${CLUSTER_ID}|" \
    deploy/multicluster/backend-cluster.yaml \
| kubectl --context=cluster-b apply -f -
```

Wait for the backend controller to come up:

```bash
kubectl --context=cluster-b -n osmo-system wait --for=condition=Available deploy/taskgroup-backend --timeout=60s
kubectl --context=cluster-b -n osmo-system logs deploy/taskgroup-backend | grep "session established"
```

You should see `session established` in cluster B's controller logs. On cluster A:

```bash
kubectl --context=cluster-a get osmocluster cluster-b -o jsonpath='{.status.connection}'
# Should print: Connected
```

## 4. Submit a workflow

Port-forward the API server in cluster A and submit. The workflow's group targets
`cluster: cluster-b`:

```bash
kubectl --context=cluster-a -n osmo-system port-forward svc/taskgroup-apiserver 8088:8088 &

curl -X POST http://localhost:8088/v1/workflows \
  -H "Authorization: Bearer me@example.com" \
  -H "Content-Type: application/json" \
  -d @- <<EOF
{
  "groups": [
    {
      "name": "hello",
      "cluster": "cluster-b",
      "runtimeType": "kai",
      "runtimeConfig": {
        "tasks": [{
          "name": "worker-0",
          "lead": true,
          "image": "busybox:1.36",
          "resources": {"cpu": "100m", "memory": "64Mi"},
          "command": ["sh", "-c"],
          "args": ["echo hello from cluster-b && sleep 5"]
        }]
      }
    }
  ]
}
EOF
```

Observe:

```bash
# On cluster A: workflow status
kubectl --context=cluster-a get osmoworkflow -n osmo-workflows

# On cluster B: the OSMOTaskGroup and its Pod actually running here
kubectl --context=cluster-b get osmotaskgroup -n osmo-workflows
kubectl --context=cluster-b get pods -n osmo-workflows
```

## How it actually works (paths)

```
USER ──HTTP──▶ apiserver (cluster A)
                  │ K8s API: writes OSMOWorkflow CR (cluster A)
                  ▼
              Workflow Controller (cluster A)
                  │ resolves DAG, sees cluster: cluster-b
                  │ calls RemoteDispatcher → CommandBus.DispatchCreateOTG
                  ▼
              Operator Service (in-process, cluster A)
                  │ looks up cluster-b's open stream
                  │ sends OperatorEnvelope{CreateOTG} on that stream
                  ▼   (bidi gRPC stream, initiated by cluster B's controller)
                  │
              TaskGroup Controller (cluster B)
                  │ receives CreateOTG via session client
                  │ applies OSMOTaskGroup CR to LOCAL K8s API (cluster B)
                  │ uses its own in-cluster service account
                  │
                  ▼ (local watch fires)
              TaskGroup Reconciler (cluster B)
                  │ KAI runtime renders Pod + PodGroup
                  ▼
              Pod runs in cluster B
                  │
                  │ status updates flow back through the session stream:
                  ▼
              Operator Service publishes to StatusBus
                  ▼
              Workflow Controller subscribes
                  ▼
              Updates OSMOWorkflow.status (cluster A)
```

## Security notes (Phase 2 MVP)

- Transport is **plain HTTP/2 gRPC, no TLS**. Suitable only for trusted private
  networks. Production needs mTLS — wire it into the gRPC server options.
- Token auth: SHA-256 of a 32-byte random token. Sufficient inside a trusted backbone;
  rotate by replacing the OSMOCluster's `tokenSecretRef` and the backend's
  `taskgroup-cluster-token` Secret in coordination.
- The Operator Service's gRPC port (9000) must be reachable from cluster B but does NOT
  need to be exposed to the public internet. Restrict via NetworkPolicy + cloud firewall.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `OSMOCluster.status.connection` stays `Disconnected` | Cluster B can't reach the operator endpoint or the token doesn't match | Check cluster B controller logs for `dial` errors or `unauthorized`; verify the SHA-256 of `taskgroup-cluster-token` matches `cluster-b-token-hash` |
| Workflow group stays `Pending` indefinitely | RemoteResolver returns "not connected" — same as above | Wait for the session to establish; then the next reconcile tick (≤30s) will dispatch |
| `unauthorized` in operator logs on every Hello | Token hash mismatch | Regenerate token + hash, update both Secrets, restart the backend controller pod |
| Cluster B sees the OTG but never runs Pods | Look at it like a single-cluster bug (KAI scheduler missing? gangScheduling needed?) | Same troubleshooting as `deploy/QUICKSTART.md` |
