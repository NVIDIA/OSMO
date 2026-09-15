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

Control and compute planes are commonly separate Helm releases. Convert and
deploy each release independently unless they already share one converged
release.

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

Save the exact legacy values files in deployment order. Back up retained
identity and credential Secrets, including the master encryption key (MEK),
service auth, OAuth credentials, backend tokens, object-storage credentials,
and generated TLS Secrets. PostgreSQL backup requirements are covered under
[Database migration](#database-migration).

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
contents, resources outside the Helm release, or legacy defaults absent from
the supplied files.

## Migrate a control-plane release

### 1. Prepare Secrets requiring manual work

The converter carries existing PostgreSQL, Valkey, MEK, and backend-token
Secret names and keys into the unified values. Those Kubernetes Secret objects
do not need to be reformatted solely for this chart migration.

Manual action is required only when a diagnostic says the legacy values do not
identify a usable Secret, when credentials are supplied inline or through an
injected file, when converting per-location object-storage Secrets, when private
CA trust was supplied through a custom mount, or for the database-backed
service-auth identity described below. Externally managed Secrets may remain
externally owned.

If the PostgreSQL or Valkey password was inline or the legacy values omitted
its Secret reference, create or identify a single-key Secret and set its name
and key in the converted values:

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

If the MEK was supplied only through an injected file, put the existing
`mek.yaml` document in a Secret and set
`secrets.masterEncryptionKey.existingSecret.name` and `.key`. Do not generate a
replacement MEK for an existing database.

For a private PostgreSQL or Valkey certificate authority, store the complete
PEM trust bundle in an externally managed Secret:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: dependency-private-cas
  namespace: <control-plane release namespace>
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

The service loads each per-location credential from one file selected by
`secretName` and `secretKey`; it does not merge separate Secret data keys. The
converter maps each legacy object-storage `secretName` and selects
`credential.json`. Add that data key to each referenced Secret unless it already
contains the complete credential document. Existing legacy keys may remain.

The converter reports `services.configs.secretRefs` because it cannot determine
which arbitrary mounts contain storage credentials. Remove entries used only
for storage after configuring the typed references. Move non-storage
application configuration mounts to `configuration.secretRefs`.

The document must contain the endpoint and credentials for that location:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: workflow-storage-credentials
  namespace: <control-plane release namespace>
type: Opaque
stringData:
  credential.json: |
    {
      "endpoint": "swift://<account>/<workflow-container>/<prefix>",
      "access_key_id": "<existing access key identifier>",
      "access_key": "<existing secret access key>"
    }
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
        key: credential.json
      logs:
        name: log-storage-credentials
        key: credential.json
      apps:
        name: application-storage-credentials
        key: credential.json
```

Configure all three per-location references, and do not combine them with the
shared `existingSecret` form. If an existing combined document uses another
data-key name, override `key` for that location.

Static credential documents use `access_key_id` and `access_key`; optional
fields include `endpoint`, `region`, `override_url`, and `addressing_style`.

#### OAuth credentials supplied as files

The converter reports legacy `gateway.oauth2Proxy.secretPaths`. Put those file
values into a Kubernetes Secret and configure separate client and cookie
references; both references may use the same Secret:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: oauth-credentials
  namespace: <control-plane release namespace>
type: Opaque
stringData:
  client_secret: <existing OAuth client secret>
  cookie_secret: <existing OAuth cookie secret>
```

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

For SDK-default object-storage authentication, no credential Secret is needed,
but all three locations must be explicit:

```yaml
externalDependencies:
  objectStorage:
    authentication:
      type: sdkDefault
    locations:
      workflows: <provider URI for workflow data>
      logs: <provider URI for logs>
      apps: <provider URI for applications>
```

Also review gateway ports, ingress and external TLS, internal TLS bootstrap,
ServiceAccounts, RBAC, NetworkPolicies, monitoring, scheduling, probes,
replicas, and resources.

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
   writers, including HPAs, automated reconciliation, operators, and
   environment-owned automation.
3. Verify the fence before proceeding: there must be no running 6.3 writer Pod,
   migration or configuration-initializer Job, external writer process, or
   active autoscaler or reconciler capable of bringing one back. Check both the
   legacy release namespace and environment-owned processes.
4. While the verified fence remains in place, enable `databaseMigration` and
   deploy the 6.4 release.
5. Keep every 6.3 writer and its autoscaling or reconciliation stopped
   throughout migration and until all upgraded manifests have been applied. If
   migration or manifest application fails, keep the fence in place and repair
   or retry the 6.4 cutover; do not restart 6.3 components against the migrated
   database.
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

The chart runs the idempotent migration Job before the 6.4 control-plane
workloads start.

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

To retry a failed or interrupted migration, correct the cause and redeploy the
release. The hook cleanup policy recreates the Job for the new operation.

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

### 1. Prepare Secrets requiring manual work

The converter carries `global.accountTokenSecret` and
`global.accountTokenSecretKey` into the unified values. The existing token
Secret format is unchanged, so no manual action is needed when that Secret is
already in the unified release namespace.

Kubernetes Secrets are namespaced. If the unified release moves to the legacy
agent namespace and the token Secret is not there, provision the same token in
that namespace. The unified compute plane does not support legacy password
authentication; obtain a backend token accepted by the control plane and
create a token Secret when converting a password-authenticated release:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: existing-backend-token
  namespace: <agent namespace>
type: Opaque
stringData:
  token: <existing 43- or 64-character URL-safe token>
  # previous-token: <distinct previous token during rotation>
```

The compute agents mount the selected key at
`/opt/osmo/secrets/token.txt`.

When converting a password-authenticated release, add the token reference to
the migration input before running the converter. Provisioning the Secret alone
does not change the legacy authentication settings:

```yaml
global:
  loginMethod: token
  accountTokenSecret: existing-backend-token
  accountTokenSecretKey: token
```

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
namespace and maps to `compute.workloadNamespace.name`; make it explicit in the
migration input so the unified chart does not fall back to the release
namespace.

Make `global.includeNamespaceUsage` explicit in the migration input. If the
backend test runner remains enabled, also set `global.backendTestNamespace`;
otherwise set `backendTestRunner.enabled: false`.

Keep the converter's compute-only `secrets` block. It disables control-plane
Secret generation for this release.

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

Helm identifies a release by name and namespace. If the legacy Helm release
namespace differs from the agent namespace, deploying the unified chart in the
agent namespace creates a separate Helm release even with the same name. Do not
allow both releases to claim the same resources concurrently.

## Deploy the unified releases

The unified chart adds component labels to Deployment selectors. Kubernetes
cannot update selectors in place, so delete these same-named legacy
control-plane Deployments before deploying the unified chart when they are
enabled:

- `osmo-agent`
- `osmo-delayed-job-monitor`
- `osmo-gateway-authz`
- `osmo-gateway-envoy`
- `osmo-gateway-oauth2-proxy`
- `osmo-gateway-ratelimit`
- `osmo-logger`
- `osmo-mcp`
- `osmo-router`
- `osmo-ui`
- `osmo-worker`

These are the names produced by the legacy chart's default component names. If
the legacy values override a component name, delete that same-named Deployment
instead. The unified chart recreates the enabled Deployments; a full release
replacement is also valid, and downtime is expected. Full release replacement
means replacing chart-managed resources, not deleting externally managed data,
credentials, or their namespaces.

The legacy `osmo-service` Deployment is replaced by `osmo-api`, so it does not
have a same-name selector conflict. The compute listener and worker names also
change in the unified chart and do not require same-name selector replacement.
