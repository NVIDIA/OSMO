<!--
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
-->

# Multi-cluster deployment quickstart

OSMOTaskGroup multi-cluster splits responsibility across two cluster roles:

- **Control cluster** runs the API server, the Workflow Controller, and the Operator
  Service (gRPC server). All OSMOWorkflow CRs and OSMOCluster CRs live here.
- **Backend clusters** run the TaskGroup Controller + a session client that phones home
  to the control cluster's Operator Service. They never see OSMOWorkflow CRs; they only
  receive OSMOTaskGroup CRs dispatched from the control side.

Backend clusters always initiate the outbound TCP connection (no inbound exposure
required). The Operator Service authenticates each incoming session against an
OSMOCluster CR's token-hash Secret.

## Prerequisites

- `kubectl` contexts for the control cluster and every backend cluster.
- `openssl` and `sha256sum` (or `shasum -a 256` on macOS).
- A way for backend clusters to reach the control cluster's Operator Service:
  a LoadBalancer Service (default in `control-cluster.yaml`), a NodePort, or an
  Ingress with HTTP/2 (gRPC) support — see the commented Ingress block at the
  bottom of `control-cluster.yaml`.

## 1. Apply the control-cluster manifests

```bash
cp deploy/multicluster/kustomization.control.yaml deploy/multicluster/kustomization.yaml
kubectl --context=control apply -k deploy/multicluster/
```

This installs the namespace, the three CRDs (OSMOWorkflow, OSMOTaskGroup, OSMOCluster),
RBAC for the controller and API server, and Deployments + Services for the API server
and the control-plane controller.

Note the Operator Service's external address — for a LoadBalancer Service:

```bash
kubectl --context=control -n osmo-system get svc taskgroup-operator -o wide
```

Call this `OPERATOR_ENDPOINT` — typically `<external-IP>:9000` or
`operator.osmo.example.com:9000` if you fronted it with an Ingress.

## 2. Register each backend cluster

For every backend cluster you want to dispatch work to, generate a token, install it on
the backend (raw) and the control (hashed), then apply an OSMOCluster CR:

```bash
BACKEND=backend-a
TOKEN=$(openssl rand -hex 32)
HASH=$(echo -n "${TOKEN}" | shasum -a 256 | cut -d' ' -f1)

# Backend: store the raw token in the cluster that will use it.
kubectl --context=${BACKEND} create namespace osmo-system --dry-run=client -o yaml \
  | kubectl --context=${BACKEND} apply -f -
kubectl --context=${BACKEND} -n osmo-system create secret generic taskgroup-cluster-token \
  --from-literal=token="${TOKEN}"

# Control: store the SHA-256 hash only. The raw token never leaves the backend cluster
# or your local generation step.
kubectl --context=control -n osmo-system create secret generic ${BACKEND}-token \
  --from-literal=tokenHash="${HASH}"
```

Then create the OSMOCluster CR. Edit `cluster-registration.yaml` to match the name,
strip the placeholder Secret (real hash was created above), and apply:

```bash
sed "s/backend-a/${BACKEND}/g" deploy/multicluster/cluster-registration.yaml \
  | awk '/^---$/{section++} section<2' \
  | kubectl --context=control apply -f -
```

(The `awk` keeps only the first YAML doc — the OSMOCluster CR — and discards the
placeholder Secret stanza.)

## 3. Apply the backend-cluster manifests

Edit `backend-cluster.yaml` to set `--operator-endpoint` and `--cluster-id`, then:

```bash
cp deploy/multicluster/kustomization.backend.yaml deploy/multicluster/kustomization.yaml
kubectl --context=${BACKEND} apply -k deploy/multicluster/
```

## 4. Verify the session is established

```bash
kubectl --context=control -n osmo-system logs deploy/taskgroup-control --tail=50 \
  | grep -E 'session established|hello rejected'
kubectl --context=control get osmocluster ${BACKEND} -o yaml
```

`status.connection` should be `Connected` and `status.lastSeen` should be recent.

## 5. Submit a workflow that targets the backend

```bash
curl -X POST http://<apiserver-address>/v1/workflows \
  -H 'Content-Type: application/json' \
  -d @- <<EOF
{
  "name": "demo",
  "groups": [
    {
      "name": "train",
      "cluster": "${BACKEND}",
      "runtimeType": "kai",
      "runtimeConfig": {
        "tasks": [{
          "name": "main",
          "image": "busybox",
          "command": ["echo", "hello from ${BACKEND}"]
        }]
      }
    }
  ]
}
EOF
```

The Workflow Controller dispatches the group via the Operator Service's session stream;
the backend's TaskGroup Controller materializes a Pod and pushes status events back.

## How it actually works (paths)

```
USER ──HTTP──▶ apiserver (control cluster)
                  │ K8s API: writes OSMOWorkflow CR (control)
                  ▼
              Workflow Controller (control)
                  │ resolves DAG, sees group.cluster: backend-a
                  │ calls RemoteDispatcher → CommandBus.DispatchCreateOTG
                  ▼
              Operator Service (in-process, control)
                  │ looks up backend-a's open session stream
                  │ sends OperatorEnvelope{CreateOTG} on that stream
                  ▼   (bidi gRPC stream, initiated by the backend's controller)
                  │
              TaskGroup Controller (backend-a)
                  │ receives CreateOTG via session client
                  │ applies OSMOTaskGroup CR to LOCAL K8s API (backend)
                  │ uses its own in-cluster service account
                  │
                  ▼ (local watch fires)
              TaskGroup Reconciler (backend-a)
                  │ KAI runtime renders Pod + PodGroup
                  ▼
              Pod runs in backend-a
                  │
                  │ status updates flow back through the session stream:
                  ▼
              Operator Service publishes to StatusBus (control)
                  ▼
              StartRemoteStatusBridge subscribes
                  ▼
              Updates OSMOWorkflow.status.Groups[group] (control)
```

Key invariants:
- The backend controller is always the gRPC *client*. The Operator Service never dials
  into a backend. NAT'd / private / edge clusters work as long as they can reach the
  control cluster's `:9000` outbound.
- Authentication happens once per session, on Hello, against the SHA-256 hash stored in
  `OSMOCluster.spec.tokenSecretRef`. Plaintext tokens never leave the backend.
- Cross-cluster owner references don't exist, so backend OTGs are not GC'd by the
  control side's K8s. Instead, the Workflow Controller carries
  `workflow.osmo.nvidia.com/remote-cleanup` finalizer and emits explicit `DeleteOTG`
  commands on workflow deletion (plus from an annotation set BEFORE Create, so a
  controller crash between dispatch and status write still cleans up).
- Status freshness across a control-plane restart: on every successful Hello the
  Operator Service sends a `ResyncRequest` and the backend's session client pushes
  the current status of every OTG in its namespace, recovering state without waiting
  for the next reconcile-driven event.

## Troubleshooting

- `hello rejected` on the control side: the token hash on the control side doesn't
  match the SHA-256 of the raw token on the backend. Regenerate.
- Backend logs say `dial: connection refused`: the `--operator-endpoint` is wrong,
  the Service has no external IP yet, or there's no network path. Verify with
  `kubectl --context=${BACKEND} run nc --image=busybox --rm -it --restart=Never \
   -- nc -vz <operator-host> 9000`.
- OSMOTaskGroup created on the backend but stays Pending: confirm the KAI PodGroup CRD
  is installed (`kubectl get crd podgroups.scheduling.kai.run.ai`). The kustomization
  includes the dev CRD; for production install the real KAI Scheduler chart.
