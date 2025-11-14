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

# NVIDIA OSMO - UI Service Helm Chart

This Helm chart deploys the OSMO UI service along with its required sidecars and configurations.

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
| `global.logs.enabled` | Enable centralized logging collection and log volume mounting | `true` |


### UI Service Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `services.ui.replicas` | Number of UI replicas (when scaling is disabled) | `1` |
| `services.ui.imageName` | Name of UI image | `web-ui` |
| `services.ui.imagePullPolicy` | Image pull policy | `Always` |
| `services.ui.serviceName` | Name of the service | `osmo-ui` |
| `services.ui.hostname` | Hostname for the service | `""` (empty, must be configured) |
| `services.ui.apiHostname` | Hostname on which the API is served | `"osmo-service.osmo.svc.cluster.local:80"` |
| `service.ui.nextjsSslEnabled` | SSL/TLS encryption for nextjs server to connect to the osmo API server | `false` |
| `services.ui.nodeSelector` | Node selector constraints for UI pod scheduling | `{}` |
| `services.ui.hostAliases` | Host aliases for custom DNS resolution | `[]` |
| `services.ui.tolerations` | Tolerations for pod scheduling on tainted nodes | `[]` |
| `services.ui.resources` | Resource limits and requests for the UI container | `{}` |
| `services.ui.docsBaseUrl` | Documentation base URL users will see from the UI | `"https://nvidia.github.io/OSMO/user_guide/"` |
| `services.ui.cliInstallScriptUrl` | CLI Installation Script URL displayed in the UI | `"https://raw.githubusercontent.com/NVIDIA/OSMO/refs/heads/main/install.sh"` |

### UI Scaling Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `services.ui.scaling.enabled` | Enable HorizontalPodAutoscaler | `false` |
| `services.ui.scaling.minReplicas` | Minimum number of replicas | `1` |
| `services.ui.scaling.maxReplicas` | Maximum number of replicas | `3` |
| `services.ui.scaling.hpaTarget` | Target Memory Utilization Percentage | `85` |

### Ingress Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `services.service.ingress.enabled` | Enable ingress for external access | `true`|
| `services.ui.ingress.prefix` | URL path prefix | `/` |
| `services.ui.ingress.ingressClass` | Ingress controller class | `nginx` |
| `services.ui.ingress.sslEnabled` | Enable SSL | `true` |
| `services.ui.ingress.sslSecret` | Name of SSL secret | `osmo-tls` |

#### ALB Annotations Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `services.ui.ingress.albAnnotations.enabled` | Enable ALB annotations | `false` |
| `services.ui.ingress.albAnnotations.sslCertArn` | ARN of SSL certificate | `arn:aws:acm:us-west-2:XXXXXXXXX:certificate/YYYYYYYY` |

### Sidecar Container Settings

#### Envoy Proxy Sidecar

| Parameter | Description | Default |
|-----------|-------------|---------|
| `sidecars.envoy.enabled` | Enable Envoy proxy sidecar | `true` |
| `sidecars.envoy.useKubernetesSecrets` | Use Kubernetes secrets for Envoy | `false` |
| `sidecars.envoy.secretPaths.clientSecret` | Path to OAuth2 client secret file | `/etc/envoy/secrets/client_secret` |
| `sidecars.envoy.secretPaths.hmacSecret` | Path to OAuth2 HMAC secret file | `/etc/envoy/secrets/hmac_secret` |
| `sidecars.envoy.image.repository` | Envoy image repository | `envoyproxy/envoy:v1.29.0` |
| `sidecars.envoy.image.pullPolicy` | Envoy image pull policy | `IfNotPresent` |
| `sidecars.envoy.service.address` | Backend service address | `127.0.0.1` |
| `sidecars.envoy.service.port` | Backend service port | `8000` |
| `sidecars.envoy.service.hostname` | Service hostname | `""` (empty, must be configured) |
| `sidecars.envoy.listenerPort` | Envoy listener port | `80` |
| `sidecars.envoy.maxHeadersSizeKb` | Maximum HTTP headers size in KB | `128` |
| `sidecars.envoy.skipAuthPaths` | Paths to skip authentication | `[]` |

#### JWT Authentication Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `sidecars.envoy.jwt.user_header` | JWT user header name | `x-osmo-user` |
| `sidecars.envoy.jwt.providers[].issuer` | JWT token issuer | `""` (empty, must be configured) |
| `sidecars.envoy.jwt.providers[].audience` | JWT token audience | `""` (empty, must be configured) |
| `sidecars.envoy.jwt.providers[].jwks_uri` | JWT JWKS URI | `""` (empty, must be configured) |
| `sidecars.envoy.jwt.providers[].user_claim` | JWT user claim field | `preferred_username` |
| `sidecars.envoy.jwt.providers[].cluster` | Target cluster name | `oauth` |

#### OAuth2 Filter Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `sidecars.envoy.oauth2Filter.enabled` | Enable OAuth2 filter | `true` |
| `sidecars.envoy.oauth2Filter.tokenEndpoint` | OAuth2 token endpoint URL | `""` (empty, must be configured) |
| `sidecars.envoy.oauth2Filter.authEndpoint` | OAuth2 authorization endpoint URL | `""` (empty, must be configured) |
| `sidecars.envoy.oauth2Filter.redirectPath` | OAuth2 redirect path | `getAToken` |
| `sidecars.envoy.oauth2Filter.clientId` | OAuth2 client ID | `""` (empty, must be configured) |
| `sidecars.envoy.oauth2Filter.authProvider` | OAuth2 authentication provider | `""` (empty, must be configured) |
| `sidecars.envoy.oauth2Filter.logoutPath` | OAuth2 logout path | `logout` |
| `sidecars.envoy.oauth2Filter.secretName` | Kubernetes secret name (when useKubernetesSecrets is true) | `oidc-secrets` |
| `sidecars.envoy.oauth2Filter.clientSecretKey` | Secret key for OAuth2 client secret | `client_secret` |
| `sidecars.envoy.oauth2Filter.hmacSecretKey` | Secret key for OAuth2 HMAC secret | `hmac_secret` |

#### Log Agent Sidecar

| Parameter | Description | Default |
|-----------|-------------|---------|
| `sidecars.logAgent.enabled` | Enable log agent (FluentBit) sidecar | `false` |
| `sidecars.logAgent.image.repository` | FluentBit image repository | `fluent/fluent-bit:4.0.8-debug` |
| `sidecars.logAgent.image.pullPolicy` | FluentBit image pull policy | `IfNotPresent` |
| `sidecars.logAgent.fluentBitPrometheusPort` | FluentBit Prometheus metrics port | `2020` |

#### Log Agent AWS CloudWatch Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `sidecars.logAgent.aws.region` | AWS region for CloudWatch | `us-west-2` |
| `sidecars.logAgent.aws.clusterName` | EKS cluster name for CloudWatch | `""` (empty, must be configured) |

#### Log Agent Log Rotation Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `sidecars.logAgent.logrotate.enabled` | Enable log rotation | `false` |
| `sidecars.logAgent.logrotate.frequency` | Log rotation frequency | `hourly` |
| `sidecars.logAgent.logrotate.maxSize` | Maximum log file size | `10M` |
| `sidecars.logAgent.logrotate.rotateCount` | Number of rotated files to keep | `5` |
| `sidecars.logAgent.logrotate.sleepSeconds` | Sleep interval between rotations | `60` |

#### OpenTelemetry Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `sidecars.otel.enabled` | Enable OpenTelemetry sidecar injection | `true` |

#### Additional Custom Containers

| Parameter | Description | Default |
|-----------|-------------|---------|
| `extraContainers` | List of additional custom containers to add to the pod | `[]` |

## Dependencies

This chart is self-contained and requires:
- A running Kubernetes cluster
- Access to NVIDIA container registry
- ALB or NGINX ingress controller
- Properly configured OAuth2 provider

**Optional Dependencies:**
- OpenTelemetry collector (if OTEL sidecar injection is enabled)
- AWS CloudWatch (if log agent with CloudWatch is enabled)
- Kubernetes secrets (if using `useKubernetesSecrets: true` for OAuth2 credentials)
