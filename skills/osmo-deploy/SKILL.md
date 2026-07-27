---
name: osmo-deploy
description: >
  Install and operate OSMO on an existing Kubernetes cluster with the OSMO
  umbrella Helm chart. Use for single-node, minimal, split-plane, External
  Secrets/NVault, Kubernetes or KAI scheduler, GPU prerequisites, upgrades,
  rollbacks, and Helm post-install validation.
license: Apache-2.0
compatibility: >
  Requires a conformant Kubernetes cluster, kubectl, Helm, and access to the
  configured OSMO images. Production secret mode requires pre-existing
  Kubernetes Secrets or External Secrets Operator plus an NVault-backed
  SecretStore. GPU installations require a working NVIDIA GPU Operator.
metadata:
  author: nvidia
  version: "2.0.0"
---

# OSMO Deploy

## When to use

Use this skill when the user asks to install, deploy, configure, upgrade,
rollback, verify, or uninstall OSMO on Kubernetes. It also applies to OSMO
deployment profiles, storage wiring, External Secrets/NVault, optional KAI
scheduling, and GPU cluster prerequisites.

Do not use this skill for workflow submission or debugging; route those
requests to the OSMO user workflow instead. Do not provision cloud accounts,
networks, Kubernetes clusters, managed databases, object stores, DNS, or IAM.
Those are platform-owned prerequisites outside the OSMO installation contract.

## Canonical entry point

All supported installations use
[`deployments/charts/osmo`](../../deployments/charts/osmo):

```bash
helm dependency build --skip-refresh deployments/charts/osmo
helm upgrade --install osmo deployments/charts/osmo \
  --namespace osmo-system \
  --create-namespace \
  --values deployments/charts/osmo/profiles/single-node.yaml \
  --wait \
  --timeout 15m
helm test osmo --namespace osmo-system --logs
```

Do not use or recreate provider-specific Terraform wrappers, deployment shell
orchestrators, imperative backend-user setup, or separate service and backend
operator installation flows.

## Required inputs

Before mutating a cluster, determine:

1. The exact kubeconfig context and target namespace. Show both to the user
   before a production change.
2. The deployment profile:
   - `single-node.yaml`: local development and evaluation; generated Secrets.
   - `minimal.yaml`: small converged installation; existing Secrets.
   - `split-control.yaml`: control cluster; External Secrets by default.
   - `split-compute.yaml`: compute cluster; External Secrets by default.
3. The chart version or source revision and matching OSMO image registry/tag.
   Never use an unpinned `latest` production deployment.
4. Secret mode and Secret names. For External Secrets, obtain the
   SecretStore/ClusterSecretStore name and NVault key/property mappings.
5. Storage choice: embedded development services or reachable PostgreSQL,
   Redis, and object storage endpoints.
6. Scheduler:
   - `kubernetes` is the portable default and requires no scheduler CRDs.
   - `kai` requires a working KAI installation and is used for gang,
     priority, and topology-aware scheduling.
7. Whether GPUs are required. GPU nodes must already expose allocatable
   `nvidia.com/gpu` through NVIDIA GPU Operator or an equivalent platform
   installation.
8. Gateway exposure, hostname, TLS, and identity-provider inputs.

If any answer changes the topology, identity, persistence, or external exposure
of a production installation, stop and request it rather than guessing.

## Workflow

### 1. Verify the target

Run read-only checks first:

```bash
kubectl config current-context
kubectl version
kubectl auth can-i create deployments --namespace <namespace>
kubectl get storageclass
helm version
```

Pin `--kube-context` and `--namespace` on every Helm or kubectl command when
more than one cluster is configured. Never rely on a mutable current context
for production operations.

### 2. Prepare values

Copy the closest reference profile into a deployment-owned values file. Keep
environment-specific hostnames, storage endpoints, Secret references, and
identity settings outside the shipped profile.

Production installations use one of:

- `secretManagement.mode: existing` for controller- or operator-created
  Kubernetes Secrets.
- `secretManagement.mode: external-secrets` for ExternalSecret resources
  reconciled from NVault.

`secretManagement.mode: generated` is development-only. Never use it for a
production control plane.

The default Secret contract is:

| Key | Consumer |
| --- | --- |
| `db-password` | PostgreSQL and OSMO services |
| `redis-password` | Redis and OSMO services |
| `backend-token` | bootstrap principal and backend operator |
| `mek.yaml` | OSMO Master Encryption Key |

Do not print Secret data or pass raw credentials through Helm command-line
values.

### 3. Render before install

```bash
helm dependency build --skip-refresh deployments/charts/osmo
helm lint deployments/charts/osmo --values <values-file>
helm template osmo deployments/charts/osmo \
  --namespace <namespace> \
  --values <values-file> > /tmp/osmo-rendered.yaml
```

Inspect the rendered namespaces, cluster-scoped RBAC, persistence, image tags,
gateway exposure, ExternalSecrets, scheduler choice, and Secret references.

### 4. Install or upgrade

```bash
helm upgrade --install osmo deployments/charts/osmo \
  --kube-context <context> \
  --namespace <namespace> \
  --create-namespace \
  --values <values-file> \
  --wait \
  --rollback-on-failure \
  --timeout 15m
```

The chart owns OSMO Kubernetes resources. It does not provision the cluster or
cloud services.

### 5. Verify

```bash
helm status osmo --kube-context <context> --namespace <namespace>
helm test osmo --kube-context <context> --namespace <namespace> --logs
kubectl --context <context> --namespace <namespace> get deployments,pods
```

The preflight and postflight hooks validate required APIs, RBAC, storage,
Secrets, deployment readiness, the gateway API, runtime callback URL, and
backend heartbeat.

For an end-to-end CPU workflow check, use
[`deployments/workflows/verify-hello.yaml`](../../deployments/workflows/verify-hello.yaml)
through the OSMO user workflow. Use `verify-gpu.yaml` only when a GPU pool is
expected.

### 6. Upgrade and rollback

Render and review the new chart and values first. Use `helm upgrade` with an
explicit chart/image version and `--rollback-on-failure`. After success, run
`helm test --logs` and a workflow smoke test. If validation fails, inspect
`helm history` and roll back only to a known compatible revision:

```bash
helm history osmo --namespace <namespace>
helm rollback osmo <revision> --namespace <namespace> --wait
```

Database migrations, MEK compatibility, and Secret preservation are release
gates; do not assume a chart rollback reverses an external database migration.

## Split-plane deployments

Install the umbrella chart independently in each cluster:

- Control cluster: `profiles/split-control.yaml`
- Compute cluster: `profiles/split-compute.yaml`

The compute profile must use an externally reachable control-plane
`computePlane.global.serviceUrl`. Both clusters must resolve the same backend
token from NVault. Use distinct, explicitly pinned kube contexts and release
names.

## Troubleshooting

- Preflight failures are missing cluster capabilities or inputs; correct the
  prerequisite rather than disabling checks.
- ExternalSecret failures require inspecting External Secrets status and the
  referenced SecretStore. Do not fall back to static production credentials.
- Pending OSMO workloads belong to workflow troubleshooting after the backend
  is online.
- A missing KAI CRD is expected when KAI is selected but not installed; either
  install KAI through the platform or select the Kubernetes scheduler.
- ImagePullBackOff requires a reachable registry, a valid image tag, or an
  existing imagePullSecret.
