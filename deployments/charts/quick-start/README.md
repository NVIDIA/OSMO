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

# NVIDIA OSMO - Quick Start Helm Chart

This Helm chart provides a complete OSMO deployment for trying OSMO. If you are considering using
OSMO, this is a good way to get a feel for OSMO without deploying in a CSP.

It is recommended to install this chart in a KIND cluster instead of a CSP. See
[Local Deployment](https://nvidia.github.io/OSMO/main/deployment_guide/appendix/deploy_local.html) for
detailed installation instructions.

## Prerequisites

Before installing this chart, you must install the KAI scheduler in a separate namespace:

```bash
helm upgrade --install kai-scheduler \
  oci://ghcr.io/nvidia/kai-scheduler/kai-scheduler \
  --version v0.12.10 \
  --create-namespace -n kai-scheduler \
  --set global.nodeSelector.node_group=kai-scheduler \
  --set "scheduler.additionalArgs[0]=--default-staleness-grace-period=-1s" \
  --set "scheduler.additionalArgs[1]=--update-pod-eviction-condition=true" \
  --wait
```

## What This Chart Installs

This chart installs and configures:

1. **Gateway (Envoy)** - Routes all external traffic to OSMO services
2. **Data infrastructure** - PostgreSQL, Redis, Localstack S3
3. **OSMO Core Services**:
   - OSMO service (API server, worker, logger, agent)
   - Web UI service
   - Router service
4. **Backend Operator** - For managing compute workloads
5. **Configuration Setup** - Automatic configuration of OSMO for local development

## Configuration

### Global Configuration

| Parameter                               | Description                                                             | Default                            |
| --------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------- |
| `global.osmoImageLocation`              | Base location for OSMO Docker images in the registry                    | `nvcr.io/nvidia/osmo`              |
| `global.osmoImageTag`                   | Docker image tag for OSMO services                                      | `latest`                           |
| `global.nodeSelector.node_group`        | Node group for service pods                                             | `service`                          |
| `global.imagePullSecret`                | Name of the Kubernetes secret containing Docker registry credentials    | `null`                             |
| `global.containerRegistry.registry`     | Container registry URL                                                  | `nvcr.io`                          |
| `global.containerRegistry.username`     | Container registry username                                             | `$oauthtoken`                      |
| `global.containerRegistry.password`     | Container registry password (NGC API key)                               | `""`                               |
| `global.objectStorage.endpoint`         | Object storage endpoint URL for workflow logs, datasets, and other data | `"s3://osmo"`                      |
| `global.objectStorage.overrideUrl`      | Object storage override URL (changed for localstack-s3)                 | `"http://localstack-s3.osmo:4566"` |
| `global.objectStorage.accessKeyId`      | Object storage access key ID for authentication                         | `"test"`                           |
| `global.objectStorage.accessKey`        | Object storage access key for authentication                            | `"test"`                           |
| `global.objectStorage.region`           | Object storage region where the bucket is located                       | `"us-east-1"`                      |

### Gateway Configuration

| Parameter                                          | Description                                              | Default                           |
| -------------------------------------------------- | -------------------------------------------------------- | --------------------------------- |
| `service.gateway.envoy.scaling.minReplicas`        | Minimum number of Envoy replicas                         | `1`                               |
| `service.gateway.envoy.scaling.maxReplicas`        | Maximum number of Envoy replicas                         | `1`                               |
| `service.gateway.envoy.service.type`               | Service type for external gateway                        | `NodePort`                        |
| `service.gateway.envoy.service.nodePort`           | NodePort for external access (matches KIND port mapping) | `30080`                           |
| `service.gateway.envoy.service.httpsPort`          | HTTPS port (null for HTTP-only local dev)                | `null`                            |
| `service.gateway.oauth2Proxy.enabled`              | Enable OAuth2 proxy                                      | `false`                           |
| `service.gateway.authz.enabled`                    | Enable authorization sidecar                             | `false`                           |

### OSMO Service Configuration

| Parameter                                               | Description                                                      | Default                                     |
| ------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------- |
| `service.services.configFile.enabled`                   | Enable external configuration file loading                       | `true`                                      |
| `service.services.configFile.path`                      | Path to the MEK configuration file                               | `/home/osmo/config/mek.yaml`                |
| `service.services.postgres.enabled`                     | Enable PostgreSQL deployment on Kubernetes                       | `true`                                      |
| `service.services.postgres.imagePullPolicy`             | Kubernetes image pull policy for PostgreSQL                      | `IfNotPresent`                              |
| `service.services.postgres.storageClassName`            | Storage class name for PostgreSQL persistent volume              | `standard`                                  |
| `service.services.postgres.password`                    | PostgreSQL password                                              | `"osmo"`                                    |
| `service.services.postgres.nodeSelector.node_group`     | Node group for PostgreSQL pods                                   | `data`                                      |
| `service.services.redis.enabled`                        | Enable Redis deployment on Kubernetes                            | `true`                                      |
| `service.services.redis.imagePullPolicy`                | Kubernetes image pull policy for Redis                           | `IfNotPresent`                              |
| `service.services.redis.storageClassName`               | Storage class name for Redis persistent volume                   | `standard`                                  |
| `service.services.redis.tlsEnabled`                     | Enable TLS for Redis connections                                 | `false`                                     |
| `service.services.redis.nodeSelector.node_group`        | Node group for Redis pods                                        | `data`                                      |
| `service.services.localstackS3.enabled`                 | Enable Localstack S3 deployment on Kubernetes                    | `true`                                      |
| `service.services.localstackS3.imagePullPolicy`         | Kubernetes image pull policy for Localstack S3                   | `IfNotPresent`                              |
| `service.services.localstackS3.buckets`                 | Creates the `osmo` bucket in Localstack S3                       | `["osmo"]`                                  |
| `service.services.localstackS3.persistence.enabled`     | Enable Localstack S3 persistence                                 | `true`                                      |
| `service.services.localstackS3.persistence.hostPath`    | Path to Localstack S3 persistence on the host                    | `/var/lib/localstack`                       |
| `service.services.localstackS3.nodeSelector.node_group` | Node group for Localstack S3 pods                                | `data`                                      |
| `service.services.service.hostname`                     | Hostname for OSMO service                                        | `quick-start.osmo`                          |
| `service.services.service.imagePullPolicy`              | Kubernetes image pull policy for the API service                 | `IfNotPresent`                              |
| `service.services.service.scaling.minReplicas`          | Minimum number of service replicas                               | `1`                                         |
| `service.services.service.scaling.maxReplicas`          | Maximum number of service replicas                               | `1`                                         |
| `service.services.service.initContainers`               | Init containers for API service                                  | Wait for postgres, redis, and localstack-s3 |
| `service.services.worker.imagePullPolicy`               | Kubernetes image pull policy for the worker service              | `IfNotPresent`                              |
| `service.services.worker.scaling.minReplicas`           | Minimum number of worker replicas                                | `1`                                         |
| `service.services.worker.scaling.maxReplicas`           | Maximum number of worker replicas                                | `1`                                         |
| `service.services.worker.initContainers`                | Init containers for worker service                               | Wait for postgres, redis, and localstack-s3 |
| `service.services.logger.imagePullPolicy`               | Kubernetes image pull policy for the logger service              | `IfNotPresent`                              |
| `service.services.logger.scaling.minReplicas`           | Minimum number of logger service replicas                        | `1`                                         |
| `service.services.logger.scaling.maxReplicas`           | Maximum number of logger service replicas                        | `1`                                         |
| `service.services.logger.initContainers`                | Init containers for logger service                               | Wait for postgres, redis, and localstack-s3 |
| `service.services.agent.imagePullPolicy`                | Kubernetes image pull policy for the agent service               | `IfNotPresent`                              |
| `service.services.agent.scaling.minReplicas`            | Minimum number of agent service replicas                         | `1`                                         |
| `service.services.agent.scaling.maxReplicas`            | Maximum number of agent service replicas                         | `1`                                         |
| `service.services.agent.initContainers`                 | Init containers for agent service                                | Wait for postgres, redis, and localstack-s3 |
| `service.services.delayedJobMonitor.imagePullPolicy`    | Kubernetes image pull policy for the delayed job monitor service | `IfNotPresent`                              |
| `service.services.delayedJobMonitor.initContainers`     | Init containers for delayed job monitor service                  | Wait for postgres, redis, and localstack-s3 |
| `service.podMonitor.enabled`                            | Enable PodMonitor for Prometheus scraping (requires `monitoring.coreos.com` CRD) | `false`         |

### Web UI Configuration

| Parameter                               | Description                          | Default                                    |
| --------------------------------------- | ------------------------------------ | ------------------------------------------ |
| `web-ui.services.ui.initContainers`     | Init containers for UI service       | Wait for osmo-service                      |
| `web-ui.services.ui.skipAuth`           | Skip authentication for UI service   | `true`                                     |
| `web-ui.services.ui.hostname`           | Hostname for UI service              | `quick-start.osmo`                         |
| `web-ui.services.ui.apiHostname`        | API hostname for server-side rendering | `osmo-gateway.osmo.svc.cluster.local:80` |

### Router Service Configuration

| Parameter                                     | Description                                             | Default                      |
| --------------------------------------------- | ------------------------------------------------------- | ---------------------------- |
| `router.services.configFile.enabled`          | Enable external configuration file loading              | `true`                       |
| `router.services.configFile.path`             | Path to the MEK configuration file                      | `/home/osmo/config/mek.yaml` |
| `router.services.service.hostname`            | Hostname for router service                             | `quick-start.osmo`           |
| `router.services.service.imagePullPolicy`     | Kubernetes image pull policy for the router service     | `IfNotPresent`               |
| `router.services.service.scaling.minReplicas` | Minimum number of router service replicas               | `1`                          |
| `router.services.service.scaling.maxReplicas` | Maximum number of router service replicas               | `1`                          |
| `router.services.service.initContainers`      | Init containers for router service                      | Wait for postgres and redis  |
| `router.services.postgres.password`           | PostgreSQL password for router                          | `"osmo"`                     |

### Backend Operator Configuration

| Parameter                                                             | Description                                                   | Default                                         |
| --------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------- |
| `backend-operator.global.serviceUrl`                                  | OSMO service URL for backend operator                         | `http://osmo-gateway.osmo.svc.cluster.local`    |
| `backend-operator.global.agentNamespace`                              | Kubernetes namespace for backend operator                     | `osmo`                                          |
| `backend-operator.global.backendNamespace`                            | Kubernetes namespace for backend workloads                    | `default`                                       |
| `backend-operator.global.backendTestNamespace`                        | Kubernetes namespace for backend test workloads               | `osmo-test`                                     |
| `backend-operator.global.backendName`                                 | Backend name identifier                                       | `default`                                       |
| `backend-operator.global.accountTokenSecret`                          | Secret name containing backend operator authentication token  | `backend-operator-token`                        |
| `backend-operator.global.loginMethod`                                 | Authentication method for backend operator                    | `token`                                         |
| `backend-operator.services.backendListener.imagePullPolicy`           | Kubernetes image pull policy for the backend listener service | `IfNotPresent`                                  |
| `backend-operator.services.backendListener.initContainers`            | Init containers for backend listener service                  | Wait for gateway and backend-operator-token     |
| `backend-operator.services.backendListener.resources.requests.cpu`    | CPU resource requests for backend listener container          | `"125m"`                                        |
| `backend-operator.services.backendListener.resources.requests.memory` | Memory resource requests for backend listener container       | `"128Mi"`                                       |
| `backend-operator.services.backendListener.resources.limits.cpu`      | CPU resource limits for backend listener container            | `"250m"`                                        |
| `backend-operator.services.backendListener.resources.limits.memory`   | Memory resource limits for backend listener container         | `"256Mi"`                                       |
| `backend-operator.services.backendWorker.imagePullPolicy`             | Kubernetes image pull policy for the backend worker service   | `IfNotPresent`                                  |
| `backend-operator.services.backendWorker.initContainers`              | Init containers for backend worker service                    | Wait for gateway and backend-operator-token     |
| `backend-operator.services.backendWorker.resources.requests.cpu`      | CPU resource requests for backend worker container            | `"125m"`                                        |
| `backend-operator.services.backendWorker.resources.requests.memory`   | Memory resource requests for backend worker container         | `"128Mi"`                                       |
| `backend-operator.services.backendWorker.resources.limits.cpu`        | CPU resource limits for backend worker container              | `"250m"`                                        |
| `backend-operator.services.backendWorker.resources.limits.memory`     | Memory resource limits for backend worker container           | `"256Mi"`                                       |
| `backend-operator.backendTestRunner.enabled`                          | Enable backend test runner                                    | `false`                                         |
| `backend-operator.podMonitor.enabled`                                 | Enable PodMonitor for Prometheus scraping (requires `monitoring.coreos.com` CRD) | `false`                  |
