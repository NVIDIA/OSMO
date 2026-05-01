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
  Requires kubectl, helm, jq, and the osmo CLI on PATH (the deploy script will
  install osmo from GitHub if missing). Cloud providers also need terraform >=
  1.9 plus az login (Azure) or aws configure (AWS). MicroK8s provider requires
  Ubuntu 22.04 + sudo; --gpu requires NVIDIA driver >= 525.
metadata:
  author: nvidia
  version: "1.0.0"
---

# OSMO Deploy

## When to Use This Skill

Activate when the user asks to install, deploy, set up, stand up, or provision OSMO; when they reference `deploy-osmo-minimal.sh` / `deploy-k8s.sh` / "OSMO helm install"; when they ask to wire up workflow storage (MinIO / Azure Blob / S3); or when they ask to add a GPU pool, install KAI Scheduler, install the NVIDIA GPU Operator, or run post-install smoke tests on an OSMO cluster.

Do **not** activate for general OSMO usage questions (running workflows, CLI usage, troubleshooting a running deployment) — those belong to the `osmo-agent` skill.

Targets OSMO 6.3 in ConfigMap mode. Earlier 6.2 CLI-write mode is **not** supported by this skill (the chart's HTTP 409 on `osmo config update` is the runtime signal).

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

## Storage backends

Use `--storage-backend {auto|minio|azure-blob|byo|none}`:

- **auto** (default): probes BYO env vars → microk8s minio addon → existing minio service → osmo Azure TF storage_account output
- **minio**: in-cluster S3. On microk8s, uses the `minio` addon; otherwise installs the bitnami MinIO chart
- **azure-blob**: Azure Blob Storage Account. Reads `STORAGE_ACCOUNT`/`STORAGE_KEY` env vars first, falls back to osmo Azure TF outputs
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
  `configure-storage.sh` (+ `storage/{minio,azure-blob,byo}.sh`),
  `port-forward.sh`, `verify.sh`, `microk8s/install.sh`
- Workflows under [workflows/](../../deployments/workflows/):
  `verify-hello.yaml`, `verify-gpu.yaml`
- Documentation: https://nvidia.github.io/OSMO/main/deployment_guide/
