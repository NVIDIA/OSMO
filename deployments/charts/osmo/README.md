<!--
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
-->

# OSMO Helm Chart

The `osmo` chart deploys the OSMO control-plane services and gateway.

The supported `split-plane-control` profile installs the API, UI, router,
worker, logger, agent, delayed-job monitor, and standalone OSMO gateway. It
uses operator-managed PostgreSQL, Valkey, object storage, and Kubernetes
Secrets. Compute-plane workloads and chart-generated Secrets are outside this
chart's clean-install boundary.

Install the chart in a dedicated namespace. OSMO Deployments in that namespace
must use the selectors rendered by this chart because Kubernetes Deployment
selectors are immutable.

## Values layout

- `planes` selects the OSMO plane.
- `embeddedDependencies` selects chart-owned supporting systems.
- `externalDependencies` contains typed connection information.
- `services` configures OSMO application services.
- `gateway` configures Envoy and gateway-adjacent services.
- `externalUrl` is the required public OSMO URL used in generated service
  configuration and redirects.
- `ingress` and `httproute` optionally configure Kubernetes edge resources.
- `monitoring` configures Prometheus Operator PodMonitors.
- `secrets` contains typed references to operator-owned Kubernetes Secrets.
- `configuration` contains shared OSMO domain configuration.
- `global`, `runtimeImage`, `commonLabels`, `commonAnnotations`, and
  `podDefaults` provide shared image, metadata, and workload defaults.

Every component image uses `registry`, `repository`, `tag`, `digest`, and
`pullPolicy`. A non-empty `global.imageRegistry` replaces every component and
runtime registry, which supports a registry mirror without rewriting
repositories. A component digest takes precedence over its tag. Workflow
runtime images use the separate `runtimeImage` repository and tag. Configure
registry credentials once through `global.imagePullSecrets`.

Known chart values are schema-validated. Kubernetes pass-through structures
such as resources, probes, affinity, security contexts, volumes, custom HPA
metrics and behavior, and PodMonitor TLS/relabeling accept fields supported by
the target Kubernetes APIs. The `configuration` subtree accepts OSMO
application configuration.

## Control-plane installation

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
helm upgrade --install osmo deployments/charts/osmo \
  --namespace osmo \
  --create-namespace \
  -f deployments/charts/osmo/profiles/split-plane-control.yaml \
  -f <environment-values.yaml> \
  --wait \
  --timeout 25m
```

## Scaling and disruption behavior

Every scalable component has the same `autoscaling` contract. When
`autoscaling.enabled` is false, its Deployment uses `replicas` and the chart
does not create an HPA. When it is true, the HPA owns replica count through
`minReplicas` and `maxReplicas`; optional `behavior` is passed directly to the
autoscaling/v2 API.

CPU or memory utilization targets require matching non-empty
`resources.requests.cpu` or `resources.requests.memory`. The chart rejects an
enabled HPA that Kubernetes could not calculate. The split-plane control
profile enables autoscaling for the production API, router, worker, logger,
agent, and Envoy workloads and supplies their required requests.

Each component also has a `podDisruptionBudget` block. General defaults leave
budgets disabled so local clusters are easy to drain. The production profile
enables `maxUnavailable: 1` with `unhealthyPodEvictionPolicy: AlwaysAllow` for
replicated API, router, worker, logger, and Envoy workloads. A PDB protects only
against voluntary disruption; it does not replace replicas, topology spread,
health probes, or application-level recovery. Overly strict budgets can block
node drains, so set exactly one of `minAvailable` and `maxUnavailable`.

## Pod and ServiceAccount security

`podDefaults` supplies shared affinity, scheduling, Pod security context,
container security context, and termination grace period. Component `pod`
values override shared maps. The default Pod security context uses
`seccompProfile.type: RuntimeDefault`; containers drop all Linux capabilities,
disallow privilege escalation, and run as non-root.

The API, UI, router, worker, logger, agent, delayed-job monitor, and Envoy
default to `readOnlyRootFilesystem: true`. Their shipped images were validated
in a live Kind deployment with that setting. The chart mounts ephemeral
`emptyDir` volumes at `/tmp` where services mint ephemeral TLS material and at
`/var/run/osmo` where progress probes exchange state. These writable paths are
chart-owned and remain present when operators append custom
`extraVolumeMounts` and `pod.extraVolumes`. Optional components that have not
passed the same live check do not claim this default.

`serviceAccount.automountServiceAccountToken` defaults to false for components
that do not use the Kubernetes API. It remains true for the API because
configuration reload reporting reads its ConfigMap and creates Events through
the chart's Role. The value controls both the Pod and any ServiceAccount the
component asks the chart to create.

## Metadata precedence

`commonLabels` and `commonAnnotations` apply to all chart-owned resources.
`podDefaults.labels` and `podDefaults.annotations` add Pod-only metadata, and
resource or component maps override common metadata. Chart identity labels and
behavioral annotations such as the Envoy configuration checksum are protected
and take final precedence so user metadata cannot break selectors or rollout
triggers.

## Prometheus Operator monitoring

Set `monitoring.podMonitor.enabled: true` when the Prometheus Operator CRDs are
installed. The chart creates an OSMO application PodMonitor and, when their
components are enabled, separate Envoy and OAuth2 Proxy monitors. Configure
Prometheus discovery through `labels`, metadata through `annotations`, and
scraping through `interval`, `scrapeTimeout`, `scheme`, `tlsConfig`,
`honorLabels`, `targetLabels`, `relabelings`, and `metricRelabelings`. The chart
does not install the Prometheus Operator or its CRDs.

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

The gateway Service is the chart's single in-cluster entry point. It has one
HTTP or HTTPS port, configured by `gateway.envoy.service`, and all edge
resources target that port. Set `externalUrl` to the public URL clients use;
the chart does not infer it from a Service, Ingress, or HTTPRoute.

Choose the edge pattern appropriate for the cluster:

1. **Private `ClusterIP` (default).** Keep
   `gateway.envoy.service.type: ClusterIP` and have an operator-managed,
   authenticating proxy forward HTTP and WebSocket traffic to the gateway.
   This is the control profile default.
2. **Direct `LoadBalancer`.** Set
   `gateway.envoy.service.type: LoadBalancer`; optionally set its
   `port`, `nodePort`, `loadBalancerClass`, `loadBalancerSourceRanges`, and
   `externalTrafficPolicy`. Configure the intended TLS and authentication
   layers for the public endpoint.
3. **Ingress.** Set `ingress.enabled: true` and configure at least
   `ingress.hostname`; optionally configure its class, annotations, paths, and
   TLS block. The generated Ingress forwards to the gateway Service.
4. **Gateway API `HTTPRoute`.** Set `httproute.enabled: true`, supply at least
   one `httproute.parentRefs` entry for a Gateway that already exists, and
   configure hostnames and rules as needed. The chart creates an HTTPRoute only;
   it never creates a Gateway or GatewayClass.

Ingress and HTTPRoute can be enabled together when the cluster intentionally
uses both edge mechanisms. For local verification of the default private
Service:

```bash
kubectl --namespace osmo port-forward service/osmo-gateway 8080:80
curl http://127.0.0.1:8080/api/version
```
