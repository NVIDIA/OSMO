<!--
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
-->

# OSMO Helm Chart

The `osmo` chart is the unified OSMO deployment entry point.

The supported `split-plane-control` profile installs the API, UI, router,
worker, logger, agent, delayed-job monitor, and standalone OSMO gateway. It
can create a persistent PostgreSQL cluster through CloudNativePG or connect to
an external PostgreSQL service, and it can deploy embedded Valkey or connect
to an external Valkey service. Object storage and the remaining Kubernetes
Secrets are externally managed. Compute-plane workloads and the other embedded
dependencies remain future work.

## Embedded PostgreSQL

Embedded PostgreSQL requires CloudNativePG chart `0.29.0` (operator `1.30.0`):

```bash
helm repo add cnpg https://cloudnative-pg.github.io/charts
helm upgrade --install osmo-cnpg cnpg/cloudnative-pg \
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

## Optional configuration

- Configure the OSMO image registry under `imageRegistry`, pull credentials
  under `imagePullSecrets`, and component images under `runtimeImage` and each
  component's `image` block. Configure dependency images and pull credentials
  in their native values blocks; for example, Valkey uses `valkey.image` and
  `valkey.imagePullSecrets`.
- Configure replicas, autoscaling, resources, disruption budgets, scheduling,
  security contexts, probes, volumes, and ServiceAccounts under `services`,
  `gateway`, and `podDefaults`.
- Enable Prometheus Operator PodMonitors with `monitoring.podMonitor.enabled`.
- Apply shared resource metadata to OSMO-owned resources with `commonLabels`
  and `commonAnnotations`; configure dependency metadata under `valkey`.
- Supply OSMO application configuration under `configuration`.

See [`values.yaml`](values.yaml) for the complete configuration reference.

## Secrets

The same Kubernetes Secret may satisfy several logical blocks, or each block
may reference a separate Secret. The defaults expect these keys:

| Values block | Default key | Consumer |
| --- | --- | --- |
| `secrets.postgresql` (external) | `db-password` | PostgreSQL clients |
| `secrets.valkey` | `redis-password` | Valkey clients |
| `secrets.objectStorage` | `object-storage.yaml` | Workflow data, logs, and apps |
| `secrets.masterEncryptionKey` | `mek.yaml` | OSMO encryption-key configuration |

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
`secrets.masterEncryptionKey.existingSecret.{name,key}` reference. Production
installs should create and manage that Secret outside Helm. For a disposable
test install backed by a new, empty database, set
`secrets.masterEncryptionKey.bootstrap.enabled=true`; a
pre-install hook generates the initial 256-bit key inside Kubernetes and creates
the named Secret only when it is absent. It never renders key material into
Helm output or release state, preserves an existing Secret, and fails an
upgrade if the Secret was deleted rather than generating an incompatible key.
The bootstrap Secret persists after uninstall and requires explicit cleanup. A
Helm install or different release name can still point at retained database
data. In that case, restore the MEK that encrypted the data; do not enable
bootstrap to generate a replacement.
If the bootstrap workload cannot start or complete, Helm removes the complete
privileged hook resource set. A sanitized recovery ConfigMap remains for
diagnosis and is removed automatically after a successful retry.

Rotate the Secret with two separate updates: add the new JWK while leaving `currentMek`
unchanged, verify every live pod's `MEK consumer status` log lists the new key,
then change only `currentMek`. Per-Pod-UID state is also stored in
`public.mek_consumer_status`, and a pod that skipped the projected PREPARE
revision can activate only an exact fingerprint already registered by another
consumer. Existing UEK key material is preserved
while its wrapper is moved to the active MEK; direct-MEK dynamic-config
ciphertext is re-encrypted in bounded, durably checkpointed background batches.
Keep previous MEKs in the Secret.
This release rejects MEK removal because it cannot yet prove retirement across
all HA writers. OSMO does not mutate the Secret after bootstrap. Reconciliation progress and
blockers appear in service logs as `MEK reconciliation status` records.

For the first upgrade of an existing database to the MEK registry, stop every
legacy control-plane writer before starting the new release. Scale the OSMO
Deployments to zero, perform the Helm upgrade with
`--set secrets.masterEncryptionKey.allowExistingCiphertextAdoption=true`, wait
for all new Deployments to become ready, and immediately upgrade the value back
to `false`. The flag is unnecessary on a fresh install and is rejected as an
implicit migration: without it, first adoption fails when authenticated
ciphertext already exists. During adoption PostgreSQL also fences UEK/config
writes, so a legacy write already in flight is rolled back rather than landing
after the authenticated scan.

```bash
set -euo pipefail
MEK_SELECTOR='app.kubernetes.io/instance=<release>,app.kubernetes.io/component in (api,worker,router,logger,agent,delayed-job-monitor)'
kubectl delete horizontalpodautoscaler -n <namespace> \
  -l "$MEK_SELECTOR" --ignore-not-found
kubectl scale deployment -n <namespace> \
  -l "$MEK_SELECTOR" --replicas=0
kubectl wait pod -n <namespace> -l "$MEK_SELECTOR" \
  --for=delete --timeout=10m
remaining=$(kubectl get pod -n <namespace> -l "$MEK_SELECTOR" \
  --field-selector='status.phase!=Succeeded,status.phase!=Failed' -o name)
test -z "$remaining"
helm upgrade <release> deployments/charts/osmo -n <namespace> \
  --reuse-values --wait \
  --set secrets.masterEncryptionKey.allowExistingCiphertextAdoption=true
# After every new Deployment is Ready:
helm upgrade <release> deployments/charts/osmo -n <namespace> \
  --reuse-values --wait \
  --set secrets.masterEncryptionKey.allowExistingCiphertextAdoption=false
```

For an external Valkey endpoint signed by a public CA, enable
`externalDependencies.valkey.tls.enabled` and leave `caExistingSecret` empty to
use the image's system trust store. For a private CA, set `caExistingSecret` and
`caKey` in the same block. The selected key must contain the complete trust
bundle because clients use it through `SSL_CERT_FILE`. PostgreSQL private CAs
are also configured in its `externalDependencies` TLS block.

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
kubectl --namespace osmo port-forward service/osmo-gateway 8080:80
curl http://127.0.0.1:8080/api/version
```
