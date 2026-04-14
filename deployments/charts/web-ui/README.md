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

# NVIDIA OSMO - UI Service Helm Chart

This Helm chart deploys the OSMO UI (Next.js web frontend). Authentication and traffic routing are handled by the gateway deployed via the service chart (`gateway.enabled: true`).

## Values

### Global Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `global.osmoImageLocation` | Location of OSMO images | `nvcr.io/nvidia/osmo` |
| `global.osmoImageTag` | Tag of the OSMO images | `latest` |
| `global.imagePullSecret` | Name of the Kubernetes secret containing Docker registry credentials | `null` |
| `global.nodeSelector` | Global node selector | `{}` |
| `global.logs.enabled` | Enable centralized logging collection and log volume mounting | `true` |

### UI Service Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `services.ui.replicas` | Number of UI replicas (when scaling is disabled) | `1` |
| `services.ui.imageName` | Name of UI image | `web-ui` |
| `services.ui.imagePullPolicy` | Image pull policy | `Always` |
| `services.ui.serviceName` | Name of the service | `osmo-ui` |
| `services.ui.hostname` | Hostname for the service | `""` |
| `services.ui.apiHostname` | Hostname on which the API is served | `"osmo-service.osmo.svc.cluster.local:80"` |
| `services.ui.containerPort` | Container port for the UI | `8000` |
| `services.ui.portForwardEnabled` | Enable port-forwarding through Web UI | `false` |
| `services.ui.nodeSelector` | Node selector constraints for UI pod scheduling | `{}` |
| `services.ui.hostAliases` | Host aliases for custom DNS resolution | `[]` |
| `services.ui.tolerations` | Tolerations for pod scheduling on tainted nodes | `[]` |
| `services.ui.resources` | Resource limits and requests for the UI container | `{}` |
| `services.ui.docsBaseUrl` | Documentation base URL displayed in the UI | `"https://nvidia.github.io/OSMO/main/user_guide/"` |
| `services.ui.cliInstallScriptUrl` | CLI Installation Script URL displayed in the UI | See values.yaml |
| `services.ui.maxHttpHeaderSizeKb` | Maximum HTTP header size in KB for the Node.js server | `128` |

### UI Scaling Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `services.ui.scaling.enabled` | Enable HorizontalPodAutoscaler | `false` |
| `services.ui.scaling.minReplicas` | Minimum number of replicas | `1` |
| `services.ui.scaling.maxReplicas` | Maximum number of replicas | `3` |
| `services.ui.scaling.hpaTarget` | Target Memory Utilization Percentage | `85` |
| `services.ui.scaling.customMetrics` | Additional custom metrics for HPA scaling (list of autoscaling/v2 metric specs) | `[]` |

### Ingress Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `services.ui.ingress.enabled` | Enable ingress for direct access (disable when using the gateway) | `true` |
| `services.ui.ingress.ingressClass` | Ingress controller class | `nginx` |
| `services.ui.ingress.sslEnabled` | Enable SSL | `true` |
| `services.ui.ingress.sslSecret` | Name of SSL secret | `osmo-tls` |

#### ALB Annotations Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `services.ui.ingress.albAnnotations.enabled` | Enable ALB annotations | `false` |
| `services.ui.ingress.albAnnotations.sslCertArn` | ARN of SSL certificate | `""` |

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
| `extraContainers` | Additional custom containers to add to the pod | `[]` |
| `extraPodAnnotations` | Additional pod annotations | `{}` |

## Dependencies

This chart requires:
- A running Kubernetes cluster
- Access to NVIDIA container registry
- ALB or NGINX ingress controller, or the OSMO gateway from the service chart
