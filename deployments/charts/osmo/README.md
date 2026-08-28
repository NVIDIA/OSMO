<!--
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
-->

# OSMO Helm Chart

The `osmo` chart is the unified OSMO deployment entry point.

See the [profile matrix](profiles/README.md) for which values files are direct
development presets and which are base overlays requiring environment input.

The chart supports control-only, compute-only, and converged releases. It can
render backend listener and worker resources directly with the control services,
create a PostgreSQL Cluster through CloudNativePG, and deploy Valkey and RustFS.
Production profiles consume externally managed Kubernetes Secrets. The
self-contained kind profile uses retained in-cluster generation for development
credentials without Vault agent injection. The standalone `backend-operator`
chart remains available for existing two-chart installations, but it is not a
dependency of this chart.

## Quick start

The `quickstart.yaml` profile is a development-only path to trying the complete
OSMO browser, CLI, API, and CPU workflow experience in one converged release.
It installs:

- the Envoy gateway and browser UI;
- the API, worker, router, logger, agent, and delayed-job monitor;
- the compute backend listener and worker;
- persistent CloudNativePG, Valkey, and RustFS instances;
- generated development credentials, object-storage buckets, configuration,
  and a CPU-only default pool.

### Prerequisites

Use Kubernetes 1.30 or newer with enough capacity for the resources described
below. The cluster must have a default dynamic StorageClass. Install Helm,
`kubectl`, KAI Scheduler, and the CloudNativePG operator before OSMO. The
examples use the `kind-osmo` context; replace it if your development cluster has
a different context.

```bash
kubectl --context kind-osmo get storageclass

helm --kube-context kind-osmo upgrade --install kai-scheduler \
  https://github.com/NVIDIA/KAI-Scheduler/releases/download/v0.14.0/kai-scheduler-v0.14.0.tgz \
  --namespace kai-scheduler \
  --create-namespace \
  --wait \
  --timeout 10m

helm repo add cnpg https://cloudnative-pg.github.io/charts
helm repo update cnpg
helm --kube-context kind-osmo upgrade --install cnpg cnpg/cloudnative-pg \
  --version 0.29.0 \
  --namespace cnpg-system \
  --create-namespace \
  --wait \
  --timeout 10m
```

### Install OSMO

Install the unified chart with the single quick-start values file:

```bash
helm dependency build deployments/charts/osmo
helm --kube-context kind-osmo upgrade --install osmo deployments/charts/osmo \
  --namespace osmo \
  --create-namespace \
  --values deployments/charts/osmo/profiles/quickstart.yaml \
  --set-string compute.backendName=default \
  --wait \
  --timeout 20m
```

For prerelease OSMO images published below `nvcr.io/nvstaging/osmo`, set the
registry and repository defaults separately. The runtime init and client images
use the same location and tag:

```bash
helm --kube-context kind-osmo upgrade --install osmo deployments/charts/osmo \
  --namespace osmo \
  --create-namespace \
  --values deployments/charts/osmo/profiles/quickstart.yaml \
  --set-string compute.backendName=default \
  --set-string imageRegistry=nvcr.io \
  --set-string imageRepository=nvstaging/osmo \
  --set-string imageTag=2026.8.28.3b3d1b0a2.ecolter3910-amd64 \
  --set-string 'imagePullSecrets[0].name=osmo-nvcr-pull' \
  --wait \
  --timeout 20m
```

Inspect the release without reading generated Secret values:

```bash
kubectl --context kind-osmo --namespace osmo get pods,pvc,services,jobs
kubectl --context kind-osmo --namespace osmo get service osmo-gateway
```

### Open the UI and use the CLI

The gateway exposes the UI and API on NodePort `30080`. Set `OSMO_URL` from a
reachable node address, then open the same URL in a browser:

```bash
export OSMO_NODE_ADDRESS="$(kubectl --context kind-osmo get nodes \
  --output jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}')"
export OSMO_URL="http://${OSMO_NODE_ADDRESS}:30080"
curl --fail "$OSMO_URL/api/version"
```

For a kind cluster whose `extraPortMappings` maps container port `30080` to
host port `80`, use this URL instead:

```bash
export OSMO_URL=http://127.0.0.1
```

If the NodePort is not reachable from the workstation, run a port-forward in
one terminal:

```bash
kubectl --context kind-osmo --namespace osmo \
  port-forward service/osmo-gateway 8080:80
```

Then select the forwarded URL in the terminal where you use the CLI:

```bash
export OSMO_URL=http://127.0.0.1:8080
```

Install the CLI if needed, log in with the development identity, and submit the
canonical smoke workflow:

```bash
curl -fsSL https://raw.githubusercontent.com/NVIDIA/OSMO/refs/heads/main/install.sh | bash
osmo login "$OSMO_URL" --method=dev --username=testuser
osmo workflow submit deployments/workflows/verify-hello.yaml \
  --pool default \
  --format-type json
osmo workflow query <workflow-id> --format-type json
```

Repeat the query until the workflow status is `COMPLETED`.

### Troubleshooting and cleanup

If installation does not become ready, inspect pods, recent events, and the
UI. A `Pending` database, Valkey, or RustFS PVC usually means the cluster has no
working default StorageClass. A `Pending` workflow commonly means KAI is not
healthy or the cluster lacks the workflow capacity described below.

```bash
kubectl --context kind-osmo --namespace osmo get pods,pvc,jobs
kubectl --context kind-osmo --namespace osmo get events \
  --sort-by=.lastTimestamp
kubectl --context kind-osmo --namespace osmo logs deployment/osmo-ui
```

Clean up only the quick-start release and namespace:

```bash
helm --kube-context kind-osmo uninstall osmo --namespace osmo --wait
kubectl --context kind-osmo delete namespace osmo \
  --wait=true \
  --timeout=10m
```

### Capacity and limitations

The profile runs one replica of every required OSMO service, including the UI
and delayed-job monitor, and uses persistent volumes for PostgreSQL (1 GiB),
Valkey (512 MiB), and RustFS (1 GiB). PostgreSQL requests 1 CPU and 2 GiB, while
Valkey and RustFS each request 500 millicores and 1 GiB. The nine OSMO services
request 100 millicores and 256 MiB each, and the gateway requests 50 millicores
and 64 MiB. Those long-running pods reserve approximately 2.95 CPU and 6.4 GiB
before Kubernetes, KAI, and CloudNativePG operator overhead.

The canonical hello-world pod additionally requests 1 CPU, 1 GiB of memory, and
1 GiB of ephemeral storage for both its user container and its `osmo-ctrl`
container. Ensure an eligible worker has at least 2 CPU, 2 GiB of memory, and
2 GiB of ephemeral storage available for that workflow. The profile disables
MCP, optional gateway authentication and rate limiting, TLS, ingress,
monitoring, autoscaling, disruption budgets, backups, and HA behavior.

This profile uses development authentication and exposes an administrator
identity through a NodePort. It is not a production security or availability
configuration. Use a production profile with managed credentials, TLS,
authorization, backups, suitable resource sizing, and HA dependencies for
long-lived environments.

## Full kind development profile

The `kind-self-contained.yaml` profile is for development only. It expects an
existing cluster with KAI Scheduler installed. CloudNativePG is intentionally a
separate operator release; the unified `osmo` release owns its PostgreSQL
`Cluster`, Valkey, RustFS, control plane, and compute plane.

Install CloudNativePG first:

```bash
helm repo add cnpg https://cloudnative-pg.github.io/charts
helm repo update cnpg
helm --kube-context kind-osmo upgrade --install cnpg cnpg/cloudnative-pg \
  --version 0.29.0 \
  --namespace cnpg-system \
  --create-namespace \
  --wait \
  --timeout 10m
kubectl --context kind-osmo --namespace cnpg-system rollout status \
  deployment/cnpg-cloudnative-pg --timeout=10m
```

Install OSMO with one values file:

```bash
helm dependency build deployments/charts/osmo
helm --kube-context kind-osmo upgrade --install osmo deployments/charts/osmo \
  --namespace osmo \
  --create-namespace \
  --values deployments/charts/osmo/profiles/kind-self-contained.yaml \
  --set-string compute.backendName=default \
  --wait \
  --timeout 20m
```

Check the database, workloads, storage, and Services without reading Secret
values:

```bash
kubectl --context kind-osmo --namespace osmo wait \
  --for=condition=Ready cluster/osmo-pg --timeout=10m
kubectl --context kind-osmo --namespace osmo get pods,pvc,services,jobs
kubectl --context kind-osmo --namespace osmo get secret \
  osmo-backend-token osmo-master-encryption-key osmo-valkey-credentials \
  osmo-rustfs-credentials
```

In one terminal, forward the gateway:

```bash
kubectl --context kind-osmo --namespace osmo \
  port-forward service/osmo-gateway 8080:80
```

In another terminal, log in and submit the smoke workflow:

```bash
curl --fail http://127.0.0.1:8080/api/version
osmo login http://127.0.0.1:8080 --method=dev --username=testuser
osmo workflow submit deployments/workflows/verify-hello.yaml \
  --pool default \
  --format-type json
osmo workflow query <workflow-id> --format-type json
```

Repeat the query until the workflow status is `COMPLETED`. A `FAILED` or
`CANCELLED` status is an acceptance failure; inspect `osmo workflow logs` and
namespace events before retrying.

The profile creates the three object-storage buckets and wires their RustFS
endpoint and credential Secret into the control plane. It also creates a
retained backend token and master encryption key through pre-install hooks.
Those two secret values are generated inside Kubernetes and never appear in
Helm values, rendered manifests, logs, or Helm release state.

## Embedded PostgreSQL

Embedded PostgreSQL requires CloudNativePG chart `0.29.0` (operator `1.30.0`):

```bash
helm repo add cnpg https://cloudnative-pg.github.io/charts
helm upgrade --install cnpg cnpg/cloudnative-pg \
  --version 0.29.0 \
  --namespace cnpg-system \
  --create-namespace \
  --wait
```

Add the following PostgreSQL settings to the environment values used with the
`split-plane-control` profile:

```yaml
embeddedDependencies:
  postgresql:
    enabled: true

externalDependencies:
  postgresql:
    host: ''

secrets:
  postgresql:
    existingSecret: ''
```

Install the chart after the operator is Ready:

```bash
helm dependency build deployments/charts/osmo
helm upgrade --install osmo deployments/charts/osmo \
  --namespace osmo \
  --create-namespace \
  -f deployments/charts/osmo/profiles/split-plane-control.yaml \
  -f <environment-values.yaml> \
  --wait \
  --timeout 25m
```

The defaults create three PostgreSQL 16 instances with one 20 Gi
`ReadWriteOnce` PVC per instance, required hostname anti-affinity, a
PodDisruptionBudget, and synchronous replication to one standby. A generated
application Secret is wired into every OSMO PostgreSQL client automatically.
Leaving `postgresql.cluster.initdb.secret.name` empty lets CloudNativePG create
`<cluster>-app`.
Set `postgresql.cluster.storage.storageClass` when the cluster default is not
the desired durable StorageClass. See the
[CloudNativePG cluster chart](https://github.com/cloudnative-pg/charts/tree/cluster-v0.8.0/charts/cluster)
for additional `postgresql` values.

For resource-constrained development, explicitly relax the production settings:

```yaml
postgresql:
  cluster:
    instances: 1
    enablePDB: false
    postgresql:
      synchronous:
        number: 0
        dataDurability: preferred
```

## Install the control plane with external PostgreSQL

Create an environment values file containing the external endpoints and
Secret references:

```yaml
externalUrl: https://osmo.example.com

externalDependencies:
  postgresql:
    host: postgresql.example.com
    port: 5432
    database: osmo
    username: osmo
  valkey:
    host: valkey.example.com
    port: 6379
    database: 0
  objectStorage:
    endpoint: https://s3.example.com
    region: us-east-1
    buckets:
      workflows: osmo-workflows
      logs: osmo-logs
      apps: osmo-apps

secrets:
  postgresql:
    existingSecret: osmo-postgresql
  valkey:
    existingSecret: osmo-valkey
  objectStorage:
    existingSecret: osmo-object-storage
  masterEncryptionKey:
    existingSecret:
      name: osmo-master-encryption-key
      key: mek.yaml
```

Keep `embeddedDependencies.postgresql.enabled: false` (the default), then
install the chart by layering the environment values after the profile:

```bash
helm dependency build deployments/charts/osmo
helm upgrade --install osmo deployments/charts/osmo \
  --namespace osmo \
  --create-namespace \
  -f deployments/charts/osmo/profiles/split-plane-control.yaml \
  -f <environment-values.yaml> \
  --wait \
  --timeout 25m
```

## Install a split compute plane

The `split-plane-compute.yaml` profile installs only the backend listener,
worker, and their Kubernetes access. It does not render control services,
PostgreSQL, Valkey, RustFS, or credentials. Before installing, provision the
referenced Secret in the compute release namespace. Its `token` key must contain
the current 43- or 64-character URL-safe backend token; `previous-token` may
contain a distinct old token during rotation.

Copy the profile and replace its example `externalUrl` and
`compute.authentication.existingSecret` values, then install it with an
explicit backend name. Each compute release attached to the same control plane
must use a unique name.

```bash
helm dependency build deployments/charts/osmo
helm --kube-context <compute-context> upgrade --install osmo-compute \
  deployments/charts/osmo \
  --namespace osmo-compute \
  --create-namespace \
  --values <compute-values.yaml> \
  --set-string compute.backendName=<backend-name> \
  --wait \
  --timeout 10m
```

An empty `compute.workloadNamespace` resolves to the Helm release namespace.
This is the WDP-01/WDP-02 boundary: a compute-only release uses `externalUrl`
to reach the external control plane and consumes
`compute.authentication.existingSecret` from its release namespace. Change
`compute.authentication.tokenKey` when the token is stored under a non-default
Secret key. The release has no dependency on Vault-agent annotations or
control-plane workloads.

In a converged release, listener and worker instead use the release gateway
Service DNS and port. They start concurrently with the control plane and rely
on their normal connection retries rather than a chart-managed startup gate.
They do not hairpin through `externalUrl`; that value remains the public URL
used by clients and control-plane configuration.

## Embedded Valkey

Embedded Valkey is disabled by default. Enable it with retained generated
credentials as follows:

```yaml
embeddedDependencies:
  valkey:
    enabled: true

externalDependencies:
  valkey:
    host: ''

secrets:
  valkey:
    generate: true
    existingSecret: ''
```

The generated Secret and 8 GiB `ReadWriteOnce` PVC are retained on uninstall.
Back up both resources and restore the original Secret before reinstalling or
recovering the PVC. To supply an existing Secret instead, disable
`secrets.valkey.generate` and set both `secrets.valkey.existingSecret` and
`valkey.auth.usersExistingSecret` to its name. An existing Secret is recommended
for production and GitOps installations. Generated credentials are retained in
the Kubernetes Secret and Helm release history; restrict access to both and use
`--hide-secret` when previewing an install or upgrade.

The default standalone primary uses append-only persistence and a `Recreate`
upgrade strategy. Kubernetes restarts a failed primary and reattaches its PVC;
Valkey-backed OSMO operations are unavailable until it becomes Ready. Take a
storage snapshot before upgrades and follow the CSI provider's guidance for
volume expansion. Replication is available through
`valkey.replica.enabled=true`, but the primary remains fixed and is not
automatically failed over. Standalone and replication use different persistent
storage layouts. OSMO does not manage topology migrations, so review the
[official Valkey chart documentation](https://github.com/valkey-io/valkey-helm/tree/main/valkey#deployment-modes)
before changing `valkey.replica.enabled`. Use an external Valkey service for
automatic primary promotion, multi-zone failover, managed backups, or TLS.

To use external Valkey, keep `embeddedDependencies.valkey.enabled=false` and
configure `externalDependencies.valkey` and
`secrets.valkey.existingSecret` as shown in the installation example.

## Embedded RustFS object storage

Enable embedded object storage with retained generated credentials as follows:

```yaml
embeddedDependencies:
  objectStorage:
    enabled: true

externalDependencies:
  objectStorage:
    endpoint: ''
    buckets:
      workflows: ''
      logs: ''
      apps: ''

secrets:
  objectStorage:
    generate: true
    existingSecret: ''

rustfs:
  secret:
    existingSecret: osmo-rustfs-credentials
```

The chart deploys a standalone RustFS instance with a retained 10 GiB
`ReadWriteOnce` PVC. A post-install/post-upgrade Job creates the configured
workflow, log, and app buckets when they are absent. OSMO is configured with
the RustFS endpoint, buckets, and generated credentials automatically.

The generated `osmo-rustfs-credentials` Secret is retained on uninstall and
reused on upgrades. To provide an existing Secret, disable
`secrets.objectStorage.generate` and set both
`secrets.objectStorage.existingSecret` and
`rustfs.secret.existingSecret` to its name. The Secret must contain
`RUSTFS_ACCESS_KEY`, `RUSTFS_SECRET_KEY`, and `object-storage.yaml`; the
credentials in all three entries must match. Use a unique Secret name for each
OSMO release in the same namespace. Generated RustFS credentials are also
stored in Helm release history; restrict access to it and use `--hide-secret`
when previewing an install or upgrade.

For a distributed deployment, layer
[`embedded-rustfs-ha-values.yaml`](embedded-rustfs-ha-values.yaml) after the
environment values and provide the existing Secret referenced by that file.

To use external object storage, keep
`embeddedDependencies.objectStorage.enabled=false` and configure
`externalDependencies.objectStorage` and
`secrets.objectStorage.existingSecret` as shown in the installation example
above.

## Optional configuration

- Configure the OSMO image registry, base repository, and tag under
  `imageRegistry`, `imageRepository`, and `imageTag`; they default to
  `nvcr.io`, `nvidia/osmo`, and `latest`. A non-empty service-specific
  `image.registry`, `image.repository`, or `image.tag` takes precedence over
  the corresponding top-level value. Runtime workflow image fields under
  `runtimeImage` are optional overrides and inherit the matching top-level
  value when empty. Otherwise the chart uses `nvcr.io/nvidia/osmo` and the
  component name. The chart writes the resolved workflow images into the
  managed API configuration unless `configuration.workflow.backend_images`
  overrides them. Configure dependency images and pull credentials in their
  native values blocks; for example, Valkey uses `valkey.image` and
  `valkey.imagePullSecrets`.
- Configure replicas, autoscaling, resources, disruption budgets, scheduling,
  security contexts, probes, volumes, and ServiceAccounts under `services`,
  `gateway`, and `podDefaults`. Directly owned workload extensions use
  `extraEnv`, `extraArgs`, `extraVolumeMounts`, `pod.initContainers`,
  `pod.extraContainers`, and `pod.extraVolumes`. Configurable probes use an
  `enabled` switch and a raw Kubernetes probe under `spec`.
- Configure per-Service labels and annotations under each component's
  `service` block. Service ports and names that wire chart components together
  remain chart-managed.
- Configure compute-wide workflow namespace, backend identity, authentication
  Secret, RBAC, namespace-wide workflow network policy, and priority classes
  under `compute`.
  Listener, worker, and test-runner workload settings live under
  `services.backendListener`, `services.backendWorker`, and
  `services.backendTestRunner`.
- Enable Prometheus Operator PodMonitors independently with
  `monitoring.podMonitor.control.enabled` and
  `monitoring.podMonitor.compute.enabled`. Shared scrape settings apply to both
  planes and cover only OSMO-owned pods.
- Apply shared resource metadata to OSMO-owned resources with `commonLabels`
  and `commonAnnotations`. Component metadata overrides shared user metadata;
  chart-protected identity labels and annotations take final precedence.
  Configure dependency metadata in the dependency's native values block.
- Configure hook and init-container images with their image objects under
  `secrets.backendApiTokens.bootstrap.image`,
  `secrets.masterEncryptionKey.bootstrap.image`,
  `embeddedDependencies.objectStorage.bootstrap.image`, and
  `services.backendTestRunner.initContainer.image`. Digest references take
  precedence over tags, and all directly owned Pods use `imagePullSecrets`.
- Supply OSMO application configuration under `configuration`.

See [`values.yaml`](values.yaml) for the complete configuration reference.

## Compute resource ownership

Binary defaults are not duplicated as individual Helm values. Override
listener, worker, or test-runner command-line tuning with the component's
`extraArgs`. `services.backendListener.enableNodeLabelUpdate` remains explicit
because enabling it also grants the listener permission to patch Node labels.

`compute.rbac.create=false` disables all chart-owned compute Roles and
RoleBindings in the workflow and test namespaces. Cluster RBAC is controlled
separately. When namespaced RBAC is chart-owned but cluster policy is centrally
managed, set `compute.rbac.clusterRoles.create=false` and provide `listenerName`,
`workerName`, and, when the test runner is enabled, `testRunnerName` under
`compute.rbac.clusterRoles`. Chart-owned cluster RBAC names include a stable
hash of the Helm release namespace so equal release names in different
namespaces do not collide.

`compute.workflowNetworkPolicy` owns a namespace-wide egress policy for every
Pod in `compute.workloadNamespace`; it is not limited to OSMO Pods. Enabling it
requires one or more `clusterCIDRs`, unless
`allowAllClusterEgress=true` explicitly acknowledges unrestricted cluster
egress. Use `allowedNamespaces` and `additionalEgressRules` for environment
specific destinations.

`compute.priorityClasses.create` controls ownership of the fixed
`osmo-high`, `osmo-normal`, and `osmo-low` PriorityClasses consumed by workflow
Pods. Only one release in a cluster should create them; other compute releases
must set `create: false`.

## Secrets

The same Kubernetes Secret may satisfy several logical blocks, or each block
may reference a separate Secret. The defaults expect these keys:

| Values block | Default key | Consumer |
| --- | --- | --- |
| `secrets.postgresql` (external) | `db-password` | PostgreSQL clients |
| `secrets.valkey` | `redis-password` | Valkey clients |
| `secrets.objectStorage` | `object-storage.yaml` | Workflow data, logs, and apps |
| `secrets.masterEncryptionKey` | `mek.yaml` | OSMO encryption-key configuration |
| `secrets.backendApiTokens.credentials[]` | `token`, optional `previous-token` | Backend authentication |
| `secrets.defaultAdmin` | `password` | Optional administrator bootstrap |
| `secrets.oauthClientSecret` | `client_secret` | OAuth2 proxy client authentication |
| `secrets.oauthCookieSecret` | `cookie_secret` | OAuth2 proxy sessions |

Generated backend-token and MEK Secrets are intentionally retained because
replacing either can disconnect the compute plane or make encrypted database
fields unreadable. A release-owned, non-secret ConfigMap records the managed
backend-token Secret names so upgrades can create newly added credentials while
still failing when a retained credential disappears. Restore the original
Secret under the same name; do not generate a replacement against a retained
database. Back up the generated Valkey and RustFS Secrets with their PVCs for
the same reason.

`helm --kube-context kind-osmo uninstall osmo --namespace osmo` removes
release-owned workloads but does
not make retained credentials or data safe to discard. Inspect and back up
retained Secrets and PVCs before deleting the namespace. CloudNativePG database
retention follows the operator and cluster settings. Uninstall the CNPG operator
only after all managed PostgreSQL Clusters have been handled.

To use an existing embedded PostgreSQL credential Secret, provide a
`kubernetes.io/basic-auth` Secret whose `username` matches
`postgresql.cluster.initdb.owner`, then set:

```yaml
postgresql:
  cluster:
    initdb:
      secret:
        name: osmo-postgresql-credentials
```

The MEK is mounted through the typed
`secrets.masterEncryptionKey.existingSecret.{name,key}` reference. Use
`managementMode: external` for an operator-owned read-only Secret. Use
`managementMode: osmo` when this release should create and update that exact
Secret through explicitly requested lifecycle Jobs.

For a disposable install backed by a new database, enable `bootstrap`. Helm
renders no MEK Secret data. A namespace-scoped create-only lifecycle Job waits
for PostgreSQL, proves that the database has no users, UEKs, or dynamic
configuration, verifies that every chart consumer is blocked before its writer
container starts, and atomically creates the full Secret. Key material never
enters Helm output or release state. A retry accepts only the exact Secret owned
by this installation and authenticates the retained database before succeeding;
it never overwrites or deletes a Secret. Non-chart database writers must be
stopped for initial bootstrap.

After the bootstrap Job succeeds, commit and sync
`secrets.masterEncryptionKey.bootstrap.enabled: false`. This mandatory second
Helm/GitOps transaction removes bootstrap Secret-creation RBAC from desired
state. The chart rejects a rotation phase while bootstrap remains enabled.
If bootstrap fails or its database credentials are corrected under Argo CD or
Flux, increment the non-secret `bootstrap.attempt` before syncing again; this
creates a new immutable retry Job without deriving public names from credential
bytes.

Every consumer loads its keyring once at process startup. Before becoming
ready, it performs a bounded authenticated inventory of every UEK wrapper and
registered direct-MEK configuration value. It then logs one machine-readable
`OSMO_MEK_DESCRIPTOR` containing only the current key ID, loaded key IDs,
generation, and non-secret bundle digest. There are no MEK database tables,
triggers, polling loops, or hot reloads.

Rotation is an explicit three-phase operation. Use one unique request ID for
the whole rotation and keep every previous key in the Secret:

1. Set `rotation.phase=prepare`. The managed Job adds exactly one key and leaves
   `currentMek` unchanged. After the Job succeeds, clear the phase, change
   `rotation.rolloutRevision`, and sync again to roll every consumer.
2. Set `rotation.phase=activate`. The Job first verifies that the complete,
   Ready Pod cohort belongs to the expected Deployments and logged the PREPARE
   descriptor, then selects the new key. Clear the phase, change
   `rolloutRevision` again, and sync to perform the second rollout.
3. Set `rotation.phase=rewrap`. The Job verifies the ACTIVATE cohort, then
   compare-and-swap rewraps all UEKs and registered direct-MEK configuration
   from the beginning and runs two authenticated inventories. Clear the phase
   after success.

For example, the same values changes work with Helm upgrades or separate Argo
CD syncs:

```yaml
secrets:
  masterEncryptionKey:
    managementMode: osmo
    bootstrap:
      enabled: false
      attempt: "1" # increment only to retry a failed bootstrap
    rotation:
      requestId: rotate-2026-08-21
      phase: prepare       # then "", activate, "", rewrap, ""
      rolloutRevision: "1" # change to "2" after PREPARE and "3" after ACTIVATE
```

Each Job creates or reuses a release-scoped Kubernetes Lease directly. The
Lease is intentionally absent from Helm desired state, so GitOps self-heal
cannot clear a live holder. A Lease held by another attempt is never stolen,
even after its timestamp expires. If an attempt dies, delete its old Job/Pod,
verify it is gone, clear the Lease holder, increment `rotation.attempt`, and
retry the same phase. Jobs never delete Pods or patch Deployments; Helm or the
GitOps controller owns both rollouts. Clear a completed phase promptly so its
narrowly scoped ServiceAccount and RoleBinding leave the desired state.

In `managementMode=external`, the operator performs PREPARE and ACTIVATE by
updating the existing Secret, with one rollout after each update. Then set only
`rotation.phase=rewrap`. The rewrap Job has exact-name Secret `get` permission,
not `patch` or `update`, and enforces the same ACTIVATE Pod attestation before
touching ciphertext.

Rewrap completion is point-in-time evidence, not permission to remove an old
key. Because this design deliberately has no database write fence, all old MEKs
remain mandatory. User plaintext and UEK key material do not change; only their
encrypted wrappers change. Normal application reads never perform MEK rewrap
writes; the explicit Job is the sole orchestrator.

For an external Valkey endpoint signed by a public CA, enable
`externalDependencies.valkey.tls.enabled` and leave `caExistingSecret` empty to
use the image's system trust store. For a private CA, set `caExistingSecret` and
`caKey` in the same block. The selected key must contain the complete trust
bundle because clients use it through `SSL_CERT_FILE`. PostgreSQL private CAs
are also configured in its `externalDependencies` TLS block.

Secret references may share one Kubernetes Secret or use separate Secrets.
After rotating an external Secret, change its `rolloutNonce` to restart
consumers.

### OAuth credentials

OAuth client credentials are always operator-owned. The client and cookie may
share a Secret:

```yaml
secrets:
  oauthClientSecret:
    existingSecret: oauth2-proxy-secrets
    keys:
      value: client_secret
  oauthCookieSecret:
    existingSecret: oauth2-proxy-secrets
    keys:
      value: cookie_secret
```

For direct-Helm development only, set
`secrets.oauthCookieSecret.generate: true` and clear its `existingSecret`.
Production and GitOps installations must use an existing Secret because
generated values are stored in Helm release state.

Cookie rotation invalidates browser sessions and must not leave replicas using
different keys. Suspend the OAuth2 Proxy HPA, scale its Deployment to zero and
verify no matching nonterminal pods remain; then replace the Secret, update
`rolloutNonce`, complete the rollout, and restore autoscaling.

For upgrades from legacy OAuth values, move `secretName`, `clientSecretKey`, and
`cookieSecretKey` to the blocks above and remove `useKubernetesSecrets` and
`secretPaths`. Also remove unsupported `mountPath` fields from typed Secret
blocks; Helm schema errors identify any remaining legacy fields.

## Internal gateway TLS

`gateway.tls` protects internal Envoy-to-service traffic, not public ingress.

| Mode | Configuration |
| --- | --- |
| Development | `gateway.tls.generated.enabled: true` |
| Production | Set `generated.enabled: false`, `caSecret`, and every `upstreamCerts` Secret |

- Rotate leaves by changing `gateway.tls.generated.leafRotationNonce`.
- For CA rotation, freeze consumer HPAs and use one unique rotation ID through `prepare`, `activate`,
  `retire`, then `stable`. Wait after every phase. Before `retire`, verify every live leaf and consumer uses the activated CA.
  Unfreeze HPAs only after `stable` completes.
- On the first upgrade from process-local TLS, set
  `gateway.tls.generated.bootstrap.allowInitialGeneration=true` once, verify the
  retained Secrets, then set it back to `false`. Never use this flag to replace
  a missing retained CA; restore the original Secret instead.

## Exposure

Set `externalUrl` to the public URL clients use. The gateway can be exposed in
one of these ways:

- Keep `gateway.envoy.service.type: ClusterIP` for in-cluster access.
- Set `gateway.envoy.service.type: LoadBalancer` for a load balancer Service.
- Set `ingress.enabled: true` and configure `ingress.hostname`.
- Set `httproute.enabled: true` and configure `httproute.parentRefs` for an
  existing Gateway.

For local access to the default ClusterIP Service:

```bash
kubectl --context kind-osmo --namespace osmo \
  port-forward service/osmo-gateway 8080:80
curl http://127.0.0.1:8080/api/version
```
