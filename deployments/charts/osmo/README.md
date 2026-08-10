<!--
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
-->

# OSMO Helm Chart

The `osmo` chart is the unified OSMO deployment entry point.

The chart currently deploys the OSMO control-plane services and gateway, with
an optional embedded Valkey dependency. Compute-plane workloads and other
dependencies will be added in future work.

## Install the control plane

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

Install the chart by layering the environment values after the profile:

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
include the official `valkey/valkey` chart version `0.11.0`.

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
`valkey.auth.usersExistingSecret` to its name.

The default standalone primary uses append-only persistence and a `Recreate`
upgrade strategy. Kubernetes restarts a failed primary and reattaches its PVC;
Valkey-backed OSMO operations are unavailable until it becomes Ready. Take a
storage snapshot before upgrades and follow the CSI provider's guidance for
volume expansion. Replication is available through
`valkey.replica.enabled=true`, but the primary remains fixed and is not
automatically failed over. Choose the topology before initial installation;
changing between standalone and replication requires a planned data migration
because the two modes use different PVCs. Use an external Valkey service for
automatic primary promotion, multi-zone failover, managed backups, or TLS.

To use external Valkey, keep `embeddedDependencies.valkey.enabled=false` and
configure `externalDependencies.valkey` and
`secrets.valkey.existingSecret` as shown in the installation example.

## Optional configuration

- Configure component images and registry credentials under `global`,
  `runtimeImage`, and each component's `image` block.
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
| `secrets.postgresql` | `db-password` | PostgreSQL clients |
| `secrets.valkey` | `redis-password` | Valkey clients |
| `secrets.objectStorage` | `object-storage.yaml` | Workflow data, logs, and apps |
| `secrets.masterEncryptionKey` | `mek.yaml` | OSMO encryption-key configuration |

For PostgreSQL or Valkey private CAs, enable TLS in the corresponding
`externalDependencies` block and reference the CA Secret there. A Valkey
`caKey` must contain the complete trust bundle; its default is
`ca-bundle.crt`.

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
