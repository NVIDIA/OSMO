---
name: osmo-deploy
description: >
  Deploy OSMO using the unified chart on Azure AKS, AWS EKS or an
  existing Kubernetes cluster. Use for cluster provisioning, deployment storage,
  KAI Scheduler or GPU Operator installation, and post-install smoke tests.
  General workflow usage and running-cluster diagnosis belong to osmo-user.
license: Apache-2.0
metadata:
  author: nvidia
  version: "2.0.0"
---

# OSMO Deploy

Requires the unified osmo chart, Python 3, Helm, jq, and kubectl. Cloud provisioning requires Terraform and authenticated az or aws. Verification installs the OSMO CLI if absent. Legacy service/backend-operator values require explicit migration.

Use [deploy-osmo.sh](../../deployments/scripts/deploy-osmo.sh) for a converged
installation. Read the [installer README](../../deployments/scripts/README.md)
for supported flags, environment variables, credentials, and provider behavior.
Run from the repository root:

```bash
./deployments/scripts/deploy-osmo.sh --provider byo --no-gpu
```

The default installs the checkout's unified chart as release `osmo` in namespace
`osmo`, with chart-owned PostgreSQL, Valkey, object storage, and credentials.
KAI Scheduler, GPU Operator, and CloudNativePG remain prerequisites outside the
chart. A usable default StorageClass or explicit per-dependency storage classes
are required for embedded persistence. The development gateway uses ClusterIP
and has authentication disabled; keep it on trusted networks.

For production or split control/compute planes, use Helm directly with the
[unified chart profiles and lifecycle instructions](../../deployments/charts/osmo/README.md).
Use [deploy-osmo-single-plane.sh](../../deployments/scripts/deploy-osmo-single-plane.sh)
for authenticated cloud deployments: Azure is the default workload-identity path;
`--provider aws` selects RDS, TLS ElastiCache and private S3 with token login.
The AWS path shares the Python installer; it does not provision cloud workload identity.

## Choose inputs from the requested deployment

Use choices already supplied by the user or existing desired state. Ask only
for missing choices that affect the deployment: target cluster/provider,
subscription/account and region, resource names, GPU capacity, storage, and
versions. Inspect the intended context and Terraform state before mutations;
use a separate Terraform directory/state for independent deployments. Respect
existing authorization and request approval for cloud provisioning or
replacement when that action has not already been authorized.

- `byo` uses the current kubeconfig; no Terraform or host bootstrap.
- `azure` and `aws` run the provider Terraform example, then connect its managed
  database/cache and native object storage to the chart. Supply tfvars or the
  documented password environment variables; use `--non-interactive` for an
  unattended invocation. Use `--skip-terraform` to reuse existing outputs.
- `--gpu-node-pool` requests a cloud GPU node pool. Azure uses `TF_GPU_VM_SIZE`
  and `TF_GPU_COUNT`; AWS uses `TF_GPU_INSTANCE_TYPE`, `TF_GPU_COUNT`, and
  `TF_GPU_MAX_COUNT`. `--no-gpu` skips GPU installation and verification.
- Azure `--find-gpu-region SKU COUNT` checks candidate-region quota. Availability
  is not guaranteed by a quota check.
- Azure `--with-nfs-storage` provisions the optional Azure Files account and
  roles. Consumers still own their StorageClass and PVC manifests.

`--dry-run` validates input values and prints intent; it is not a Terraform plan
or a rendered deployment. Use it to catch retired inputs before running.

For AWS single-plane, supply database/cache passwords through the documented
environment variables on first creation. The script writes private persistent
JSON inputs and selects state by account, region, cluster and environment; use
`OSMO_TERRAFORM_WORK_DIR` to override the location. Repeat the same context for
reuse/destroy, and preserve the recorded inputs and administrator token on reruns.
Existing state is required for reuse/destroy. RDS uses `verify-full` with the AWS
CA bundle (or caller `POSTGRES_CA_FILE`). Read the README before customizing GPU
capacity or changing persistent Terraform inputs.

## Versions and customization

The default uses the local chart. `--chart-version`/`OSMO_CHART_VERSION` selects a
published **unified** `osmo` chart; discover versions with `--list-chart-versions`.
Do not assume an older service-chart version is compatible. Use matching image
and CLI versions (`OSMO_IMAGE_TAG`, `OSMO_CLI_REF`) when pinning a release.
`OSMO_IMAGE_REGISTRY` is a registry host plus repository path. Private images
need the documented pull-secret inputs for both services and workflow runtime.

Pass unified YAML through repeatable `--helm-values` and overrides through
`--helm-set`. Values are under `planes`, `services.api`, `configuration`,
`embeddedDependencies`, `externalDependencies`, and `secrets`. Legacy `global`
and `services.configs` inputs fail; per-chart flags are retired. Read the chart
schema and profiles for the specific setting instead of assembling legacy values.

## Storage and identity

`--storage-backend auto` preserves explicit/prior storage configuration, otherwise
chooses Azure Blob or S3 for cloud providers and chart-owned embedded storage for
local clusters. Explicit choices are `embedded`, `azure-blob`, `s3`, and `byo`.
The old `minio` and `none` modes are removed. An existing MinIO service works as
BYO S3 with its endpoint, bucket, override URL, and credentials.

Static cloud credentials are written to a referenced Kubernetes Secret, never
Helm password flags. External databases and buckets/containers must already
exist. Custom values can reference pre-provisioned Secrets.

`--auth-method workload-identity` configures SDK-default storage authentication,
API/worker ServiceAccount annotations, and workflow identity. The caller must
provision cloud permissions and federation for all three ServiceAccounts; see
the README for exact default names and namespace subjects. Azure needs
`WORKLOAD_IDENTITY_CLIENT_ID`; S3 needs `WORKLOAD_IDENTITY_ROLE_ARN`. Do not claim
identity works based only on a Helm render: run storage verification.

## Lifecycle and verification

An existing legacy `service` or `backend-operator` release is refused. Explicitly
migrate release ownership, values, data, and credentials using the chart guide;
this installer does not perform that migration. The minimal wrapper and MicroK8s
bootstrap are removed. Existing clusters use the BYO path.

On a fresh install, chart hooks create bootstrap credentials. The installer
then disables MEK/service-auth bootstrap. Upgrades retain prior values and
require retained credential Secrets; missing keys require deliberate recovery.
Do not re-enable bootstrap to hide a missing-key failure.

Verification runs CPU, object-storage, and optional GPU workflows. It owns a
temporary foreground port-forward and cleans up that process. Private AKS uses
`az aks command invoke` with explicit chart/manifest uploads; verification needs
a reachable `OSMO_URL` or an explicit `--skip-verify`. Report skipped verification
as unverified, never as a successful smoke test.

Cloud kubeconfigs used during installation are temporary. Use the scoped
credential-refresh command printed by the installer before workstation access.
For subsequent local access run `deployments/scripts/port-forward.sh`; it stays
in the foreground and stops with Ctrl-C.

`--destroy` uninstalls only the selected release for BYO, preserving
namespaces and retained resources. For cloud providers it destroys the selected
Terraform state unless `--skip-terraform` selects release-only removal. Confirm
the intended state and scope within the user's existing authorization.
