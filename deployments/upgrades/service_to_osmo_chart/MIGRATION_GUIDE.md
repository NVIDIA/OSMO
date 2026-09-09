# Migrating legacy OSMO charts to the unified chart

This guide describes how to migrate an OSMO 6.3 installation from the legacy
`service` and `backend-operator` charts to the unified `osmo` chart for OSMO
6.4. It is written for operators using Helm directly or through a deployment
controller.

The control plane and compute planes are separate Helm releases in many
installations. Migrate and verify them independently unless they are already
deployed as one converged release.

The supplied converters translate supported legacy overrides into the unified
values schema. They do not inspect a cluster, read Secret data, modify
resources, or make the migration automatic. Treat their output as a reviewed
starting point and resolve every diagnostic before deployment.

Only the 6.3-to-6.4 upgrade path is supported here. Do not use these
instructions for a database older than the OSMO 6.3 schema.

## Migration overview

For each release:

1. Record the release name, release namespace, chart version, image tag, and
   ordered values files currently in use.
2. Back up PostgreSQL and every externally managed credential or identity
   Secret required for rollback.
3. Render and save the legacy manifests.
4. Convert the legacy values and resolve every reported item.
5. Create or update the typed Kubernetes Secrets expected by the unified
   chart.
6. Render the unified chart and compare the manifests semantically.
7. Test the migration in a non-production environment.
8. Perform the cutover during a maintenance window, verify the installation,
   and retain the rollback inputs until the rollback window closes.

If a deployment controller reconciles the release automatically, pause that
reconciliation while reviewing replacement resources and performing the
cutover. Resume it only after the deployed values and one-time migration flags
are in their intended steady state.

## Prerequisites

- Confirm that the source application is OSMO 6.3 and that PostgreSQL has the
  OSMO 6.3 schema.
- Use OSMO 6.4 images with the OSMO 6.4 unified chart. Pin the chart version and
  image tag for the migration and rollback window.
- Install Helm and build the dependencies for both charts that you render.
- Have read access to the current Helm values and manifests, and permission to
  create the replacement Secrets and resources during the maintenance window.
- Inventory Secret names and data-key names without printing their values.
- Take and test a PostgreSQL backup. Back up the master encryption key (MEK),
  service-auth identity, backend tokens, OAuth credentials, storage
  credentials, and custom TLS material.
- Record any resources managed outside Helm, including externally managed
  Secrets and cluster-scoped RBAC or PriorityClasses. Do not transfer ownership
  of those resources accidentally.
- Check available capacity for replacement workloads. Some resource names and
  selectors differ, so the old and new workloads may coexist briefly.

Build local chart dependencies before rendering:

```bash
helm dependency build deployments/charts/service
helm dependency build deployments/charts/backend-operator
helm dependency build deployments/charts/osmo
```

## Converter behavior

Both converters accept one or more YAML files. Inputs are merged from left to
right using Helm's map-merge and list-replace behavior, so pass files in the
same order as the existing release.

The default mode is fail-closed. An unsupported or ambiguous value produces a
path-based diagnostic on standard error, suppresses YAML output, and exits
with status 2. Diagnostics do not include Secret values.

`--allow-unmapped` emits the safe partial conversion for inspection:

```bash
python3 CONVERTER.py \
  --allow-unmapped \
  legacy-values.yaml \
  --output converted-values.partial.yaml \
  2>conversion-report.txt
```

Never deploy the partial output by itself. Keep the original legacy values
unchanged and create a temporary migration copy. For every diagnostic:

- remove settings that are inactive or intentionally retired from the
  migration copy; or
- translate settings that require operator input into a separate unified-chart
  override file, then remove the legacy form from the migration copy.

Rerun the converter without `--allow-unmapped` against the migration copy and
require a successful exit. For rendering and deployment, layer the reviewed
manual override after the converted output so deliberate operator choices win:

```bash
helm template "${RELEASE_NAME}" deployments/charts/osmo \
  --namespace "${RELEASE_NAMESPACE}" \
  --values converted-values.yaml \
  --values manual-overrides.yaml
```

The converters process explicit overrides. They cannot infer live Secret
contents, resources created outside the release, or behavior inherited only
from an older chart's defaults. Render both charts to account for those
differences.

## Migrating a control-plane release

Use `control_plane_values_convert.py` for values previously consumed by the
legacy `service` chart:

```bash
python3 deployments/upgrades/service_to_osmo_chart/control_plane_values_convert.py \
  legacy-values.yaml \
  --output control-plane-values.yaml
```

For split values, preserve their existing order:

```bash
python3 deployments/upgrades/service_to_osmo_chart/control_plane_values_convert.py \
  base-values.yaml \
  config-values.yaml \
  template-values.yaml \
  pool-values.yaml \
  --output control-plane-values.yaml
```

The converter selects the control-plane composition and maps supported image,
gateway, service, autoscaling, scheduling, ingress, monitoring, dependency,
configuration, and Secret-reference settings. It disables unified-chart
defaults that would otherwise add behavior not present in the legacy release,
such as component PodDisruptionBudgets.

### Review control-plane dependencies

For PostgreSQL, Valkey, and object storage, decide whether the unified release
owns an embedded dependency or connects to an external one. Do not enable an
embedded dependency simply because it is the chart default.

For an external dependency:

- configure its endpoint under `externalDependencies`;
- configure TLS and a CA Secret when the endpoint uses a private CA;
- reference an existing Kubernetes Secret under `secrets`; and
- verify the configured Secret name and data key exist in the release
  namespace.

The unified chart does not accept inline credentials. Arbitrary credential
files or file paths from legacy values must be replaced with the typed Secret
references documented by the chart. An external secret controller may continue
to own those Secrets; configure the chart to consume them without generating or
adopting them.

### Review object storage

Preserve the provider, endpoint, bucket or container, region, and credential
source for workflow data, logs, and applications. The unified chart supports
S3-compatible, Azure Blob, and OpenStack Swift or SwiftStack locations. The
chart accepts `s3://`, `azure://`, and `swift://` location URIs.

Use `secrets.objectStorage.existingSecret` when all locations share one
credentials document. Use
`secrets.objectStorage.credentialSecretRefs` when each location already has a
separate Secret. If an endpoint is stored only in a referenced Secret, leave
the corresponding explicit location empty rather than creating a conflicting
fallback endpoint.

Validate read and write access with least-privilege credentials before the
maintenance window. Do not print credentials while checking Secret structure.

For Azure Blob Storage, private containers are necessary but insufficient:

- the authoritative infrastructure definition must explicitly set account
  `allowBlobPublicAccess` to `false`;
- AzureRM Terraform must set
  `allow_nested_items_to_be_public = false` on every storage account;
- every container must remain private; and
- a live account query must return the literal value `false`:

```bash
az storage account show --ids "${STORAGE_ACCOUNT_ID}" \
  --query allowBlobPublicAccess -o tsv
```

An empty, `null`, or `true` result is not verified. If anonymous access is
actually required, stop and obtain explicit approval for the exact account,
container, and data scope before changing it.

### Preserve encryption and authentication identities

Do not generate a replacement MEK for an existing database. Configure
`secrets.masterEncryptionKey` to use the existing key material and choose the
management mode deliberately:

- `external` keeps an operator or external secret controller responsible for
  the Secret; or
- `osmo` enables the chart's explicit bootstrap and rotation lifecycle.

Bootstrap is for a new, empty database. It is not a recovery path for a missing
MEK.

The service-auth identity signs and verifies credentials. Replacing it during
the migration invalidates existing tokens. Follow the service-auth migration
procedure in `deployments/charts/osmo/README.md` to copy the existing
database-backed identity into the chart's typed Secret. Keep the existing MEK
available for that migration.

Before the first control-plane cutover:

1. Configure the existing PostgreSQL credentials and MEK Secret references.
2. Prepare the release-authorized service-auth destination Secret as described
   by the chart.
3. Stop legacy API writers before the migration hooks run.
4. Enable the service-auth migration only for the first successful upgrade.
5. Verify existing tokens against the new API.
6. Disable the one-time migration flag in the follow-up values update.

Retain the old database identity and MEK until rollback is no longer required.

### Run the database migration

The unified chart's bundled pgroll migration supports the OSMO 6.3-to-6.4
schema transition. Configure `databaseMigration` with the same PostgreSQL
Secret, schema, scheduling constraints, and network access required by the
control plane.

Enable it for the upgrade, render the Job, and verify its annotations and
credentials before deployment. The deployment system must run the database
migration before the service-auth migration and before new API writers start.
After a successful upgrade, disable one-time migration settings as documented
by the chart.

Do not run the migration against an unverified database version. A Helm
rollback does not reverse a database migration.

### Review gateway and TLS changes

The unified gateway may expose different Service ports or resource names from
the legacy chart. Preserve every port used by an in-cluster consumer through
the unified gateway's service configuration.

`gateway.tls` protects internal gateway-to-service traffic. For generated
internal TLS, set
`gateway.tls.generated.bootstrap.allowInitialGeneration=true` only for the
first migration. Verify that the retained CA and leaf Secrets were created,
then set the flag back to `false`. Never regenerate a missing retained CA
during rollback; restore the backed-up Secret.

Preserve OAuth client and cookie Secret references. Rotating the cookie Secret
logs users out, so credential rotation should be a separate operation unless
it is required for the migration.

## Migrating a compute-plane release

Use `compute_values_convert.py` for values previously consumed by the legacy
`backend-operator` chart:

```bash
python3 deployments/upgrades/service_to_osmo_chart/compute_values_convert.py \
  --release-name "${RELEASE_NAME}" \
  --release-namespace "${AGENT_NAMESPACE}" \
  legacy-backend-values.yaml \
  --output compute-plane-values.yaml
```

`--release-name` is the existing Helm release name. It is required when the
legacy backend test runner is enabled and `global.name` is unset so the
converter can preserve the test-runner ServiceAccount name.

Set `global.includeNamespaceUsage` explicitly in the migration input to the
workflow namespaces whose usage the backend listener should monitor. The
converter does not carry forward the legacy chart's environment-specific
default. If the backend test runner remains enabled, also set
`global.backendTestNamespace`; otherwise explicitly disable
`backendTestRunner.enabled`.

The namespace distinction is important:

- the legacy chart renders backend agents into `global.agentNamespace`, even
  when the Helm release namespace differs;
- the unified chart renders backend agents into its Helm release namespace;
  and
- `global.backendNamespace` is the workflow namespace, not necessarily the
  agent namespace.

Set `--release-namespace` to the effective legacy `global.agentNamespace`, and
install the unified release in that namespace. The converter maps the workflow
namespace to `compute.workloadNamespace.name` and preserves the separate test
namespace. This keeps agents, their token Secret, workflows, and test resources
in their established namespaces.

The converter supports token authentication. Confirm that
`compute.authentication.existingSecret` exists in the release namespace and
contains `compute.authentication.tokenKey`. Both agent containers mount that
key at `/opt/osmo/secrets/token.txt`.

The generated compute-only values explicitly disable control-plane Secret
generation and embedded dependencies. Keep the generated `secrets` section:
the current unified defaults enable control-plane or embedded Secret workflows
that do not apply to a compute-only release, and omitting the overrides fails
chart validation.

Review the converted backend identity, endpoint, image, pull policy,
scheduling, resources, probes, listener cache and API settings, worker progress
interval, RBAC, NetworkPolicy, PriorityClasses, monitoring, and test-runner
configuration. The converter makes legacy defaults explicit where unified
defaults differ.

## Render and compare

Render the legacy and unified releases with the same release identity and their
effective namespaces. Repeat `--values` for every input file in deployment
order. The examples use separate reviewed override files for manual control-
and compute-plane mappings; create an empty file when no manual mappings are
required.

Control plane:

```bash
helm template "${RELEASE_NAME}" deployments/charts/service \
  --namespace "${RELEASE_NAMESPACE}" \
  --values legacy-values.yaml > /tmp/osmo-legacy-control.yaml

helm template "${RELEASE_NAME}" deployments/charts/osmo \
  --namespace "${RELEASE_NAMESPACE}" \
  --values control-plane-values.yaml \
  --values control-plane-overrides.yaml > /tmp/osmo-unified-control.yaml
```

Compute plane:

```bash
helm template "${RELEASE_NAME}" deployments/charts/backend-operator \
  --namespace "${LEGACY_RELEASE_NAMESPACE}" \
  --values legacy-backend-values.yaml > /tmp/osmo-legacy-compute.yaml

helm template "${RELEASE_NAME}" deployments/charts/osmo \
  --namespace "${AGENT_NAMESPACE}" \
  --values compute-plane-values.yaml \
  --values compute-plane-overrides.yaml > /tmp/osmo-unified-compute.yaml
```

Lint the same layered unified values that you rendered:

```bash
helm lint deployments/charts/osmo \
  --values control-plane-values.yaml \
  --values control-plane-overrides.yaml

helm lint deployments/charts/osmo \
  --values compute-plane-values.yaml \
  --values compute-plane-overrides.yaml
```

Compare resources by kind, namespace, component, and behavior rather than YAML
document order or generated checksums.

Review at least:

- resource kinds, names, namespaces, labels, selectors, and ownership;
- images, commands, arguments, environment variables, and ports;
- Secret and ConfigMap names, keys, volumes, mount paths, and rollout triggers;
- replicas, HPAs, PodDisruptionBudgets, resources, probes, and security
  contexts;
- node selectors, affinity, tolerations, topology constraints, and priority;
- ServiceAccounts, Role and ClusterRole rules, and bindings;
- NetworkPolicies, ingress, Services, and monitoring resources; and
- migration Jobs, lifecycle annotations, ordering, retry behavior, and
  cleanup.

Expect some intentional replacement resources. The unified chart uses
release-scoped labels and names, collision-resistant cluster RBAC names, and
additional pod hardening. A component with a changed immutable selector cannot
roll in place. Plan for the old and new workloads to overlap or for a brief
service interruption.

Do not accept unexplained drift in images, credentials, namespaces, database
targets, storage locations, scheduling, resources, RBAC permissions, or
network access.

## Cutover

Migrate a non-production release first. Use a maintenance window for any
control-plane migration that changes database schema, service-auth identity
storage, immutable selectors, or stable Service names.

1. Confirm backups and rollback inputs are current.
2. Pause automatic reconciliation for the release, if applicable.
3. Apply externally managed Secrets and verify only their names and key
   structure.
4. Re-render the exact values that will be deployed and review the final diff.
5. Stop legacy API writers before database and service-auth migration hooks
   start.
6. Remove only legacy resources that conflict with replacement immutable
   selectors or stable names.
7. Upgrade or synchronize the release using the unified chart. For Helm:

   ```bash
   helm upgrade --install "${RELEASE_NAME}" deployments/charts/osmo \
     --namespace "${RELEASE_NAMESPACE}" \
     --values converted-values.yaml \
     --values manual-overrides.yaml \
     --wait \
     --timeout 20m
   ```

8. Require database and service-auth migration Jobs to complete successfully
   before accepting new API traffic.
9. Complete the verification checklist below.
10. Disable one-time migration and TLS-generation flags, deploy the steady-state
    values, and verify again.
11. Resume automatic reconciliation only after the deployed release and stored
    values agree.

Migrate compute-plane releases one at a time. Confirm each backend reconnects
and can run a small workflow before moving to the next one.

## Verification

For a control-plane release, verify:

- every Deployment is available and every expected HPA targets the replacement
  workload;
- gateway health, ingress, API readiness, UI access, and authentication;
- existing access tokens remain valid after service-auth migration;
- PostgreSQL and Valkey connectivity, including TLS and password keys;
- workflow submission, scheduling, cancellation, logs, and data transfer;
- router HTTP, WebSocket, exec, port-forward, and rsync paths;
- object-storage read and write access for workflows, logs, and applications;
- authorization, rate limiting, monitoring, and alerts; and
- the deployed schema version and successful cleanup of one-time Jobs.

For a compute-plane release, verify:

- listener and worker Deployments are available in the agent namespace;
- the backend reconnects with its existing identity;
- node, pod, event, and heartbeat streams recover;
- workflow and test resources remain in their original namespaces;
- the token Secret name, key, and mount path are unchanged;
- the test-runner template and ServiceAccount are usable;
- monitoring discovers both agent components; and
- a small workflow schedules and completes successfully.

Review the final prune or deletion set before removing legacy resources. Keep
resources whose ownership or consumers have not been established.

## Rollback

Preserve the legacy values, chart version, image tag, database backup, and all
identity and credential Secrets until the rollback window closes.

A rollback may require more than changing the chart path:

- stop new API writers before restoring the old control plane;
- determine whether the old binaries are compatible with the migrated schema;
- restore the database backup when schema rollback is required;
- restore the original MEK, service-auth identity, TLS, OAuth, storage, and
  backend-token Secrets;
- restore the legacy release namespace and chart values together; and
- verify authentication, workflows, logs, storage, and backend connectivity
  before reopening traffic.

Do not generate replacement identity material during rollback. If the original
database or identity Secret cannot be restored, stop and recover those inputs
before starting either chart.
