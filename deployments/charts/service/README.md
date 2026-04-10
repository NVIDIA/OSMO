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

### Global Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `global.osmoImageLocation` | Location of OSMO images | `nvcr.io/nvidia/osmo` |
| `global.osmoImageTag` | Tag of the OSMO images | `latest` |
| `global.imagePullSecret` | Name of the Kubernetes secret containing Docker registry credentials | `null` |
| `global.nodeSelector` | Global node selector | `{}` |

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
| `services.service.imageName` | Service image name | `service` |
| `services.service.serviceName` | Service name | `osmo-service` |
| `services.service.initContainers` | Init containers for API service | `[]` |
| `services.service.hostname` | Service hostname | `""` |
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
| `services.agent.imageName` | Agent image name | `agent` |
| `services.agent.serviceName` | Service name | `osmo-agent` |
| `services.agent.initContainers` | Init containers for agent service | `[]` |
| `services.agent.nodeSelector` | Node selector constraints | `{}` |
| `services.agent.tolerations` | Pod tolerations | `[]` |
| `services.agent.resources` | Resource limits and requests | See values.yaml |
| `services.agent.topologySpreadConstraints` | Topology spread constraints | See values.yaml |

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
| `gateway.envoy.image` | Envoy image | `envoyproxy/envoy:v1.29.0` |
| `gateway.envoy.logLevel` | Envoy log level | `info` |
| `gateway.envoy.listenerPort` | Listener port | `8080` |
| `gateway.envoy.maxHeadersSizeKb` | Max header size in KB | `128` |
| `gateway.envoy.hostname` | External hostname (used in OAuth2 redirect) | `""` |
| `gateway.envoy.maxRequests` | Circuit breaker max concurrent requests | `100` |
| `gateway.envoy.idp.host` | IDP host for JWKS (e.g. `login.microsoftonline.com`) | `""` |
| `gateway.envoy.jwt.providers` | JWT provider configurations | `[]` |
| `gateway.envoy.skipAuthPaths` | Paths that bypass authentication | See values.yaml |
| `gateway.envoy.serviceRoutes` | Custom Envoy routes for osmo-service upstream | `[]` |
| `gateway.envoy.routerRoute.cookie.name` | Cookie name for router session affinity | `_osmo_router_affinity` |
| `gateway.envoy.routerRoute.cookie.ttl` | Cookie TTL for router affinity | `60s` |
| `gateway.envoy.ingress.enabled` | Enable Ingress for the gateway | `false` |

Envoy uses filesystem-based dynamic configuration (LDS/CDS). When the ConfigMap is updated, Envoy automatically reloads listeners and clusters without a pod restart.

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
| `gateway.oauth2Proxy.image` | OAuth2 Proxy image | `quay.io/oauth2-proxy/oauth2-proxy:v7.14.2` |
| `gateway.oauth2Proxy.provider` | OIDC provider type | `oidc` |
| `gateway.oauth2Proxy.oidcIssuerUrl` | OIDC issuer URL | `""` |
| `gateway.oauth2Proxy.clientId` | OAuth2 client ID | `""` |
| `gateway.oauth2Proxy.cookieName` | Session cookie name | `_osmo_session` |
| `gateway.oauth2Proxy.redisSessionStore` | Use Redis for session store | `true` |

#### Gateway Authz

| Parameter | Description | Default |
|-----------|-------------|---------|
| `gateway.authz.enabled` | Enable Authz deployment | `true` |
| `gateway.authz.scaling.minReplicas` | Minimum number of Authz replicas | `1` |
| `gateway.authz.scaling.maxReplicas` | Maximum number of Authz replicas | `3` |
| `gateway.authz.scaling.hpaCpuTarget` | Target CPU utilization percentage for HPA | `80` |
| `gateway.authz.scaling.hpaMemoryTarget` | Target memory utilization percentage for HPA | `80` |
| `gateway.authz.imageName` | Authz image name | `authz-sidecar` |
| `gateway.authz.imageTag` | Override image tag (defaults to `global.osmoImageTag`) | `""` |
| `gateway.authz.grpcPort` | gRPC port | `50052` |

#### Network Policies

| Parameter | Description | Default |
|-----------|-------------|---------|
| `gateway.networkPolicies.enabled` | Deploy NetworkPolicies restricting ingress to upstream pods | `false` |
| `gateway.networkPolicies.upstreams` | List of upstream pods to protect (name, podSelector, port) | See values.yaml |

#### TLS

| Parameter | Description | Default |
|-----------|-------------|---------|
| `gateway.tls.enabled` | Generate self-signed certs for upstream TLS | `false` |

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

- The chart consists of multiple services: API, Worker, Logger, Agent, and Delayed Job Monitor
- Each service can be scaled independently using HPA
- Authentication is handled through the gateway's OAuth2 Proxy and JWT validation
- The gateway Envoy provides cookie-based session affinity for the router service
- Comprehensive logging with Fluent Bit integration
- OpenTelemetry for observability
