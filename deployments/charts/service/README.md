<!--
  SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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

This Helm chart deploys the OSMO platform with its core services and required sidecars.

## Values

### Global Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `global.osmoImageLocation` | Location of OSMO images | `nvcr.io/nvidia/osmo` |
| `global.osmoImageTag` | Tag of the OSMO images | `latest` |
| `global.imagePullSecret` | Name of the image pull secret | `imagepullsecret` |
| `global.nodeSelector` | Global node selector | `kubernetes.io/arch: amd64` |

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
| `services.delayedJobMonitor.extraArgs` | Additional command line arguments | `[]` |
| `services.delayedJobMonitor.nodeSelector` | Node selector constraints | `{}` |
| `services.delayedJobMonitor.tolerations` | Pod tolerations | `[]` |
| `services.delayedJobMonitor.resources` | Resource limits and requests | `{}` |

#### Worker Service

| Parameter | Description | Default |
|-----------|-------------|---------|
| `services.worker.scaling.minReplicas` | Minimum replicas | `2` |
| `services.worker.scaling.maxReplicas` | Maximum replicas | `10` |
| `services.worker.scaling.targetQueueLength` | Target queue length per worker | `15` |
| `services.worker.imageName` | Worker image name | `worker` |
| `services.worker.serviceName` | Service name | `osmo-worker` |
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
| `services.service.scaling.hpaTarget` | HPA target utilization | `80` |
| `services.service.imageName` | Service image name | `service` |
| `services.service.serviceName` | Service name | `osmo-service` |
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
| `services.logger.scaling.targetConnections` | Target connections | `15` |
| `services.logger.imageName` | Logger image name | `logger` |
| `services.logger.serviceName` | Service name | `osmo-logger` |
| `services.logger.nodeSelector` | Node selector constraints | `{}` |
| `services.logger.tolerations` | Pod tolerations | `[]` |
| `services.logger.resources` | Resource limits and requests | See values.yaml |
| `services.logger.topologySpreadConstraints` | Topology spread constraints | See values.yaml |

#### Agent Service

| Parameter | Description | Default |
|-----------|-------------|---------|
| `services.agent.scaling.minReplicas` | Minimum replicas | `1` |
| `services.agent.scaling.maxReplicas` | Maximum replicas | `9` |
| `services.agent.scaling.hpaTarget` | HPA target utilization | `80` |
| `services.agent.imageName` | Agent image name | `agent` |
| `services.agent.serviceName` | Service name | `osmo-agent` |
| `services.agent.nodeSelector` | Node selector constraints | `{}` |
| `services.agent.tolerations` | Pod tolerations | `[]` |
| `services.agent.resources` | Resource limits and requests | See values.yaml |
| `services.agent.topologySpreadConstraints` | Topology spread constraints | See values.yaml |

### Ingress Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `services.service.ingress.prefix` | URL path prefix | `/` |
| `services.service.ingress.ingressClass` | Ingress controller class | `nginx` |
| `services.service.ingress.sslEnabled` | Enable SSL | `true` |
| `services.service.ingress.sslSecret` | Name of SSL secret | `osmo-tls` |
| `services.service.ingress.annotations` | Additional custom annotations | `{}` |

#### ALB Annotations Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `services.service.ingress.albAnnotations.enabled` | Enable ALB annotations | `false` |
| `services.service.ingress.albAnnotations.sslCertArn` | ARN of SSL certificate | `arn:aws:acm:us-west-2:XXXXXXXXX:certificate/YYYYYYYY` |

### Sidecar Configuration

The chart now supports extensible sidecar configuration through the `sidecars` section:

#### Envoy Proxy Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `sidecars.envoy.enabled` | Enable Envoy sidecar | `true` |
| `sidecars.envoy.useKubernetesSecrets` | Use Kubernetes secrets instead of Vault | `false` |
| `sidecars.envoy.secretPaths.clientSecret` | Path to OAuth client secret | `/etc/envoy/secrets/client_secret` |
| `sidecars.envoy.secretPaths.hmacSecret` | Path to HMAC secret | `/etc/envoy/secrets/hmac_secret` |
| `sidecars.envoy.image` | Envoy proxy image | `envoyproxy/envoy:v1.29.0` |
| `sidecars.envoy.imagePullPolicy` | Image pull policy | `IfNotPresent` |
| `sidecars.envoy.listenerPort` | Envoy listener port | `80` |
| `sidecars.envoy.maxHeadersSizeKb` | Maximum header size in KB | `128` |
| `sidecars.envoy.logLevel` | Envoy log level | `info` |
| `sidecars.envoy.service.hostname` | Service hostname | `""` |
| `sidecars.envoy.service.address` | Service address | `127.0.0.1` |
| `sidecars.envoy.service.port` | Service port | `8000` |
| `sidecars.envoy.extraVolumeMounts` | Additional volume mounts for Envoy container | `[]` |
| `sidecars.envoy.jwt.user_header` | JWT user header | `x-osmo-user` |
| `sidecars.envoy.jwt.providers` | JWT providers configuration | See values.yaml |
| `sidecars.envoy.oauth2Filter.enabled` | Enable OAuth2 filter | `true` |
| `sidecars.envoy.oauth2Filter.tokenEndpoint` | Token endpoint URL | `""` |
| `sidecars.envoy.oauth2Filter.authEndpoint` | Auth endpoint URL | `""` |
| `sidecars.envoy.oauth2Filter.redirectPath` | OAuth redirect path | `api/auth/getAToken` |
| `sidecars.envoy.oauth2Filter.clientId` | OAuth client ID | `""` |
| `sidecars.envoy.oauth2Filter.authProvider` | Auth provider | `""` |
| `sidecars.envoy.oauth2Filter.logoutPath` | OAuth logout path | `logout` |
| `sidecars.envoy.oauth2Filter.forwardBearerToken` | Forward bearer token | `true` |
| `sidecars.envoy.oauth2Filter.secretName` | Kubernetes secret name for OIDC secrets | `oidc-secrets` |
| `sidecars.envoy.oauth2Filter.clientSecretKey` | Key name for client secret in Kubernetes secret | `client_secret` |
| `sidecars.envoy.oauth2Filter.hmacSecretKey` | Key name for HMAC secret in Kubernetes secret | `hmac_secret` |


#### Log Agent Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `sidecars.logAgent.enabled` | Enable log agent sidecar | `true` |
| `sidecars.logAgent.image` | Log agent image | `fluent/fluent-bit:4.0.8-debug` |
| `sidecars.logAgent.prometheusPort` | Prometheus metrics port | `2020` |
| `sidecars.logAgent.configName` | Log agent config name | `osmo-log-agent-config` |
| `sidecars.logAgent.cloudwatch.enabled` | Enable CloudWatch logging | `false` |
| `sidecars.logAgent.cloudwatch.region` | AWS region for CloudWatch | `us-west-2` |
| `sidecars.logAgent.cloudwatch.clusterName` | Cluster name for CloudWatch | `""` |

#### OpenTelemetry Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `sidecars.otel.enabled` | Enable OTEL collector | `true` |
| `sidecars.otel.image` | OTEL collector image | `otel/opentelemetry-collector-contrib:0.68.0` |
| `sidecars.otel.configName` | OTEL config name | `otel-config` |

#### Rate Limit Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `sidecars.rateLimit.enabled` | Enable rate limiting | `true` |
| `sidecars.rateLimit.image` | Rate limit image | `envoyproxy/ratelimit:9d8d70a8` |
| `sidecars.rateLimit.imagePullPolicy` | Image pull policy | `IfNotPresent` |
| `sidecars.rateLimit.redis.serviceName` | Redis service name | `""` |
| `sidecars.rateLimit.redis.port` | Redis port | `6379` |
| `sidecars.rateLimit.configName` | Rate limit config name | `ratelimit-config` |

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
- Optional: HashiCorp Vault server (for secret management)
- Optional: CloudWatch (for AWS environments)

## Architecture

The osmo platform consists of:

### Core Services
- **API Service**: Main REST API with ingress, scaling, and authentication
- **Worker Service**: Background job processing with queue-based scaling
- **Logger Service**: Log collection and processing with connection-based scaling
- **Agent Service**: Client communication and management
- **Delayed Job Monitor**: Monitoring and management of delayed background jobs

### Sidecar Components
- **Envoy Proxy**: Advanced traffic routing, authentication
- **Log Agent**: Centralized log collection and forwarding
- **OpenTelemetry Collector**: Metrics and tracing collection
- **Rate Limiter**: API endpoint rate limiting

## Notes

- The chart consists of multiple services: API, Worker, Logger, Agent, and Delayed Job Monitor
- Each service can be scaled independently using HPA
- Authentication is handled through OAuth2 providers with JWT tokens
- The service supports both external OAuth2 providers and internal JWT authentication
- Envoy is used as a proxy sidecar for handling authentication and routing
- Comprehensive logging with Fluent Bit integration
- OpenTelemetry for observability
- Rate limiting available for API endpoints with extensive configuration
