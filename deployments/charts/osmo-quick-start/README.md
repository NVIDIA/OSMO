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

# NVIDIA OSMO - Quick Start Helm Chart

This Helm chart provides a complete OSMO deployment for trying OSMO. If you are considering using
OSMO, this is a good way to get a feel for OSMO without deploying in a CSP.

It is recommended to install this chart in a KIND cluster instead of a CSP.

## What This Chart Installs

This chart installs and configures:

1. **Ingress NGINX Controller** - For routing traffic to OSMO services
2. **OSMO Core Services**:
   - OSMO service (API server, worker, logger, agent)
   - Documentation service
   - Web UI service
   - Router service
3. **Backend Operator** - For managing compute workloads
4. **Configuration Setup** - Automatic configuration of OSMO for local development

## Configuration

### Global Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `global.osmoImageLocation` | Base location for OSMO Docker images in the registry | `nvcr.io/nvstaging/osmo` |
| `global.osmoImageTag` | Docker image tag for OSMO services | `latest` |
| `global.nodeSelector.node_group` | Node group for service pods | `service` |
| `global.nodeSelector."kubernetes.io/arch"` | Architecture constraint for pod scheduling | `amd64` |
| `global.imagePullSecret` | Name of the Kubernetes secret containing Docker registry credentials | `imagepullsecret` |
| `global.containerRegistry.registry` | Container registry URL | `nvcr.io` |
| `global.containerRegistry.username` | Container registry username | `$oauthtoken` |
| `global.containerRegistry.password` | Container registry password (NGC API key) | `""` |
| `global.objectStorage.endpoint` | Object storage endpoint URL for workflow logs, datasets, and other data | `"s3://osmo"` |
| `global.objectStorage.accessKeyId` | Object storage access key ID for authentication | `"test"` |
| `global.objectStorage.accessKey` | Object storage access key for authentication | `"test"` |
| `global.objectStorage.region` | Object storage region where the bucket is located | `"us-east-1"` |

### Ingress NGINX Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `ingress-nginx.controller.nodeSelector.node_group` | Node group for ingress controller | `service` |
| `ingress-nginx.controller.nodeSelector."kubernetes.io/arch"` | Architecture constraint for ingress controller | `amd64` |
| `ingress-nginx.controller.service.type` | Service type for ingress controller | `NodePort` |
| `ingress-nginx.controller.service.nodePorts.http` | HTTP NodePort for external access | `30080` |


### OSMO Service Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `service.services.configFile.enabled` | Enable external configuration file loading | `true` |
| `service.services.configFile.path` | Path to the MEK configuration file | `/home/osmo/config/mek.yaml` |
| `service.services.postgres.enabled` | Enable PostgreSQL deployment on Kubernetes | `true` |
| `service.services.postgres.storageClassName` | Storage class name for PostgreSQL persistent volume | `standard` |
| `service.services.postgres.password` | PostgreSQL password | `"osmo"` |
| `service.services.redis.enabled` | Enable Redis deployment on Kubernetes | `true` |
| `service.services.redis.storageClassName` | Storage class name for Redis persistent volume | `standard` |
| `service.services.redis.tlsEnabled` | Enable TLS for Redis connections | `false` |
| `service.services.localstackS3.enabled` | Enable Localstack S3 deployment on Kubernetes | `true` |
| `service.services.localstackS3.buckets` | Creates the `osmo` bucket in Localstack S3 | `["osmo"]` |
| `service.services.localstackS3.persistence.enabled` | Enable Localstack S3 persistence | `true` |
| `service.services.localstackS3.persistence.hostPath` | Path to Localstack S3 persistence on the host | `/var/lib/localstack` |
| `service.services.service.hostname` | Hostname for OSMO service ingress | `osmo-ingress-nginx-controller.osmo.svc.cluster.local` |
| `service.services.service.scaling.minReplicas` | Minimum number of service replicas | `1` |
| `service.services.service.scaling.maxReplicas` | Maximum number of service replicas | `1` |
| `service.services.service.ingress.sslEnabled` | Enable SSL for service ingress | `false` |
| `service.services.worker.scaling.minReplicas` | Minimum number of worker replicas | `1` |
| `service.services.worker.scaling.maxReplicas` | Maximum number of worker replicas | `1` |
| `service.services.logger.scaling.minReplicas` | Minimum number of logger service replicas | `1` |
| `service.services.logger.scaling.maxReplicas` | Maximum number of logger service replicas | `1` |
| `service.services.agent.scaling.minReplicas` | Minimum number of agent service replicas | `1` |
| `service.services.agent.scaling.maxReplicas` | Maximum number of agent service replicas | `1` |
| `service.sidecars.envoy.enabled` | Enable Envoy proxy sidecar container | `false` |
| `service.sidecars.logAgent.enabled` | Enable log agent sidecar for centralized log collection | `false` |
| `service.sidecars.logAgent.logrotate.enabled` | Enable automatic log rotation | `false` |
| `service.sidecars.otel.enabled` | Enable OTEL collector sidecar for metrics and tracing | `false` |
| `service.sidecars.rateLimit.enabled` | Enable rate limiting service | `false` |

### Web UI Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `web-ui.services.ui.skipAuth` | Skip authentication for UI service | `true` |
| `web-ui.services.ui.hostname` | Hostname for UI service | `osmo-ingress-nginx-controller.osmo.svc.cluster.local` |
| `web-ui.services.ui.ingress.sslEnabled` | Enable SSL for UI ingress | `false` |
| `web-ui.services.ui.extraEnvs` | Additional environment variables for the UI service | `[{name: NEXT_PUBLIC_OSMO_SSL_ENABLED, value: false}]` |
| `web-ui.sidecars.envoy.enabled` | Enable Envoy proxy sidecar container | `false` |

### Router Service Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `router.services.configFile.enabled` | Enable external configuration file loading | `true` |
| `router.services.configFile.path` | Path to the MEK configuration file | `/home/osmo/config/mek.yaml` |
| `router.services.service.hostname` | Hostname for router service | `osmo-ingress-nginx-controller.osmo.svc.cluster.local` |
| `router.services.service.scaling.minReplicas` | Minimum number of router service replicas | `1` |
| `router.services.service.scaling.maxReplicas` | Maximum number of router service replicas | `1` |
| `router.services.service.ingress.sslEnabled` | Enable SSL for router ingress | `false` |
| `router.services.postgres.password` | PostgreSQL password for router | `"osmo"` |
| `router.sidecars.envoy.enabled` | Enable Envoy proxy sidecar container | `false` |
| `router.sidecars.logAgent.enabled` | Enable log agent sidecar for centralized log collection | `false` |

### Backend Operator Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `backend-operator.global.serviceUrl` | OSMO service URL for backend operator | `http://osmo-ingress-nginx-controller.osmo.svc.cluster.local` |
| `backend-operator.global.agentNamespace` | Kubernetes namespace for backend operator | `osmo` |
| `backend-operator.global.backendNamespace` | Kubernetes namespace for backend workloads | `default` |
| `backend-operator.global.backendTestNamespace` | Kubernetes namespace for backend test workloads | `osmo-test` |
| `backend-operator.global.backendName` | Backend name identifier | `default` |
| `backend-operator.global.accountTokenSecret` | Secret name containing backend operator authentication token | `backend-operator-token` |
| `backend-operator.global.loginMethod` | Authentication method for backend operator | `token` |
| `backend-operator.services.backendListener.resources.requests.cpu` | CPU resource requests for backend listener container | `"125m"` |
| `backend-operator.services.backendListener.resources.requests.memory` | Memory resource requests for backend listener container | `"128Mi"` |
| `backend-operator.services.backendListener.resources.limits.cpu` | CPU resource limits for backend listener container | `"250m"` |
| `backend-operator.services.backendListener.resources.limits.memory` | Memory resource limits for backend listener container | `"256Mi"` |
| `backend-operator.services.backendWorker.resources.requests.cpu` | CPU resource requests for backend worker container | `"125m"` |
| `backend-operator.services.backendWorker.resources.requests.memory` | Memory resource requests for backend worker container | `"128Mi"` |
| `backend-operator.services.backendWorker.resources.limits.cpu` | CPU resource limits for backend worker container | `"250m"` |
| `backend-operator.services.backendWorker.resources.limits.memory` | Memory resource limits for backend worker container | `"256Mi"` |
| `backend-operator.backendTestRunner.enabled` | Enable backend test runner | `false` |
| `backend-operator.sidecars.OTEL.enabled` | Enable OTEL collector sidecar for metrics and tracing | `false` |
