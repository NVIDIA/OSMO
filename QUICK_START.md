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

# NVIDIA OSMO - Quick Start

This guide will walk you through steps necessary to deploy OSMO on your local workstation.
At the end of the guide, you would've deployed all essential components of OSMO and be able
to run a workflow in your environment.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) - Container runtime (>=28.3.2)
- [KIND](https://kind.sigs.k8s.io/docs/user/quick-start/#installation) - Kubernetes in Docker
  (>=0.29.0)
- [kubectl](https://kubernetes.io/docs/tasks/tools/) - Kubernetes command-line tool (>=1.32.2)
- [helm](https://helm.sh/docs/intro/install/) - Helm command-line tool (>=3.16.2)

## 1. Prepare

### Create directory

```bash
mkdir -p ~/osmo-quick-start && cd ~/osmo-quick-start
```

### Download and Install OSMO CLI

```bash
curl -fsSL https://raw.githubusercontent.com/NVIDIA/OSMO/refs/heads/main/install.sh | bash
```

## 2. Configure variables

### Determine CPU Architecture

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

### Setup Registry Credentials

This setup uses pre-built images from NVIDIA's container registry,
[NGC](https://www.nvidia.com/en-us/gpu-cloud/). You will need to have an NGC API key for
`nvcr.io/nvstaging/osmo` to pull images from NGC. Set the following environment variable:

```bash
export CONTAINER_REGISTRY_PASSWORD='<NGC API key>'
```

## 3. Create a KIND cluster

### Create config

```bash
cat > kind-osmo-cluster-config.yaml <<'EOF'
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
name: osmo
nodes:
  - role: control-plane
  - role: worker
    kubeadmConfigPatches:
    - |
      kind: JoinConfiguration
      nodeRegistration:
        kubeletExtraArgs:
          node-labels: "node_group=ingress"
    extraPortMappings:
      - containerPort: 30080
        hostPort: 80
        protocol: TCP
  - role: worker
    kubeadmConfigPatches:
    - |
      kind: JoinConfiguration
      nodeRegistration:
        kubeletExtraArgs:
          node-labels: "node_group=data"
    extraMounts:
      - hostPath: /tmp/localstack-s3
        containerPath: /var/lib/localstack
  - role: worker
    kubeadmConfigPatches:
    - |
      kind: JoinConfiguration
      nodeRegistration:
        kubeletExtraArgs:
          node-labels: "node_group=service"
  - role: worker
    kubeadmConfigPatches:
    - |
      kind: JoinConfiguration
      nodeRegistration:
        kubeletExtraArgs:
          node-labels: "node_group=service"
  - role: worker
    kubeadmConfigPatches:
    - |
      kind: JoinConfiguration
      nodeRegistration:
        kubeletExtraArgs:
          node-labels: "node_group=compute"
EOF
```

### Create the KIND cluster:

```bash
kind create cluster --config kind-osmo-cluster-config.yaml --name osmo
```

This creates a cluster with:

- 1 control-plane node
- 1 worker node labeled `node_group=ingress` for NGINX ingress
- 1 worker ndoe labeled `node_group=data` for data dependencies (PostgreSQL, Redis, LocalStack S3)
- 2 worker nodes labeled `node_group=service` for OSMO services
- 1 worker node labeled `node_group=compute` for compute workloads

## 4. Installation

### Add OSMO Helm Registry

Before installing the chart, you need to add the Helm repository with your API key:

```bash
helm repo add nvstaging-osmo https://helm.ngc.nvidia.com/nvstaging/osmo \
  --username='$oauthtoken' \
  --password="$CONTAINER_REGISTRY_PASSWORD"
helm repo update
```

### Install the Chart

```bash
helm upgrade --install osmo nvstaging-osmo/osmo-quick-start \
  --version 1.0.0 \
  --namespace osmo \
  --create-namespace \
  --wait \
  --set global.containerRegistry.password="$CONTAINER_REGISTRY_PASSWORD" \
  --set global.nodeSelector."kubernetes\.io/arch"=$ARCH \
  --set ingress-nginx.controller.nodeSelector."kubernetes\.io/arch"=$ARCH
```

Installing the chart will take about 5 minutes. If you're curious what's happening, you can monitor with:

```bash
kubectl get pods --namespace osmo
```

See [Configuration Options](./deployments/charts/osmo-quick-start/README.md#configuration) in the
`osmo-quick-start` chart for more ways to install the chart.

### Add Host Entry

Add the following line to your `/etc/hosts` file:

```bash
echo "127.0.0.1 quick-start.osmo" | sudo tee -a /etc/hosts
```

## 5. Using OSMO

### Login to OSMO

```bash
osmo login http://quick-start.osmo --method=dev --username=testuser
```

### Run a workflow

You can run a workflow by using the OSMO CLI.

#### Create a workflow file

```bash
cat > hello_world.yaml <<'EOF'
workflow:
  name: hello-osmo
  tasks:
  # Simple Task
  - name: hello
    image: ubuntu:22.04  # Docker image name
    command: ["bash"]
    args: ["/tmp/entry.sh"]
    files:
    - path: /tmp/entry.sh
      contents: |
        echo "Hello from OSMO!"
EOF
```
#### Submit the workflow

```bash
osmo workflow submit hello_world.yaml
```

## 6. Deleting the cluster

Delete the cluster using KIND. This will also delete all persistent volumes, including the postgres
database that was created.

```sh
kind delete cluster --name osmo
```
