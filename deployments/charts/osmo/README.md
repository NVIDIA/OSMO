<!--
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
-->

# OSMO Helm Chart

The `osmo` chart is the unified OSMO deployment entry point. This initial
version directly owns the control-plane service and gateway templates. It does
not depend on the legacy `service` chart.

The supported `split-plane-control` profile installs the API, UI, router,
worker, logger, agent, delayed-job monitor, and standalone OSMO gateway. It
uses operator-managed PostgreSQL, Valkey, object storage, and Kubernetes
Secrets. Compute-plane workloads, embedded dependencies, generated Secrets,
Gateway API exposure, and Ingress exposure are rejected until implemented.

## Values layout

- `planes` selects the OSMO plane.
- `embeddedDependencies` selects chart-owned supporting systems.
- `externalDependencies` contains typed connection information.
- `services` configures OSMO application services.
- `gateway` configures Envoy and gateway-adjacent services.
- `exposure` describes the public URL and edge ownership.
- `secrets` contains typed references to operator-owned Kubernetes Secrets.
- `configuration` contains shared OSMO domain configuration.
- `image`, `imagePullSecrets`, `commonLabels`, `commonAnnotations`, and
  `podDefaults` provide shared workload defaults.

Service images inherit the top-level registry, repository prefix, tag, and
pull policy. A component can override these beneath its own `image` block.
Maps merge with shared defaults and component lists replace inherited lists.

## Control-plane installation

Create an environment values file containing the external endpoints and
Secret references:

```yaml
exposure:
  mode: external
  baseUrl: https://osmo.example.com

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
helm upgrade --install osmo deployments/charts/osmo \
  --namespace osmo \
  --create-namespace \
  -f deployments/charts/osmo/profiles/split-plane-control.yaml \
  -f <environment-values.yaml> \
  --wait \
  --timeout 25m
```

## Existing Secret contract

The same Kubernetes Secret may satisfy several logical blocks, or each block
may reference a separate Secret. The defaults expect these keys:

| Values block | Default key | Consumer |
| --- | --- | --- |
| `secrets.postgresql` | `db-password` | PostgreSQL clients |
| `secrets.valkey` | `redis-password` | Valkey clients |
| `secrets.objectStorage` | `object-storage.yaml` | Workflow data, logs, and apps |
| `secrets.masterEncryptionKey` | `mek.yaml` | OSMO encryption-key configuration |

The chart only reads operator-owned Secrets. It does not create, mutate, or
delete them. When PostgreSQL or Valkey uses a private CA, enable TLS in the
matching `externalDependencies` block and reference the CA Secret there. The
Valkey `caKey` must hold a complete PEM trust bundle, including the public or
system roots used by other HTTPS endpoints; OSMO's Python services consume that
bundle through `SSL_CERT_FILE`. The default Valkey key is `ca-bundle.crt`.

## Exposure

`exposure.mode: external` renders the internal OSMO gateway and no public edge
resource. The control profile keeps that Service at `ClusterIP`; an
operator-managed, authenticating proxy is responsible for forwarding HTTP and
WebSocket traffic to it. Do not expose the profile's gateway directly without
adding the intended authentication layer. For local verification:

```bash
kubectl --namespace osmo port-forward service/osmo-gateway 8080:80
curl http://127.0.0.1:8080/api/version
```
