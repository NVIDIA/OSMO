# OSMO on Google Cloud: development example

This example follows the Terraform examples inside OSMO. It manages its own
resources in an **existing project with billing enabled**; it does not read or
depend on the separate `infra` repository. It does not adopt existing clusters.

## Resources

- Dedicated VPC, private subnet, Cloud NAT and private service access.
- Zonal GKE Standard cluster, DNS control-plane endpoint, private nodes and
  Workload Identity Federation enabled. The CPU pool has two `e2-standard-4`
  nodes. No GPU node pool or GPU Operator is installed.
- Private Cloud SQL PostgreSQL 16, zonal availability, backups and point-in-time
  recovery. The database uses `db-custom-2-7680`.
- Private Memorystore Redis 7.2, BASIC tier, 1 GiB, AUTH and TLS enabled.
- Private GCS bucket, bucket-scoped storage service account and HMAC credentials.
- GKE node service account with the default node role and Artifact Registry read
  access in the target project. Artifact Registry repositories/images are not created.

This is a development baseline, not a production HA configuration. PostgreSQL
connections use TLS `require`: traffic is encrypted, but server identity is not
verified against its private IP. Redis uses its CA certificate plus a public CA
bundle, so HTTPS access to GCS continues to validate public certificates.

GCS uses HMAC because the current `GSBackend.data_auth` rejects default credentials.
Enabling GKE Workload Identity does not remove that application limitation.

## Prerequisites

Install Terraform >= 1.9 or compatible OpenTofu, Google Cloud CLI,
`gke-gcloud-auth-plugin`, `kubectl`, Helm, OpenSSL, jq, curl and the OSMO CLI.
The script checks dependencies and does not install CLI tools. Configure both
gcloud login and Application Default Credentials for the intended identity.
That identity needs permission to enable APIs and manage the resources above,
including project IAM bindings, storage HMAC keys, and cluster administration.
Organization policies must allow HMAC keys and the selected location.

Choose a new cluster name and a shared image tag available for all OSMO service
and runtime images. Public NGC images are the default. A private Artifact Registry
repository in this project works through the node service account; external private
registries requiring Docker pull secrets are outside this example.

From the OSMO repository root:

```bash
export TF_VAR_project_id='<existing-project-id>'
export TF_VAR_cluster_name='osmo-dev'
export TF_VAR_region='asia-southeast1'
export TF_VAR_zone='asia-southeast1-b'
export OSMO_IMAGE_TAG='<tested-image-tag>'
# Optional, e.g. asia-southeast1-docker.pkg.dev/<project>/<repository>
# export OSMO_IMAGE_REGISTRY='nvcr.io/nvidia/osmo'
# Optional when Terraform is not installed:
# export TERRAFORM_BIN='/absolute/path/to/tofu'

bash deployments/scripts/deploy-osmo-gcp.sh plan
bash deployments/scripts/deploy-osmo-gcp.sh apply
bash deployments/scripts/deploy-osmo-gcp.sh deploy
```

`plan` previews infrastructure. `apply` asks Terraform's normal approval question.
`deploy` reads that target's Terraform outputs, creates Kubernetes Secrets,
installs KAI and the unified OSMO chart, then runs the existing CPU and GCS
round-trip smoke workflows. GPU verification is skipped. `verify` reruns those
workflows without installing or upgrading resources. Smoke tests create workflow
records, logs and objects. Each command propagates failures.

The gateway stays ClusterIP-only and authenticated. The deploy/verify process
uses an isolated temporary kubeconfig and a localhost port-forward on port 9000;
it removes both on exit. It does not change the user's default kubectl context.
The OSMO CLI's smoke-test login does update its local login configuration.
To open the UI later, explicitly obtain credentials for this cluster, port-forward
`service/osmo-gateway` in namespace `osmo`, and use the token in the
`osmo-default-admin` Secret (`password` key). No public ingress or DNS is created.

## State, upgrades and teardown

The script retains state and provider locks under:

```text
deployments/terraform/gcp/example/.osmo/<project>/<zone>/<cluster>/
```

Keep the same project, region, zone and cluster environment variables for every
operation. Re-running `deploy` preserves admin/backend tokens and updates the
OSMO release. Secrets go through protected temporary files; Helm values contain
only endpoints, Secret references and a rollout hash. Do not enable Terraform
debug logging for real credentials.

Local Terraform state contains PostgreSQL, Redis and HMAC credentials in plain
text, even though the output is marked sensitive. The existing Terraform
`.gitignore` excludes it; back it up securely. For team use, configure a protected
remote backend and migrate the state before sharing control. Do not delete the
state directory to reset an environment: the cloud resources would remain.

Stopping the script or deleting OSMO Pods does not stop infrastructure billing.
Nodes, managed databases, disks, NAT and stored data remain provisioned.
There is no automatic destroy command. For intentional teardown, review the
target's state, apply `TF_VAR_deletion_protection=false`, then run Terraform
`destroy` in that same state directory. GKE/SQL protection defaults to enabled;
GCS `force_destroy=false` also prevents deleting a non-empty bucket. Back up or
explicitly remove retained data before completing teardown.

## Local verification

```bash
terraform -chdir=deployments/terraform/gcp/example init -backend=false
terraform -chdir=deployments/terraform/gcp/example validate
bazel test //deployments/scripts/tests:test_deploy_osmo_gcp
shellcheck deployments/scripts/deploy-osmo-gcp.sh deployments/scripts/tests/test_deploy_osmo_gcp.sh
```

The shell test mocks cloud/Kubernetes commands. Passing it or Helm rendering is
not evidence of a running deployment. Runtime acceptance is a successful `deploy`
or `verify` against actual infrastructure, including both workflow completions.
