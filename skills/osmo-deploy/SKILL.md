---
name: osmo-deploy
description: >
  How to deploy OSMO to a Kubernetes cluster on Azure (AKS), AWS (EKS), MicroK8s
  (single-node), or any kubectl-reachable cluster (BYO). Use this skill whenever
  the user asks to install, deploy, set up, or stand up OSMO; whenever they ask
  to provision an OSMO cluster; whenever they mention deploy-osmo-minimal.sh,
  deploy-k8s.sh, or "OSMO helm install"; whenever they ask to wire up workflow
  storage (MinIO / Azure Blob / S3); or whenever they ask to add a GPU pool to
  an OSMO cluster, install KAI scheduler, install the NVIDIA GPU Operator, or
  run the post-install smoke tests. Targets OSMO 6.3 (ConfigMap mode).
license: Apache-2.0
compatibility: >
  REQUIRES OSMO >= 6.3 (ConfigMap mode). The chart's default "latest"
  currently resolves to 6.2 GA which is NOT supported by this skill — you
  must explicitly pin OSMO_CHART_VERSION + OSMO_IMAGE_TAG + OSMO_CLI_REF to
  a 6.3.x version (see "Picking chart, image, and CLI versions"). Also
  requires kubectl, helm, jq, and the osmo CLI on PATH (the deploy script
  will install osmo from GitHub if missing). Cloud providers also need
  terraform >= 1.9 plus az login (Azure) or aws configure (AWS). MicroK8s
  provider requires Ubuntu 22.04 + sudo; --gpu requires NVIDIA driver >= 525.
metadata:
  author: nvidia
  version: "1.0.0"
---

# OSMO Deploy

## When to Use This Skill

Activate when the user asks to install, deploy, set up, stand up, or provision OSMO; when they reference `deploy-osmo-minimal.sh` / `deploy-k8s.sh` / "OSMO helm install"; when they ask to wire up workflow storage (MinIO / Azure Blob / S3); or when they ask to add a GPU pool, install KAI Scheduler, install the NVIDIA GPU Operator, or run post-install smoke tests on an OSMO cluster.

Do **not** activate for general OSMO usage questions (running workflows, CLI usage, troubleshooting a running deployment) — those belong to the `osmo-agent` skill.

**This skill requires OSMO >= 6.3 (ConfigMap mode).** Earlier versions are not supported — the chart's HTTP 409 on `osmo config update` is the runtime signal that the cluster landed on 6.2 (CLI-write mode). The current GA (`latest`) is **older than 6.3**, so a deploy with default env vars will land on the unsupported version. You MUST set the three version pins before invoking the script — see "Picking chart, image, and CLI versions" below.

## Workflow

The canonical entry point is [scripts/deploy-osmo-minimal.sh](../../deployments/scripts/deploy-osmo-minimal.sh) under `osmo/external/deployments/`. Run from inside that directory:

```bash
cd osmo/external/deployments
./scripts/deploy-osmo-minimal.sh --provider <azure|aws|microk8s|byo> [options]
```

The script orchestrates these phases:

1. **Cluster bootstrap** (provider-specific): Terraform for Azure/AWS, snap install + addons for MicroK8s, no-op for BYO
2. **Cluster-agnostic dependencies**: KAI Scheduler + NVIDIA GPU Operator + (optional) MinIO — each idempotent (auto-skips when already present)
3. **Storage configuration**: K8s Secrets + Helm values fragment for `services.configs.workflow.workflow_*.credential.secretName`
4. **OSMO Helm install**: single `service` release (the 6.3 chart bundles router + UI) + `backend-operator` release. Static base values come from [values/service.yaml](../../deployments/values/service.yaml) and [values/backend-operator.yaml](../../deployments/values/backend-operator.yaml); per-cluster overrides ride on `--set`; auto-detected fragments (`pod-monitor-on.yaml` when prometheus-operator CRDs exist, `gpu-pool.yaml` when GPU nodes exist) and the storage fragment are layered with additional `-f` flags.
5. **Idempotent backend-operator token mint** (replaces the old placeholder fallback)
6. **Smoke tests**: `verify-hello.yaml` (CPU) + `verify-gpu.yaml` (GPU; skipped under `--no-gpu`)
7. **Persistent port-forward watchdogs**: `osmo-gateway:9000` (gateway-aware target — falls back to `osmo-service` when the gateway is disabled) and `osmo-ui:3000`

## Picking a provider

| Provider | When to use |
|---|---|
| `azure` | Cloud install on Azure AKS with managed PostgreSQL + Redis. Optional GPU node pool + Blob storage account when `--gpu-node-pool` and `storage_account_enabled=true`. |
| `aws` | Cloud install on AWS EKS with RDS + ElastiCache. Optional GPU node group via `--gpu-node-pool`. |
| `microk8s` | Single-node K8s on a Brev/local Ubuntu box. The script bootstraps MicroK8s itself (snapd, addons, optional NVIDIA addon). |
| `byo` | A cluster you already have. Skips bootstrap and TF entirely. Required env vars: `POSTGRES_HOST POSTGRES_USERNAME POSTGRES_PASSWORD POSTGRES_DB_NAME REDIS_HOST REDIS_PORT REDIS_PASSWORD` (`IS_PRIVATE_CLUSTER` optional, defaults to false). |

## Required user inputs (ask these BEFORE invoking the script)

When the user asks to deploy OSMO without supplying every flag/env, prompt for these inputs first. Map answers to env vars (or `--flag` equivalents) and only then invoke `deploy-osmo-minimal.sh`.

**Universal prompts (every provider):**

1. **"Do you need GPUs?"** (yes/no)
   - If **no** → set `TF_GPU_NODE_POOL_ENABLED=false`, skip prompts 2-4.
   - If **yes** → continue.
2. **"How many GPUs?"** — expect a positive integer. Set `TF_GPU_COUNT=<n>` and `TF_GPU_NODE_POOL_ENABLED=true`.
3. **"What kind of GPU?"** — expect an Azure VM SKU (e.g. `Standard_NC40ads_H100_v5`) or AWS instance type (e.g. `p4d.24xlarge`). If the user gives an informal name (`H100`, `A10`, `T4`), translate to the canonical SKU: `H100 → Standard_NC40ads_H100_v5`, `A10 → Standard_NV36ads_A10_v5`, `T4 → Standard_NC4as_T4_v3` on Azure. Set `TF_GPU_VM_SIZE=<sku>`. Default to `Standard_NC40ads_H100_v5` on Azure / `p4d.24xlarge` on AWS if the user leaves it blank.
4. **"What region do you have availability?"** — accept a specific region OR `idk`.
   - If `idk` → call `./scripts/deploy-osmo-minimal.sh --find-gpu-region "$TF_GPU_VM_SIZE" "$TF_GPU_COUNT"`. The script iterates `TF_REGION_CANDIDATES` (env-overridable; default covers H100-likely Azure regions: `eastus2 swedencentral westus3 southcentralus westeurope`) and prints the first region whose quota fits. Set `TF_REGION` to that. Exits non-zero if no candidate has quota — surface the error to the user with a suggestion to expand `TF_REGION_CANDIDATES`.
   - If user names a region → set `TF_REGION` to it directly.

**Azure-only prompts (provider=azure, when not already supplied via flags/env):**

4. **"Azure subscription ID?"** — if not set via `--subscription-id` or `TF_SUBSCRIPTION_ID`, default to `$(az account show --query id -o tsv)` and ask the user to confirm or override.
5. **"Resource group name?"** — if not set via `--resource-group` or `TF_RESOURCE_GROUP`. The group must already exist (`az group show -n <rg>`); if not, prompt the user to create it (`az group create -n <rg> -l <region>`) before continuing.

**AWS-only prompts:** AWS region (`--aws-region`) and profile (`--aws-profile`) — defaults `us-west-2` / `default` are usually fine; only re-prompt if the user explicitly didn't pick a region.

Once these are collected, invoke the script in `--non-interactive` mode with the answers passed as env vars (or `--flag` equivalents) — that avoids the script re-asking the same questions and keeps the agent's prompts as the single source of truth.

## Picking chart, image, and CLI versions

**This skill requires OSMO >= 6.3 (ConfigMap mode). Pinning is mandatory, not optional.**

The script's default behavior (no env vars set) resolves to:
- `OSMO_CHART_VERSION` empty → helm picks the latest **stable** chart in repo
- `OSMO_IMAGE_TAG=latest` → most recent **GA** image
- `OSMO_CLI_REF=main` → bootstraps the **latest GA** CLI via the upstream `install.sh`

Today the latest GA is **older than 6.3**, so leaving any of these at default lands you on an unsupported version. The Helm install fails (e.g. on Ingress validation), or the CLI's wire format doesn't match the service, or the chart attempts `osmo config update` and gets HTTP 409 in 6.3 ConfigMap mode.

### Required: set all three pins to a 6.3.x version

```bash
# Step 1: discover the latest 6.3.x (release or RC). Authoritative — passes --devel.
./scripts/deploy-osmo-minimal.sh --list-chart-versions

# Step 2: pin all three env vars to the same release before invoking the deploy.
export OSMO_CHART_VERSION=<6.3.x chart version from step 1>
export OSMO_IMAGE_TAG=<matching 6.3.x image tag>
export OSMO_CLI_REF=<matching 6.3.x release tag>
```

The chart version + image tag are usually a 1:1 release pair (e.g. chart `1.3.x` ↔ image `6.3.x`). The CLI release tag matches the image tag.

### Why each pin matters (each is independently required)

- **`OSMO_CHART_VERSION`** — helm's "latest" resolution can roll forward unexpectedly. Pinning a specific 6.3.x chart prevents both (a) accidentally landing on a pre-6.3 chart and (b) drifting between deploys.
- **`OSMO_IMAGE_TAG`** — must match the chart's expected app version. The chart's templates assume specific image entrypoints and env contracts that change across minor releases.
- **`OSMO_CLI_REF`** — the `osmo` CLI's wire format (auth, workflow submit/get, configmap loading) must match the service. A CLI from a different minor version often connects but fails at the first non-trivial call. The deploy script's `install_osmo_cli_if_missing` honors `OSMO_CLI_REF` by downloading the matching installer directly to `$HOME/.local/bin` (no sudo); override the destination via `OSMO_CLI_TARGET`.

### Prerelease vs release within 6.3.x

Both stable and prerelease versions are published to `nvidia/osmo`. Prerelease tags (`*-prerelease-rc*`) are hidden from `helm search` by default — that's why `--list-chart-versions` passes `--devel`. Use the latest non-prerelease 6.3.x if one exists; otherwise pin to the latest 6.3.x prerelease RC. The pinning workflow above is identical either way.

## Storage backends

Use `--storage-backend {auto|minio|azure-blob|s3|byo|none}`:

- **auto** (default): probes BYO env vars → microk8s minio addon → existing minio service → osmo AWS TF `s3_bucket` output → osmo Azure TF `storage_account` output
- **minio**: in-cluster S3. On microk8s, uses the `minio` addon; otherwise installs the bitnami MinIO chart
- **azure-blob**: Azure Blob Storage Account. Reads `STORAGE_ACCOUNT`/`STORAGE_KEY` env vars first, falls back to osmo Azure TF outputs
- **s3**: AWS S3 with static credentials. Reads `STORAGE_BUCKET`/`STORAGE_ACCESS_KEY_ID`/`STORAGE_ACCESS_KEY` env vars first, falls back to osmo AWS TF outputs (when `s3_bucket_enabled=true`). For IAM-role-based auth (IRSA), use `--backend byo --auth-method workload-identity` instead.
- **byo**: caller provides credentials via env (`STORAGE_ACCESS_KEY_ID`, `STORAGE_ACCESS_KEY`, `STORAGE_ENDPOINT`, optional `STORAGE_REGION`, `STORAGE_OVERRIDE_URL`). No resources created.
- **none**: skip storage entirely (manual configuration later)

In static-auth mode the helper writes K8s Secrets (`osmo-workflow-{data,log,app}-cred`) and a Helm values fragment that the chart consumes via `services.configs.workflow.workflow_*.credential.secretName`. There are **no** `osmo config update` or `osmo credential set` CLI calls — those return HTTP 409 in 6.3 ConfigMap mode.

## Auth modes (`--auth-method`)

`--auth-method {static|workload-identity}` controls how OSMO services authenticate to the cloud storage backend.

- **static** (default): K8s Secrets carry static cloud credentials (account keys / connection strings / S3 access keys). Works with every backend.
- **workload-identity**: No K8s Secrets. OSMO services use the cluster's federated identity:
  - `azure-blob` + WI = AKS Workload Identity (UAMI + federated credential)
  - `byo` + WI = AWS IRSA (IAM role + EKS OIDC trust policy)
  - `minio` + WI = **not supported** (MinIO has no cloud-vendor IdP)

> ⚠ **Workload identity mode requires caller-provisioned cloud-side identity.** The deploy scripts do **not** create the UAMI / IAM role, attach RBAC, or create the federated credential — those are owned by the caller (typically the platform/security team). The script does the K8s-side wiring (SA annotation + pod labels for the AKS WI mutating webhook + DefaultDataCredential values fragment) and surfaces a prominent prerequisite checklist before any work begins. If prerequisites aren't met, OSMO will start successfully but workflows will fail at runtime with 401/403 from the storage backend.

### Azure Workload Identity prerequisites

```bash
# 1. AKS cluster has OIDC issuer + Workload Identity addons
az aks update -g <rg> -n <cluster> --enable-oidc-issuer --enable-workload-identity

# 2. Provision UAMI
az identity create -g <rg> -n osmo-data-uami

# 3. Grant Storage Blob Data Contributor on the storage account
az role assignment create \
  --role "Storage Blob Data Contributor" \
  --assignee <UAMI-principal-id> \
  --scope /subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.Storage/storageAccounts/<account>

# 4. Federate UAMI to the chart's ServiceAccount (default name: osmo-minimal)
az identity federated-credential create \
  --name osmo-osmo-minimal \
  --identity-name osmo-data-uami \
  --resource-group <rg> \
  --issuer "$(az aks show -g <rg> -n <cluster> --query oidcIssuerProfile.issuerUrl -o tsv)" \
  --subject "system:serviceaccount:osmo-minimal:osmo-minimal"

# 5. Run deploy with WI
./scripts/deploy-osmo-minimal.sh --provider byo \
  --storage-backend azure-blob --auth-method workload-identity \
  --workload-identity-client-id "$(az identity show -g <rg> -n osmo-data-uami --query clientId -o tsv)"
```

### AWS IRSA prerequisites

```bash
# 1. EKS cluster has an OIDC identity provider (most clusters already do)
aws eks describe-cluster --name <cluster> --query "cluster.identity.oidc.issuer"

# 2. Create IAM role with S3 access + EKS OIDC trust policy
#    Trust policy admits: system:serviceaccount:osmo-minimal:osmo-minimal

# 3. Run deploy with WI
./scripts/deploy-osmo-minimal.sh --provider byo \
  --storage-backend byo --auth-method workload-identity \
  --workload-identity-role-arn arn:aws:iam::<acct>:role/osmo-data-access
```

## Customizing values

Hand-editable static values live in [deployments/values/](../../deployments/values/):

- `service.yaml` — base values for the service chart (router + UI bundled)
- `backend-operator.yaml` — base values for the backend-operator chart
- `gpu-pool.yaml` — opt-in fragment, layered when GPU nodes are detected
- `pod-monitor-on.yaml` — opt-in fragment, layered when prometheus-operator CRDs are detected

Per-cluster values (PG/Redis hosts, image registry/tag, NGC pull secret name, namespace) are **not** in those files — they're injected at install time via `--set` so users can edit the YAML for things that don't change per-cluster. `service.yaml` mirrors the [docs minimal-deploy reference](../../docs/deployment_guide/appendix/deploy_minimal.rst). See the [values README](../../deployments/values/README.md) for layering details.

> **Security note**: `service.yaml` ships with the gateway's OAuth2 Proxy + authz disabled (matching the docs minimal example). The gateway then trusts client-supplied `x-osmo-{user,roles,allowed-pools}` headers. Do **not** expose this gateway to untrusted networks. For production deploys, use the standard deployment guide path which keeps OAuth2 + authz enabled.

## Common invocations

```bash
# Azure with GPU pool + Blob storage
./scripts/deploy-osmo-minimal.sh --provider azure --gpu-node-pool --storage-backend azure-blob

# AWS, CPU only
./scripts/deploy-osmo-minimal.sh --provider aws --no-gpu

# Single-node MicroK8s on a fresh Ubuntu box (with GPU)
./scripts/deploy-osmo-minimal.sh --provider microk8s --gpu --storage-backend minio

# Existing cluster (orion-cluster-azure, etc.) — caller exports DB/Redis env vars first
export POSTGRES_HOST=... REDIS_HOST=...   # (full list above)
./scripts/deploy-osmo-minimal.sh --provider byo --storage-backend azure-blob

# Tear down
./scripts/deploy-osmo-minimal.sh --provider <x> --destroy
```

## Idempotency contract

Every cluster-agnostic install is safe to no-op when its target is already present (CRD checks for KAI, multi-signal detection for GPU Operator, addon/release detection for MinIO). This makes the script safe to layer on top of clusters that already have these components installed (e.g. when an upstream skill provisioned the cluster + KAI + GPU Operator first). Re-runs are also safe — backend-operator tokens are reused if a non-placeholder value already exists in `osmo-operator-token`.

## Troubleshooting

- **`osmo CLI not found`**: the script will install from GitHub on first run; if it fails, install manually then re-run.
- **Pod failures**: `kubectl logs -n osmo-minimal -l app=osmo-service`
- **Smoke test failures**: GPU smoke depends on the GPU Operator being healthy + a node labeled `nvidia.com/gpu.present=true`; `kubectl describe node` to verify
- **Stop port-forward watchdogs**: `pkill -f 'osmo-pf-watchdog:'`
- **Private AKS clusters**: use `az aks command invoke` for kubectl access; the script sets `IS_PRIVATE_CLUSTER=true` automatically when detected

## Reference

- Helpers under [scripts/](../../deployments/scripts/):
  `install-kai-scheduler.sh`, `install-gpu-operator.sh`, `install-minio.sh`,
  `configure-storage.sh` (+ `storage/{minio,azure-blob,s3,byo}.sh`),
  `port-forward.sh`, `verify.sh`, `microk8s/install.sh`
- Workflows under [workflows/](../../deployments/workflows/):
  `verify-hello.yaml`, `verify-gpu.yaml`
- Documentation: https://nvidia.github.io/OSMO/main/deployment_guide/
