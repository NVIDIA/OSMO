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


# NVIDIA OSMO - Backend-Operator Helm Chart

This Helm chart deploys the OSMO Backend-Operator for managing compute backend resources and monitoring.

## Values

### Global Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `global.name` | Name override for deployment (optional) | `null` |
| `global.osmoImageLocation` | Location of OSMO images | `nvcr.io/nvidia/osmo` |
| `global.osmoImageTag` | Tag of the OSMO images | `latest` |
| `global.imagePullSecret` | Name of the image pull secret | `null` |
| `global.nodeSelector` | Global node selector | `{}` |
| `global.agentNamespace` | Namespace for agent deployment | `osmo` |
| `global.backendName` | Name identifier for this backend | `default` |
| `global.backendNamespace` | Backend namespace | `osmo-namespace` |
| `global.backendTestNamespace` | Namespace for backend cluster validation tests | `null` |
| `global.serviceUrl` | Service URL | `""` (empty, must be configured) |
| `global.accountUsername` | Account username | `""` (empty, must be configured) |
| `global.accountPasswordSecret` | Secret name for account password | `svc-osmo-admin` |
| `global.accountPasswordSecretKey` | Secret key for account password | `password` |
| `global.accountTokenSecret` | Secret name for account token | `agent-token` |
| `global.accountTokenSecretKey` | Secret key for account token | `token` |
| `global.loginMethod` | Login method | `password` |
| `global.nodeConditionPrefix` | Node condition prefix | `""` (empty) |
| `global.includeNamespaceUsage` | Namespaces to include in usage monitoring | `osmo-staging,osmo-prod` |
| `global.enableClusterRoles` | Enable cluster roles | `true` |
| `global.enableNonClusterRoles` | Enable non-cluster roles | `true` |

### Global Network Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `global.network.restrictEgress` | Restrict egress traffic for workflow pods | `false` |
| `global.network.allowlistEgress.enabled` | Enable egress allowlist | `false` |
| `global.network.allowlistEgress.proxyNamespace` | Proxy namespace | `osmo-squid-proxy` |
| `global.network.allowlistEgress.additionalAllowedDomains` | Additional allowed domains | `[]` |
| `global.network.allowlistEgress.sidecarContainers` | Additional sidecar containers | `[]` |
| `global.network.allowlistEgress.additionalVolumes` | Additional volumes for sidecar containers | `[]` |
| `global.network.allowlistEgress.hostAliases` | Host aliases for pods | `[]` |
| `global.network.allowlistEgress.resources.requests.cpu` | CPU requests for allowlist squid proxy server | `2` |
| `global.network.allowlistEgress.resources.requests.memory` | Memory requests for allowlist squid proxy server | `4Gi` |
| `global.network.allowlistEgress.resources.limits.memory` | Memory limits for allowlist squid proxy server | `4Gi` |


### Global Logging Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `global.logs.logLevel` | Log level for application | `DEBUG` |
| `global.logs.k8sLogLevel` | Log level for Kubernetes | `WARNING` |

### Global Tolerations

| Parameter | Description | Default |
|-----------|-------------|---------|
| `global.tolerations` | Global tolerations | `[{"key": "ops", "operator": "Exists", "effect": "NoSchedule"}]` |

### Priority Classes

| Parameter | Description | Default |
|-----------|-------------|---------|
| `global.priorityClasses.enabled` | Enable priority classes (only used if kaischeduler plugin is enabled) | `true` |
| `global.priorityClasses.classes[0].name` | High priority class name | `osmo-high` |
| `global.priorityClasses.classes[0].value` | High priority class value | `125` |
| `global.priorityClasses.classes[1].name` | Normal priority class name | `osmo-normal` |
| `global.priorityClasses.classes[1].value` | Normal priority class value | `100` |
| `global.priorityClasses.classes[2].name` | Low priority class name | `osmo-low` |
| `global.priorityClasses.classes[2].value` | Low priority class value | `50` |




### Service Settings

#### Backend Listener

| Parameter | Description | Default |
|-----------|-------------|---------|
| `services.backendListener.enableNodeLabelUpdate` | Enable node label updates | `false` |
| `services.backendListener.imageName` | Listener image name | `backend-listener` |
| `services.backendListener.imagePullPolicy` | Image pull policy | `Always` |
| `services.backendListener.serviceName` | Service name | `osmo-backend-listener` |
| `services.backendListener.initContainers` | Init containers for backend listener | `[]` |
| `services.backendListener.serviceAccount` | Service account name | `backend-listener` |
| `services.backendListener.max_unacked_messages` | Maximum unacked messages | `100` |
| `services.backendListener.podCacheTtl` | Pod cache TTL in seconds | `15` |
| `services.backendListener.extraArgs` | Additional arguments | `[]` |
| `services.backendListener.extraEnvs` | Additional environment variables | `[]` |
| `services.backendListener.extraPodAnnotations` | Additional pod annotations | `{}` |
| `services.backendListener.extraPodLabels` | Additional pod labels | `{}` |
| `services.backendListener.extraSidecarContainers` | Additional sidecar containers | `[]` |
| `services.backendListener.nodeSelector` | Node selector | `{}` |
| `services.backendListener.hostAliases` | Host aliases | `[]` |
| `services.backendListener.volumes` | Volumes for backend listener | Default includes progress files for liveness and startup probes |
| `services.backendListener.volumeMounts` | Volume mounts for backend listener | Default includes progress files mount at `/var/run/osmo` |
| `services.backendListener.resources.requests.cpu` | CPU requests | `2` |
| `services.backendListener.resources.requests.memory` | Memory requests | `16Gi` |
| `services.backendListener.resources.limits.cpu` | CPU limits | `2` |
| `services.backendListener.resources.limits.memory` | Memory limits | `16Gi` |
| `services.backendListener.apiQps` | QPS (Queries Per Second) to Kube-API Server | `20` |
| `services.backendListener.apiBurst` | API Burst Setting for Kube-API requests | `30` |

#### Backend Worker

| Parameter | Description | Default |
|-----------|-------------|---------|
| `services.backendWorker.imageName` | Worker image name | `backend-worker` |
| `services.backendWorker.imagePullPolicy` | Image pull policy | `Always` |
| `services.backendWorker.serviceName` | Service name | `osmo-backend-worker` |
| `services.backendWorker.initContainers` | Init containers for backend worker | `[]` |
| `services.backendWorker.serviceAccount` | Service account name | `backend-worker` |
| `services.backendWorker.extraArgs` | Additional arguments | `[]` |
| `services.backendWorker.extraEnvs` | Additional environment variables | `[]` |
| `services.backendWorker.extraPodAnnotations` | Additional pod annotations | `{}` |
| `services.backendWorker.extraPodLabels` | Additional pod labels | `{}` |
| `services.backendWorker.extraSidecarContainers` | Additional sidecar containers | `[]` |
| `services.backendWorker.nodeSelector` | Node selector | `{}` |
| `services.backendWorker.hostAliases` | Host aliases | `[]` |
| `services.backendWorker.volumes` | Volumes for backend worker | See values.yaml |
| `services.backendWorker.volumeMounts` | Volume mounts for backend worker | See values.yaml |
| `services.backendWorker.resources.requests.cpu` | CPU requests | `1` |
| `services.backendWorker.resources.requests.memory` | Memory requests | `512Mi` |
| `services.backendWorker.resources.limits.cpu` | CPU limits | `2` |
| `services.backendWorker.resources.limits.memory` | Memory limits | `1Gi` |


### Service Sidecar Settings

#### OpenTelemetry Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `sidecars.OTEL.enabled` | Enable OpenTelemetry | `true` |
| `sidecars.OTEL.image` | OpenTelemetry collector image | `otel/opentelemetry-collector-contrib:0.68.0` |
| `sidecars.OTEL.configName` | OpenTelemetry config name | `otel-config` |
| `sidecars.OTEL.ports` | OpenTelemetry container ports | `[{containerPort: 4000, name: metrics}]` |
| `sidecars.OTEL.resources` | OpenTelemetry resource limits | See values.yaml |

#### Extra ConfigMaps

| Parameter | Description | Default |
|-----------|-------------|---------|
| `extraConfigMaps` | Additional ConfigMaps to create | `{}` |

The `extraConfigMaps` section allows you to define additional ConfigMaps that will be created alongside the chart. Each ConfigMap can have its own data, labels, and annotations.

Example:
```yaml
extraConfigMaps:
  my-config:
    data:
      config.yaml: |
        key: value
        setting: enabled
      script.sh: |
        #!/bin/bash
        echo "Hello World"
    annotations:
      description: "Custom configuration"
    labels:
      component: "custom"
```

## Dependencies

This chart requires:
- A running Kubernetes cluster
- Access to NVIDIA container registry
- OpenTelemetry collector (if OTEL is enabled)
- Slack integration (if monitor Slack notifications enabled)
- KAI scheduler


## Notes

- The chart consists of three main components:
  - **Backend Listener**: Handles backend events and notifications with configurable message limits
  - **Backend Worker**: Processes backend tasks with resource management

- Each component can be configured independently with custom resources and settings
- Includes comprehensive mount monitoring with failure threshold configuration
- Integrates with OpenTelemetry for observability
- Configurable network egress controls for security
- Priority classes for workload scheduling optimization
