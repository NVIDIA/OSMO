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

## CloudNativePG prerequisite

Embedded PostgreSQL requires the official CloudNativePG operator and CRDs.
Install the pinned, Apache-2.0 CloudNativePG operator chart once per Kubernetes
cluster before installing OSMO. The operator watches OSMO namespaces but has a
separate Helm lifecycle:

```bash
helm repo add cnpg https://cloudnative-pg.github.io/charts
helm repo update cnpg
helm upgrade --install osmo-cnpg cnpg/cloudnative-pg \
  --version 0.29.0 \
  --namespace cnpg-system \
  --create-namespace \
  --wait
```

The OSMO chart vendors the official CloudNativePG `cluster` chart at version
`0.8.0`, which creates a `Cluster` custom resource. It does not install or
upgrade the operator. The default PostgreSQL 16 image is obtained from the
CloudNativePG project on GHCR. Confirm that the operator and database images
are mirrored or pullable in restricted environments.

## Installation with embedded PostgreSQL

Enable the dependency in the same environment values file used for OSMO:

```yaml
embeddedDependencies:
  postgresql:
    enabled: true

externalUrl: https://osmo.example.com

externalDependencies:
  postgresql:
    host: ''
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
    generate: true
    existingSecret: ''
  valkey:
    existingSecret: osmo-valkey
  objectStorage:
    existingSecret: osmo-object-storage
  masterEncryptionKey:
    existingSecret: osmo-master-encryption-key
```

Install OSMO after the operator is Ready:

```bash
helm upgrade --install osmo deployments/charts/osmo \
  --namespace osmo \
  --create-namespace \
  -f deployments/charts/osmo/profiles/split-plane-control.yaml \
  -f <environment-values.yaml> \
  --wait \
  --timeout 25m
```

The production defaults create three PostgreSQL 16 instances. Each instance
has its own 20 Gi `ReadWriteOnce` PVC, using the cluster's default StorageClass,
and requests and limits one CPU and 2 Gi memory for Guaranteed QoS. Override
`postgresql.cluster.storage.storageClass` when the default class is not the
durable storage class intended for database data. Separate WAL storage is
available through `postgresql.cluster.walStorage`, but is disabled by default.

OSMO connects only to the stable `<release>-postgresql-rw` service. CNPG
creates the application credential Secret (normally
`<release>-postgresql-app`) and CA Secret, and OSMO uses certificate
verification for every database connection. The generated database and owner
are both `osmo` by default.

## High availability and operations

The production defaults spread instances by `kubernetes.io/hostname`, enable a
PodDisruptionBudget, and require quorum-based synchronous replication with
`ANY 1`: a commit must be acknowledged by one standby. CNPG performs automatic
failover and uses an unsupervised switchover when updating the primary. Loss of
the primary should therefore promote a healthy standby; loss of enough
instances to satisfy the synchronous requirement intentionally stops writes
rather than acknowledging data that has not reached a standby.

Inspect the cluster and its persistent storage with:

```bash
kubectl --namespace osmo get clusters.postgresql.cnpg.io,pods,pvc,pdb
kubectl --namespace osmo describe cluster osmo-postgresql
```

To exercise recovery in a non-production environment, record the current
primary, delete that Pod, and wait for the cluster to report three Ready
instances again:

```bash
primary=$(kubectl --namespace osmo get cluster osmo-postgresql \
  -o jsonpath='{.status.currentPrimary}')
kubectl --namespace osmo delete pod "$primary"
kubectl --namespace osmo wait pod \
  --for=condition=Ready \
  --selector=cnpg.io/cluster=osmo-postgresql \
  --timeout=10m
```

Scale by changing `postgresql.cluster.instances` and running `helm upgrade`.
Add nodes/topology domains before scaling up so anti-affinity can place the new
instances. Before scaling down, verify replication health and confirm that the
PVCs selected for removal contain no uniquely required data.

Routine image changes within the configured PostgreSQL major version roll
through replicas and finish with a primary switchover. Upgrade the
CloudNativePG operator using its own pinned Helm release, review its supported
upgrade path, and wait for it to become Ready before upgrading OSMO. A
PostgreSQL major-version change is a data migration, not a routine image
upgrade; create and validate a migration/recovery plan first.

PVCs preserve data across Pod replacement. They are not backups, and deleting
the CNPG `Cluster` (including through `helm uninstall`) can delete its owned
PVCs. Embedded backup, restore, and point-in-time recovery configuration is
deliberately rejected in this chart and is tracked by
[OSMO-6609](https://jirasw.nvidia.com/browse/OSMO-6609). Do not use embedded
PostgreSQL for production data until an independent, tested backup and restore
procedure is in place.

For resource-constrained development only, a single instance can be rendered
by explicitly relaxing durability and disabling the PDB:

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

This is not a highly available or production-ready configuration.

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
    generate: false
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

The dependency build is only needed for a source checkout. Packaged charts
include the official Valkey chart version `0.11.0` and CloudNativePG cluster
chart version `0.8.0`.

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

For an existing embedded PostgreSQL credential, CNPG requires a
`kubernetes.io/basic-auth` Secret with `username` and `password` keys. The
username must match `postgresql.cluster.initdb.owner`. Set both OSMO references
to the same Secret:

```yaml
secrets:
  postgresql:
    generate: false
    existingSecret: osmo-postgresql-credentials
    keys:
      username: username
      password: password
postgresql:
  cluster:
    initdb:
      database: osmo
      owner: osmo
      secret:
        name: osmo-postgresql-credentials
```

Except for the generated CNPG application credentials, the chart only reads
operator-owned Secrets. It does not mutate or delete external Secrets. When an
external PostgreSQL or Valkey service uses a private CA, enable TLS in the
matching `externalDependencies` block and reference the CA Secret there. The
Valkey `caKey` must hold a complete PEM trust bundle, including the public or
system roots used by other HTTPS endpoints; OSMO's Python services consume that
bundle through `SSL_CERT_FILE`. The default Valkey key is `ca-bundle.crt`.

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
