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

# OSMO Deployments

This directory contains all resources for deploying OSMO on various cloud providers and environments.

> ⚠️ **Note:** These scripts deploy a **minimal version of OSMO** without authentication.
> Users will interact with OSMO as a **guest user**. For production deployments with
> authentication (SSO, LDAP, etc.), refer to the [full deployment guide](https://nvidia.github.io/OSMO/main/deployment_guide/).

## Quick Start

**Deploy OSMO Minimal with one command:**

```bash
# Azure deployment
cd scripts
./deploy-osmo-minimal.sh --provider azure

# AWS deployment
cd scripts
./deploy-osmo-minimal.sh --provider aws
```

## Directory Structure

```
deployments/
├── scripts/           # Automated deployment scripts (recommended)
│   ├── deploy-osmo-minimal.sh   # Main deployment script
│   ├── azure/         # Azure-specific provisioning
│   └── aws/           # AWS-specific provisioning
├── terraform/         # Raw Terraform configurations
│   ├── azure/         # Azure infrastructure modules
│   └── aws/           # AWS infrastructure modules
└── charts/            # Helm charts for OSMO components
```

## Deployment Options

### 1. Automated Scripts (Recommended)

The easiest way to deploy OSMO. The scripts handle infrastructure provisioning and OSMO deployment automatically.

📖 **[scripts/README.md](scripts/README.md)** - Full documentation

```bash
cd scripts
./deploy-osmo-minimal.sh --provider azure  # or aws
```

**Features:**
- Interactive configuration prompts
- Terraform infrastructure provisioning
- Automatic secret creation (database, Redis, MEK)
- Helm chart deployment
- Post-deployment verification

**Limitations (Minimal Deployment):**
- No authentication - all users access as **guest**
- Development/testing purposes only
- Not recommended for production without additional configuration

### 2. Terraform Only

For users who want to provision infrastructure separately and have more control.

📖 **[terraform/azure/example/README.md](terraform/azure/example/README.md)** - Azure Terraform docs
📖 **[terraform/aws/example/README.md](terraform/aws/example/README.md)** - AWS Terraform docs

```bash
cd terraform/azure/example
terraform init
terraform apply
```

### 3. Helm Charts Only

For users who already have Kubernetes infrastructure and want to deploy OSMO directly.

📖 **[charts/](charts/)** - Helm chart install guide

> **Note:** Before installing Helm charts manually, you must create:
> - Kubernetes namespaces (`osmo-minimal`, `osmo-operator`, `osmo-workflows`)
> - Database secrets (`db-secret` with PostgreSQL password)
> - Redis secrets (`redis-secret` with Redis password)
> - MEK ConfigMap (Master Encryption Key)
> - The PostgreSQL database itself
>
> **Recommended:** Use the deployment script which handles all prerequisites.
> You'll need to provide your existing infrastructure details:

```bash
cd scripts

# Set environment variables for your existing infrastructure
export POSTGRES_HOST="your-postgres-host.database.azure.com"
export POSTGRES_USERNAME="postgres"
export POSTGRES_PASSWORD="your-password"
export REDIS_HOST="your-redis-host.redis.cache.windows.net"
export REDIS_PASSWORD="your-redis-password"

./deploy-osmo-minimal.sh --provider azure --skip-terraform
```

For a direct Helm install, deploy the charts in this order:

```bash
kubectl create namespace osmo --dry-run=client -o yaml | kubectl apply -f -
kubectl create namespace osmo-test --dry-run=client -o yaml | kubectl apply -f -
BACKEND_OPERATOR_PASSWORD=$(dd if=/dev/urandom bs=32 count=1 2>/dev/null | base64 | tr -d '\n=' | head -c 43)
kubectl create secret generic backend-operator-password \
  --namespace osmo \
  --from-literal=password="$BACKEND_OPERATOR_PASSWORD" \
  --dry-run=client -o yaml | kubectl apply -f -

if ! kubectl get configmap mek-config --namespace osmo >/dev/null 2>&1; then
  MEK_KEY=$(dd if=/dev/urandom bs=32 count=1 2>/dev/null | base64 | tr -d '\n')
  MEK_JWK=$(printf '{"k":"%s","kid":"key1","kty":"oct"}' "$MEK_KEY" | base64 | tr -d '\n')
  MEK_FILE=$(mktemp)
  printf 'currentMek: key1\nmeks:\n  key1: %s\n' "$MEK_JWK" > "$MEK_FILE"
  kubectl create configmap mek-config \
    --namespace osmo \
    --from-file=mek.yaml="$MEK_FILE" \
    --dry-run=client -o yaml | kubectl apply -f -
  rm -f "$MEK_FILE"
fi

helm repo add osmo https://helm.ngc.nvidia.com/nvidia/osmo
helm repo update osmo

helm upgrade --install osmo osmo/service \
  --namespace osmo \
  -f charts/service/quick-start-values.yaml \
  --wait

helm upgrade --install osmo-backend-operator osmo/backend-operator \
  --namespace osmo \
  -f charts/backend-operator/quick-start-values.yaml \
  --wait
```

After installing the CLI and logging in, set the demo pool and LocalStack data credential:

```bash
osmo login http://quick-start.osmo --method=dev --username=testuser
osmo profile set pool default
osmo credential set osmo --type DATA --payload \
  access_key_id=test \
  access_key=test \
  endpoint=s3://osmo \
  override_url=http://localstack-s3.osmo:4566 \
  region=us-east-1
```

The `quick-start-values.yaml` files preserve the local-development settings from the former umbrella chart. They use the chart-managed LocalStack S3 service, so `scripts/configure-storage.sh` is not needed for this local flow. For production, replace them with environment-specific values for your hostname, identity provider, databases, Redis, object storage, and backend credentials. If you use the charts directly with external object storage, run `scripts/configure-storage.sh` before the service Helm install and pass the generated values file after your base values file.

These values assume the OSMO images are pullable without a registry Secret. If your registry requires credentials, create a Kubernetes image pull Secret and pass `--set global.imagePullSecret=<secret-name>` to both chart installs.

## Supported Platforms

| Platform | Status | Documentation |
|----------|--------|---------------|
| **Azure** (AKS) | ✅ Fully Supported | [scripts/README.md](scripts/README.md) |
| **AWS** (EKS) | ✅ Fully Supported | [scripts/README.md](scripts/README.md) |

## Prerequisites

- **Terraform** >= 1.9
- **kubectl**
- **Helm**
- **Cloud CLI** (`az` for Azure, `aws` for AWS)

## Post-Deployment Access

After deployment, access OSMO via port-forwarding:

```bash
# Access OSMO UI
kubectl port-forward svc/osmo-ui 3000:80 -n osmo-minimal
# Open: http://localhost:3000

# Access OSMO API
kubectl port-forward svc/osmo-service 9000:80 -n osmo-minimal
# Open: http://localhost:9000/api/docs
```

## Documentation

- [OSMO Deployment Guide](https://nvidia.github.io/OSMO/main/deployment_guide/appendix/deploy_minimal.html)
- [Configure Data Storage](https://nvidia.github.io/OSMO/main/deployment_guide/getting_started/configure_data_storage.html)
- [Install KAI Scheduler](https://nvidia.github.io/OSMO/main/deployment_guide/byoc/install_dependencies.html)
