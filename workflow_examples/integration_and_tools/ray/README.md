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

# NVIDIA OSMO - Ray Framework

This example demonstrates how to launch a Ray cluster on OSMO. Ray is a unified framework for scaling AI and Python applications, and OSMO provides native support for running Ray clusters, making it easy to leverage Ray's distributed computing capabilities.

The workflow launches a Ray cluster with one master node and one or more worker nodes. The master node runs the Ray head process that coordinates the cluster, while worker nodes connect to the master to form a distributed compute cluster.

## Running this workflow

```bash
curl -O https://raw.githubusercontent.com/NVIDIA/OSMO/main/workflow_examples/integration_and_tools/ray/ray.yaml
osmo workflow submit ray.yaml
```

You can customize the cluster size and resources:

```bash
osmo workflow submit ray.yaml --set num_nodes=4 --set gpu=2 --set cpu=16 --set memory=128Gi
```

## Accessing the Ray Cluster

Port-forward the dashboard ports to access the Ray dashboard and Prometheus metrics:

```bash
# Get the workflow ID from the submit command output
osmo workflow port-forward <workflow-id> master --port 8265,9090
```

The Ray dashboard will be available at `http://localhost:8265`.
The Prometheus dashboard will be available at `http://localhost:9090`.

Set the Ray address environment variable to use Ray CLI:

```bash
export RAY_ADDRESS="http://localhost:8265"
```

## Best Practices

1. **Resource Allocation**: Ensure your resource requests match your workload requirements. Ray works best when it has accurate information about available resources.

2. **Monitoring**: Use the Ray dashboard to monitor cluster health, task progress, and resource utilization.

3. **Port Configuration**: The default Ray port (6376) can be customized using the `ray_port` parameter if needed.

4. **Timeouts**: Consider setting appropriate timeouts to manage cluster lifecycle and avoid unnecessary resource consumption.

