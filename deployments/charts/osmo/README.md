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
to an external Valkey service. S3-compatible object storage can be provided by
embedded SeaweedFS or an external service. The remaining Kubernetes Secrets
are externally managed. Compute-plane workloads and the other embedded
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
helm repo add seaweedfs https://seaweedfs.github.io/seaweedfs/helm
helm dependency build deployments/charts/osmo
helm upgrade --install osmo deployments/charts/osmo \
  --namespace osmo \
  --create-namespace \
  -f deployments/charts/osmo/profiles/split-plane-control.yaml \
  -f <environment-values.yaml> \
  --wait \
  --timeout 25m
```

The dependency build is only needed for a source checkout. Packaged charts
include the official `valkey/valkey` chart version `0.11.0`, CloudNativePG
cluster chart version `0.8.0`, and SeaweedFS chart version `4.41.0`.

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
  `valkey.imagePullSecrets`, while SeaweedFS uses `seaweedfs.image` and
  `seaweedfs.global.imagePullSecrets`.
- Configure replicas, autoscaling, resources, disruption budgets, scheduling,
  security contexts, probes, volumes, and ServiceAccounts under `services`,
  `gateway`, and `podDefaults`.
- Enable Prometheus Operator PodMonitors with `monitoring.podMonitor.enabled`.
- Apply shared resource metadata to OSMO-owned resources with `commonLabels`
  and `commonAnnotations`; configure dependency metadata under `valkey` and
  `seaweedfs`.
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

The chart does not mutate or delete referenced existing Secrets. Generated
embedded credentials follow the retained dependency-specific behavior
described below.

## Embedded S3-compatible storage

The chart pins SeaweedFS chart `4.41.0` (SeaweedFS `4.41`) from the
project-owned Helm repository. SeaweedFS is disabled by default. To replace
only the external object-storage dependency, layer this over the control-plane
values:

```yaml
embeddedDependencies:
  objectStorage:
    enabled: true

secrets:
  objectStorage:
    generate: true
    existingSecret: ''

# Make this unique if more than one release shares a namespace.
seaweedfs:
  global:
    seaweedfs:
      serviceAccountName: osmo-seaweedfs
```

The PostgreSQL, Valkey, master-encryption-key, `externalUrl`, and component
image values are still required. The external object-storage endpoint and
bucket values are ignored in this mode. Enabling the dependency provisions a `10Gi`
`ReadWriteOnce` PVC, starts the all-in-one S3 endpoint, creates
`osmo-workflows`, `osmo-logs`, and `osmo-apps` idempotently, and configures
OSMO to use the release-scoped in-cluster endpoint. Override
`seaweedfs.allInOne.data.size` and `storageClass` before installation when the
cluster default is unsuitable. Bucket names can be changed in
`seaweedfs.allInOne.s3.createBuckets`; keep the workflows, logs, apps order.

SeaweedFS's native retained pre-install/pre-upgrade hook creates
`<release>-seaweedfs-s3-secret` with the S3 identity. A later least-privilege
OSMO hook reads that native admin identity and synchronizes
`<release>-object-storage-credentials`, which contains the
`object-storage.yaml` file expected by OSMO. SeaweedFS remains the credential
source of truth; the derived OSMO Secret can be recreated from it. The native
Secret and PVC are retained after `helm uninstall`. Back up the native Secret
with the PVC, restrict access to Helm release history, and use `--hide-secret`
when previewing an install or upgrade.

To supply credentials instead, create one Secret with both keys below:

| Key | Content |
| --- | --- |
| `object-storage.yaml` | YAML containing `access_key_id`, `access_key`, and `addressing_style: path` |
| `seaweedfs_s3_config` | SeaweedFS S3 identity JSON granting the matching identity `Admin`, `Read`, and `Write` |

Then configure the same Secret in the parent and dependency values:

```yaml
embeddedDependencies:
  objectStorage:
    enabled: true
secrets:
  objectStorage:
    generate: false
    existingSecret: osmo-seaweedfs-s3
seaweedfs:
  s3:
    existingConfigSecret: osmo-seaweedfs-s3
```

The chart rejects mismatched names because OSMO and SeaweedFS must read the
same identity. Existing Secrets are never created, changed, or deleted by the
chart.

### Availability, data protection, and scaling

The default all-in-one topology is persistent but **not highly available**.
It uses one pod and a `Recreate` update strategy. Do not increase
`allInOne.replicas` on a `ReadWriteOnce` volume; use the distributed topology
instead.

[`embedded-seaweedfs-ha-values.yaml`](embedded-seaweedfs-ha-values.yaml) is a
render-tested production-oriented starting point. It uses three masters,
three persistent volume servers, two filers, two S3 gateways, pod
anti-affinity, and `001` data replication. Multiple filers require one shared
metadata database; the example disables local LevelDB and references an
operator-managed PostgreSQL database and Secret. Replace every storage class,
capacity, endpoint, Secret name, and service-account name for the target
cluster. For zone failure protection, define named `seaweedfs.volumes` groups
with explicit `dataCenter`/`rack` placement and choose a replication policy
that places copies across those failure domains. Replica counts without a
matching replication policy do not protect object data.

Before production use:

- size master, volume, filer, S3, and PostgreSQL resources from load tests;
- use failure-domain-aware persistent volumes and confirm anti-affinity can be
  scheduled on the available nodes;
- back up the filer PostgreSQL database, SeaweedFS master metadata, object
  data, and the S3 credential Secret on the same recovery schedule;
- enable bucket versioning/object lock in `createBuckets` when the retention
  model requires it, understanding that object lock is irreversible;
- enable SeaweedFS transport security and namespace network policy when the
  cluster does not provide an equivalent trusted service network; and
- run restore and node-loss drills before relying on replication as data
  protection.

Scale volume servers by adding failure-domain-aware replicas or named volume
groups, then allow SeaweedFS to rebalance data. Scale stateless S3 gateways
independently. Scale filers only after configuring a shared metadata store.
Keep an odd number of masters and change master membership deliberately; do
not simply remove a quorum member and its PVC.

For upgrades, first back up metadata, data, and credentials; render the new
chart against current values; review upstream SeaweedFS release notes; and
upgrade one pinned dependency version at a time. Confirm master quorum, volume
replication, filer health, bucket access, and OSMO API health before removing
old replicas or backups. A normal pod failure is recovered by Kubernetes using
the same PVC. For a lost volume/PVC, replace capacity and let a healthy replica
restore data before reducing redundancy. For filer database loss, restore the
shared metadata database before accepting writes. For total loss, restore
credentials and metadata first, then object data, and validate all three OSMO
buckets.

### Provenance

The dependency comes from the SeaweedFS project-owned Helm repository and is
Apache-2.0 licensed. The upstream chart is not signed, and it selects the
multi-architecture `chrislusf/seaweedfs:4.41` image by tag rather than digest.
Mirror and scan the chart and image when organizational supply-chain policy
requires it.

## External S3-compatible storage

To disable embedded storage, keep
`embeddedDependencies.objectStorage.enabled: false`, configure
`externalDependencies.objectStorage`, and reference an existing
`secrets.objectStorage.existingSecret` containing `object-storage.yaml`. No
SeaweedFS Deployment, StatefulSet, Service, PVC, RBAC, or hook is rendered.

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
