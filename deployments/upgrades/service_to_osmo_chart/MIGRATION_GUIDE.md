# Migrating legacy OSMO charts to the unified chart

This guide describes how to migrate an OSMO 6.3 installation from the legacy
`service` and `backend-operator` charts to the unified `osmo` chart in OSMO
6.4. It covers control planes that use externally managed PostgreSQL,
Redis or Valkey, and object storage. It does not cover moving data out of a
dependency deployed by a legacy chart.

Control and compute planes are commonly separate Helm releases. Convert,
render, and verify each release independently unless they already share one
converged release.

This migration has a maintenance window. All OSMO workloads may be stopped and
recreated. The goal is to preserve data, identity, credentials, namespaces, and
required behavior, not to provide a zero-downtime chart transition.

The supplied converters translate supported legacy overrides into the unified
values schema. They do not inspect a cluster, read Secret data, or modify
resources. Treat converted values as a reviewed starting point rather than an
automatic deployment.

Only the 6.3-to-6.4 upgrade path is supported. Bring older databases to the
OSMO 6.3 schema with the applicable legacy migrations before following this
guide.

## Common preparation

Before converting either release:

1. Record the Helm release name, Helm release namespace, chart version, image
   tag or digest, and every values file in deployment order.
2. For a compute release, separately record the namespace containing its
   agents, the namespace containing workflow workloads, and the backend test
   namespace.
3. Pin compatible OSMO 6.4 chart and image versions for the migration and
   rollback window.
4. Render and save the complete legacy manifests.
5. Inventory resources that the unified release will retain, update, rename,
   recreate, or remove. Include cluster-scoped resources and resources managed
   outside Helm.
6. Back up PostgreSQL and the master encryption key (MEK), service-auth
   identity, OAuth credentials, backend tokens, object-storage credentials,
   and generated TLS Secrets.
7. Verify that externally managed Secrets can be restored under the same names
   and keys. Do not print their values while checking them.
8. Test database restore procedures before the maintenance window. Helm and
   deployment-controller rollback cannot reverse a database migration.
9. Confirm sufficient permissions to stop the old workloads, create the new
   resources, and restore the old release if necessary.

Build the chart dependencies before rendering:

```bash
helm dependency build deployments/charts/service
helm dependency build deployments/charts/backend-operator
helm dependency build deployments/charts/osmo
```

### Establish the control-plane writer fence

Before running database or service-auth migration hooks, stop every legacy
PostgreSQL writer and configuration initializer. Prevent HPAs and automated
reconciliation from restarting them. Verify that no old API Pod remains.

Keep the writer fence in place until the database migration, service-auth
migration, and any internal-TLS bootstrap have completed and the new API is
ready. A failed deployment is not permission to restart an old binary against
an uncertain schema.

Use one PostgreSQL TLS policy for both migration Jobs and application
workloads. The unified chart uses `verify-full` when PostgreSQL TLS is enabled
and `disable` when it is disabled. If the legacy deployment uses another mode,
such as encryption without server verification, do not silently change it.
Provision a trusted CA and use `verify-full`, or add the required chart support
before migrating.

## Converter behavior

Both converters accept one or more YAML files. Inputs are merged from left to
right using Helm's map-merge and list-replace behavior. Pass files in the same
order as the legacy release.

The default mode is fail-closed. An unsupported or ambiguous value produces a
path-only diagnostic on standard error, suppresses YAML output, and exits with
status 2. Diagnostics do not include Secret values.

Use `--allow-unmapped` only to inspect the safe partial conversion:

```bash
python3 CONVERTER.py \
  --allow-unmapped \
  legacy-values.yaml \
  --output converted-values.partial.yaml \
  2>conversion-report.txt
```

Never deploy the partial output by itself. Keep the original values unchanged
and work from a migration copy. For every diagnostic:

- remove a legacy setting that is inactive or deliberately retired; or
- translate it into a separate unified-chart override, then remove the legacy
  form from the migration copy.

Rerun the converter without `--allow-unmapped` and require a successful exit.
Always layer manual overrides after converted values so explicit operator
decisions win:

```bash
helm template "${RELEASE_NAME}" deployments/charts/osmo \
  --namespace "${RELEASE_NAMESPACE}" \
  --values converted-values.yaml \
  --values manual-overrides.yaml
```

The converters see only explicit inputs. They cannot infer live Secret
contents, resources outside the Helm release, controller settings, or behavior
inherited only from legacy chart defaults. The render comparison later in this
guide is therefore mandatory even when conversion produces no diagnostics.

## Migrate a control-plane release

### 1. Prepare and format control-plane Secrets

The unified chart uses typed Secret references. Secret names are
operator-selected unless a chart-managed lifecycle is explicitly enabled. A
Secret managed by an external secret controller may remain externally owned;
configure the chart to consume it without generating or adopting it.

| Purpose | Required | Legacy reference | Unified reference and default key |
| --- | --- | --- | --- |
| PostgreSQL password | Yes | `services.postgres.passwordSecretName` and `passwordSecretKey` | `secrets.postgresql.existingSecret` and `keys.password` (`db-password`) |
| Valkey password | Yes | `services.redis.passwordSecretName` and `passwordSecretKey` | `secrets.valkey.existingSecret` and `keys.password` (`redis-password`) |
| Object storage | With static authentication | `services.configs.secretRefs` and each workflow credential's `secretName` | `secrets.objectStorage.existingSecret` or all three `credentialSecretRefs` |
| MEK | Yes | `services.masterEncryptionKey` or an injected file | `secrets.masterEncryptionKey.existingSecret` (`mek.yaml`) |
| Service-auth identity | Yes | PostgreSQL-backed in OSMO 6.3 | `secrets.serviceAuth.existingSecret` (`authentication-config.json`) |
| Backend API token | When token-authenticated compute planes connect | `services.backendApiTokens.credentials[]` | `secrets.backendApiTokens.credentials[]` (`token`, optional `previous-token`) |
| OAuth client and cookie | When OAuth is enabled | OAuth proxy Secret or injected paths | `secrets.oauthClientSecret` and `secrets.oauthCookieSecret` |
| Default administrator | When bootstrap is enabled | `services.defaultAdmin` | `secrets.defaultAdmin` (`password`) |
| Private CAs | When private trust roots are used | Custom mounts or injected configuration | Dependency TLS blocks selecting a Secret and key |
| Internal gateway TLS | When internal TLS is enabled | Legacy gateway TLS Secrets | Generated retained Secrets or `gateway.tls.{caSecret,upstreamCerts}` |

PostgreSQL and Valkey keep ordinary single-key Secrets. Only their values paths
change:

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

Reference them without placing credential values in Helm values:

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

For PostgreSQL or Valkey using a private CA, place the complete trust bundle in
an externally managed Secret and select its key from the applicable
`externalDependencies.*.tls` block.

#### Object-storage Secret formats

The legacy chart mounted arbitrary `services.configs.secretRefs` under
`/etc/osmo/secrets/<secret-name>` and resolved `secretName` from configuration.
The unified chart selects object-storage Secrets through typed values and
mounts them at the same `/etc/osmo/secrets/<secret-name>` location.

The converter reports the legacy `services.configs.secretRefs` list because it
cannot prove that every entry is used only for object storage. After adding the
typed object-storage references, remove legacy entries used only for those
credentials. Move any remaining application-configuration Secret mounts to
`configuration.secretRefs` and make each consuming configuration field name
both its `secretName` and `secretKey`:

```yaml
configuration:
  secretRefs:
  - secretName: additional-configuration-secret
```

These general configuration Secrets also remain mounted read-only at
`/etc/osmo/secrets/<secret-name>`.

Choose one credential source. With SDK-default authentication, create no
object-storage credential Secret. Define all three locations in values and let
the provider SDK use its workload, managed, or instance identity:

```yaml
externalDependencies:
  objectStorage:
    authentication:
      type: sdkDefault
    locations:
      workflows: azure://<account>/<workflow-container>/<prefix>
      logs: azure://<account>/<log-container>/<prefix>
      apps: azure://<account>/<application-container>/<prefix>

secrets:
  objectStorage:
    generate: false
    existingSecret: ""
```

For static authentication, choose exactly one of the following Secret formats.

For one credential document shared by all three locations, put the secret
fields in one YAML document. Define the three locations explicitly in values:

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
`key` loads the Secret's individual data keys:

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

This Secret-only endpoint form is valid only when every referenced Secret
provides its own `endpoint`. Alternatively, set each reference's `key` to a
YAML document containing that location's credential. Do not combine the shared
`existingSecret` form with per-location references, and do not configure only
some of the three per-location references.

Static credential documents use `access_key_id` and `access_key`; optional
fields include `endpoint`, `region`, `override_url`, and `addressing_style`.
Keep the provider and URI scheme consistent across workflow data, logs, and
applications.

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

#### Preserve the MEK

Do not generate a replacement MEK for an existing database. Preserve the
existing `mek.yaml` document and reference it through the new values path:

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

The unified chart mounts it at `/opt/osmo/mek/mek.yaml`. Keep the Secret and
its key ID and key material unchanged through the rollback window.

#### Prepare the service-auth identity

OSMO 6.3 stores the service-auth signing identity in PostgreSQL. The unified
chart mounts a Kubernetes Secret containing `authentication-config.json` at
`/etc/osmo/service-auth/authentication-config.json`. Replacing this identity
invalidates existing tokens.

After establishing the writer fence, create an empty destination Secret and
authorize it for the exact Helm release:

```bash
kubectl create secret generic "${SERVICE_AUTH_SECRET}" \
  --namespace "${RELEASE_NAMESPACE}"
kubectl annotate secret "${SERVICE_AUTH_SECRET}" \
  --namespace "${RELEASE_NAMESPACE}" \
  "osmo.nvidia.com/service-auth-db-migration-placeholder=${RELEASE_NAME}"
```

Configure external ownership and enable the migration only for the first
cutover phase:

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

The migration Job decrypts and copies the existing database-backed identity;
it does not generate or rotate one. The Job uses the configured MEK and
PostgreSQL credential references.

After the migration and every non-API configuration consumer are healthy,
perform a second deployment with the same configuration and images, API
enabled, and service-auth migration disabled:

```yaml
services:
  api:
    enabled: true

secrets:
  serviceAuth:
    migration:
      enabled: false
```

#### Translate OAuth and backend-token Secrets

Legacy OAuth proxy Secret paths are not accepted by the unified chart. The
client and cookie may still use the same Kubernetes Secret, but they have
separate typed references:

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

Preserve existing backend token Secrets. Each credential must select exactly
one existing or managed Secret source:

```yaml
secrets:
  backendApiTokens:
    enabled: true
    credentials:
    - name: primary
      existingSecret:
        name: existing-backend-token
```

Each token Secret contains `token` and may contain a distinct
`previous-token` during rotation.

### 2. Run the control-plane converter

Run `control_plane_values_convert.py` with the legacy service-chart values:

```bash
python3 deployments/upgrades/service_to_osmo_chart/control_plane_values_convert.py \
  legacy-values.yaml \
  --output control-plane-values.yaml
```

For split files, preserve their deployment order:

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
unified defaults that would otherwise introduce behavior absent from the
legacy release.

An enabled legacy `services.migration` becomes an enabled
`databaseMigration`. The converter maps its target schema, pgroll version,
image, node selector, tolerations, and resources. It deliberately diagnoses
legacy service-account, arbitrary annotation, injected environment, volume,
and init-container extensions because the unified migration Job obtains
PostgreSQL credentials and trust through typed fields and does not mount a
service-account token.

### 3. Complete the control-plane values

Add a final override only for information that cannot be recovered safely from
the legacy input.

#### External connections and TLS

Confirm the final values contain the actual external hosts, ports, database
names, usernames, and TLS policy. These often came from an injected whole-file
configuration rather than legacy Helm values:

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
    tls:
      enabled: true
      caExistingSecret: <PostgreSQL CA Secret>
      caKey: ca.crt
  valkey:
    host: <Valkey host>
    port: 6379
    database: 0
    tls:
      enabled: true
      caExistingSecret: <empty for a public CA, otherwise the CA Secret>
      caKey: ca-bundle.crt
```

Do not add a fallback object-storage endpoint when all three per-location
Secrets contain their endpoints. Leave all locations and S3 fields empty in
that case, as shown in the Secret-only example.

#### Database migration

For an unmigrated OSMO 6.3 database, the final first-phase values must enable
the bundled OSMO 6.4 migrations:

```yaml
databaseMigration:
  enabled: true
  targetSchema: public
```

The converter preserves an enabled legacy migration. If the legacy setting was
disabled, enable the unified migration after confirming the source schema. The
Job reads the same external PostgreSQL Secret and TLS settings as the
applications and runs before the service-auth migration and new API writers.

Use the migrations bundled in the selected OSMO 6.4 chart. Do not apply ad hoc
SQL for legacy empty-user data or historical role-constraint names. If the
bundled migration fails, stop with the writer fence intact and correct the
chart or source data deliberately.

Migration hooks are not a database rollback mechanism. Keep
`databaseMigration.enabled` set when services use a versioned target schema;
otherwise follow the chart's steady-state guidance after a successful upgrade.

#### Identity, gateway, and ownership settings

Complete the MEK, service-auth, OAuth, backend-token, and object-storage blocks
from the Secret preparation section. Also review:

- gateway Service ports still used by clients or in-cluster consumers;
- ingress and external TLS Secret references;
- generated internal TLS bootstrap and retained CA, trust, and leaf Secrets;
- cluster-scoped resource ownership;
- custom ServiceAccounts, RBAC, NetworkPolicies, and monitoring; and
- environment-specific hook annotations needed to order this release relative
  to resources outside the chart.

When generated internal TLS is used for the first time, enable initial
generation only for the transition:

```yaml
gateway:
  tls:
    generated:
      bootstrap:
        allowInitialGeneration: true
```

After the retained TLS Secrets exist and have been verified, set this value to
`false`. A missing retained CA must fail closed rather than be regenerated
during recovery.

### 4. Render and classify control-plane changes

Render both charts with their exact deployment layers:

```bash
helm template "${RELEASE_NAME}" deployments/charts/service \
  --namespace "${RELEASE_NAMESPACE}" \
  --values legacy-values.yaml \
  > /tmp/osmo-legacy-control.yaml

helm lint deployments/charts/osmo \
  --values control-plane-values.yaml \
  --values control-plane-overrides.yaml

helm template "${RELEASE_NAME}" deployments/charts/osmo \
  --namespace "${RELEASE_NAMESPACE}" \
  --values control-plane-values.yaml \
  --values control-plane-overrides.yaml \
  > /tmp/osmo-unified-control.yaml
```

Repeat `--values` for every legacy input when rendering the old chart. Compare
resources by kind, namespace, component, and behavior rather than YAML document
order or generated checksums.

Classify every object as retained, normally updated, renamed, recreated, or
removed. At minimum compare:

- names, namespaces, labels, immutable selectors, and ownership annotations;
- images, commands, arguments, environment, ports, and Services;
- Secret names, data keys, projected paths, mount paths, and rollout triggers;
- resources, replicas, HPAs, probes, disruption budgets, and scheduling;
- ServiceAccounts, Roles, ClusterRoles, and bindings;
- NetworkPolicies, ingress, monitoring, and TLS resources; and
- migration Jobs, annotations, ordering, retry behavior, and cleanup.

Several legacy control-plane Deployments may need recreation because the
unified chart changes immutable selectors. Review the gateway Envoy, agent,
delayed-job monitor, authorization, OAuth proxy, logger, MCP, router, UI, and
worker components. Derive the actual resource names from the rendered diff;
do not assume a fixed release prefix.

## Migrate a compute-plane release

### 1. Prepare and format compute-plane Secrets

The unified compute plane supports token authentication. Preserve the existing
backend token rather than issuing a new identity during the chart migration.

The Secret data format is unchanged:

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

The Secret must exist in the unified Helm release namespace. Both compute
agents continue to mount the selected key at
`/opt/osmo/secrets/token.txt`. Preserve any image-pull Secret selected through
`global.imagePullSecret`; it becomes an entry in `imagePullSecrets`.

Compute-only values intentionally disable control-plane Secret generation and
embedded dependencies. Keep the generated `secrets` block even though the
compute plane does not consume those control-plane credentials; omitting the
overrides can re-enable incompatible unified defaults or fail validation.

### 2. Run the compute-plane converter

Run `compute_values_convert.py` with the legacy backend chart values:

```bash
python3 deployments/upgrades/service_to_osmo_chart/compute_values_convert.py \
  --release-name "${RELEASE_NAME}" \
  --release-namespace "${AGENT_NAMESPACE}" \
  legacy-backend-values.yaml \
  --output compute-plane-values.yaml
```

`--release-name` preserves the legacy backend test-runner ServiceAccount name
when the test runner is enabled and `global.name` is unset.

The legacy chart can render agents into `global.agentNamespace` even when the
Helm release itself lives elsewhere. The unified chart renders agents into the
Helm release namespace. Set `--release-namespace` to the effective legacy
agent namespace and deploy the unified release there.

`global.backendNamespace` is the workflow namespace, not the agent namespace.
The converter maps it to `compute.workloadNamespace.name`. It separately
preserves `global.backendTestNamespace`.

Make `global.includeNamespaceUsage` explicit in the migration input before
running the converter. It may have been inherited only from a legacy chart
default. The converter writes it as
`--include_namespace_usage=...` under
`services.backendListener.extraArgs` and refuses to guess when it is absent.

If the backend test runner remains enabled, set
`global.backendTestNamespace`. Otherwise explicitly set
`backendTestRunner.enabled: false` in the migration input.

### 3. Complete the compute-plane values

Review the converted backend identity, control-plane endpoint, agent and
workload namespaces, token reference, images, pull policy, scheduling,
resources, probes, listener cache and API settings, worker progress interval,
RBAC, NetworkPolicy, monitoring, and test-runner configuration.

The following choices require cluster or environment knowledge and cannot be
made safely by the converter.

#### PriorityClass ownership

The fixed `osmo-high`, `osmo-normal`, and `osmo-low` PriorityClasses may be
consumed by many compute releases. Exactly one release or an external
administrator should own them:

```yaml
compute:
  priorityClasses:
    create: false
```

Set `create: true` only for the designated owning release. The converter
preserves the legacy value because it cannot identify the cluster owner.

#### Namespaces, RBAC, and NetworkPolicy

Confirm the established workflow namespace is retained rather than created or
renamed accidentally:

```yaml
compute:
  workloadNamespace:
    name: <existing workflow namespace>
    create: false
```

Review whether namespaced and cluster-scoped RBAC are owned by this release or
provided externally. Cross-namespace test-runner Roles and RoleBindings need
names that do not collide with other releases. The converter preserves custom
objects but does not rename them.

When `compute.workflowNetworkPolicy.enabled` is true, verify cluster CIDRs,
DNS, allowed namespaces, and additional egress rules against the target
cluster. This policy selects the workflow namespace, not only OSMO Pods.

### 4. Render and classify compute-plane changes

Render with the legacy release namespace and the unified agent namespace:

```bash
helm template "${RELEASE_NAME}" deployments/charts/backend-operator \
  --namespace "${LEGACY_RELEASE_NAMESPACE}" \
  --values legacy-backend-values.yaml \
  > /tmp/osmo-legacy-compute.yaml

helm lint deployments/charts/osmo \
  --values compute-plane-values.yaml \
  --values compute-plane-overrides.yaml

helm template "${RELEASE_NAME}" deployments/charts/osmo \
  --namespace "${AGENT_NAMESPACE}" \
  --values compute-plane-values.yaml \
  --values compute-plane-overrides.yaml \
  > /tmp/osmo-unified-compute.yaml
```

Compare listener, worker, test-runner, ServiceAccounts, RBAC, NetworkPolicy,
PriorityClasses, PodMonitors, token Secret projections, and namespaces.

Helm identifies a release by name and namespace. When the legacy Helm release
namespace differs from its agent namespace, installing the unified chart in
the agent namespace creates a separate Helm release even if its name is
unchanged. Treat this as replacement, not an in-place upgrade. Do not allow the
old and new releases to claim the same namespaced or cluster-scoped resources
concurrently.

## Deploy the unified release

The migration may use a full release replacement or a selective in-place
replacement. Downtime is expected in both cases.

A full replacement is often simpler: establish the writer fence, preserve all
external and retained state, remove the old chart-owned resources, and deploy
the unified release cleanly. Selective replacement is also valid when an
operator wants to retain normally updatable objects and recreate only those
with immutable-field conflicts.

Whichever method is selected:

1. Confirm PostgreSQL and every retained or externally managed Secret are
   protected from deletion.
2. Establish the legacy-writer fence.
3. Apply or reconcile externally managed Secrets.
4. Re-render the exact converted and manual value layers to be deployed.
5. Run the database, service-auth, and internal-TLS hooks in their required
   order.
6. Recreate resources whose immutable fields conflict with the unified
   manifests, or replace the release as a whole.
7. Wait for the unified workloads to become ready.
8. Review and remove remaining legacy resources.
9. Perform the verification and steady-state update below.

### Argo CD and other GitOps controllers

Put the complete migration values in the controller's source of truth. When an
Application is generated by an ApplicationSet or equivalent, change the
generator or template inputs rather than editing the generated child.

Pause automated reconciliation while establishing the writer fence and
reviewing the migration. Keep pruning enabled when it is part of the intended
deployment model, and prefer prune-last ordering so replacement resources can
be created before obsolete resources are removed when their names do not
conflict. Configure that ordering on the Application or its ApplicationSet
template:

```yaml
spec:
  syncPolicy:
    syncOptions:
    - PruneLast=true
```

Run the controller's normal synchronization first so pre-deployment migration
and bootstrap hooks can complete. Stop on the first hook failure and verify the
database version and destination Secrets without printing secret material.
For example, with Argo CD:

```bash
argocd app sync "${APPLICATION_NAME}" --prune
argocd app wait "${APPLICATION_NAME}" --operation --sync --health
```

For the workload transition, either:

- perform a full Application replacement, including Force or Replace semantics
  when that is the chosen migration method; or
- selectively delete and recreate only resources with immutable-field
  conflicts.

An Argo CD full replacement can be requested explicitly:

```bash
argocd app sync "${APPLICATION_NAME}" \
  --force \
  --replace \
  --prune
argocd app wait "${APPLICATION_NAME}" --operation --sync --health
```

A full replacement intentionally restarts every workload. Before using it,
confirm its deletion and prune set excludes externally owned Secrets, retained
identity and TLS Secrets, PVCs, Namespaces that must survive, and shared
cluster-scoped resources. Forced hook or RBAC creation may encounter a stale
object with the same name; inspect that object and either remove it deliberately
or retry with a normal synchronization after the replacement attempt.

After the unified resources are healthy, run a normal synchronization without
one-time replacement options. Review every remaining prune candidate, then
restore the installation's intended automated reconciliation policy.

For a compute release, verify the new listener and worker connect before
considering the migration complete. They do not need to overlap with the old
agents; an interval with no connected backend is acceptable during the
maintenance window.

### Direct Helm

Use Helm 3.19 or newer when generated internal TLS is enabled. Complete the
writer fence and Secret preparation before changing the Helm release.

For an in-place upgrade, keep the release name and namespace and delete
selector-incompatible resources immediately before `helm upgrade`:

```bash
helm upgrade --install "${RELEASE_NAME}" deployments/charts/osmo \
  --namespace "${RELEASE_NAMESPACE}" \
  --values converted-values.yaml \
  --values manual-overrides.yaml \
  --wait \
  --wait-for-jobs \
  --timeout 25m
```

A full uninstall and reinstall is also valid when downtime and complete
resource recreation are accepted. Before uninstalling, verify which resources
Helm will delete and separately protect the database, PVCs, Namespaces,
identity Secrets, credentials, TLS material, and shared cluster-scoped
resources. Reinstall with the intended release name and namespace so Secret
authorization and derived resource identities remain correct.

Do not treat `--atomic` as a database or external-Secret rollback plan.
Completed migrations and externally managed Secret updates survive a failed or
rolled-back Helm deployment. On failure, keep legacy writers stopped, correct
the cause, and retry or execute the explicit rollback procedure.

For a compute release, an in-place upgrade or full replacement causes a short
backend interruption. A separately named replacement release is optional when
operators want to validate it before deleting the old release. Before running
two releases concurrently, ensure they do not claim the same PriorityClasses,
fixed-name RBAC, test resources, or mutable Secrets.

## Verify and establish steady state

For a control-plane release, verify:

- the database-migration and service-auth migration Jobs completed;
- the deployed schema version is the intended OSMO 6.4 schema;
- the service-auth Secret contains the migrated identity and existing tokens
  remain valid;
- the retained MEK, TLS, OAuth, storage, and backend-token Secrets still exist;
- every enabled Deployment is available and every HPA targets the replacement
  workload;
- gateway health, ingress, API readiness, UI, and authentication;
- PostgreSQL and Valkey connectivity with the intended TLS policy;
- object-storage reads and writes for workflows, logs, and applications;
- workflow submission, scheduling, cancellation, logs, and data transfer; and
- router HTTP, WebSocket, exec, port-forward, and rsync paths.

For a compute-plane release, verify:

- listener and worker Deployments are available in the agent namespace;
- the backend reconnects with its existing identity;
- node, Pod, event, and heartbeat streams recover;
- workflow and test resources remain in their intended namespaces;
- the token Secret name, key, and `/opt/osmo/secrets/token.txt` mount are
  preserved;
- test-runner RBAC and templates remain usable; and
- a small workflow schedules and completes.

After verification:

1. Disable the one-time service-auth migration.
2. Disable initial internal-TLS generation after retained TLS state is proven.
3. Apply or synchronize the steady-state values without one-time replacement
   options.
4. Restore the intended automated reconciliation policy.
5. Confirm no unexplained legacy resources or prune candidates remain.

## Rollback

Preserve the legacy values, chart version, images, database backup, manifests,
and every identity and credential Secret until the rollback window closes.

A rollback may require more than restoring the old chart:

- keep all writers stopped while determining schema compatibility;
- restore PostgreSQL when the legacy binaries cannot use the migrated schema;
- restore the original MEK, service-auth identity, OAuth, TLS, storage, and
  backend-token Secrets;
- restore the legacy release name and namespace together;
- restore cluster-scoped ownership and namespaced RBAC deliberately; and
- verify authentication, workflows, logs, storage, and backend connectivity
  before reopening traffic.

Do not generate replacement identity material during rollback. If the original
database or identity Secret cannot be restored, stop and recover those inputs
before starting either chart.
