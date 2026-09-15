<!--
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
-->

# Upgrading OSMO from 6.3 to 6.4

## What's new in 6.4

- **Workflow labels** — optional, immutable `key: value` metadata on the
  workflow spec, stored in PostgreSQL and stamped onto task pods. See the
  workflow specification and submission guides for usage, and the
  `labels_config` reference for the admin policy.

## Migrate from the legacy charts

OSMO 6.4 replaces the legacy `service` and `backend-operator` charts with the
unified `osmo` chart. This procedure supports an OSMO 6.3 control plane using
externally managed PostgreSQL, Redis or Valkey, and object storage. It does not
cover moving data out of a dependency deployed by a legacy chart.

Control and compute planes are commonly separate Helm releases. Convert,
render, and verify each release independently unless they already share one
converged release.

This migration has a maintenance window. OSMO control-plane and compute-plane
components may be stopped and recreated. Preserve data, identity, credentials,
namespaces, and required behavior; downtime during the chart transition is
expected.

The supplied converters translate supported legacy overrides into the unified
values schema. They do not inspect a cluster, read Secret data, or modify
resources. Treat converted values as a reviewed starting point.

Only the 6.3-to-6.4 upgrade path is supported. Upgrade older installations to
OSMO 6.3 before following this guide.

### Prepare the migration

1. Record each Helm release name and namespace, the effective control-plane,
   agent, workflow, and backend-test namespaces, and every values file in
   deployment order.
2. Render and save the complete legacy control-plane and compute-plane
   manifests with those exact values.
3. Back up retained identity and credential Secrets, including the master
   encryption key (MEK), service auth, OAuth credentials, backend tokens,
   object-storage credentials, and generated TLS Secrets. PostgreSQL backup
   requirements are covered under [Database migration](#database-migration).

The legacy and unified charts need not exist in the same checkout. Build and
render the legacy charts from OSMO 6.3 source, and the unified chart from OSMO
6.4 source:

```bash
helm dependency build "${OSMO_63_SOURCE}/deployments/charts/service"
helm dependency build "${OSMO_63_SOURCE}/deployments/charts/backend-operator"
helm dependency build "${OSMO_64_SOURCE}/deployments/charts/osmo"
```

### Run the converters

Both converters accept one or more YAML files and merge them from left to
right. Pass files in the same order as the legacy release.

Run a converter normally first. If it reports settings that need manual work,
rerun it with `--allow-partial` to write the mappings it could complete while
showing and recording the remaining paths:

```bash
python3 CONVERTER.py \
  --allow-partial \
  legacy-values.yaml \
  --output converted-values.partial.yaml \
  2> >(tee conversion-report.txt >&2)
```

Do not deploy partial output by itself. Keep the original values unchanged and
work from a migration copy. For every diagnostic, either remove an inactive or
retired legacy setting or translate it into a unified-chart override and then
remove its legacy form from the migration copy. Rerun the converter without
`--allow-partial` after resolving every diagnostic.

The converters see only explicit inputs. They cannot infer live Secret
contents, resources outside the Helm release, controller settings, or legacy
defaults absent from the supplied files. Always compare the legacy and unified
renders before deployment.

## Migrate a control-plane release

### 1. Format control-plane Secrets

The unified chart uses typed Secret references. Externally managed Secrets may
remain externally owned; configure the chart to consume them without generating
or adopting them.

| Purpose | Legacy reference | Unified reference and default key |
| --- | --- | --- |
| PostgreSQL password | `services.postgres.passwordSecretName` and `passwordSecretKey` | `secrets.postgresql.existingSecret` and `keys.password` (`db-password`) |
| Valkey password | `services.redis.passwordSecretName` and `passwordSecretKey` | `secrets.valkey.existingSecret` and `keys.password` (`redis-password`) |
| Object storage | `services.configs.secretRefs` and each credential's `secretName` | `secrets.objectStorage.existingSecret` or all three `credentialSecretRefs` |
| MEK | `services.masterEncryptionKey` or an injected file | `secrets.masterEncryptionKey.existingSecret` (`mek.yaml`) |
| Service-auth identity | PostgreSQL-backed in OSMO 6.3 | `secrets.serviceAuth.existingSecret` (`authentication-config.json`) |
| Backend API token | `services.backendApiTokens.credentials[]` | `secrets.backendApiTokens.credentials[]` (`token`, optional `previous-token`) |
| OAuth client and cookie | OAuth proxy Secret or injected paths | `secrets.oauthClientSecret` and `secrets.oauthCookieSecret` |
| Default administrator | `services.defaultAdmin` | `secrets.defaultAdmin` (`password`) |
| Private CAs | Custom mounts or injected configuration | `externalDependencies.{postgresql,valkey}.tls` |

PostgreSQL and Valkey use ordinary single-key Secrets:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: external-postgresql-credentials
type: Opaque
stringData:
  db-password: <existing PostgreSQL password>
---
apiVersion: v1
kind: Secret
metadata:
  name: external-valkey-credentials
type: Opaque
stringData:
  redis-password: <existing Valkey password>
```

Reference them without placing credentials in Helm values:

```yaml
secrets:
  postgresql:
    existingSecret: external-postgresql-credentials
    keys:
      password: db-password
  valkey:
    generate: false
    existingSecret: external-valkey-credentials
    keys:
      password: redis-password
```

For a private PostgreSQL or Valkey certificate authority, store the complete
PEM trust bundle in an externally managed Secret:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: dependency-private-cas
type: Opaque
stringData:
  postgresql-ca.crt: |
    -----BEGIN CERTIFICATE-----
    <PostgreSQL CA certificate chain>
    -----END CERTIFICATE-----
  valkey-ca.crt: |
    -----BEGIN CERTIFICATE-----
    <Valkey CA certificate chain>
    -----END CERTIFICATE-----
```

Select those keys in the dependency TLS settings:

```yaml
externalDependencies:
  postgresql:
    tls:
      enabled: true
      sslMode: verify-full
      caExistingSecret: dependency-private-cas
      caKey: postgresql-ca.crt
  valkey:
    tls:
      enabled: true
      caExistingSecret: dependency-private-cas
      caKey: valkey-ca.crt
```

The chart mounts the selected bundle into the migration Jobs and every enabled
application component that connects to that dependency.

#### Object-storage Secrets

The legacy chart mounted `services.configs.secretRefs` under
`/etc/osmo/secrets/<secret-name>`. The unified chart mounts typed object-storage
Secrets at the same path.

The converter reports `services.configs.secretRefs` because it cannot prove
that every entry is used only for object storage. After adding typed storage
references, remove entries used only for storage credentials. Move any other
application-configuration Secret mounts to `configuration.secretRefs`.

Choose one authentication type:

- `sdkDefault` lets the provider SDK discover a workload, managed, or instance
  identity and does not use an object-storage credential Secret.
- `static` means OSMO reads explicit credentials from Kubernetes Secrets.

For SDK-default authentication, define the three locations in values:

```yaml
externalDependencies:
  objectStorage:
    authentication:
      type: sdkDefault
    locations:
      workflows: <provider URI for workflow data>
      logs: <provider URI for logs>
      apps: <provider URI for applications>

secrets:
  objectStorage:
    generate: false
    existingSecret: ""
```

For one static credential document shared by all locations, store its fields in
one YAML document and define the locations in values:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: object-storage-credentials
type: Opaque
stringData:
  object-storage.yaml: |
    access_key_id: <existing access key identifier>
    access_key: <existing secret access key>
```

```yaml
externalDependencies:
  objectStorage:
    authentication:
      type: static
    locations:
      workflows: s3://<workflow-bucket>/<prefix>
      logs: s3://<log-bucket>/<prefix>
      apps: s3://<application-bucket>/<prefix>
    s3:
      region: <region>
      overrideUrl: <S3-compatible HTTPS endpoint or empty>

secrets:
  objectStorage:
    generate: false
    existingSecret: object-storage-credentials
    keys:
      credentials: object-storage.yaml
```

For separate per-location Secrets, configure all three references. A blank
`key` mounts every data item in that Secret as its own file under
`/etc/osmo/secrets/<secret-name>/<data-key>`:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: workflow-storage-credentials
type: Opaque
stringData:
  endpoint: swift://<account>/<workflow-container>/<prefix>
  access_key_id: <existing access key identifier>
  access_key: <existing secret access key>
```

```yaml
externalDependencies:
  objectStorage:
    authentication:
      type: static
    locations:
      workflows: ""
      logs: ""
      apps: ""
    s3:
      region: ""
      overrideUrl: ""

secrets:
  objectStorage:
    generate: false
    existingSecret: ""
    credentialSecretRefs:
      workflows:
        name: workflow-storage-credentials
        key: ""
      logs:
        name: log-storage-credentials
        key: ""
      apps:
        name: application-storage-credentials
        key: ""
```

This Secret-only endpoint form requires every referenced Secret to provide its
own `endpoint`. Alternatively, set each `key` to a YAML credential document.
Configure all three per-location references, and do not combine them with the
shared `existingSecret` form.

Static credential documents use `access_key_id` and `access_key`; optional
fields include `endpoint`, `region`, `override_url`, and `addressing_style`.

#### Preserve the MEK

Do not generate a replacement MEK for an existing database. Preserve the
existing `mek.yaml` document:

```yaml
secrets:
  masterEncryptionKey:
    managementMode: external
    existingSecret:
      name: existing-mek
      key: mek.yaml
    bootstrap:
      enabled: false
```

The unified chart mounts it at `/opt/osmo/mek/mek.yaml`.

#### Translate OAuth and backend-token Secrets

The OAuth client and cookie may share a Secret, but use separate references:

```yaml
secrets:
  oauthClientSecret:
    existingSecret: oauth-credentials
    keys:
      value: client_secret
  oauthCookieSecret:
    generate: false
    existingSecret: oauth-credentials
    keys:
      value: cookie_secret
```

Preserve existing backend token Secrets:

```yaml
secrets:
  backendApiTokens:
    enabled: true
    credentials:
    - name: primary
      existingSecret:
        name: existing-backend-token
```

### 2. Run the control-plane converter

Run the converter with the legacy service-chart values:

```bash
python3 deployments/upgrades/service_to_osmo_chart/control_plane_values_convert.py \
  legacy-values.yaml \
  --output control-plane-values.yaml
```

For split files, preserve deployment order:

```bash
python3 deployments/upgrades/service_to_osmo_chart/control_plane_values_convert.py \
  base-values.yaml \
  config-values.yaml \
  template-values.yaml \
  pool-values.yaml \
  --output control-plane-values.yaml
```

The converter selects a control-only composition and maps supported images,
services, gateway settings, scheduling, configuration, external dependencies,
typed Secret references, and database-migration settings. It also disables
unified defaults that would introduce behavior absent from the legacy release.

### 3. Complete the control-plane values

Add a final override for information that cannot be recovered from the legacy
input. Confirm the actual external hosts, ports, database names, usernames,
object-storage locations, and TLS policy:

```yaml
embeddedDependencies:
  postgresql:
    enabled: false
  valkey:
    enabled: false
  objectStorage:
    enabled: false

externalDependencies:
  postgresql:
    host: <PostgreSQL host>
    port: 5432
    database: <database name>
    username: <database user>
  valkey:
    host: <Valkey host>
    port: 6379
    database: 0
```

Do not add fallback object-storage endpoints when all three per-location
Secrets contain their endpoints. Leave all location and S3 fields empty as in
the Secret-only example.

Also review gateway ports, ingress and external TLS, internal TLS bootstrap,
ServiceAccounts, RBAC, NetworkPolicies, monitoring, scheduling, probes,
replicas, and resources. Apply environment-specific hook annotations only when
the release must be ordered relative to resources outside the chart.

### 4. Render and compare the control plane

```bash
helm template "${RELEASE_NAME}" \
  "${OSMO_63_SOURCE}/deployments/charts/service" \
  --namespace "${RELEASE_NAMESPACE}" \
  --values legacy-values.yaml \
  > /tmp/osmo-legacy-control.yaml

helm lint "${OSMO_64_SOURCE}/deployments/charts/osmo" \
  --values control-plane-values.yaml \
  --values control-plane-overrides.yaml

helm template "${RELEASE_NAME}" \
  "${OSMO_64_SOURCE}/deployments/charts/osmo" \
  --namespace "${RELEASE_NAMESPACE}" \
  --values control-plane-values.yaml \
  --values control-plane-overrides.yaml \
  > /tmp/osmo-unified-control.yaml
```

Repeat `--values` for every legacy input. Compare by kind, namespace,
component, and behavior rather than document order or generated checksums.
Check resource identity, immutable selectors, images, commands, arguments,
ports, Services, Secret keys and mount paths, replicas, probes, scheduling,
RBAC, NetworkPolicies, monitoring, TLS, and migration Jobs.

Several legacy Deployments may need recreation because the unified chart uses
different immutable selectors. Derive the affected resource names from the
rendered diff.

## Database migration

OSMO 6.4 reads and writes the nullable `workflows.labels` JSONB column and uses
ConfigMap-backed configuration instead of the legacy database fields listed
below. Every upgrade from 6.3 must run the unified chart's ordered migrations
before the API, worker, or agent starts.

### Legacy-writer quiescence fence

Migrations 007 and 009 change or remove database state that a running 6.3
process can recreate after the migration transaction releases its locks.
Therefore, `databaseMigration.enabled: true` is safe only inside this cutover
fence:

1. Before enabling `databaseMigration`, stop every 6.3 OSMO component, Job, and
   external process that can write PostgreSQL or initialize database
   configuration. Identify all legacy control-plane components with PostgreSQL
   credentials; stopping only the API is not sufficient. Keep PostgreSQL itself
   running for the migration.
2. Disable or suspend every mechanism that could recreate or scale those
   writers, including HPAs, GitOps automated sync or self-heal, operators, and
   environment-owned automation. Either pause the reconciler or first commit
   and apply a desired state with the legacy writers at zero and their
   autoscaling disabled.
3. Verify the fence before proceeding: there must be no running 6.3 writer Pod,
   migration or configuration-initializer Job, external writer process, or
   active autoscaler or reconciler capable of bringing one back. Check both the
   legacy release namespace and environment-owned processes.
4. While the verified fence remains in place, enable `databaseMigration` and
   apply the 6.4 release through Helm or the installation's GitOps workflow. If
   GitOps is used, make quiescence a completed, separately verified operation
   before syncing the migration and 6.4 manifests.
5. Keep every 6.3 writer and its autoscaling or reconciliation stopped
   throughout the pre-upgrade or PreSync hook and until all upgraded manifests
   have been applied. If migration or manifest application fails, keep the
   fence in place and repair or retry the 6.4 cutover; do not restart 6.3
   components against the migrated database.
6. Resume reconciliation and autoscaling only after the migration succeeds and
   every component being started uses the 6.4 image and configuration. No 6.3
   database writer may resume.

### Backup before destructive cleanup

Migration 009 permanently deletes the retired legacy configuration rows listed
below. Before enabling `databaseMigration`, create a PostgreSQL backup using the
database operator or provider's supported mechanism, verify that it completed
successfully and is restorable, and retain its identifier through the rollback
window.

Neither pgroll rollback nor Helm rollback restores rows deleted by migration
009. If database restoration is required, stop every 6.3 and 6.4 PostgreSQL
writer and every reconciler that could restart one, then follow the database
operator or provider's tested restore procedure. Validate the restored database
and schema before resuming only the release version compatible with that state.
A full database restore also rewinds changes made after the backup. If selective
restoration of the legacy values is required, export them before cleanup and
deliver a reviewed, tested forward restoration migration; adding a `down` field
cannot reconstruct values after they have been deleted.

Before enabling `databaseMigration`, configure and validate every applicable
destination value in the 6.4 values. SQL cannot determine whether an
environment-specific replacement is correct. Rows marked retired have no 6.4
runtime destination, but operators must confirm that the deployment no longer
depends on them.

| Legacy row | Disposition before cleanup |
| --- | --- |
| `SERVICE.service_cluster` | Retired; Helm release/resource identity replaces it |
| `SERVICE.service_cluster_namespace` | Retired; release namespace and `POD_NAMESPACE` replace it |
| `SERVICE.service_url` | `externalUrl` / `service.service_base_url` |
| `SERVICE.user_data_path` | `configuration.workflow.workflow_data.base_url` |
| `SERVICE.user_dataset_path` | Retired; no 6.4 runtime equivalent |
| `SERVICE.workflow_backends` | `configuration.backends` plus pool backend selection |
| `SERVICE.workflow_start_timeout` | `configuration.service.max_pod_restart_limit` |
| `WORKFLOW.credential_validation_enabled` | `credential_config.disable_registry_validation` and `disable_data_validation` |
| `WORKFLOW.default_workflow_backend` | Retired after pool backend selection is configured |
| `WORKFLOW.exec_port_config` | Retired; no current port-range equivalent |
| `WORKFLOW.workflow_alert` | `configuration.workflow.workflow_alerts`, or explicitly retired when unused |
| Every `DATASET` row | Retired; dataset configuration is not part of the 6.4 ConfigMap schema |

The cleanup migration removes all eleven enumerated legacy keys and every row
whose type is `DATASET`. It does not remove `SERVICE.service_auth` or any
current configuration field.

After the destination-value preflight, enable the idempotent pgroll hook in the
unified `osmo` chart values. It requires external PostgreSQL:

```yaml
databaseMigration:
  enabled: true
  targetSchema: public
```

The chart includes both Helm `pre-install,pre-upgrade` hook annotations and Argo
CD `PreSync` annotations. Use either Helm or Argo CD according to the existing
release workflow; neither is a prerequisite for the other. If Argo CD must
order these hooks relative to environment-owned resources, set an
environment-specific sync wave:

```yaml
databaseMigration:
  annotations:
    argocd.argoproj.io/sync-wave: "<environment-sync-wave>"
```

### Migrate database-backed service auth

Service-auth migration is opt-in and applies only when the 6.3 installation's
stable signing identity is stored in `SERVICE.service_auth`. The migration must
preserve that identity or existing tokens become invalid.

With the writer fence established, create an empty destination Secret and
authorize it for the exact Helm release:

```bash
kubectl create secret generic "${SERVICE_AUTH_SECRET}" \
  --namespace "${RELEASE_NAMESPACE}"
kubectl annotate secret "${SERVICE_AUTH_SECRET}" \
  --namespace "${RELEASE_NAMESPACE}" \
  "osmo.nvidia.com/service-auth-db-migration-placeholder=${RELEASE_NAME}"
```

The migration Job cannot create this Secret: its scoped RBAC permits only
`get` and `update`, and it rejects an absent or unauthorized destination.
Service-auth bootstrap is not a substitute because it creates a new signing
identity.

For the first cutover phase, disable the API and enable migration:

```yaml
services:
  api:
    enabled: false

secrets:
  serviceAuth:
    managementMode: external
    existingSecret:
      name: <service-auth Secret name>
      key: authentication-config.json
    bootstrap:
      enabled: false
    migration:
      enabled: true
```

The hook decrypts and validates the database identity and copies that same
stable identity into the authorized Secret. It does not create or rotate an
identity. Leave migration disabled when no database-backed identity needs to be
copied.

After the hook succeeds and every enabled non-API configuration consumer is
healthy, perform a second deployment with the API enabled and migration
disabled:

```yaml
services:
  api:
    enabled: true

secrets:
  serviceAuth:
    migration:
      enabled: false
```

To retry a failed or interrupted migration, correct the cause and rerun the
Helm upgrade or start another GitOps synchronization. The hook cleanup policy
recreates the Job for the new operation.

### Verify the workflow-label schema

Before allowing the service rollout to continue, verify the column and generic
GIN index:

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'workflows'
  AND column_name = 'labels';

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'workflows'
  AND indexname = 'workflow_labels_gin_idx';
```

The expected results contain one `jsonb` column row and a `jsonb_ops` GIN index
on `labels`. New databases receive both from the in-code schema.

The generic GIN index accelerates key existence, exact-value, and alternation
filters. Deployments with curated keys should also provision per-key indexes
for prefix and missing-label queries. For example:

```sql
CREATE INDEX CONCURRENTLY workflow_labels_ppp_pattern_idx
    ON workflows ((labels ->> 'PPP') text_pattern_ops);

CREATE INDEX CONCURRENTLY workflow_labels_ppp_missing_idx
    ON workflows (submit_time DESC)
    WHERE labels IS NULL OR NOT (labels ? 'PPP');
```

Use deployment-specific index names and replace `PPP` with the configured key.
Create or drop these indexes outside a transaction because PostgreSQL does not
allow `CONCURRENTLY` inside a transaction block.

## Migrate a compute-plane release

### 1. Format compute-plane Secrets

Preserve the existing backend token. Its data format is unchanged:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: existing-backend-token
type: Opaque
stringData:
  token: <existing 43- or 64-character URL-safe token>
  # previous-token: <distinct previous token during rotation>
```

Only the values path changes:

| Legacy | Unified |
| --- | --- |
| `global.accountTokenSecret` | `compute.authentication.existingSecret` |
| `global.accountTokenSecretKey` | `compute.authentication.tokenKey` |

```yaml
compute:
  authentication:
    existingSecret: existing-backend-token
    tokenKey: token
```

The Secret must exist in the unified Helm release namespace. The compute
agents mount it at `/opt/osmo/secrets/token.txt`. Preserve the image-pull Secret
selected by `global.imagePullSecret`.

Keep the converter's compute-only `secrets` block. Those settings disable
control-plane Secret generation and prevent unified defaults from affecting a
compute-only release.

### 2. Run the compute-plane converter

```bash
python3 deployments/upgrades/service_to_osmo_chart/compute_values_convert.py \
  --release-name "${RELEASE_NAME}" \
  --release-namespace "${AGENT_NAMESPACE}" \
  legacy-backend-values.yaml \
  --output compute-plane-values.yaml
```

`--release-name` preserves the legacy backend test-runner ServiceAccount name
when the test runner is enabled and `global.name` is unset.

The legacy chart can render agents into `global.agentNamespace` while the Helm
release lives elsewhere. The unified chart renders agents into the Helm release
namespace. Set `--release-namespace` to the legacy agent namespace and deploy
the unified release there. `global.backendNamespace` remains the workflow
namespace and maps to `compute.workloadNamespace.name`.

Make `global.includeNamespaceUsage` explicit in the migration input. If the
backend test runner remains enabled, also set `global.backendTestNamespace`;
otherwise set `backendTestRunner.enabled: false`.

### 3. Complete the compute-plane values

Review backend identity, control-plane endpoint, namespaces, token reference,
images, pull policy, scheduling, resources, probes, listener settings, worker
progress interval, RBAC, NetworkPolicy, monitoring, and test-runner settings.

Exactly one release or an external administrator should own the fixed
`osmo-high`, `osmo-normal`, and `osmo-low` PriorityClasses:

```yaml
compute:
  priorityClasses:
    create: false
```

Retain the established workflow namespace unless this release should create a
new one:

```yaml
compute:
  workloadNamespace:
    name: <existing workflow namespace>
    create: false
```

Review cross-namespace test-runner RBAC for name collisions. If workflow
NetworkPolicy is enabled, verify cluster CIDRs, DNS, allowed namespaces, and
additional egress rules for the workflow namespace.

### 4. Render and compare the compute plane

```bash
helm template "${RELEASE_NAME}" \
  "${OSMO_63_SOURCE}/deployments/charts/backend-operator" \
  --namespace "${LEGACY_RELEASE_NAMESPACE}" \
  --values legacy-backend-values.yaml \
  > /tmp/osmo-legacy-compute.yaml

helm lint "${OSMO_64_SOURCE}/deployments/charts/osmo" \
  --values compute-plane-values.yaml \
  --values compute-plane-overrides.yaml

helm template "${RELEASE_NAME}" \
  "${OSMO_64_SOURCE}/deployments/charts/osmo" \
  --namespace "${AGENT_NAMESPACE}" \
  --values compute-plane-values.yaml \
  --values compute-plane-overrides.yaml \
  > /tmp/osmo-unified-compute.yaml
```

Compare listener, worker, test runner, ServiceAccounts, RBAC, NetworkPolicy,
PriorityClasses, PodMonitors, token projections, and namespaces.

Helm identifies a release by name and namespace. If the legacy Helm release
namespace differs from the agent namespace, deploying the unified chart in the
agent namespace creates a separate Helm release even with the same name. Do not
allow both releases to claim the same resources concurrently.

## Deploy the unified releases

Use either full replacement or selective in-place replacement. Both approaches
may restart OSMO control-plane and compute-plane components.

1. Protect PostgreSQL, PVCs, and retained or externally managed Secrets from
   deletion.
2. Establish the legacy-writer fence before control-plane migration.
3. Apply externally managed Secrets and the final converted values.
4. Re-render the exact values layers being deployed.
5. Run database, service-auth, and internal-TLS hooks in their required order.
6. Recreate objects with immutable-field conflicts, or replace the release.
7. Wait for the unified components to become ready and remove obsolete legacy
   resources.

### GitOps controllers

Put the complete values in the controller's source of truth. If an Application
is generated, update its generator or template rather than the generated child.
Pause automated reconciliation while establishing the writer fence and
reviewing the migration. Restore the intended reconciliation policy after the
unified resources are healthy.

A normal synchronization may be sufficient. A full replacement is also valid
when the controller supports it and the migration accepts complete resource
recreation. In either case, ensure deletion and pruning exclude externally
owned Secrets, retained identity and TLS Secrets, PVCs, required Namespaces,
and shared cluster-scoped resources.

### Direct Helm

Use Helm 3.19 or newer when generated internal TLS is enabled. For an in-place
upgrade:

```bash
helm upgrade --install "${RELEASE_NAME}" \
  "${OSMO_64_SOURCE}/deployments/charts/osmo" \
  --namespace "${RELEASE_NAMESPACE}" \
  --values converted-values.yaml \
  --values manual-overrides.yaml \
  --wait \
  --wait-for-jobs \
  --timeout 25m
```

A full uninstall and reinstall is also valid. Before uninstalling, protect the
database, PVCs, Namespaces, identity Secrets, credentials, TLS material, and
shared cluster-scoped resources. Reinstall with the intended release name and
namespace.

Helm rollback does not reverse completed database migrations or externally
managed Secret updates. On failure, keep legacy writers stopped and repair,
retry, or follow the rollback procedure below.

## Verify and establish steady state

For a control-plane release, verify:

- database and service-auth migration Jobs completed;
- the database has the intended OSMO 6.4 schema;
- existing authentication tokens remain valid;
- retained MEK, TLS, OAuth, storage, and backend-token Secrets still exist;
- every enabled Deployment is available and every HPA targets the replacement;
- gateway, ingress, API, UI, and authentication work;
- PostgreSQL, Valkey, and object-storage reads and writes work; and
- workflow submission, scheduling, cancellation, logs, data transfer, exec,
  port-forward, and rsync work.

For a compute-plane release, verify:

- listener and worker Deployments are available in the agent namespace;
- the backend reconnects with its existing identity;
- node, Pod, event, and heartbeat streams recover;
- workflow and backend-test resources remain in their intended namespaces;
- the token name, key, and `/opt/osmo/secrets/token.txt` mount are preserved;
- test-runner RBAC and templates work; and
- a small workflow schedules and completes.

After verification, disable one-time service-auth migration and initial
internal-TLS generation, apply the steady-state values, restore the intended
reconciliation policy, and remove unexplained legacy resources.

## Rollback

Preserve the OSMO 6.3 values, images, manifests, database backup, and identity
and credential Secrets until the rollback window closes.

Keep all database writers stopped while determining schema compatibility.
Restore PostgreSQL if 6.3 cannot use the migrated schema, restore the original
MEK and other retained Secrets, then restore the legacy release name and
namespace together. Do not generate replacement identity material during
rollback.
