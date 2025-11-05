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

You don't need a cloud account or enterprise approval to try OSMO. Your local workstation provides
everything you need to experience the platform.

## Deploy OSMO on Your Workstation

When you deploy OSMO locally on your workstation, you get the complete platform:

- **Full workflow orchestration** – Task dependencies, parallel execution, state management
- **Real containerized execution** – Your Docker images running in local Kubernetes (via KIND)
- **Complete data management** – Local object storage for datasets and artifacts
- **The same YAML workflows** that scale to cloud environments
- **Interactive development** – SSH into containers, attach debuggers, inspect logs

This guide will walk you through steps necessary to deploy OSMO on your local workstation. At the
end of the guide, you will have deployed all essential components of OSMO and be able to run a
workflow in your environment.

## Why Start Locally?

Local deployment is ideal for:

- **Evaluating OSMO** before proposing it to your team or organization
- **Learning the platform** in a low-risk environment
- **Testing your workflows** with your own Docker images and data
- **Assessing fit** for your robotics development needs
- **Understanding the interface** – CLI, Web UI, and YAML specifications

No cloud costs. No complex infrastructure setup. Just Docker, a few command-line tools, and about 10
minutes of your time.

If OSMO works for your use case locally, it will scale to hundreds of GPUs in the cloud – using the
exact same workflows.

> [!WARNING]
> Quick Start is not recommended for production use because it lacks authentication and
> security features.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) - Container runtime (>=28.3.2)
- [KIND](https://kind.sigs.k8s.io/docs/user/quick-start/#installation) - Kubernetes in Docker
  (>=0.29.0)
- [kubectl](https://kubernetes.io/docs/tasks/tools/) - Kubernetes command-line tool (>=1.32.2)
- [helm](https://helm.sh/docs/intro/install/) - Helm command-line tool (>=3.16.2)
- [Raise `inotify` limits](https://kind.sigs.k8s.io/docs/user/known-issues/#pod-errors-due-to-too-many-open-files)
- [Make sure your user has permission to use `docker`](https://kind.sigs.k8s.io/docs/user/known-issues/#docker-permission-denied)

### Optional: GPU support

If your workstation has a GPU, you can use [nvkind](https://github.com/NVIDIA/nvkind) instead of
KIND to expose the GPU to the KIND cluster. Follow the
[prerequisites](https://github.com/NVIDIA/nvkind?tab=readme-ov-file#prerequisites),
[setup](https://github.com/NVIDIA/nvkind?tab=readme-ov-file#setup), and
[installation](https://github.com/NVIDIA/nvkind?tab=readme-ov-file#install-nvkind) to install
`nvkind` and then continue with these instructions.

## 1. Create a KIND cluster

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
          node-labels: "node_group=ingress,nvidia.com/gpu.deploy.operands=false"
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
          node-labels: "node_group=kai-scheduler,nvidia.com/gpu.deploy.operands=false"
  - role: worker
    kubeadmConfigPatches:
    - |
      kind: JoinConfiguration
      nodeRegistration:
        kubeletExtraArgs:
          node-labels: "node_group=data,nvidia.com/gpu.deploy.operands=false"
    extraMounts:
      - hostPath: /tmp/localstack-s3
        containerPath: /var/lib/localstack
  - role: worker
    kubeadmConfigPatches:
    - |
      kind: JoinConfiguration
      nodeRegistration:
        kubeletExtraArgs:
          node-labels: "node_group=service,nvidia.com/gpu.deploy.operands=false"
  - role: worker
    kubeadmConfigPatches:
    - |
      kind: JoinConfiguration
      nodeRegistration:
        kubeletExtraArgs:
          node-labels: "node_group=service,nvidia.com/gpu.deploy.operands=false"
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

If you are not using a GPU, create the KIND cluster with `kind`:

```bash
kind create cluster --config kind-osmo-cluster-config.yaml --name osmo
```

If you are using a GPU, you will use `nvkind` to create the cluster. First, update which GPUs are
exposed to the compute node by updating the following line of the KIND config:

```yaml
# ...
# Last worker node labeled "compute"
- role: worker
  devices: [0] # <- Add GPU devices from `nvidia-smi -L`, e.g. [0, 1, 2, 3] for 4 available GPUs
  kubeadmConfigPatches:
    - |
      kind: JoinConfiguration
      nodeRegistration:
        kubeletExtraArgs:
          node-labels: "node_group=compute"
```

Then create the cluster with `nvkind`:

```bash
nvkind create cluster --config kind-osmo-cluster-config.yaml --name osmo
```

Both `kind` and `nvkind` commands create a Kubernetes cluster on your workstation with a control
plane node and several worker nodes. The
[core OSMO components](https://nvidia.github.io/OSMO/user_guide/high_level_architecture.html) will
be installed on those worker nodes:

- Control Plane
  - 2 worker nodes labeled `node_group=service` for API server and workflow engine
  - 1 worker node labeled `node_group=ingress` for NGINX ingress
- Compute Layer
  - 1 worker node labeled `node_group=compute`
- Data Layer
  - 1 worker node labeled `node_group=data` for PostgreSQL, Redis, LocalStack S3

## 2. Installation

### [Optional] Install GPU Operator

[GPU Operator](https://github.com/NVIDIA/gpu-operator) is necessary if your workstation has a GPU
and you'd like to use it with OSMO Quick Start.

```bash
helm fetch https://helm.ngc.nvidia.com/nvidia/charts/gpu-operator-v25.10.0.tgz
helm upgrade --install gpu-operator gpu-operator-v25.10.0.tgz \
  --namespace gpu-operator \
  --create-namespace \
  --set driver.enabled=false \
  --set toolkit.enabled=false \
  --set nfd.enabled=true \
  --wait
```

### Install KAI scheduler

```bash
helm upgrade --install kai-scheduler \
  oci://ghcr.io/nvidia/kai-scheduler/kai-scheduler \
  --version v0.5.5 \
  --create-namespace -n kai-scheduler \
  --set global.nodeSelector.node_group=kai-scheduler \
  --set "scheduler.additionalArgs[0]=--default-staleness-grace-period=-1s" \
  --wait
```

KAI scheduler is used to for coscheduling, priority, and preemption of workflows and tasks.

### Install OSMO

```bash
helm fetch https://helm.ngc.nvidia.com/nvidia/osmo/charts/quick-start-1.0.0.tgz
helm upgrade --install osmo quick-start-1.0.0.tgz \
  --namespace osmo \
  --create-namespace \
  --wait
```

Installing the chart will take about 5 minutes. If you're curious what's happening, you can monitor
with:

```bash
kubectl get pods --namespace osmo
```

See [Configuration Options](./deployments/charts/quick-start/README.md#configuration) in the
`quick-start` chart for more ways to install the chart.

### Add Host Entry

Add the following line to your `/etc/hosts` file:

```bash
echo "127.0.0.1 quick-start.osmo" | sudo tee -a /etc/hosts
```

## 3. Using OSMO

Congratulations! You now have OSMO configured and running on your workstation. You are ready to
start running your robotics workflows on OSMO.

### Download and Install OSMO CLI

```bash
curl -fsSL https://raw.githubusercontent.com/NVIDIA/OSMO/refs/heads/main/install.sh | bash
```

### Login to OSMO

```bash
osmo login http://quick-start.osmo --method=dev --username=testuser
```

### Run Your Workflows

Explore [next steps](https://nvidia.github.io/OSMO/user_guide/getting_started/next_steps.html) for
information on submitting workflows, interactive development, distributed training, and more.

Once you have reached the limits of your workstation, you can scale to the cloud seamlessly –
without rewriting your workflows. Contact your cloud administrator to discuss deploying OSMO for
your organization.

> [!NOTE]
> Cloud engineers and administrators can find more information about deploying OSMO in the
> [Deployment Guide](https://nvidia.github.io/OSMO/deployment_guide/index.html).

## 4. Deleting the cluster

Delete the cluster using KIND. This will also delete all persistent volumes, including the postgres
database that was created.

```sh
kind delete cluster --name osmo
```

