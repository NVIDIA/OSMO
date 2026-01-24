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
```

## Directory Structure

```
scripts/
├── deploy-osmo-minimal.sh   # Main entry point
├── deploy-k8s.sh            # Kubernetes/Helm deployment logic
├── common.sh                # Shared helper functions
├── azure/
│   └── terraform.sh         # Azure-specific Terraform provisioning
├── aws/
│   └── terraform.sh         # AWS-specific Terraform provisioning
└── README.md                # This file
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
| `--provider` | Cloud provider: `azure` or `aws` |

#### General Options

| Option | Description |
|--------|-------------|
| `--skip-terraform` | Skip infrastructure provisioning (use existing) |
| `--skip-osmo` | Skip OSMO deployment (only provision infrastructure) |
| `--destroy` | Destroy all resources |
| `--dry-run` | Show what would be done without making changes |
| `--non-interactive` | Fail if required parameters are missing (for CI/CD) |
| `-h, --help` | Show help message |

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
  --non-interactive
```

> **Note:** Keep cluster names short (≤12 characters) to avoid AWS IAM role name length limits.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OSMO_IMAGE_REGISTRY` | OSMO Docker image registry | `nvcr.io/nvidia/osmo` |
| `OSMO_IMAGE_TAG` | OSMO Docker image tag | `latest` |
| `BACKEND_TOKEN_EXPIRY` | Backend operator token expiry | `2027-01-01` |
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

