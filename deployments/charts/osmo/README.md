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
to an external Valkey service. Object storage can use an external S3-compatible
service or the optional embedded RustFS dependency. The remaining Kubernetes
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
    existingSecret: osmo-master-encryption-key
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

## Embedded RustFS object storage

Embedded RustFS is disabled by default. RustFS and its Helm chart are pinned to
the prerelease `1.0.0-rc.2`, and upstream labels distributed mode as testing.
Treat both the standalone and distributed profiles as pre-production. The
four-node example below is an operations starting point, not a claim of HA or
production readiness. Approval under WDP-01 has not been established.

For a development install with retained generated credentials, add these
values after the `split-plane-control` profile and environment values:

```yaml
embeddedDependencies:
  objectStorage:
    enabled: true
    region: us-east-1
    buckets:
      workflows: osmo-workflows
      logs: osmo-logs
      apps: osmo-apps

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

The chart generates `osmo-rustfs-credentials` with all three required data
keys, retains it on uninstall, and reuses it on upgrades. Generated credentials
are visible to users who can read the Secret or Helm release history. Restrict
both and use `--hide-secret` when previewing an install or upgrade.

For GitOps, recovery, and the distributed example, create the Secret first.
`RUSTFS_ACCESS_KEY` and `RUSTFS_SECRET_KEY` must exactly match the values in
`object-storage.yaml`:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: osmo-rustfs-credentials
  namespace: osmo
type: Opaque
stringData:
  RUSTFS_ACCESS_KEY: replace-with-access-key
  RUSTFS_SECRET_KEY: replace-with-secret-key
  object-storage.yaml: |
    access_key_id: replace-with-access-key
    access_key: replace-with-secret-key
    addressing_style: path
```

Use these values with that Secret:

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
    generate: false
    existingSecret: osmo-rustfs-credentials

rustfs:
  secret:
    existingSecret: osmo-rustfs-credentials
```

The post-install/post-upgrade bootstrap Job waits for the S3 endpoint, then
creates the configured workflow, log, and app buckets if they are absent. It
does not recreate an existing bucket or delete objects. Bucket names and the
region are injected into OSMO configuration together with the internal RustFS
Service endpoint and `object-storage.yaml` Secret key.

### Standalone and distributed topology

The chart defaults to one standalone RustFS Deployment with one retained 10 GiB
`ReadWriteOnce` PVC. It uses a `Recreate` strategy, so object storage is
unavailable while the pod is replaced. Set `rustfs.storageclass.name` and
`rustfs.storageclass.dataStorageSize` before installation for the target CSI
driver and capacity.

The checked-in [`embedded-rustfs-ha-values.yaml`](embedded-rustfs-ha-values.yaml)
example creates a four-replica StatefulSet with one 100 GiB `standard`
`ReadWriteOnce` data volume per pod, required hostname anti-affinity, a
`maxUnavailable: 1` PodDisruptionBudget, pod-local endpoint injection, and
`EC:2` parity. Create the existing Secret above, then install it as the final
values layer:

```bash
helm dependency build deployments/charts/osmo
helm upgrade --install osmo deployments/charts/osmo \
  --namespace osmo \
  --create-namespace \
  -f deployments/charts/osmo/profiles/split-plane-control.yaml \
  -f <environment-values.yaml> \
  -f deployments/charts/osmo/embedded-rustfs-ha-values.yaml \
  --wait \
  --timeout 25m
```

For this four-drive `EC:2` layout, reads can tolerate two failed drives. Write
quorum means writes continue with only one node down; with two nodes down the
remaining data can still be readable but writes stop. A PDB covers voluntary
disruptions only, and hostname anti-affinity is only as useful as the available
nodes and underlying storage failure domains.

StatefulSet volume claim templates are immutable. Changing `drivesPerNode`,
the StorageClass, or requested sizes in values does not update an existing
StatefulSet and can be rejected by Kubernetes. Plan those fields before the
first install. Follow the CSI provider's documented PVC expansion procedure
when in-place expansion is supported; take a verified backup first.

### Expansion, backup, upgrade, and recovery

Expand distributed capacity with append-only server pools. Enable
`rustfs.pools`, keep the original pool as the first entry, and append new pools;
never reorder the list. After the new pool is Ready, run
`rc admin rebalance start <alias>` to redistribute existing data. Before any
pool removal, complete `rc admin decommission` for that pool and follow the
upstream removal procedure. Do not treat deleting a StatefulSet or its PVCs as
a capacity migration.

Erasure coding and replication are not backups. Back up object data to a
separate failure domain and back up the matching credential Secret. Define and
test restores before relying on the service. Restore the original Secret with
retained PVCs; a different access/secret-key pair can make the surviving data
unusable to OSMO. Snapshot consistency and volume restore steps are specific to
the CSI provider.

Upgrade the RustFS chart and image together. Before upgrading, read the RustFS
release notes, verify backups and restore instructions, and confirm the pinned
chart and image provenance. Allow the StatefulSet to replace one pod at a time
and wait for each pod's `/health/ready` endpoint before continuing. Also wait
for the bucket-bootstrap Job and OSMO workloads. A Helm rollback may be
unsupported after an on-disk format or cryptographic-format change; in that
case restore the prior version and data from a tested backup instead of forcing
a rollback.

For one failed node, preserve its PVC and let Kubernetes reattach it or replace
the failed infrastructure according to the storage provider's procedure. Do
not intentionally take a second node down while writes are required. For
multiple failures, stop changes, determine read/write quorum, preserve all
remaining volumes and the credential Secret, and use RustFS's documented admin
recovery procedure. The install notes provide the effective endpoint and this
readiness inventory command:

```bash
kubectl get deployment,statefulset,pod,pvc,job --namespace osmo
```

The embedded endpoint is plain HTTP and is not exposed by RustFS Ingress or
Gateway API. Use cluster network controls to restrict it to OSMO and operator
traffic. The OSMO example does not configure RustFS TLS, mTLS, or a
NetworkPolicy; validate those controls separately before use across untrusted
networks. Prefer an external S3 service when managed TLS, multi-zone durability,
backups, lifecycle policy, or a supported production SLA is required.

Private registries are configured in the dependency's native values, not
`imageRegistry`: use `rustfs.image.rustfs.repository` and `.tag`,
`rustfs.image.initImage.repository` and `.tag`, and `rustfs.imagePullSecrets`.
Keep the RustFS tag in `tag@sha256` form when mirroring because the upstream
chart has no first-class image digest fields. Override the bootstrap image with
`embeddedDependencies.objectStorage.bootstrap.image`, also using a digest.

### RustFS provenance and licensing

- The dependency chart and release are `1.0.0-rc.2`. The fetched chart archive
  has SHA-256 digest
  `c26cb094bc9735d01548ee540d018c1d88e2038bfd27ddc330770f5d525e63eb`.
  The chart repository/archive is unsigned, so the digest detects unexpected
  bytes but does not establish publisher identity.
- The [`rustfs/rustfs`](https://github.com/rustfs/rustfs) and
  [`rustfs/helm`](https://github.com/rustfs/helm) repositories are
  Apache-2.0 licensed.
- The RustFS multi-architecture manifest is pinned as
  `sha256:7d6d361c49c08d427250fb59aae5d78df83d644c3405d9ccf4b21cda0b0692d0`,
  includes amd64 and arm64 images, and has attestations. OSMO uses the
  chart-compatible `1.0.0-rc.2@sha256:...` tag value because neither the chart
  nor its image values expose a first-class digest field.
- The init image is BusyBox, licensed GPL-2.0. Distributing or mirroring it
  carries the corresponding GPL source-availability obligations; retain the
  license notices and provide corresponding source as required.

### External S3 fallback

To return to external object storage, set
`embeddedDependencies.objectStorage.enabled=false`, configure the HTTPS
endpoint, region, and three named buckets under
`externalDependencies.objectStorage`, and set
`secrets.objectStorage.existingSecret` to a Secret containing
`object-storage.yaml`. The external Secret needs the OSMO SDK configuration;
it does not need the two RustFS environment keys. Verify data migration and
bucket contents independently before disabling or removing embedded storage.

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

When an external PostgreSQL or Valkey service uses a private CA, enable TLS in
the matching `externalDependencies` block and reference the CA Secret there.
The Valkey `caKey` must hold a complete PEM trust bundle, including the public
or system roots used by other HTTPS endpoints; OSMO's Python services consume
that bundle through `SSL_CERT_FILE`. The default Valkey key is `ca-bundle.crt`.

For an external Valkey endpoint signed by a public CA, leave
`caExistingSecret` empty to use the image's system trust store.

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
