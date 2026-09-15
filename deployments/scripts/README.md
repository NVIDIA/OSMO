<!--
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
-->

# OSMO deployment scripts

`deploy-osmo.sh` installs the unified `osmo` chart on Azure, AWS, or an
existing Kubernetes cluster. Infrastructure provisioning stays in the provider
drivers; Helm owns OSMO configuration, the compute backend, embedded dependencies,
and application credential bootstrap. Python 3 orchestrates commands using argument
arrays; Helm parses and merges values files.

For production and split-plane deployments, use the
[chart profiles](../charts/osmo/profiles/README.md) and Helm directly. This installer
is a converged development flow. Its default gateway uses development authentication
and remains a ClusterIP. Configure authentication and exposure through native chart
values before making a deployment publicly accessible.

## Quick start

From this directory:

```bash
# Existing development cluster, embedded PostgreSQL/Valkey/RustFS, CPU verification
./deploy-osmo.sh --provider byo --no-gpu

# Cloud infrastructure plus the unified chart (configure terraform.tfvars first)
./deploy-osmo.sh --provider azure --non-interactive --no-gpu
./deploy-osmo.sh --provider aws --non-interactive --no-gpu
```

Install Python 3, Helm, jq, kubectl, and the cloud CLI/Terraform when applicable.
Use the chart's documented Helm/Kubernetes versions and provide a dynamic
StorageClass or explicit per-dependency storage classes. The installer installs
KAI, optional GPU Operator, and CloudNativePG when embedded PostgreSQL is selected.
Host and MicroK8s bootstrap have been removed; connect an already provisioned
cluster with `--provider byo`.

`verify.sh` checks CPU scheduling, an object-storage round trip, and GPU execution
unless `--no-gpu` is supplied. A missing OSMO CLI is installed through the existing
CLI installer. `OSMO_CLI_REF` pins that download and `OSMO_CLI_TARGET` selects its
location; an already installed CLI is reused. Match the CLI to the selected images.

## Options and values

Run `./deploy-osmo.sh --help` for all options.

| Option | Behavior |
| --- | --- |
| `--provider azure\|aws\|byo` | Select infrastructure; default `byo` |
| `--namespace`, `--release` | Target namespace and release; both default `osmo` |
| `--helm-values FILE` / `--values FILE` | Repeatable native unified-chart values |
| `--helm-set KEY=VALUE` | Repeatable Helm overrides; use files for complex values |
| `--chart-path PATH` | Use a local unified chart directory, including one in a separate `main` checkout |
| `--chart-version VERSION` | Install a published **osmo** chart version; default is this checkout's chart |
| `--skip-terraform` | Reuse cloud Terraform outputs; BYO never provisions a cluster |
| `--skip-osmo` | Provision infrastructure only |
| `--skip-prerequisites` | Caller manages KAI/GPU Operator/CNPG |
| `--skip-verify` | Explicitly skip workflow verification |
| `--gpu-node-pool` | Enable a cloud GPU pool; configure its size/type in Terraform inputs |
| `--with-nfs-storage` | Azure NFS infrastructure; consumer supplies its StorageClass |
| `--dry-run` | Validate override syntax/legacy keys and print intent; no cloud/Kubernetes operations |
| `--destroy` | Cloud: destroy the selected Terraform infrastructure. BYO: uninstall the selected release |
| `--destroy --skip-terraform` | Uninstall only the selected release on an existing cloud cluster |
| `--list-chart-versions` | List published unified chart versions, including prereleases |
| `--find-gpu-region SKU COUNT` | Azure quota discovery without installing OSMO |

Values precedence is chart defaults, previously stored release values on upgrades,
generated connection/image settings, then caller files and sets. The old
`global.*`, `services.configs`, `services.service` and related two-chart keys are
rejected before provisioning. Per-chart service/operator flags are no longer accepted.
The installer does not translate arbitrary old Helm values.

`OSMO_IMAGE_REGISTRY` supplies a registry/repository prefix; `OSMO_IMAGE_TAG` applies
to services and workflow runtime images. `OSMO_IMAGE_PULL_SECRET` and
`OSMO_IMAGE_PULL_CONFIG` reference a Docker config; only credentials for the selected
registry are copied. `--ngc-api-key`/`NGC_API_KEY` remains available for nvcr.io.
Prefer credential files/environment variables over putting passwords in shell history.

The local chart requires compatible OSMO images. When testing an unreleased chart,
set `OSMO_IMAGE_REGISTRY` and `OSMO_IMAGE_TAG` to images built from the matching
source revision. A published `latest` image can lag behind the chart; single-plane
installation requires the service image to include `service-auth-bootstrap` and
`mek-lifecycle`.

For example, select the local chart from your `main` checkout explicitly:

```bash
./deploy-osmo-single-plane.sh --provider aws \
  --chart-path /path/to/main-checkout/deployments/charts/osmo \
  --aws-profile default --aws-region us-west-2 --cluster-name my-osmo-test --no-gpu
```

`--chart-path` is also supported by `deploy-osmo.sh`. It cannot be combined with
an explicit `--chart-version`, and overrides `OSMO_CHART_VERSION` inherited from
the environment. The single-plane profile comes from the selected local chart.
This uses the checkout's files as they are; it does not switch branches, pull `main`,
or build container images.

For cloud provisioning, the existing `--subscription-id`, `--resource-group`,
`--cluster-name`, `--region`, `--aws-region`, `--aws-profile`, `--k8s-version`,
`--environment`, `--postgres-password`, and `--redis-password` options feed the
provider drivers. `AZURE_TERRAFORM_DIR`/`AWS_TERRAFORM_DIR` select the working state
and tfvars directory. Use a separate directory for each deployment. Existing tfvars
are reused when credentials are not supplied; `--non-interactive` fails when required
configuration is missing. `TF_GPU_COUNT`, `TF_GPU_VM_SIZE` (Azure), and
`TF_GPU_INSTANCE_TYPE`/`TF_GPU_MAX_COUNT` (AWS) configure GPU capacity.

## Storage and external databases

`--storage-backend auto` selects Azure Blob for Azure, S3 for AWS, and embedded
RustFS for new local deployments. An explicit `STORAGE_ENDPOINT` selects BYO storage
on local clusters. Existing/caller unified storage values take precedence over auto
selection. `--storage-backend embedded` explicitly selects chart-owned RustFS.

External storage and database resources must exist before Helm installation.
Cloud Terraform creates the managed database and selected storage resources. BYO
PostgreSQL must already contain the requested database; this installer does not create
an arbitrary external database.

| Backend | Inputs |
| --- | --- |
| `s3` | `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_ACCESS_KEY`; cloud Terraform outputs can supply these |
| `azure-blob` | `STORAGE_ACCOUNT`, `STORAGE_KEY`, optional `AZURE_CONTAINER_NAME` (default `osmo-workflows`) |
| `byo` | `STORAGE_ENDPOINT`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_ACCESS_KEY` |

Optional S3 settings: `STORAGE_REGION`, `STORAGE_OVERRIDE_URL`, and
`STORAGE_ADDRESSING_STYLE` (`path`, `virtual`, `auto`). Locations default to
`<endpoint>/workflows`, `/logs`, `/apps`; override with `STORAGE_WORKFLOWS_URL`,
`STORAGE_LOGS_URL`, `STORAGE_APPS_URL` or native chart values to retain existing paths.
One existing credential document is mounted for all three uses. Existing per-location
Secrets remain supported through the chart's `secrets.objectStorage.credentialSecretRefs`.

For an existing MinIO instance, select `byo` and supply its S3 bucket, HTTP(S) endpoint,
credentials and path addressing. The old `minio` installer and `none` storage modes
are retired; use embedded RustFS for new local storage or explicit external values.
There is no automatic transfer or deletion of MinIO data/PVCs.

`--auth-method workload-identity` maps to `sdkDefault`. Set
`WORKLOAD_IDENTITY_CLIENT_ID` for Azure or `WORKLOAD_IDENTITY_ROLE_ARN` for AWS.
Provision cloud IAM/RBAC/OIDC federation first. The installer annotates API and worker
ServiceAccounts plus `<release>-workflow`; Azure also needs pod webhook labels.
Federated trust must match the effective release/workflow namespaces and ServiceAccount
names. With the defaults, federate `system:serviceaccount:osmo:osmo-api`,
`system:serviceaccount:osmo:osmo-worker`, and
`system:serviceaccount:osmo:osmo-workflow`. Custom service-account names or a
separate workload namespace change those subjects. The separate Azure single-plane example below also provisions its cloud identity.

External database variables are `POSTGRES_HOST`, `POSTGRES_PORT`,
`POSTGRES_DB_NAME`, `POSTGRES_USERNAME`, `POSTGRES_PASSWORD`, `REDIS_HOST`,
`REDIS_PORT`, and `REDIS_PASSWORD`. TLS is selected with `POSTGRES_TLS_ENABLED` and
`REDIS_TLS_ENABLED`; cloud Redis defaults to TLS, including AWS on port 6379.
Native unified values support existing Secrets and custom CA bundles. Generated
passwords never enter Helm values; caller-provided Secret references are reused.

## Existing releases and teardown

The installer refuses legacy `service`/`backend-operator` releases in its target
namespace or with the old default release names. Migrating existing releases requires
explicit ownership, configuration, data and credential handling; changing an install
command does not perform that migration. The standalone charts remain available.

After successful initial installation, the installer disables MEK/service-auth
bootstrap using the stored release values. Upgrades preserve values and require the
retained credentials; they never mint replacement encryption/signing keys automatically.
Use the chart's recovery/rotation procedures for missing credentials or interrupted bootstrap.

Uninstall preserves namespaces and chart-retained Secrets/PVCs. Cloud `--destroy`
destroys the selected Terraform infrastructure (including its data resources); use
`--skip-terraform` when only uninstalling OSMO. No global namespace deletion, Docker
pruning or process-name killing is performed.

## Access and private AKS

Cloud installs use temporary kubeconfigs. The installer prints scoped credential-refresh
instructions for subsequent workstation access. Run a foreground gateway port-forward:

```bash
./port-forward.sh osmo 9000
# Custom service/port: ./port-forward.sh osmo 9000 osmo-gateway 8081
# Ctrl-C stops it. API and UI share http://127.0.0.1:9000.
```

Verification owns a temporary port-forward and cleans it up on exit. For a configured
endpoint, set `OSMO_URL`. Authentication is selected with `OSMO_LOGIN_METHOD`,
`OSMO_TOKEN_FILE` or `OSMO_PASSWORD_FILE` as supported by `verify.sh`.

Private AKS installation uses `az aks command invoke`, checks each remote exit code,
and uploads only packaged charts and explicitly referenced manifests/values. Helm
repositories are resolved locally; credentials and Terraform state are not uploaded
as part of the working tree. Explicit Secret manifests are private temporary files.
Verification requires an `OSMO_URL` reachable from the caller or `--skip-verify`;
local port-forwarding cannot reach an inaccessible private Kubernetes API.

## AWS single-plane deployment

`deploy-osmo-single-plane.sh --provider aws` uses the same shared orchestration as
`deploy-osmo.sh`, layered with the chart's single-plane profile and AWS token-auth
settings. It provisions EKS, RDS PostgreSQL, TLS ElastiCache, and a private S3 bucket
with scoped static IAM credentials. The profile uses an administrator token and
runs CPU/object-storage verification. A configured GPU node pool also installs
GPU Operator and runs GPU verification; `--no-gpu` explicitly skips both.

```bash
# Supply through your secret-management environment; values are not Helm flags.
export TF_POSTGRES_PASSWORD=<database-password>
export TF_REDIS_PASSWORD=<cache-auth-token-at-least-16-characters>
./deploy-osmo-single-plane.sh --provider aws \
  --aws-profile my-profile --aws-region us-west-2 --cluster-name my-osmo \
  --non-interactive

# Optional GPU pool (TF_GPU_COUNT counts nodes, not GPUs per node)
TF_GPU_COUNT=1 TF_GPU_INSTANCE_TYPE=g5.xlarge \
  ./deploy-osmo-single-plane.sh --provider aws \
  --aws-profile my-profile --aws-region us-west-2 --cluster-name my-osmo \
  --gpu-node-pool
```

`TF_VAR_rds_password` and `TF_VAR_redis_auth_token` are also accepted on first
creation. The selected AWS profile applies to Terraform and AWS CLI commands.
On first creation, the installer records AWS's regional default EKS version in
standard support; `--k8s-version` selects an explicit version. Existing versions
are preserved on reruns; `TF_NODE_INSTANCE_TYPE` sets CPU nodes
on initial creation. CPU nodes use AL2023 and GPU nodes use its NVIDIA AMI;
GPU Operator reuses that AMI's host driver and toolkit. Other shared options include image overrides, unified Helm
values, storage settings, `--skip-verify`, `--skip-terraform`, and `--destroy`.
Choose a cluster name unique within the account: the Terraform example's S3/IAM
resource names are global even when clusters are in different regions.

Each account/region/cluster/environment gets a persistent directory under
`deployments/terraform/aws/example/.osmo/`; its path is printed. Override with
`OSMO_TERRAFORM_WORK_DIR`. The directory contains private `terraform.tfvars.json`,
Terraform state, and a deployment-context record. Reruns preserve the stored
credentials and inputs. Edit the persistent inputs for configuration changes;
explicit `--gpu-node-pool` and `--k8s-version` update those settings. Context changes
are refused before Terraform apply. Existing legacy Terraform state can still be
used with `deploy-osmo.sh`; it is not automatically adopted into this state layout.

Repeat the same profile, region, cluster name and environment for reuse or destroy.
`--skip-terraform` uses existing outputs. `--destroy` destroys that infrastructure;
`--destroy --skip-terraform` only uninstalls OSMO. Both require existing state.
Terraform's bucket deletion protections remain in effect.

RDS connections use `verify-full` with the official AWS RDS CA bundle downloaded
from `truststore.pki.rds.amazonaws.com`; `POSTGRES_CA_FILE` supplies an offline
bundle. ElastiCache uses TLS on port 6379. Credentials and the administrator token
are referenced Secrets, and MEK/service-auth bootstrap is disabled after installation.
The admin token is retained across upgrades; a missing retained token is an error.

## Azure single-plane deployment

`deploy-osmo-single-plane.sh` remains the focused Azure workload-identity example
used by CI. Authenticate Azure CLI, create the target resource group and run:

```bash
export TF_RESOURCE_GROUP=<resource-group>
./deploy-osmo-single-plane.sh
```

Azure remains the no-argument default (`--provider azure` is also accepted).
It provisions public AKS, PostgreSQL, Valkey and private Blob storage with a managed
identity; uses the unified single-plane profile with token authentication; and verifies
CPU/storage workflows. `TF_NODE_INSTANCE_TYPE` defaults to `Standard_D8s_v3`.
It accepts the `OSMO_IMAGE_REGISTRY`, `OSMO_IMAGE_TAG`, `OSMO_IMAGE_PULL_SECRET`
and `OSMO_IMAGE_PULL_CONFIG` overrides described above. Its narrower profile does
not provision GPU pools or NFS.

`deploy-osmo-minimal.sh` has been removed. Use `deploy-osmo-single-plane.sh` for
Azure/AWS single-plane deployments or `deploy-osmo.sh` for the configurable
unified-chart quickstart.
The old two-chart assembly, storage generators, MinIO installer and detached watchdog
have been retired. Azure deployment/OETF/cleanup CI uses the
[current workflow](../../ci/deployment-test/README.md); its old test wrapper and
wrapper-level KIND/JSON/JUnit interface are retired.
