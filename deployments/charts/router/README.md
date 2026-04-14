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

# NVIDIA OSMO - Router Service Helm Chart

This Helm chart deploys the OSMO Router service. Authentication, authorization, and traffic routing are handled by the gateway deployed via the service chart (`gateway.enabled: true`).

## Quick Start

```bash
helm install my-router ./router -f my-values.yaml
```

## Configuration Values

### Global Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `global.osmoImageLocation` | Base location for OSMO Docker images | `nvcr.io/nvidia/osmo` |
| `global.osmoImageTag` | Docker image tag for OSMO router service | `latest` |
| `global.imagePullSecret` | Name of the Kubernetes secret for Docker registry credentials | `null` |
| `global.nodeSelector` | Global node selector constraints | `{}` |
| `global.logs.enabled` | Enable centralized logging collection | `true` |
| `global.logs.logLevel` | Application log level (DEBUG, INFO, WARNING, ERROR, CRITICAL) | `DEBUG` |
| `global.logs.k8sLogLevel` | Kubernetes system log level | `WARNING` |

### Router Service Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `services.service.imageName` | Router Docker image name | `router` |
| `services.service.imagePullPolicy` | Image pull policy | `Always` |
| `services.service.serviceName` | Kubernetes service name | `osmo-router` |
| `services.service.initContainers` | Init containers for router service | `[]` |
| `services.service.hostname` | Hostname for ingress (required) | `""` |
| `services.service.webserverEnabled` | Enable wildcard subdomain support | `false` |
| `services.service.extraArgs` | Additional command line arguments | `[]` |
| `services.service.serviceAccountName` | Kubernetes service account name | `router` |
| `services.service.hostAliases` | Custom DNS resolution within pods | `[]` |

#### Scaling Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `services.service.scaling.minReplicas` | Minimum number of replicas | `3` |
| `services.service.scaling.maxReplicas` | Maximum number of replicas | `5` |
| `services.service.scaling.memoryTarget` | Target memory utilization percentage for HPA | `80` |
| `services.service.scaling.hpaCpuTarget` | Target CPU utilization percentage for HPA | `80` |
| `services.service.scaling.customMetrics` | Additional custom metrics for HPA scaling (list of autoscaling/v2 metric specs) | `[]` |

#### Ingress Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `services.service.ingress.enabled` | Enable ingress for direct access (disable when using the gateway) | `true` |
| `services.service.ingress.prefix` | URL path prefix for ingress rules | `/` |
| `services.service.ingress.ingressClass` | Ingress controller class | `nginx` |
| `services.service.ingress.sslEnabled` | Enable SSL/TLS encryption | `true` |
| `services.service.ingress.sslSecret` | Name of SSL/TLS certificate secret | `osmo-tls` |
| `services.service.ingress.annotations` | Custom ingress annotations | `{}` |

#### Resource Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `services.service.resources` | Resource limits and requests for router container | `{}` |
| `services.service.nodeSelector` | Node selector constraints for router pods | `{}` |
| `services.service.tolerations` | Tolerations for pod scheduling on tainted nodes | `[]` |
| `services.service.topologySpreadConstraints` | Topology spread constraints | See values.yaml |

### Configuration File Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `services.configFile.enabled` | Enable external configuration file loading | `false` |
| `services.configFile.path` | Path to the configuration file | `/opt/osmo/config.yaml` |

### PostgreSQL Database Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `services.postgres.serviceName` | PostgreSQL service name | `postgres` |
| `services.postgres.port` | PostgreSQL service port | `5432` |
| `services.postgres.db` | PostgreSQL database name | `osmo` |
| `services.postgres.user` | PostgreSQL username | `postgres` |

### Redis Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `services.redis.serviceName` | Kubernetes service name for Redis | `redis` |
| `services.redis.port` | Redis service port | `6379` |
| `services.redis.dbNumber` | Redis database number to use (0-15) | `0` |
| `services.redis.tlsEnabled` | Enable TLS encryption for Redis connections | `true` |

### Extensibility

| Parameter | Description | Default |
|-----------|-------------|---------|
| `extraContainers` | Additional sidecar containers | `[]` |
| `extraVolumes` | Additional volumes | `[]` |
| `extraPodLabels` | Additional pod labels | `{}` |
| `extraPodAnnotations` | Additional pod annotations | `{}` |
| `extraVolumeMounts` | Additional volume mounts | `[]` |
| `extraConfigMaps` | Additional ConfigMaps to create | `[]` |

## Health Checks

- **Liveness Probe**: `/api/router/version` on port `8000`
- **Readiness Probe**: `/api/router/version` on port `8000`
- **Startup Probe**: `/api/router/version` on port `8000`

## Dependencies

This chart requires:
- Kubernetes cluster (1.19+)
- Access to NVIDIA container registry
- PostgreSQL database
- Ingress controller (NGINX or AWS ALB), or the OSMO gateway from the service chart

## Examples

See the `charts_value/router/` directory for example configurations for different environments.
