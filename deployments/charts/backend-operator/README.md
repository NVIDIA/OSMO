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


# NVIDIA OSMO - Backend-Operator Helm Chart

This Helm chart deploys the OSMO Backend-Operator for managing compute backend resources and monitoring.

Starting with chart version 1.3.0 this chart also installs the
`workflow.osmo.nvidia.com/v1alpha1 OSMOTaskGroup` CustomResourceDefinition that
the OSMOTaskGroup controller (PROJ-taskgroup-crd) reconciles. The CRD lives
under `templates/` (not `crds/`) so chart upgrades apply schema changes; this
matters during Phase 1 while the v1alpha1 schema is still evolving. The
controller Deployment itself ships in a later chart bump once the reconcile
loop is fully wired.

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
| `global.serviceGrpcPort` | Port for gRPC connections. Ignore if empty | `""` (empty) |
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

### Global NetworkPolicy Settings

When enabled, a `NetworkPolicy` is applied to the workflow namespace (`global.backendNamespace`) that allows unrestricted external internet egress while blocking cross-namespace cluster traffic except to explicitly allowlisted namespaces.

| Parameter | Description | Default |
|-----------|-------------|---------|
| `global.networkPolicy.enabled` | Create the `NetworkPolicy`. When `false`, all egress is unrestricted. | `false` |
| `global.networkPolicy.clusterCIDRs` | Internal cluster CIDRs (pod CIDR, service CIDR) to exclude from the external egress rule. Required for namespace isolation to be effective. | `[]` |
| `global.networkPolicy.dnsNamespace` | Namespace containing the cluster DNS service (CoreDNS/kube-dns). Port 53 egress is allowed to pods in this namespace. | `kube-system` |
| `global.networkPolicy.allowedNamespaces` | Additional namespaces that workflow pods may reach. | `[]` |
| `global.networkPolicy.additionalEgressRules` | Raw `NetworkPolicyEgressRule` objects appended to the policy. Use for IP-based allowances or DNS workarounds on iptables-based CNIs. | `[]` |


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

The backend listener supports two implementations controlled by the `useV2` flag:
- **v1 (default)**: Python-based listener (`backend-listener` image)
- **v2**: Go-based listener (`backend-listener-v2` image)

Set `services.backendListener.useV2: true` to switch to the Go-based listener.

##### Shared Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `services.backendListener.useV2` | Use Go-based v2 listener instead of Python v1 | `false` |
| `services.backendListener.imageName` | Listener image name (v2 appends `-v2` automatically) | `backend-listener` |
| `services.backendListener.imagePullPolicy` | Image pull policy | `Always` |
| `services.backendListener.serviceName` | Service name | `osmo-backend-listener` |
| `services.backendListener.initContainers` | Init containers for backend listener | `[]` |
| `services.backendListener.serviceAccount` | Service account name | `backend-listener` |
| `services.backendListener.maxUnackedMessages` | Maximum number of unacknowledged messages | `100` |
| `services.backendListener.enableNodeLabelUpdate` | Enable updating node verified label based on availability | `false` |
| `services.backendListener.extraArgs` | Additional command line arguments | `[]` |
| `services.backendListener.extraEnvs` | Additional environment variables | `[]` |
| `services.backendListener.extraPodAnnotations` | Additional pod annotations | `{}` |
| `services.backendListener.extraPodLabels` | Additional pod labels | `{}` |
| `services.backendListener.extraSidecarContainers` | Additional sidecar containers | `[]` |
| `services.backendListener.nodeSelector` | Node selector | `{}` |
| `services.backendListener.hostAliases` | Host aliases | `[]` |
| `services.backendListener.volumes` | Volumes for backend listener | Default includes progress files for liveness and startup probes |
| `services.backendListener.volumeMounts` | Volume mounts for backend listener | Default includes progress files mount at `/var/run/osmo` |
| `services.backendListener.resources.requests.cpu` | CPU requests | `1` |
| `services.backendListener.resources.requests.memory` | Memory requests | `2Gi` |
| `services.backendListener.resources.limits.memory` | Memory limits | `2Gi` |

##### V1 (Python) Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `services.backendListener.podCacheTtl` | Time-to-live for pod cache entries (in seconds) | `15` |
| `services.backendListener.apiQps` | Kubernetes API client QPS setting | `20` |
| `services.backendListener.apiBurst` | Kubernetes API client burst setting | `30` |

##### V2 (Go) Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `services.backendListener.resyncPeriodSec` | Resync period in seconds for Kubernetes informer | `300` |
| `services.backendListener.stateCacheTTLMin` | Time-to-live for state cache entries (in minutes) | `15` |
| `services.backendListener.usageFlushIntervalSec` | Usage flush interval in seconds for resource usage updates | `15` |
| `services.backendListener.progressDir` | Directory to write progress timestamps to (for liveness/startup probes) | `/tmp/osmo/operator` |
| `services.backendListener.progressFrequencySec` | Progress frequency in seconds (for periodic progress reporting when idle) | `15` |
| `services.backendListener.eventChanSize` | Buffer size for event channel (EventListener) | `500` |
| `services.backendListener.eventCacheTTLMin` | Event deduplication cache TTL in minutes | `15` |
| `services.backendListener.labelUpdateChanSize` | Buffer size for label update channel | `200` |
| `services.backendListener.metrics.component` | Service component name for metrics | `osmo-backend-listener` |
| `services.backendListener.metrics.version` | Service version for metrics (defaults to image tag if empty) | `""` |

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
| `services.backendWorker.extraRBACRules` | Extra RBAC rules appended to the backend worker Role in the workflow namespace. Use this to grant permissions for Kubernetes resource kinds (vanilla or CRD) that your group templates create. Each entry follows the standard `PolicyRule` format. | `[]` |


### Prometheus Metrics Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `podMonitor.enabled` | Enable PodMonitor for Prometheus scraping (requires `monitoring.coreos.com` CRD) | `true` |

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
- Prometheus Operator (if `podMonitor.enabled` is true)
- Slack integration (if monitor Slack notifications enabled)
- KAI scheduler


## Notes

- The chart consists of three main components:
  - **Backend Listener**: Handles backend events and notifications with configurable message limits
  - **Backend Worker**: Processes backend tasks with resource management

- Each component can be configured independently with custom resources and settings
- Includes comprehensive mount monitoring with failure threshold configuration
- Integrates with OpenTelemetry for observability
- Optional Kubernetes `NetworkPolicy` to restrict cross-namespace egress while permitting external internet traffic
- Priority classes for workload scheduling optimization
