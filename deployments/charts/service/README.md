<!--
  SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

  http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.

  SPDX-License-Identifier: Apache-2.0
-->

# NVIDIA OSMO - Helm Chart

This Helm chart deploys the OSMO platform with its core services and an optional standalone API gateway.

## Values

> **Hostname configuration.** Three template fields read the external hostname for this deployment: `services.service.hostname` (API service `--service_hostname`), `services.router.hostname` (router `--hostname` for session-key extraction from `Host:` headers), and `gateway.envoy.hostname` (Ingress / TLS / OAuth2 redirect). Each one falls back to `global.hostname` when empty, so the recommended pattern is **set `global.hostname` once** at the top level and leave the per-component fields blank. Per-component fields still take precedence on the (rare) deployments that need a different value.

### Global Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `global.osmoImageLocation` | Location of OSMO images | `nvcr.io/nvidia/osmo` |
| `global.osmoImageTag` | Tag of the OSMO images | `latest` |
| `global.imagePullSecret` | Name of the Kubernetes secret containing Docker registry credentials | `null` |
| `global.nodeSelector` | Global node selector | `{}` |
| `global.hostname` | External DNS hostname this OSMO deployment serves on (e.g. `staging.osmo.nvidia.com`). Canonical fallback for `services.service.hostname`, `services.router.hostname`, and `gateway.envoy.hostname` — set this once at the top level instead of three times. | `""` |

### Global Logging Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `global.logs.enabled` | Enable logging | `true` |
| `global.logs.logLevel` | Log level for application | `DEBUG` |
| `global.logs.k8sLogLevel` | Log level for Kubernetes | `WARNING` |


### Configuration File Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `services.configFile.enabled` | Enable external configuration file loading | `false` |
| `services.configFile.path` | Path to the configuration file | `/opt/osmo/config.yaml` |

### Database Migration Settings (pgroll)

| Parameter | Description | Default |
|-----------|-------------|---------|
| `services.migration.enabled` | Enable the pgroll migration Job (Helm pre-upgrade hook) | `false` |
| `services.migration.targetSchema` | Target pgroll schema. Use `public` (the default). | `public` |
| `services.migration.image` | Container image for the migration Job | `postgres:15-alpine` |
| `services.migration.pgrollVersion` | pgroll release version to download | `v0.16.1` |
| `services.migration.serviceAccountName` | Service account name (defaults to global if empty) | `""` |
| `services.migration.nodeSelector` | Node selector for the migration Job pod | `{}` |
| `services.migration.tolerations` | Tolerations for the migration Job pod | `[]` |
| `services.migration.resources` | Resource limits and requests for the migration Job | `{}` |
| `services.migration.extraAnnotations` | Annotations on the Job and ConfigMap (e.g., ArgoCD hooks) | `{}` |
| `services.migration.extraPodAnnotations` | Annotations on the Job pod (e.g., Vault agent) | `{}` |
| `services.migration.extraEnv` | Extra environment variables for the migration container | `[]` |
| `services.migration.extraVolumeMounts` | Extra volume mounts for the migration container | `[]` |
| `services.migration.extraVolumes` | Extra volumes for the migration Job pod | `[]` |
| `services.migration.initContainers` | Init containers for the migration Job pod | `[]` |

To add new migrations for future releases, drop JSON files into the chart's `migrations/` directory. They are automatically included via `.Files.Glob`.

### PostgreSQL Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `services.postgres.enabled` | Enable PostgreSQL deployment | `false` |
| `services.postgres.image` | PostgreSQL image | `postgres:15.1` |
| `services.postgres.serviceName` | Service name | `postgres` |
| `services.postgres.port` | PostgreSQL port | `5432` |
| `services.postgres.db` | Database name | `osmo` |
| `services.postgres.user` | PostgreSQL username | `postgres` |
| `services.postgres.passwordSecretName` | Name of the Kubernetes secret containing the PostgreSQL password | `postgres-secret` |
| `services.postgres.passwordSecretKey` | Key name in the secret that contains the PostgreSQL password | `password` |
| `services.postgres.storageSize` | Storage size | `20Gi` |
| `services.postgres.storageClassName` | Storage class name | `""` |
| `services.postgres.enableNodePort` | Enable NodePort service | `true` |
| `services.postgres.nodePort` | NodePort value | `30033` |
| `services.postgres.nodeSelector` | Node selector constraints | `{}` |
| `services.postgres.tolerations` | Pod tolerations | `[]` |

### Redis Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `services.redis.enabled` | Enable Redis deployment | `false` |
| `services.redis.image` | Redis image | `redis:7.0` |
| `services.redis.serviceName` | Service name | `redis` |
| `services.redis.port` | Redis port | `6379` |
| `services.redis.dbNumber` | Redis database number | `0` |
| `services.redis.storageSize` | Storage size | `20Gi` |
| `services.redis.storageClassName` | Storage class name | `""` |
| `services.redis.tlsEnabled` | Enable TLS | `true` |
| `services.redis.enableNodePort` | Enable NodePort service | `true` |
| `services.redis.nodePort` | NodePort value | `30034` |
| `services.redis.nodeSelector` | Node selector constraints | `{}` |
| `services.redis.tolerations` | Pod tolerations | `[]` |

### Service Settings

#### Delayed Job Monitor Service

| Parameter | Description | Default |
|-----------|-------------|---------|
| `services.delayedJobMonitor.replicas` | Number of replicas | `1` |
| `services.delayedJobMonitor.imageName` | Image name | `delayed-job-monitor` |
| `services.delayedJobMonitor.serviceName` | Service name | `osmo-delayed-job-monitor` |
| `services.delayedJobMonitor.initContainers` | Init containers for delayed job monitor | `[]` |
| `services.delayedJobMonitor.extraArgs` | Additional command line arguments | `[]` |
| `services.delayedJobMonitor.nodeSelector` | Node selector constraints | `{}` |
| `services.delayedJobMonitor.tolerations` | Pod tolerations | `[]` |
| `services.delayedJobMonitor.resources` | Resource limits and requests | `{}` |

#### Worker Service

| Parameter | Description | Default |
|-----------|-------------|---------|
| `services.worker.scaling.minReplicas` | Minimum replicas | `2` |
| `services.worker.scaling.maxReplicas` | Maximum replicas | `10` |
| `services.worker.scaling.hpaMemoryTarget` | Target memory utilization percentage for HPA scaling | `80` |
| `services.worker.scaling.hpaCpuTarget` | Target CPU utilization percentage for HPA scaling | `80` |
| `services.worker.scaling.customMetrics` | Additional custom metrics for HPA scaling (list of autoscaling/v2 metric specs) | `[]` |
| `services.worker.imageName` | Worker image name | `worker` |
| `services.worker.serviceName` | Service name | `osmo-worker` |
| `services.worker.initContainers` | Init containers for worker | `[]` |
| `services.worker.extraArgs` | Additional command line arguments | `[]` |
| `services.worker.nodeSelector` | Node selector constraints | `{}` |
| `services.worker.tolerations` | Pod tolerations | `[]` |
| `services.worker.resources` | Resource limits and requests | `{}` |
| `services.worker.topologySpreadConstraints` | Topology spread constraints | See values.yaml |

#### API Service

| Parameter | Description | Default |
|-----------|-------------|---------|
| `services.service.scaling.minReplicas` | Minimum replicas | `3` |
| `services.service.scaling.maxReplicas` | Maximum replicas | `9` |
| `services.service.scaling.hpaMemoryTarget` | Target memory utilization percentage for HPA scaling | `80` |
| `services.service.scaling.hpaCpuTarget` | Target CPU utilization percentage for HPA scaling | `80` |
| `services.service.scaling.customMetrics` | Additional custom metrics for HPA scaling (list of autoscaling/v2 metric specs) | `[]` |
| `services.service.imageName` | Service image name | `service` |
| `services.service.serviceName` | Service name | `osmo-service` |
| `services.service.initContainers` | Init containers for API service | `[]` |
| `services.service.hostname` | External DNS hostname for the API service (passed as `--service_hostname`, used to set `service_base_url` in the DB-backed configs). When empty, falls back to `global.hostname`. | `""` |
| `services.service.extraArgs` | Additional command line arguments | `[]` |
| `services.service.hostAliases` | Host aliases for custom DNS resolution | `[]` |
| `services.service.disableTaskMetrics` | Disable task metrics collection | `false` |
| `services.service.nodeSelector` | Node selector constraints | `{}` |
| `services.service.tolerations` | Pod tolerations | `[]` |
| `services.service.resources` | Resource limits and requests | `{}` |
| `services.service.topologySpreadConstraints` | Topology spread constraints | See values.yaml |
| `services.service.livenessProbe` | Liveness probe configuration | See values.yaml |

#### Logger Service

| Parameter | Description | Default |
|-----------|-------------|---------|
| `services.logger.scaling.minReplicas` | Minimum replicas | `3` |
| `services.logger.scaling.maxReplicas` | Maximum replicas | `9` |
| `services.logger.scaling.hpaMemoryTarget` | Target memory utilization percentage for HPA scaling | `80` |
| `services.logger.scaling.hpaCpuTarget` | Target CPU utilization percentage for HPA scaling | `80` |
| `services.logger.scaling.customMetrics` | Additional custom metrics for HPA scaling (list of autoscaling/v2 metric specs) | `[]` |
| `services.logger.imageName` | Logger image name | `logger` |
| `services.logger.serviceName` | Service name | `osmo-logger` |
| `services.logger.initContainers` | Init containers for logger service | `[]` |
| `services.logger.nodeSelector` | Node selector constraints | `{}` |
| `services.logger.tolerations` | Pod tolerations | `[]` |
| `services.logger.resources` | Resource limits and requests | See values.yaml |
| `services.logger.topologySpreadConstraints` | Topology spread constraints | See values.yaml |

#### Agent Service

| Parameter | Description | Default |
|-----------|-------------|---------|
| `services.agent.scaling.minReplicas` | Minimum replicas | `1` |
| `services.agent.scaling.maxReplicas` | Maximum replicas | `9` |
| `services.agent.scaling.hpaMemoryTarget` | Target memory utilization percentage for HPA scaling | `80` |
| `services.agent.scaling.hpaCpuTarget` | Target CPU utilization percentage for HPA scaling | `80` |
| `services.agent.scaling.customMetrics` | Additional custom metrics for HPA scaling (list of autoscaling/v2 metric specs) | `[]` |
| `services.agent.imageName` | Agent image name | `agent` |
| `services.agent.serviceName` | Service name | `osmo-agent` |
| `services.agent.initContainers` | Init containers for agent service | `[]` |
| `services.agent.nodeSelector` | Node selector constraints | `{}` |
| `services.agent.tolerations` | Pod tolerations | `[]` |
| `services.agent.resources` | Resource limits and requests | See values.yaml |
| `services.agent.topologySpreadConstraints` | Topology spread constraints | See values.yaml |

#### UI Service

| Parameter | Description | Default |
|-----------|-------------|---------|
| `services.ui.enabled` | Render the UI Deployment/Service/HPA | `true` |
| `services.ui.replicas` | Number of UI replicas | `1` |
| `services.ui.imageName` | UI image name | `web-ui` |
| `services.ui.imagePullPolicy` | Image pull policy | `Always` |
| `services.ui.serviceName` | Service name | `osmo-ui` |
| `services.ui.apiHostname` | Hostname used for server-side rendering | `osmo-gateway:80` |
| `services.ui.portForwardEnabled` | Enable port-forwarding through the UI | `false` |
| `services.ui.nextjsSslEnabled` | Enable SSL for UI-to-API server-side requests | `false` |
| `services.ui.containerPort` | Container port | `8000` |
| `services.ui.serviceAccountName` | Service account name | `""` |
| `services.ui.maxHttpHeaderSizeKb` | Maximum Node.js header size in KB | `128` |
| `services.ui.docsBaseUrl` | Documentation URL shown in the UI | `https://nvidia.github.io/OSMO/main/user_guide/` |
| `services.ui.cliInstallScriptUrl` | CLI install script URL shown in the UI | See values.yaml |
| `services.ui.scaling.enabled` | Enable HorizontalPodAutoscaler | `false` |
| `services.ui.scaling.minReplicas` | Minimum replicas | `1` |
| `services.ui.scaling.maxReplicas` | Maximum replicas | `3` |
| `services.ui.scaling.hpaTarget` | Target memory utilization percentage | `85` |
| `services.ui.extraPodAnnotations` | Extra pod annotations | `{}` |
| `services.ui.extraEnvs` | Extra environment variables | `[]` |
| `services.ui.extraVolumeMounts` | Extra volume mounts | `[]` |
| `services.ui.extraVolumes` | Extra volumes | `[]` |
| `services.ui.extraContainers` | Extra sidecar containers | `[]` |
| `services.ui.service.type` | Service type | `""` |
| `services.ui.service.port` | Service port | `80` |
| `services.ui.service.extraPorts` | Additional service ports | `[]` |
| `services.ui.nodeSelector` | Node selector constraints | `{}` |
| `services.ui.hostAliases` | Host aliases for custom DNS resolution | `[]` |
| `services.ui.tolerations` | Pod tolerations | `[]` |
| `services.ui.resources` | Resource limits and requests | `{}` |
| `services.ui.livenessProbe` | Liveness probe configuration | See values.yaml |
| `services.ui.startupProbe` | Startup probe configuration | See values.yaml |
| `services.ui.readinessProbe` | Readiness probe configuration | See values.yaml |

#### Router Service

The router was its own Helm chart prior to v6.3 and is now deployed as part of the service chart. The gateway routes `/api/router/*` to the `osmo-router` Kubernetes Service.

| Parameter | Description | Default |
|-----------|-------------|---------|
| `services.router.scaling.minReplicas` | Minimum replicas | `3` |
| `services.router.scaling.maxReplicas` | Maximum replicas | `5` |
| `services.router.scaling.memoryTarget` | Target memory utilization percentage for HPA scaling | `80` |
| `services.router.scaling.hpaCpuTarget` | Target CPU utilization percentage for HPA scaling | `80` |
| `services.router.scaling.customMetrics` | Additional custom metrics for HPA scaling (list of autoscaling/v2 metric specs) | `[]` |
| `services.router.imageName` | Router image name | `router` |
| `services.router.imageTag` | Per-router image tag override; falls back to `global.osmoImageTag` when empty. Useful for canary-deploying a new router image without bumping the rest of the chart. | `""` |
| `services.router.imagePullPolicy` | Image pull policy | `Always` |
| `services.router.serviceName` | Service name | `osmo-router` |
| `services.router.initContainers` | Init containers for router service | `[]` |
| `services.router.hostname` | External hostname (e.g. `staging.osmo.nvidia.com`) used by the router to extract a session key from `Host` / `X-Forwarded-Host` headers — requests to `<key>.<hostname>` resolve to session `<key>`. Required for subdomain-based session routing. When empty, falls back to `global.hostname`; if both are empty the chart omits `--hostname` and the binary's default of `localhost` applies (only matches `*.localhost`). | `""` |
| `services.router.webserverEnabled` | Enable webserver functionality for wildcard subdomain support | `false` |
| `services.router.serviceAccountName` | Per-router ServiceAccount name. When empty, falls back to `global.serviceAccountName`. | `""` |
| `services.router.extraArgs` | Additional command line arguments | `[]` |
| `services.router.extraPodLabels` | Extra labels applied to the router pod | `{}` |
| `services.router.extraPodAnnotations` | Extra annotations applied to the router pod (e.g. vault-injector annotations) | `{}` |
| `services.router.extraEnvs` | Extra container env vars (list of `{name, value}` or `{name, valueFrom}`) | `[]` |
| `services.router.extraPorts` | Extra named container ports | `[]` |
| `services.router.extraVolumes` | Extra pod volumes | `[]` |
| `services.router.extraVolumeMounts` | Extra container volume mounts | `[]` |
| `services.router.extraContainers` | Extra sidecar containers | `[]` |
| `services.router.hostAliases` | Host aliases for custom DNS resolution within router pods | `[]` |
| `services.router.nodeSelector` | Node selector constraints (merged with `global.nodeSelector`; per-router keys take precedence on collision) | `{}` |
| `services.router.tolerations` | Pod tolerations | See values.yaml |
| `services.router.resources` | Resource limits and requests | `{}` |
| `services.router.topologySpreadConstraints` | Topology spread constraints | See values.yaml |
| `services.router.livenessProbe` | Liveness probe configuration | See values.yaml |
| `services.router.startupProbe` | Startup probe configuration | See values.yaml |
| `services.router.readinessProbe` | Readiness probe configuration | See values.yaml |

The router reads the same `services.configFile.path` as the API service. When `services.configFile.enabled: false` (default), the router gets `--config <path>` as a CLI arg. The API service ignores `services.configFile.path` unless `services.configFile.enabled: true`, so setting just the path lets you point the router at a vault-injected config without affecting the API service.

### Ingress Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `services.service.ingress.enabled` | Enable ingress for external access | `true`|
| `services.service.ingress.prefix` | URL path prefix | `/` |
| `services.service.ingress.ingressClass` | Ingress controller class | `nginx` |
| `services.service.ingress.sslEnabled` | Enable SSL | `true` |
| `services.service.ingress.sslSecret` | Name of SSL secret | `osmo-tls` |
| `services.service.ingress.annotations` | Additional custom annotations | `{}` |

#### ALB Annotations Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `services.service.ingress.albAnnotations.enabled` | Enable ALB annotations | `false` |
| `services.service.ingress.albAnnotations.sslCertArn` | ARN of SSL certificate | `""` |

### Prometheus Metrics Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `podMonitor.enabled` | Enable PodMonitor for Prometheus scraping (requires `monitoring.coreos.com` CRD) | `true` |

### Gateway Configuration

When `gateway.enabled` is true, the chart deploys Envoy, OAuth2 Proxy, and Authz as independent Deployments and Services, decoupled from the application pods. This replaces the legacy sidecar model where these components ran inside every service pod.

Benefits of the separate gateway model:
- Envoy stays alive during upstream service deployments, preserving downstream connections
- Each component can be scaled and resourced independently
- Cookie-based session affinity at the Envoy tier (CSP-independent)
- Envoy becomes optional for users with existing API gateways

#### Gateway Envoy

| Parameter | Description | Default |
|-----------|-------------|---------|
| `gateway.enabled` | Deploy the standalone gateway | `false` |
| `gateway.name` | Name prefix for all gateway resources | `osmo-gateway` |
| `gateway.envoy.enabled` | Enable Envoy deployment | `true` |
| `gateway.envoy.scaling.minReplicas` | Minimum number of Envoy replicas | `2` |
| `gateway.envoy.scaling.maxReplicas` | Maximum number of Envoy replicas | `6` |
| `gateway.envoy.scaling.hpaCpuTarget` | Target CPU utilization percentage for HPA | `80` |
| `gateway.envoy.scaling.hpaMemoryTarget` | Target memory utilization percentage for HPA | `80` |
| `gateway.envoy.scaling.customMetrics` | Additional custom metrics for HPA scaling (list of autoscaling/v2 metric specs) | `[]` |
| `gateway.envoy.image` | Envoy image | `envoyproxy/envoy:v1.29.0` |
| `gateway.envoy.logLevel` | Envoy log level | `info` |
| `gateway.envoy.listenerPort` | Listener port | `8080` |
| `gateway.envoy.maxHeadersSizeKb` | Max header size in KB | `128` |
| `gateway.envoy.hostname` | External hostname (used in the Ingress `host:` rule, TLS hosts list, and the OAuth2 redirect URL). When empty, falls back to `global.hostname`. | `""` |
| `gateway.envoy.maxRequests` | Circuit breaker max concurrent requests | `100` |
| `gateway.envoy.idp.host` | IDP host for JWKS (e.g. `login.microsoftonline.com`) | `""` |
| `gateway.envoy.jwt.providers` | JWT provider configurations | `[]` |
| `gateway.envoy.skipAuthPaths` | Paths that bypass authentication | See values.yaml |
| `gateway.envoy.serviceRoutes` | Custom Envoy routes for osmo-service upstream | `[]` |
| `gateway.envoy.routerRoute.cookie.name` | Cookie name for router session affinity | `_osmo_router_affinity` |
| `gateway.envoy.routerRoute.cookie.ttl` | Cookie TTL for router affinity | `60s` |
| `gateway.envoy.ingress.enabled` | Enable Ingress for the gateway | `false` |
| `gateway.envoy.defaultIdentity.user` | Default `x-osmo-user` for unauthenticated requests (minimal/demo deployments only) — leave empty in production | `""` |
| `gateway.envoy.defaultIdentity.roles` | Default `x-osmo-roles` (comma-separated) — only applied when `defaultIdentity.user` is set | `""` |
| `gateway.envoy.defaultIdentity.allowedPools` | Default `x-osmo-allowed-pools` (comma-separated) — only applied when `defaultIdentity.user` is set | `""` |

Envoy uses filesystem-based dynamic configuration (LDS/CDS). When the ConfigMap is updated, Envoy automatically reloads listeners and clusters without a pod restart.

**Identity header trust by mode.** The gateway either trusts or strips client-supplied `x-osmo-{user,roles,allowed-pools}` headers based on whether `gateway.oauth2Proxy.enabled` or `gateway.authz.enabled` is `true`:

| `oauth2Proxy.enabled` | `authz.enabled` | Identity headers from clients |
|---|---|---|
| `true` (default) | `true` (default) | Stripped at the HCM `internal_only_headers` layer **and** by the Lua filter. ext_authz (the authz sidecar) is the only source. Production posture. |
| `true` | `false` | Same — both strip mechanisms still run. |
| `false` | `true` | Same — both strip mechanisms still run. |
| `false` | `false` (minimal mode) | **Trusted.** Both strip mechanisms are skipped so dev-mode CLI's `x-osmo-user: <name>` flows through. `defaultIdentity` is only injected via `ADD_IF_ABSENT` when the client did not set its own. **Any caller with network access to the gateway can claim any user, role, or pool — only safe on clusters whose gateway is not exposed to untrusted networks.** |

#### Gateway Upstreams

| Parameter | Description | Default |
|-----------|-------------|---------|
| `gateway.upstreams.service.host` | osmo-service K8s DNS name | `osmo-service` |
| `gateway.upstreams.service.port` | osmo-service port | `80` |
| `gateway.upstreams.router.enabled` | Route to osmo-router | `true` |
| `gateway.upstreams.router.host` | osmo-router headless K8s DNS name | `osmo-router-headless` |
| `gateway.upstreams.router.port` | osmo-router pod port (headless resolves to pod IPs) | `8000` |
| `gateway.upstreams.ui.enabled` | Route to osmo-ui | `true` |
| `gateway.upstreams.ui.host` | osmo-ui K8s DNS name | `osmo-ui` |
| `gateway.upstreams.ui.port` | osmo-ui port | `80` |
| `gateway.upstreams.agent.enabled` | Route to osmo-agent | `true` |
| `gateway.upstreams.agent.host` | osmo-agent K8s DNS name | `osmo-agent` |
| `gateway.upstreams.agent.port` | osmo-agent port | `80` |
| `gateway.upstreams.logger.enabled` | Route to osmo-logger | `true` |
| `gateway.upstreams.logger.host` | osmo-logger K8s DNS name | `osmo-logger` |
| `gateway.upstreams.logger.port` | osmo-logger port | `80` |

#### Gateway OAuth2 Proxy

| Parameter | Description | Default |
|-----------|-------------|---------|
| `gateway.oauth2Proxy.enabled` | Enable OAuth2 Proxy deployment | `true` |
| `gateway.oauth2Proxy.scaling.minReplicas` | Minimum number of OAuth2 Proxy replicas | `1` |
| `gateway.oauth2Proxy.scaling.maxReplicas` | Maximum number of OAuth2 Proxy replicas | `3` |
| `gateway.oauth2Proxy.scaling.hpaCpuTarget` | Target CPU utilization percentage for HPA | `80` |
| `gateway.oauth2Proxy.scaling.hpaMemoryTarget` | Target memory utilization percentage for HPA | `80` |
| `gateway.oauth2Proxy.scaling.customMetrics` | Additional custom metrics for HPA scaling (list of autoscaling/v2 metric specs) | `[]` |
| `gateway.oauth2Proxy.image` | OAuth2 Proxy image | `quay.io/oauth2-proxy/oauth2-proxy:v7.14.2` |
| `gateway.oauth2Proxy.provider` | OIDC provider type | `oidc` |
| `gateway.oauth2Proxy.oidcIssuerUrl` | OIDC issuer URL | `""` |
| `gateway.oauth2Proxy.clientId` | OAuth2 client ID | `""` |
| `gateway.oauth2Proxy.cookieName` | Session cookie name | `_osmo_session` |
| `gateway.oauth2Proxy.redisSessionStore` | Use Redis for session store | `true` |
| `gateway.oauth2Proxy.extraEnv` | Extra environment variables for the oauth2-proxy container (e.g. `OAUTH2_PROXY_REDIS_PASSWORD` from a Secret ref when Redis requires AUTH) | `[]` |

#### Gateway Authz

| Parameter | Description | Default |
|-----------|-------------|---------|
| `gateway.authz.enabled` | Enable Authz deployment | `true` |
| `gateway.authz.scaling.minReplicas` | Minimum number of Authz replicas | `1` |
| `gateway.authz.scaling.maxReplicas` | Maximum number of Authz replicas | `3` |
| `gateway.authz.scaling.hpaCpuTarget` | Target CPU utilization percentage for HPA | `80` |
| `gateway.authz.scaling.hpaMemoryTarget` | Target memory utilization percentage for HPA | `80` |
| `gateway.authz.scaling.customMetrics` | Additional custom metrics for HPA scaling (list of autoscaling/v2 metric specs) | `[]` |
| `gateway.authz.imageName` | Authz image name | `authz-sidecar` |
| `gateway.authz.imageTag` | Override image tag (defaults to `global.osmoImageTag`) | `""` |
| `gateway.authz.grpcPort` | gRPC port | `50052` |

#### Network Policies

| Parameter | Description | Default |
|-----------|-------------|---------|
| `gateway.networkPolicies.enabled` | Deploy NetworkPolicies restricting ingress to upstream pods | `false` |
| `gateway.networkPolicies.upstreams` | List of upstream pods to protect (name, podSelector, port) | See values.yaml |

#### Gateway → Upstream TLS

Traffic between the Envoy gateway and the upstream services (`osmo-service`, `osmo-router`, `osmo-agent`, `osmo-logger`) is encrypted by default. The UI intentionally stays on plain HTTP behind NetworkPolicy — Next.js does not natively serve TLS.

Two modes:

**Default — encryption without validation.** Each upstream service mints its own ephemeral self-signed cert in-process at startup (ECDSA P-256, ~1ms), writes it to a temp dir, and loads it into uvicorn's SSLContext. The Python service does this via `--ssl_self_signed true` from the chart; the cert generation happens in `SSLConfig._mint_ephemeral_self_signed()` (`src/utils/static_config.py`). Envoy connects with TLS but configures `common_tls_context: {}` on the upstream cluster — it does *not* validate the cert. The wire is encrypted; identity verification is delegated to NetworkPolicy + Kubernetes RBAC.

This means: no CA management, no Secrets to rotate, no ArgoCD churn, no init containers, no cross-pod cert dependency. Cert lifecycle is tied to process lifecycle — a pod restart mints a fresh cert.

**Validated — cert-manager.** Set `gateway.tls.certManager.enabled: true`. The chart emits cert-manager `Issuer` + `Certificate` resources. By default it creates a self-signed root + a CA Issuer + per-service Certificates; the upstream Deployments mount the resulting Secrets read-only. To plug in an existing CA (Vault, internal PKI, ACME), set `gateway.tls.certManager.issuerRef`. Requires cert-manager installed in the cluster.

| Parameter | Description | Default |
|-----------|-------------|---------|
| `gateway.tls.enabled` | Encrypt gateway → upstream traffic. | `true` |
| `gateway.tls.caDuration` | CA cert validity (cert-manager mode). | `87600h` (10y) |
| `gateway.tls.caRenewBefore` | Renew CA this long before expiry (cert-manager mode). | `720h` (30d) |
| `gateway.tls.certDuration` | Leaf cert validity (cert-manager mode). | `43800h` (5y) |
| `gateway.tls.certRenewBefore` | Renew leaf this long before expiry (cert-manager mode). | `360h` (15d) |
| `gateway.tls.certManager.enabled` | Switch from default mode to cert-manager-managed validated TLS. | `false` |
| `gateway.tls.certManager.issuerRef` | Optional: point at an existing Issuer/ClusterIssuer. Map with `name`, `kind` (`Issuer` or `ClusterIssuer`), and `group` (defaults to `cert-manager.io`). When empty, the chart creates a self-signed Issuer + CA chain. | `{}` |

NetworkPolicy and TLS are independent: NetworkPolicy controls *who* can connect at L3/L4; TLS encrypts the bytes at L7. Run them together for defense in depth.

### Extensibility

Each service supports extensibility through the following parameters:

| Parameter | Description | Default |
|-----------|-------------|---------|
| `services.{service}.extraPodAnnotations` | Extra pod annotations | `{}` |
| `services.{service}.extraEnv` | Extra environment variables | `[]` |
| `services.{service}.extraArgs` | Extra command line arguments | `[]` |
| `services.{service}.extraVolumeMounts` | Extra volume mounts | `[]` |
| `services.{service}.extraVolumes` | Extra volumes | `[]` |
| `services.{service}.extraSidecars` | Extra sidecar containers | `[]` |
| `services.{service}.serviceAccountName` | Service account name | `""` |


## Dependencies

This chart requires:
- A running Kubernetes cluster (1.19+)
- Access to NVIDIA container registry (nvcr.io)
- PostgreSQL database (external or deployed via chart)
- Redis cache (external or deployed via chart)
- Properly configured OAuth2 provider for authentication
- Optional: CloudWatch (for AWS environments)

## Architecture

The OSMO platform consists of:

### Core Services
- **API Service**: Main REST API with ingress, scaling, and authentication
- **Router Service**: Routes per-workflow client traffic; the gateway routes `/api/router/*` here. Was its own Helm chart prior to v6.3 and is now deployed by this chart.
- **Worker Service**: Background job processing with queue-based scaling
- **Logger Service**: Log collection and processing with connection-based scaling
- **Agent Service**: Client communication and management
- **Delayed Job Monitor**: Monitoring and management of delayed background jobs

### Gateway (optional, `gateway.enabled: true`)
- **Envoy Proxy**: Unified API gateway routing to all upstream services with JWT authentication, OAuth2, authorization, and rate limiting. Uses filesystem-based dynamic config (LDS/CDS) for zero-downtime config updates.
- **OAuth2 Proxy**: Handles OIDC authentication flows with Redis-backed sessions
- **Authz**: gRPC authorization service evaluating semantic RBAC policies against PostgreSQL
- **Network Policies**: Restrict ingress to upstream pods so only the gateway Envoy can reach them
- **TLS Certificates**: Self-signed CA and server certs for encrypted gateway-to-upstream communication

### Monitoring
- **OpenTelemetry Collector**: Metrics and tracing collection
- **Prometheus PodMonitor**: Service metrics scraping

## Notes

- The chart consists of multiple services: API, Router, Worker, Logger, Agent, and Delayed Job Monitor
- Each service can be scaled independently using HPA
- Authentication is handled through the gateway's OAuth2 Proxy and JWT validation
- The gateway Envoy provides cookie-based session affinity for the router service
- Comprehensive logging with Fluent Bit integration
- OpenTelemetry for observability
