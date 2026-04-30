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

This directory contains scripts for deploying OSMO on various cloud providers.

## Quick Start

```bash
# Azure deployment (interactive)
./deploy-osmo-minimal.sh --provider azure

# AWS deployment (interactive)
./deploy-osmo-minimal.sh --provider aws

# Single-node MicroK8s (auto-installs MicroK8s on a fresh Ubuntu box)
./deploy-osmo-minimal.sh --provider microk8s --gpu

# Bring-your-own cluster (kubectl already configured)
export POSTGRES_HOST=... POSTGRES_USERNAME=... POSTGRES_PASSWORD=...
export POSTGRES_DB_NAME=... REDIS_HOST=... REDIS_PORT=... REDIS_PASSWORD=...
./deploy-osmo-minimal.sh --provider byo --storage-backend byo \
    --postgres-password "$POSTGRES_PASSWORD" --redis-password "$REDIS_PASSWORD"
```

## Directory Structure

```
scripts/
├── deploy-osmo-minimal.sh    # Main entry point
├── deploy-k8s.sh             # Kubernetes/Helm deployment logic
├── common.sh                 # Shared helper functions (logging, osmo CLI install, etc.)
├── install-kai-scheduler.sh  # KAI Scheduler install (idempotent via CRD detection)
├── install-gpu-operator.sh   # NVIDIA GPU Operator install (multi-signal auto-skip)
├── install-minio.sh          # In-cluster MinIO install (auto-skips if addon/release present)
├── configure-storage.sh      # 6.3 storage config: K8s Secrets + Helm values fragment
├── storage/                  # Per-backend storage helpers (minio, azure-blob, byo)
├── port-forward.sh           # One-shot or --watchdog kubectl port-forward
├── verify.sh                 # End-to-end smoke tests (hello + GPU workflows)
├── azure/terraform.sh        # Azure-specific Terraform provisioning
├── aws/terraform.sh          # AWS-specific Terraform provisioning
├── microk8s/install.sh       # Single-node MicroK8s bootstrap (snap, addons, GPU)
└── README.md                 # This file
```

Workflows + values consumed by these scripts live one level up at:
```
../workflows/        # verify-hello.yaml, verify-gpu.yaml (smoke tests)
../values/           # static, hand-editable Helm values (see ../values/README.md):
                     #   service.yaml, backend-operator.yaml, gpu-pool.yaml, pod-monitor-on.yaml
./values/            # auto-generated runtime values (do not commit / hand-edit):
                     #   .storage-values.yaml (written by configure-storage.sh)
```

## Scripts Overview

### `deploy-osmo-minimal.sh`

The main entry point for deploying OSMO. This script orchestrates:

1. **Infrastructure provisioning** using Terraform (provider-specific)
2. **OSMO deployment** onto Kubernetes using Helm

#### Usage

```bash
./deploy-osmo-minimal.sh --provider <azure|aws> [options]
```

#### Required Arguments

| Argument | Description |
|----------|-------------|
| `--provider` | Cluster provider: `azure`, `aws`, `microk8s`, or `byo` |

#### General Options

| Option | Description |
|--------|-------------|
| `--skip-terraform` | Skip infrastructure provisioning (azure/aws only; implied for microk8s/byo) |
| `--skip-osmo` | Skip OSMO deployment (only provision infrastructure) |
| `--destroy` | Destroy all resources (azure/aws: TF destroy; microk8s/byo: cleanup OSMO ns only) |
| `--dry-run` | Show what would be done without making changes |
| `--non-interactive` | Fail if required parameters are missing (for CI/CD) |
| `--ngc-api-key` | NGC API key for pulling images and Helm charts from `nvcr.io` (optional) |
| `--storage-backend` | Storage backend: `auto`, `minio`, `azure-blob`, `byo`, `none` (default: `auto`) |
| `--gpu-node-pool` | Provision a GPU node pool (azure/aws only — requires the optional TF resources) |
| `--no-gpu` | Skip GPU Operator install + GPU smoke test |
| `--gpu` | microk8s only: enable the nvidia addon during bootstrap (requires NVIDIA driver ≥ 525) |
| `-h, --help` | Show help message |

#### MicroK8s & BYO Provider Options

| Provider | Notes |
|----------|-------|
| `microk8s` | Bootstraps MicroK8s on the local box if not already installed. Uses `microk8s/install.sh` (snapd + snap install + addons + optional `nvidia` addon + kubeconfig export). |
| `byo` | Skips bootstrap and TF entirely. Required env vars: `POSTGRES_HOST`, `POSTGRES_USERNAME`, `POSTGRES_PASSWORD`, `POSTGRES_DB_NAME`, `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`. Optional: `IS_PRIVATE_CLUSTER` (default false). |

#### Azure-specific Options

| Option | Description | Default |
|--------|-------------|---------|
| `--subscription-id` | Azure subscription ID | (interactive prompt) |
| `--resource-group` | Existing Azure resource group name | (interactive prompt) |
| `--postgres-password` | PostgreSQL admin password | (interactive prompt) |
| `--cluster-name` | AKS cluster name | `osmo-cluster` |
| `--region` | Azure region | `East US 2` |
| `--environment` | Environment name | `dev` |
| `--k8s-version` | Kubernetes version | `1.32.9` |

#### AWS-specific Options

| Option | Description | Default |
|--------|-------------|---------|
| `--aws-region` | AWS region | `us-west-2` |
| `--aws-profile` | AWS CLI profile | `default` |
| `--cluster-name` | EKS cluster name (keep short, ≤12 chars) | `osmo-cluster` |
| `--postgres-password` | PostgreSQL admin password | (interactive prompt) |
| `--redis-password` | Redis auth token (min 16 chars) | (interactive prompt) |
| `--environment` | Environment name | `dev` |
| `--k8s-version` | Kubernetes version | `1.30` |

### `deploy-k8s.sh`

Handles Kubernetes-specific deployment tasks:

- Creating namespaces (`osmo-minimal`, `osmo-operator`, `osmo-workflows`)
- Creating secrets (database, Redis, MEK)
- Creating the PostgreSQL database
- Deploying OSMO components via Helm:
  - OSMO Service
  - OSMO UI
  - OSMO Router
  - Backend Operator

This script is typically called by `deploy-osmo-minimal.sh` but can be used standalone:

```bash
./deploy-k8s.sh --provider azure --outputs-file .azure_outputs.env --postgres-password 'YourPassword'
```

### `common.sh`

Shared helper functions used by all scripts:

- Logging functions (`log_info`, `log_success`, `log_warning`, `log_error`)
- Command checking (`check_command`)
- User input prompts (`prompt_value`)
- Password validation (`validate_password`)
- Pod readiness waiting (`wait_for_pods`)
- OSMO CLI install from GitHub (`install_osmo_cli_if_missing`) — used by deploy-k8s.sh when minting the backend-operator token

### Cluster-agnostic install helpers

These scripts work on any kubectl-reachable cluster and are invoked as phases by `deploy-osmo-minimal.sh`. Each is idempotent and safe to run on top of a cluster where the target component is already installed (e.g. when an upstream skill already installed KAI/GPU Operator).

| Script | Purpose | Auto-skip detection |
|--------|---------|---------------------|
| `install-kai-scheduler.sh` | KAI Scheduler v0.14.0 (gang scheduling for OSMO workflows) | CRD `podgroups.scheduling.run.ai` |
| `install-gpu-operator.sh` | NVIDIA GPU Operator (drivers + container toolkit) | microk8s `nvidia` addon, helm release in any ns, `clusterpolicies.nvidia.com` CR (NVAIE), or `nvidia-device-plugin` DaemonSet |
| `install-minio.sh` | Bitnami MinIO chart (in-cluster S3 backend) | microk8s `minio` addon or existing `minio` service in `minio-operator` ns |
| `configure-storage.sh` | 6.3-mode storage wiring: creates K8s Secrets (`osmo-workflow-{data,log,app}-cred`) + emits a Helm values fragment under `services.configs.workflow.workflow_*.credential.secretName`. Dispatcher delegates to `storage/{minio,azure-blob,byo}.sh`. | n/a — backend selection via `--backend` |
| `port-forward.sh` | One-shot or `--watchdog` kubectl port-forward, tagged `osmo-pf-watchdog:<svc>` for cleanup via `pkill -f` | Reuses live PF if context+namespace match |
| `verify.sh` | End-to-end smoke tests (`workflows/verify-hello.yaml` + `verify-gpu.yaml`); polls until terminal state, dumps logs on failure. `SKIP_GPU=1` to skip GPU test. | n/a |

### `microk8s/install.sh`

Single-node MicroK8s bootstrap. Used only by `--provider microk8s`. Installs:
- snapd (auto-installed on Ubuntu cloud images that ship without it, e.g. Brev NemoClaw)
- microk8s 1.31/stable
- kubectl, helm, helmfile (snap + GitHub release for helmfile)
- Standard addons: `dns`, `hostpath-storage`, `helm3`, `rbac`, `minio` (the `registry` addon is intentionally not enabled)
- Optional `nvidia` addon (`--gpu`) with the `/dev/char` symlink workaround for host-driver mode
- Containerd Docker Hub credentials patch (only when `~/.docker/config.json` exists) — avoids Docker Hub rate limits during addon image pulls
- Kubeconfig export to `~/.kube/config` with proper ownership

Run as root: `sudo ./microk8s/install.sh [--gpu]`. Re-running is safe (no-ops if microk8s + tooling are already present).

### `azure/terraform.sh`

Azure-specific Terraform provisioning:

- AKS cluster creation
- Azure Database for PostgreSQL Flexible Server
- Azure Cache for Redis
- Virtual Network configuration
- RBAC and kubectl configuration

### `aws/terraform.sh`

AWS-specific Terraform provisioning:

- Amazon EKS cluster creation
- Amazon RDS PostgreSQL (Flexible Server)
- Amazon ElastiCache Redis
- VPC with public/private subnets
- Security groups and IAM roles
- kubectl configuration via `aws eks update-kubeconfig`

## Examples

### Interactive Azure Deployment

```bash
./deploy-osmo-minimal.sh --provider azure
```

The script will prompt for:
1. Azure Subscription ID (defaults to current)
2. Resource Group name (shows available groups)
3. PostgreSQL password (with validation)
4. Optional: cluster name, region, Kubernetes version

### Non-Interactive Azure Deployment

```bash
./deploy-osmo-minimal.sh --provider azure \
  --subscription-id "12345678-1234-1234-1234-123456789abc" \
  --resource-group "my-resource-group" \
  --postgres-password "SecurePass123!" \
  --cluster-name "my-osmo-cluster" \
  --region "East US 2" \
  --non-interactive
```

### Deploy Only OSMO (Infrastructure Exists)

```bash
./deploy-osmo-minimal.sh --provider azure --skip-terraform
```

### Provision Only Infrastructure

```bash
./deploy-osmo-minimal.sh --provider azure --skip-osmo
```

### Dry Run (Preview Changes)

```bash
./deploy-osmo-minimal.sh --provider azure --dry-run
```

### Destroy All Resources

```bash
./deploy-osmo-minimal.sh --provider azure --destroy
```

### Interactive AWS Deployment

```bash
./deploy-osmo-minimal.sh --provider aws
```

The script will prompt for:
1. AWS Region (defaults to `us-west-2`)
2. AWS Profile (defaults to `default`)
3. EKS Cluster name (keep short, max ~12 chars recommended)
4. PostgreSQL password (with validation)
5. Redis auth token (min 16 characters)
6. Environment name

### Non-Interactive AWS Deployment

```bash
./deploy-osmo-minimal.sh --provider aws \
  --aws-region "us-west-2" \
  --cluster-name "osmo-aws" \
  --postgres-password "SecurePass123!" \
  --redis-password "SecureRedisToken123!" \
  --non-interactive
```

> **Note:** Keep cluster names short (≤12 characters) to avoid AWS IAM role name length limits.

### Deployment with NGC Registry Credentials

Required when pulling OSMO images and Helm charts from a private registry in `nvcr.io`.

```bash
# Via flag
./deploy-osmo-minimal.sh --provider aws \
  --aws-region "us-west-2" \
  --cluster-name "osmo-aws" \
  --postgres-password "SecurePass123!" \
  --redis-password "SecureRedisToken123!" \
  --ngc-api-key "$NGC_API_KEY"

# Via environment variable
export NGC_API_KEY="your-ngc-api-key"
./deploy-osmo-minimal.sh --provider aws \
  --aws-region "us-west-2" \
  --cluster-name "osmo-aws" \
  --postgres-password "SecurePass123!" \
  --redis-password "SecureRedisToken123!"
```

When an NGC API key is provided, the script:
1. Authenticates `helm repo add` with `--username='$oauthtoken' --password=<NGC_API_KEY>`
2. Creates a `nvcr-secret` docker-registry secret in all three namespaces
3. Configures all Helm charts to use `nvcr-secret` as the image pull secret

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OSMO_IMAGE_REGISTRY` | OSMO Docker image registry | `nvcr.io/nvidia/osmo` |
| `OSMO_IMAGE_TAG` | OSMO Docker image tag | `latest` |
| `BACKEND_TOKEN_EXPIRY` | Backend operator token expiry | `2027-01-01` |
| `NGC_API_KEY` | NGC API key for `nvcr.io` image and Helm chart pulls | - |
| `TF_SUBSCRIPTION_ID` | Azure subscription ID | - |
| `TF_RESOURCE_GROUP` | Azure resource group | - |
| `TF_POSTGRES_PASSWORD` | PostgreSQL password | - |
| `TF_REDIS_PASSWORD` | Redis password/auth token | - |
| `TF_CLUSTER_NAME` | Cluster name | `osmo-cluster` |
| `TF_REGION` | Azure region | `East US 2` |
| `TF_AWS_REGION` | AWS region | `us-west-2` |
| `TF_AWS_PROFILE` | AWS CLI profile | `default` |

## Prerequisites

### Required Tools

- **Terraform** >= 1.9
- **kubectl**
- **Helm**
- **jq**
- **OSMO CLI** (`osmo`) - for backend operator token generation

### Azure-specific

- **Azure CLI** (`az`) - authenticated via `az login`
- An existing Azure Resource Group

### AWS-specific

- **AWS CLI** (`aws`) - configured via `aws configure`

## Post-Deployment

After successful deployment, access OSMO using port-forwarding:

```bash
# Access OSMO API
kubectl port-forward service/osmo-service 9000:80 -n osmo-minimal
# Visit: http://localhost:9000/api/docs

# Access OSMO UI
kubectl port-forward service/osmo-ui 3000:80 -n osmo-minimal
# Visit: http://localhost:3000

# Login with OSMO CLI
osmo login http://localhost:9000 --method=dev --username=testuser
```

## Troubleshooting

### Azure Authentication Errors

```bash
# Re-authenticate with Azure
az login

# Set the correct subscription
az account set --subscription "your-subscription-id"
```

### Terraform State Issues

If Terraform state becomes corrupted:

```bash
cd ../terraform/azure
rm -rf .terraform* terraform.tfstate*
```

### Pod Failures

Check pod logs:

```bash
kubectl logs -n osmo-minimal -l app=osmo-service
kubectl logs -n osmo-operator -l app.kubernetes.io/name=osmo-backend-worker
```

### Private Cluster Access (Azure)

For private AKS clusters, use `az aks command invoke`:

```bash
az aks command invoke \
  --resource-group "your-rg" \
  --name "your-cluster" \
  --command "kubectl get pods -n osmo-minimal"
```

## Documentation

- [OSMO Deployment Guide](https://nvidia.github.io/OSMO/main/deployment_guide/appendix/deploy_minimal.html)
- [Configure Data Storage](https://nvidia.github.io/OSMO/main/deployment_guide/getting_started/configure_data_storage.html)
- [Install KAI Scheduler](https://nvidia.github.io/OSMO/main/deployment_guide/byoc/install_dependencies.html)

