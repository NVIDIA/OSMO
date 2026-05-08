<!--
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

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

# OSMO Deployment Scripts

End-to-end deployer for OSMO 6.3 across multiple Kubernetes flavors and storage backends. The single entry point is `deploy-osmo-minimal.sh`; everything else (Terraform, KAI install, GPU Operator, MinIO, storage credential wiring, smoke tests) is invoked as a phase.

## Quick Start

```bash
# Azure: provision AKS + PG + Redis + Blob, then install OSMO
./deploy-osmo-minimal.sh --provider azure

# AWS: provision EKS + RDS + ElastiCache + S3, then install OSMO
./deploy-osmo-minimal.sh --provider aws

# Single-node MicroK8s on a fresh Ubuntu box (auto-installs MicroK8s)
./deploy-osmo-minimal.sh --provider microk8s --gpu

# Bring-your-own cluster (kubectl already pointing at it)
export POSTGRES_HOST=... POSTGRES_USERNAME=... POSTGRES_PASSWORD=...
export POSTGRES_DB_NAME=... REDIS_HOST=... REDIS_PORT=... REDIS_PASSWORD=...
./deploy-osmo-minimal.sh --provider byo --storage-backend byo
```

Re-running is idempotent (`helm upgrade --install` everywhere). Destroy with `--destroy`.

## Deployment Combinations

Three orthogonal axes:

1. **`--provider`** — who owns the cluster.
2. **`--storage-backend`** — which object store OSMO writes workflow data, logs, and apps to.
3. **`--auth-method`** — how OSMO services authenticate to that store: `static` (K8s Secret with credentials) or `workload-identity` (AKS Workload Identity / AWS IRSA — no static creds in cluster).

Cells show which auth methods are valid for each `(provider, storage-backend)` pair:

| ↓ Provider \ Storage → | `minio`      | `azure-blob`         | `s3`       | `byo`                |
|------------------------|--------------|----------------------|------------|----------------------|
| `azure` (AKS)          | static       | static, WI           | static     | static, WI           |
| `aws` (EKS)            | static       | static               | static     | static, WI (IRSA)    |
| `microk8s` (single-node) | static     | —                    | —          | static               |
| `byo` (any K8s)        | static       | static, WI*          | static     | static, WI*          |

\* `workload-identity` on `byo` requires the cluster's K8s API server to have the appropriate OIDC issuer + the cloud-side trust set up by the caller.

Notes:
- `s3` does **not** support `workload-identity` directly — use `--backend byo --auth-method workload-identity` with IRSA instead. `s3.sh` errors out with this guidance.
- `microk8s` deliberately has no cloud-identity path — it's a single-node dev/eval flow.
- Cross-cloud combinations (e.g. AKS pointing at S3) are valid for `static` auth.

## Tested Configurations

What "tested" means here: the listed combination ran `deploy-osmo-minimal.sh` end-to-end, all OSMO pods reached `Running 1/1`, the bundled `verify.sh` smoke workflow (`workflows/verify-hello.yaml` + optionally `verify-gpu.yaml`) reached `COMPLETED`, and (where called out) a real workload pipeline succeeded.

| Provider | Storage / Auth     | Last green | Workload verified | Notes |
|----------|-------------------|------------|-------------------|-------|
| `azure` (BYO mode against orion-cluster-azure) | `azure-blob` / static | 2026-05-07 | SDG NIM pipeline E2E (4 tasks: config_generation, pseudo_labeling_original, cosmos_augmentation, pseudo_labeling_augmented) on `Standard_NC40ads_H100_v5` | KAI + GPU Operator detect-and-skip (orion installed them); used 6.3 prerelease tags `OSMO_IMAGE_TAG=6.3.0-prerelease-rc6`, `OSMO_CHART_VERSION=1.3.0-prerelease-rc6`, `OSMO_HELM_REPO_URL=https://helm.ngc.nvidia.com/nvstaging/osmo`. Required PR #961 (configurable `startupProbe.timeoutSeconds`). |
| `azure` (TF-managed AKS + PG + Redis + Blob)   | `azure-blob` / static | Earlier in branch | `verify-hello.yaml` | Fresh-cluster fixes captured in commits `667dde95`, `5247b44f`, `2b6f0b88`, `0c64efae`. |
| `microk8s` (single-node)                       | `minio` / static      | Earlier in branch | `verify-hello.yaml` | Uses microk8s `minio` addon when present, otherwise `install-minio.sh` deploys bitnami chart. |
| `byo` (any K8s)                                | `minio` / static      | Earlier in branch | `verify-hello.yaml` | In-cluster MinIO via `install-minio.sh`. |

**Implemented but not yet E2E-verified end-to-end:**

| Combination | Status |
|-------------|--------|
| `aws` (TF-managed EKS) + `s3` / static          | Code paths complete, dry-run + plan tested. Full bring-up pending. |
| `azure-blob` / `workload-identity` (UAMI)       | Code paths complete (`storage/azure-blob.sh` workload-identity branch). Caller must pre-create UAMI + federated credential. |
| `byo` / `workload-identity` (AWS IRSA)          | Code paths complete (`storage/byo.sh` workload-identity branch). Caller must pre-create IAM role + service account annotation. |

If you hit any of the unverified combinations, please report results so the table can be updated.

## Prerelease / Staging Channel

For testing OSMO release candidates before they're tagged `latest` on the production NGC channel, set all three of:

```bash
export OSMO_IMAGE_TAG="6.3.0-prerelease-rc6"          # image tag (rc number changes per build)
export OSMO_CHART_VERSION="1.3.0-prerelease-rc6"      # chart version (rc number matches)
export OSMO_HELM_REPO_URL="https://helm.ngc.nvidia.com/nvstaging/osmo"
./deploy-osmo-minimal.sh --provider azure
```

Without `OSMO_CHART_VERSION`, helm picks the highest stable version in the repo and ignores RC tags — the install then fails when image pull tries the prerelease tag the chart wasn't built for.

The `nvstaging` repo requires the same NGC credentials as production; `--ngc-api-key`/`NGC_API_KEY` works for both.

## Directory Structure

```
scripts/
├── deploy-osmo-minimal.sh    # Main entry point — orchestrates all phases
├── deploy-k8s.sh             # K8s/Helm install logic (called by main)
├── common.sh                 # Shared logging, OSMO CLI install, helm helpers
├── install-kai-scheduler.sh  # KAI Scheduler (idempotent, CRD-detected)
├── install-gpu-operator.sh   # NVIDIA GPU Operator (multi-signal auto-skip)
├── install-minio.sh          # In-cluster MinIO (bitnami; auto-skips if addon/release present)
├── configure-storage.sh      # 6.3 storage wiring: K8s Secrets + values fragment
├── storage/                  # Per-backend storage logic (minio, azure-blob, s3, byo)
├── port-forward.sh           # One-shot or watchdog kubectl port-forward
├── verify.sh                 # End-to-end smoke tests (hello + GPU workflows)
├── azure/terraform.sh        # Azure Terraform driver
├── aws/terraform.sh          # AWS Terraform driver
├── microk8s/install.sh       # Single-node MicroK8s bootstrap
└── README.md                 # This file
```

Sibling directories under `deployments/`:

```
../workflows/        # verify-hello.yaml, verify-gpu.yaml (smoke tests)
../values/           # static, hand-editable Helm values (see ../values/README.md)
../terraform/        # Terraform modules for azure/ + aws/
./values/            # auto-generated runtime values; .storage-values.yaml from configure-storage.sh
```

## Phases of `deploy-osmo-minimal.sh`

When invoked, the entry-point runs these phases in order. Each is idempotent and safe to re-run.

1. **Provider bootstrap** (skipped for `byo`)
   - `azure` / `aws` → Terraform provisions cluster + DB + Redis (+ optional GPU pool, Blob/S3)
   - `microk8s` → `microk8s/install.sh` installs snapd, microk8s, addons, optional `nvidia` addon
2. **Cluster-agnostic dependency installs** (idempotent — auto-skip when present)
   - `install-kai-scheduler.sh` (CRD-detected: `podgroups.scheduling.run.ai`)
   - `install-gpu-operator.sh` (skipped under `--no-gpu`; multi-signal detection: addon, helm release, CR, DaemonSet)
   - `install-minio.sh` (only when `--storage-backend minio`; skipped if addon/release present)
3. **Storage credential wiring**
   - `configure-storage.sh --backend X --auth-method Y` writes K8s Secrets (`osmo-workflow-{data,log,app}-cred`) and emits `values/.storage-values.yaml` for the helm install to merge
4. **OSMO Helm install** (`deploy-k8s.sh`)
   - Creates namespaces, MEK ConfigMap, NGC pull secret
   - `helm upgrade --install` with chart + storage-values fragment + `--set global.osmoImageTag=$OSMO_IMAGE_TAG` + `--version $OSMO_CHART_VERSION` (when set)
   - Idempotent backend-operator token mint (re-uses existing if valid)
   - Waits for pods Running 1/1
5. **Smoke test** (`verify.sh`) — submits `verify-hello.yaml`, polls until COMPLETED, dumps logs on failure. With GPU nodes, also runs `verify-gpu.yaml`.
6. **Watchdog port-forwards** (optional, default on for non-CI invocations) — `port-forward.sh --watchdog` for `osmo-service` (:9000) and `osmo-ui` (:3000).

## Scripts Overview

### `deploy-osmo-minimal.sh`

Main entry point — see `--help` for the full flag list. Orchestrates all phases above.

| Flag | Purpose |
|------|---------|
| `--provider {azure,aws,microk8s,byo}` | Required. Selects bootstrap path. |
| `--storage-backend {auto,minio,azure-blob,s3,byo,none}` | Default `auto`: chooses based on provider (azure→azure-blob, aws→s3, microk8s→minio, byo→error). |
| `--auth-method {static,workload-identity}` | Default `static`. See [Deployment Combinations](#deployment-combinations) for what's supported per backend. |
| `--workload-identity-client-id ID` | Azure UAMI client ID (azure-blob + WI). |
| `--workload-identity-role-arn ARN` | AWS IAM role ARN (byo + WI / IRSA). |
| `--gpu-node-pool` | azure/aws: provision a GPU node pool via TF (requires the optional TF resources enabled). |
| `--no-gpu` | Skip GPU Operator install + GPU smoke test. |
| `--gpu` | microk8s only: enable the `nvidia` addon. Requires NVIDIA driver ≥ 525 on the host. |
| `--skip-terraform` | azure/aws: skip the bootstrap phase (cluster already exists). |
| `--skip-osmo` | Provision infrastructure only. |
| `--destroy` | TF destroy (azure/aws) + cluster cleanup. |
| `--ngc-api-key KEY` | Auth for `nvcr.io` images and `helm.ngc.nvidia.com` charts. Also `NGC_API_KEY` env var. |
| `--non-interactive` | Fail if required values are missing (CI mode). |
| `--dry-run` | Print phases without making changes. |

Full help: `./deploy-osmo-minimal.sh --help`.

### `deploy-k8s.sh`

Called by the main script. Handles the OSMO helm install, MEK ConfigMap, NGC pull secret, and idempotent backend-operator token mint. Can also run standalone:

```bash
./deploy-k8s.sh --provider azure --outputs-file .azure_outputs.env --postgres-password 'YourPassword'
```

### Cluster-agnostic install helpers

Each is idempotent — safe to invoke on a cluster where the target component already exists (e.g. when `orion-cluster-azure` pre-installed KAI + GPU Operator).

| Script | Purpose | Auto-skip detection |
|--------|---------|---------------------|
| `install-kai-scheduler.sh` | KAI Scheduler v0.14.0 (gang scheduling) | CRD `podgroups.scheduling.run.ai` |
| `install-gpu-operator.sh` | NVIDIA GPU Operator (drivers + container toolkit) | microk8s `nvidia` addon, helm release in any ns, `clusterpolicies.nvidia.com` CR (covers NVAIE), or `nvidia-device-plugin` DaemonSet |
| `install-minio.sh` | Bitnami MinIO chart | microk8s `minio` addon or existing `minio` service in `minio-operator` ns |
| `configure-storage.sh` | 6.3 storage wiring: K8s Secrets + helm values fragment for `services.configs.workflow.workflow_*.credential.secretName`. Dispatcher → `storage/{minio,azure-blob,s3,byo}.sh`. | n/a — backend chosen via `--backend` |
| `port-forward.sh` | One-shot or `--watchdog` PF, tagged `osmo-pf-watchdog:<svc>` for cleanup with `pkill -f 'osmo-pf-watchdog:'` | Reuses live PF if context+namespace match |
| `verify.sh` | Submits `workflows/verify-hello.yaml` + `verify-gpu.yaml`; polls until terminal state, dumps logs on failure. `SKIP_GPU=1` to skip GPU test. | n/a |

### `microk8s/install.sh`

Single-node MicroK8s bootstrap, used only by `--provider microk8s`. Installs snapd → microk8s 1.31/stable → kubectl/helm/helmfile → core addons (`dns`, `hostpath-storage`, `helm3`, `rbac`, `minio`) → optional `nvidia` addon → containerd Docker Hub creds patch (when `~/.docker/config.json` exists) → kubeconfig export. Run as root: `sudo ./microk8s/install.sh [--gpu]`. Idempotent.

### `azure/terraform.sh`, `aws/terraform.sh`

Provider-specific Terraform drivers. Provision cluster, DB, Redis, network, and (optionally) GPU node pool + cloud object storage. State lives under `../terraform/<provider>/`.

## Examples

### Interactive Azure deployment

```bash
./deploy-osmo-minimal.sh --provider azure
```

Prompts for subscription ID, resource group, PostgreSQL password, optionally cluster name / region / K8s version.

### Non-interactive Azure deployment

```bash
./deploy-osmo-minimal.sh --provider azure \
  --subscription-id "12345678-1234-1234-1234-123456789abc" \
  --resource-group "my-resource-group" \
  --postgres-password "SecurePass123!" \
  --cluster-name "my-osmo-cluster" \
  --region "East US 2" \
  --non-interactive
```

### Skip TF, deploy OSMO only (cluster already up)

```bash
./deploy-osmo-minimal.sh --provider azure --skip-terraform
```

### Provision infrastructure only

```bash
./deploy-osmo-minimal.sh --provider azure --skip-osmo
```

### Destroy

```bash
./deploy-osmo-minimal.sh --provider azure --destroy
```

### AWS

```bash
./deploy-osmo-minimal.sh --provider aws \
  --aws-region "us-west-2" \
  --cluster-name "osmo-aws" \
  --postgres-password "SecurePass123!" \
  --redis-password "SecureRedisToken123!" \
  --non-interactive
```

> Keep cluster names ≤ 12 characters to avoid AWS IAM role name length limits.

### NGC private registry credentials

Required for OSMO images and Helm charts under `nvcr.io` / `helm.ngc.nvidia.com`.

```bash
# Via flag
./deploy-osmo-minimal.sh --provider aws --ngc-api-key "$NGC_API_KEY" ...

# Via env var
export NGC_API_KEY="..."
./deploy-osmo-minimal.sh --provider aws ...
```

When set, the script:
1. `helm repo add` with `--username='$oauthtoken' --password=$NGC_API_KEY`
2. Creates `nvcr-secret` (docker-registry) in `osmo-minimal`, `osmo-operator`, `osmo-workflows`
3. Sets all chart `imagePullSecrets` to reference `nvcr-secret`

### Workload Identity (Azure UAMI)

Pre-create the UAMI + federated credential, then:

```bash
./deploy-osmo-minimal.sh --provider azure \
  --storage-backend azure-blob \
  --auth-method workload-identity \
  --workload-identity-client-id "<UAMI client ID>"
```

`configure-storage.sh` skips static-credential Secret creation and emits values that point OSMO services at the UAMI via the workload-identity webhook.

### Workload Identity (AWS IRSA)

Pre-create the IAM role with the OSMO service-account trust, then:

```bash
./deploy-osmo-minimal.sh --provider byo \
  --storage-backend byo \
  --auth-method workload-identity \
  --workload-identity-role-arn "arn:aws:iam::123456789012:role/osmo-storage"
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OSMO_IMAGE_REGISTRY` | OSMO Docker image registry | `nvcr.io/nvidia/osmo` |
| `OSMO_IMAGE_TAG` | OSMO Docker image tag | `latest` |
| `OSMO_CHART_VERSION` | Pin OSMO Helm chart version. **Required** for prerelease channels (chart RCs aren't tagged `latest`). | _(latest in repo)_ |
| `OSMO_HELM_REPO_URL` | OSMO Helm chart repo URL. Override to `https://helm.ngc.nvidia.com/nvstaging/osmo` for prerelease testing. | `https://helm.ngc.nvidia.com/nvidia/osmo` |
| `OSMO_HELM_REPO_NAME` | Local helm repo alias | `osmo` |
| `BACKEND_TOKEN_EXPIRY` | Backend operator token expiry | `2027-01-01` |
| `NGC_API_KEY` | NGC API key for `nvcr.io` images and chart pulls | — |
| `AZURE_ENDPOINT_SUFFIX` | Azure Storage endpoint suffix (sovereign clouds) | `core.windows.net` |
| `TF_SUBSCRIPTION_ID` | Azure subscription ID | — |
| `TF_RESOURCE_GROUP` | Azure resource group | — |
| `TF_POSTGRES_PASSWORD` | PostgreSQL password | — |
| `TF_REDIS_PASSWORD` | Redis password / auth token | — |
| `TF_CLUSTER_NAME` | Cluster name | `osmo-cluster` |
| `TF_REGION` | Azure region | `East US 2` |
| `TF_AWS_REGION` | AWS region | `us-west-2` |
| `TF_AWS_PROFILE` | AWS CLI profile | `default` |
| `STORAGE_ACCOUNT`, `STORAGE_KEY` | Azure Blob credentials (BYO storage when no Azure TF outputs available) | — |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | S3 credentials (static auth) | — |
| `POSTGRES_HOST`, `POSTGRES_USERNAME`, `POSTGRES_PASSWORD`, `POSTGRES_DB_NAME`, `POSTGRES_PORT` | DB connection (BYO mode) | — |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` | Redis connection (BYO mode) | — |

## Prerequisites

### All providers
- `kubectl`, `helm` (≥ 3.10), `jq`
- `osmo` CLI — auto-installed by `common.sh:install_osmo_cli_if_missing()` when missing

### `--provider azure`
- `az` CLI authenticated (`az login`)
- An existing Azure resource group (TF creates resources inside it)
- `terraform` ≥ 1.9

### `--provider aws`
- `aws` CLI configured (`aws configure`)
- `terraform` ≥ 1.9

### `--provider microk8s`
- Ubuntu 22.04+ host
- `sudo` access (snap install needs root)

### `--provider byo`
- `kubectl` already pointing at the target cluster
- DB + Redis reachable from cluster pods

## Post-Deployment

The watchdog port-forwards started by step 6 expose:

```
http://localhost:9000  → osmo-service (API)
http://localhost:3000  → osmo-ui
```

```bash
osmo login http://localhost:9000 --method=dev --username=testuser
osmo workflow submit ../workflows/verify-hello.yaml
osmo workflow list
```

To stop the watchdogs: `pkill -f 'osmo-pf-watchdog:'`. They're restarted by re-running `deploy-osmo-minimal.sh`.

## Troubleshooting

### Azure auth errors

```bash
az login
az account set --subscription "your-subscription-id"
```

### Terraform state corruption

```bash
cd ../terraform/azure   # or ../terraform/aws
rm -rf .terraform* terraform.tfstate*
```

### Pod failures

```bash
kubectl logs -n osmo-minimal -l app=osmo-service
kubectl logs -n osmo-operator -l app.kubernetes.io/name=osmo-backend-worker
```

### Backend-operator stuck in CrashLoopBackOff with startup probe failures

Affected: chart versions before PR #961. Either rebase to a chart that includes #961, or override the probe via values:

```yaml
startupProbe:
  timeoutSeconds: 60       # default in #961 (was 15)
  periodSeconds: 10
  failureThreshold: 30
```

### Private AKS cluster (no public API endpoint)

```bash
az aks command invoke \
  --resource-group "your-rg" \
  --name "your-cluster" \
  --command "kubectl get pods -n osmo-minimal"
```

### Helm install fails: "no chart matching constraint"

Likely cause: testing against a prerelease tag without setting `OSMO_CHART_VERSION`. See [Prerelease / Staging Channel](#prerelease--staging-channel).

## Documentation

- [OSMO Deployment Guide](https://nvidia.github.io/OSMO/main/deployment_guide/appendix/deploy_minimal.html)
- [Configure Data Storage](https://nvidia.github.io/OSMO/main/deployment_guide/getting_started/configure_data_storage.html)
- [Install KAI Scheduler](https://nvidia.github.io/OSMO/main/deployment_guide/byoc/install_dependencies.html)
