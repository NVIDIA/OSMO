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

It is recommended to install this chart in a KIND cluster instead of a CSP. Instructions for
starting the KIND cluster are below.

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

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) - Container runtime (>=28.3.2)
- [KIND](https://kind.sigs.k8s.io/docs/user/quick-start/#installation) - Kubernetes in Docker (>=0.29.0)
- [kubectl](https://kubernetes.io/docs/tasks/tools/) - Kubernetes command-line tool (>=1.32.2)
- [osmo](https://us-west-2-aws.osmo.nvidia.com/docs/getting_started/install.html#install-client) - OSMO CLI

> [!note] TODO: Install OSMO CLI from some public location.

Determine the architecture of your system and set the `ARCH` environment variable:

```bash
ARCH=$(uname -m)
if [[ "$ARCH" == "x86_64" ]]; then
  ARCH="amd64"
elif [[ "$ARCH" == "aarch64" || "$ARCH" == "arm64" ]]; then
  ARCH="arm64"
else
  echo "Unsupported architecture: $ARCH"
  exit 1
fi
echo "Detected architecture: $ARCH"
```

This setup uses pre-built images from NVIDIA's container registry,
[NGC](https://www.nvidia.com/en-us/gpu-cloud/). You will need to have an NGC API key
for `nvcr.io/nvstaging/osmo` to pull images from NGC. Set the following environment variable:

> [!note] TODO: Add CONTAINER_REGISTRY_USERNAME, CONTAINER_REGISTRY for public registry.

```bash
export CONTAINER_REGISTRY_PASSWORD=<NGC API key>
```

OSMO uses an S3 bucket for storing workflow logs, datasets, and other data. You will need to
create an S3 bucket and set the following environment variables:

```bash
export S3_ENDPOINT=<S3 endpoint>
export S3_ACCESS_KEY_ID=<S3 access key ID>
export S3_ACCESS_KEY=<S3 access key>
export S3_REGION=<S3 region>
```

> [!note] TODO: remove this step when public repo is available.

You will also need a GitLab personal access token to download configuration files from the
OSMO repository. Create a personal access token in GitLab with `read_repository` scope and
set the following environment variable:

```bash
export GITLAB_TOKEN=<your GitLab personal access token>
```

## Create a KIND cluster

Download the kind-osmo-cluster-config.yaml file from the OSMO repository:

```bash
echo "PRIVATE-TOKEN: $GITLAB_TOKEN" > /tmp/gitlab_header
curl -H "@/tmp/gitlab_header" \
  -o kind-osmo-cluster-config.yaml \
  "https://gitlab-master.nvidia.com/api/v4/projects/72729/repository/files/build%2Fkind-osmo-cluster-config.yaml/raw?ref=main"
```

Create the KIND cluster:

```bash
kind create cluster --config kind-osmo-cluster-config.yaml --name osmo
```

This creates a cluster with:

- 1 control-plane node
- 1 worker node labeled `node_group=service` (for OSMO services)
- 3 worker nodes labeled `node_group=compute` (for compute workloads)

## Installation

### 1. Add OSMO Helm Registry

> [!note] TODO: Update this step with public repo.

Before installing the chart, you need to add the Helm repository with your API key:

```bash
helm repo add nvstaging-osmo https://helm.ngc.nvidia.com/nvstaging/osmo \
  --username='$oauthtoken' \
  --password="$CONTAINER_REGISTRY_PASSWORD"
helm repo update
```

### 2. Install the Chart

> [!note] TODO: Update to public version tag

```bash
helm upgrade --install osmo nvstaging-osmo/osmo-quick-start \
  --version 0.1.0-latest \
  --namespace osmo \
  --create-namespace \
  --set global.containerRegistry.password="$CONTAINER_REGISTRY_PASSWORD" \
  --set global.objectStorage.endpoint="$S3_ENDPOINT" \
  --set global.objectStorage.accessKeyId="$S3_ACCESS_KEY_ID" \
  --set global.objectStorage.accessKey="$S3_ACCESS_KEY" \
  --set global.objectStorage.region="$S3_REGION" \
  --set global.nodeSelector."kubernetes\.io/arch"=$ARCH \
  --set ingress-nginx.controller.nodeSelector."kubernetes\.io/arch"=$ARCH
```

### 3. Add Host Entry

Add the following line to your `/etc/hosts` file:

```bash
echo "127.0.0.1 osmo-ingress-nginx-controller.osmo.svc.cluster.local" | sudo tee -a /etc/hosts
```

### 4. Login to OSMO

```bash
osmo login http://osmo-ingress-nginx-controller.osmo.svc.cluster.local \
  --method=dev --username=testuser
```

### 5. Run a workflow

You can run a workflow by using the OSMO CLI.

> [!note] TODO: Update to public repository and use url for hello_world.yaml directly.

Download the hello world workflow file from the OSMO repository:

```bash
curl -H "@/tmp/gitlab_header" \
  -o hello_world.yaml \
  "https://gitlab-master.nvidia.com/api/v4/projects/72729/repository/files/external%2Fdocs%2Fsamples%2Fhello_world%2Fhello_world.yaml/raw?ref=main"
```

Submit the workflow:

```bash
osmo workflow submit hello_world.yaml
```

## Deleting the cluster

Delete the cluster using KIND. This will also delete all persistent volumes, including the postgres database that was created.

```sh
kind delete cluster --name osmo
```

## FAQ

### How do I resolve the issue where `start_service` fails to install helm charts such as `ingress-nginx`?

This is likely caused by running out of [inotify](https://linux.die.net/man/7/inotify) resources. Follow [these instructions](https://kind.sigs.k8s.io/docs/user/known-issues/#pod-errors-due-to-too-many-open-files) to raise the limits.

### How do I use a different namespace than the default `osmo`?

`osmo-quick-start` can be deployed in a different namespace by specifying the release namespace and name.

> [!note] TODO: Update to public version tag

```bash
export RELEASE_NAME=test # or any other name you prefer

helm upgrade --install $RELEASE_NAME nvstaging-osmo/osmo-quick-start \
  --version 0.1.0-latest \
  --namespace $RELEASE_NAME \
  --create-namespace \
  --set global.containerRegistry.password="$CONTAINER_REGISTRY_PASSWORD" \
  --set global.objectStorage.endpoint="$S3_ENDPOINT" \
  --set global.objectStorage.accessKeyId="$S3_ACCESS_KEY_ID" \
  --set global.objectStorage.accessKey="$S3_ACCESS_KEY" \
  --set global.objectStorage.region="$S3_REGION" \
  --set global.nodeSelector."kubernetes\.io/arch"=$ARCH \
  --set ingress-nginx.controller.nodeSelector."kubernetes\.io/arch"=$ARCH \
  --set service.services.service.hostname="$RELEASE_NAME-ingress-nginx-controller.$RELEASE_NAME.svc.cluster.local" \
  --set web-ui.services.ui.hostname="$RELEASE_NAME-ingress-nginx-controller.$RELEASE_NAME.svc.cluster.local" \
  --set router.services.service.hostname="$RELEASE_NAME-ingress-nginx-controller.$RELEASE_NAME.svc.cluster.local" \
  --set backend-operator.global.serviceUrl="http://$RELEASE_NAME-ingress-nginx-controller.$RELEASE_NAME.svc.cluster.local" \
  --set backend-operator.global.agentNamespace="$RELEASE_NAME" \
  --set backend-operator.global.backendTestNamespace="$RELEASE_NAME-test"
```

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
| `global.objectStorage.endpoint` | Object storage endpoint URL for workflow logs, datasets, and other data | `""` |
| `global.objectStorage.accessKeyId` | Object storage access key ID for authentication | `""` |
| `global.objectStorage.accessKey` | Object storage access key for authentication | `""` |
| `global.objectStorage.region` | Object storage region where the bucket is located | `""` |

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
