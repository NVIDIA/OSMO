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

# NVIDIA OSMO - Router Service Helm Chart

This Helm chart deploys the OSMO Router service with integrated Envoy proxy and log agent sidecars. The chart has been restructured to be self-contained, removing dependencies on external sidecar charts.

## Architecture

The router deployment includes:
- **Main Router Container**: The core OSMO router service
- **Envoy Proxy Sidecar**: Handles authentication, routing, and SSL termination
- **Log Agent Sidecar**: Centralized logging with Fluent Bit

## Quick Start

```bash
# Install with default values
helm install my-router ./router

# Install with custom values
helm install my-router ./router -f my-values.yaml

# Upgrade existing installation
helm upgrade my-router ./router -f my-values.yaml
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

#### Ingress Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `services.service.ingress.enabled` | Enable ingress for external access | `true`|
| `services.service.ingress.prefix` | URL path prefix for ingress rules | `/` |
| `services.service.ingress.ingressClass` | Ingress controller class | `nginx` |
| `services.service.ingress.sslEnabled` | Enable SSL/TLS encryption | `true` |
| `services.service.ingress.sslSecret` | Name of SSL/TLS certificate secret | `osmo-tls` |
| `services.service.ingress.annotations` | Custom ingress annotations | `{}` |

#### ALB Annotations

| Parameter | Description | Default |
|-----------|-------------|---------|
| `services.service.ingress.albAnnotations.enabled` | Enable ALB-specific annotations | `false` |
| `services.service.ingress.albAnnotations.sslCertArn` | ARN of SSL certificate for HTTPS | `arn:aws:acm:us-west-2:XXXXXXXXX:certificate/YYYYYYYY` |

#### Resource Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `services.service.resources` | Resource limits and requests for router container | `{}` |
| `services.service.nodeSelector` | Node selector constraints for router pods | `{}` |
| `services.service.tolerations` | Tolerations for pod scheduling on tainted nodes | `[]` |
| `services.service.topologySpreadConstraints` | Topology spread constraints | See values.yaml |

#### Health Probe Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `services.service.livenessProbe` | Liveness probe configuration for router container | See values.yaml |
| `services.service.startupProbe` | Startup probe configuration for router container | See values.yaml |
| `services.service.readinessProbe` | Readiness probe configuration for router container | See values.yaml |

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
| `services.postgres.password` | PostgreSQL password | `""` |

## Sidecar Configuration

### Envoy Proxy Sidecar

| Parameter | Description | Default |
|-----------|-------------|---------|
| `sidecars.envoy.enabled` | Enable Envoy proxy sidecar | `true` |
| `sidecars.envoy.useKubernetesSecrets` | Use Kubernetes secrets for credentials | `false` |
| `sidecars.envoy.skipAuthPaths` | Paths that should skip authentication | `["/api/router/version"]` |
| `sidecars.envoy.image` | Envoy proxy container image | `envoyproxy/envoy:v1.29.0` |
| `sidecars.envoy.imagePullPolicy` | Image pull policy for Envoy | `IfNotPresent` |
| `sidecars.envoy.listenerPort` | Port for incoming requests | `80` |
| `sidecars.envoy.maxHeadersSizeKb` | Maximum size of HTTP headers in KB | `128` |
| `sidecars.envoy.maxRequests` | Maximum request Envoy will handle for the router service | `1000` |
| `sidecars.envoy.logLevel` | Log level for Envoy proxy | `info` |
| `sidecars.envoy.resources` | Resource limits and requests | See values.yaml |

#### Envoy Service Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `sidecars.envoy.service.port` | Upstream service port | `8000` |
| `sidecars.envoy.service.hostname` | Envoy service hostname | `""` |
| `sidecars.envoy.service.address` | Local service address | `127.0.0.1` |

#### Envoy Routing

| Parameter | Description | Default |
|-----------|-------------|---------|
| `sidecars.envoy.routes` | Route configuration for Envoy | See values.yaml |

#### OAuth2 Filter Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `sidecars.envoy.oauth2Filter.enabled` | Enable OAuth2 authentication | `true` |
| `sidecars.envoy.oauth2Filter.forwardBearerToken` | Forward bearer token to upstream | `true` |
| `sidecars.envoy.oauth2Filter.tokenEndpoint` | OAuth2 token endpoint URL | `""` |
| `sidecars.envoy.oauth2Filter.authEndpoint` | OAuth2 authorization endpoint URL | `""` |
| `sidecars.envoy.oauth2Filter.redirectPath` | OAuth2 callback redirect path | `api/auth/getAToken` |
| `sidecars.envoy.oauth2Filter.clientId` | OAuth2 client ID | `""` |
| `sidecars.envoy.oauth2Filter.authProvider` | OAuth2 authentication provider | `""` |
| `sidecars.envoy.oauth2Filter.logoutPath` | OAuth2 logout path | `logout` |
| `sidecars.envoy.oauth2Filter.secretName` | Kubernetes secret name for OIDC secrets | `oidc-secrets` |
| `sidecars.envoy.oauth2Filter.clientSecretKey` | Key name for client secret in Kubernetes secret | `client_secret` |
| `sidecars.envoy.oauth2Filter.hmacSecretKey` | Key name for HMAC secret in Kubernetes secret | `hmac_secret` |

#### JWT Authentication

| Parameter | Description | Default |
|-----------|-------------|---------|
| `sidecars.envoy.jwt.enabled` | Enable JWT authentication | `true` |
| `sidecars.envoy.jwt.user_header` | HTTP header for authenticated user | `x-osmo-user` |
| `sidecars.envoy.jwt.providers` | List of JWT token providers | `[]` |

#### OSMO Authentication

| Parameter | Description | Default |
|-----------|-------------|---------|
| `sidecars.envoy.osmoauth.enabled` | Enable OSMO authentication service | `true` |
| `sidecars.envoy.osmoauth.port` | OSMO auth service port | `80` |
| `sidecars.envoy.osmoauth.hostname` | OSMO auth hostname | `""` |
| `sidecars.envoy.osmoauth.address` | OSMO auth service address | `osmo-service` |

#### Secret Paths

| Parameter | Description | Default |
|-----------|-------------|---------|
| `sidecars.envoy.secretPaths.clientSecret` | Path to OAuth2 client secret | `/etc/envoy/secrets/client_secret` |
| `sidecars.envoy.secretPaths.hmacSecret` | Path to HMAC secret | `/etc/envoy/secrets/hmac_secret` |

### Log Agent Sidecar

| Parameter | Description | Default |
|-----------|-------------|---------|
| `sidecars.logAgent.enabled` | Enable log agent sidecar | `true` |
| `sidecars.logAgent.image` | Log agent container image | `fluent/fluent-bit:4.0.8-debug` |
| `sidecars.logAgent.imagePullPolicy` | Image pull policy for log agent | `IfNotPresent` |
| `sidecars.logAgent.prometheusPort` | Port for Prometheus metrics | `2020` |
| `sidecars.logAgent.configName` | Name of log agent ConfigMap | `router-log-agent-config` |
| `sidecars.logAgent.resources` | Resource limits and requests | See values.yaml |

#### Log Rotation

| Parameter | Description | Default |
|-----------|-------------|---------|
| `sidecars.logAgent.logrotate.enabled` | Enable log rotation | `true` |
| `sidecars.logAgent.logrotate.frequency` | Log rotation frequency | `hourly` |
| `sidecars.logAgent.logrotate.maxSize` | Maximum log file size | `10M` |
| `sidecars.logAgent.logrotate.rotateCount` | Number of log files to keep | `5` |

#### CloudWatch Logging

| Parameter | Description | Default |
|-----------|-------------|---------|
| `sidecars.logAgent.cloudwatch.region` | AWS region for CloudWatch | `us-west-2` |
| `sidecars.logAgent.cloudwatch.clusterName` | Cluster name for log grouping | `""` |
| `sidecars.logAgent.cloudwatch.role` | IAM role ARN for CloudWatch access | `""` |

## Extensibility Configuration

The chart provides several extension points for customization:

| Parameter | Description | Default |
|-----------|-------------|---------|
| `extraContainers` | Additional sidecar containers | `[]` |
| `extraVolumes` | Additional volumes | `[]` |
| `extraPodLabels` | Additional pod labels | `{}` |
| `extraPodAnnotations` | Additional pod annotations | `{}` |
| `extraEnvs` | Additional environment variables | `[]` |
| `extraArgs` | Additional command line arguments | `[]` |
| `extraPorts` | Additional container ports | `[]` |
| `extraVolumeMounts` | Additional volume mounts | `[]` |
| `extraConfigMaps` | Additional ConfigMaps to create | `[]` |


## Health Checks

The chart includes comprehensive health checks:

### Router Container (Main Service)
- **Liveness Probe**: `/api/router/version` on port `8000`
- **Readiness Probe**: `/api/router/version` on port `8000`
- **Startup Probe**: `/api/router/version` on port `8000`


## Dependencies

This chart requires:
- Kubernetes cluster (1.19+)
- Access to NVIDIA container registry
- PostgreSQL database
- OAuth2 authentication provider (Keycloak, Auth0, etc.)
- Ingress controller (NGINX or AWS ALB)
- Optional: CloudWatch for centralized logging


## Troubleshooting

### Common Issues

1. **Authentication failures**: Check OAuth2 configuration and secret paths
2. **SSL/TLS issues**: Verify certificate configuration and ingress settings
3. **Database connection**: Ensure PostgreSQL settings and network connectivity

### Debugging

```bash
# Check pod status
kubectl get pods -l app=osmo-router

# View logs
kubectl logs -l app=osmo-router -c router
kubectl logs -l app=osmo-router -c envoy
kubectl logs -l app=osmo-router -c log-agent

# Check configuration
helm template my-router ./router -f my-values.yaml

# Validate generated resources
helm template my-router ./router -f my-values.yaml | kubectl apply --dry-run=client -f -
```

## Examples

See the `charts_value/router/` directory for example configurations for different environments.
