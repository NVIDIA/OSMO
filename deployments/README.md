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

For a development evaluation, use the unified chart's `quickstart.yaml`
profile. Kind is the recommended local cluster; KAI Scheduler, CloudNativePG,
and a default dynamic StorageClass must already be available:

```bash
helm repo add cnpg https://cloudnative-pg.github.io/charts
helm repo update cnpg
helm --kube-context kind-osmo upgrade --install cnpg cnpg/cloudnative-pg \
  --version 0.29.0 \
  --namespace cnpg-system \
  --create-namespace \
  --wait \
  --timeout 10m

helm dependency build deployments/charts/osmo
helm --kube-context kind-osmo upgrade --install osmo deployments/charts/osmo \
  --namespace osmo \
  --create-namespace \
  --values deployments/charts/osmo/profiles/quickstart.yaml \
  --set-string compute.backendName=default \
  --wait \
  --wait-for-jobs \
  --timeout 20m
```

After the first installation creates the retained master-encryption-key Secret,
remove the one-time bootstrap Job and Secret-creation permission:

```bash
helm --kube-context kind-osmo upgrade osmo deployments/charts/osmo \
  --namespace osmo \
  --reuse-values \
  --set secrets.masterEncryptionKey.bootstrap.enabled=false \
  --wait \
  --timeout 20m
```

The quick-start profile installs the control and compute planes, PostgreSQL,
Valkey, and RustFS in one development OSMO release and creates its credentials
and buckets automatically. See
[`charts/osmo/README.md`](charts/osmo/README.md) for readiness checks,
port-forwarding, hello-world validation, recovery, and split-plane deployment.
The unified chart owns its listener and worker templates directly. The
standalone `backend-operator` chart below remains available only for legacy
two-chart installations.

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

The unified self-contained profile is the production converged path for
hosting OSMO outside a cloud environment. It owns a synchronous three-instance
CloudNativePG Cluster, replicated Valkey, distributed RustFS, retained MEK and
backend-token Secrets, and object-storage buckets. The Kubernetes cluster must
provide KAI Scheduler, the CloudNativePG operator, a default dynamic
StorageClass, a NetworkPolicy-enforcing CNI, IPv4 cluster CIDRs, and a TLS edge
for the ClusterIP gateway. Separately, register an OIDC client with an identity
provider reachable by users and OSMO gateway workloads. The provider may run
inside or outside the cluster; its tokens must emit OSMO role assignments and
bootstrap an administrator. The release creates and retains the workflow
namespace and enables OAuth2, authorization, and network isolation; operators
supply and test backups.

The legacy deployment scripts require existing infrastructure details:

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

For a legacy two-chart direct Helm install, deploy the charts in this order.
New development installs should use the unified flow above:

```bash
kubectl create namespace osmo --dry-run=client -o yaml | kubectl apply -f -
kubectl create namespace osmo-test --dry-run=client -o yaml | kubectl apply -f -
LOCAL_ADMIN_PASSWORD=$(dd if=/dev/urandom bs=32 count=1 2>/dev/null | base64 | tr -d '\n=' | head -c 43)
kubectl create secret generic local-admin-password \
  --namespace osmo \
  --from-literal=password="$LOCAL_ADMIN_PASSWORD" \
  --dry-run=client -o yaml | kubectl apply -f -

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

For the local quick-start only, the service values generate `osmo-mek` and
`backend-operator-token` during the first Helm install. Both are generated
inside Kubernetes and preserved across upgrades; no pre-created MEK or backend
Secret is required. Production values keep both bootstrap modes disabled.

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
