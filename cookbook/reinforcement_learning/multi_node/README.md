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

# Isaac Lab: Multi-Node Training Robot Policy with Reinforcement Learning

This example demonstrates how to run a reinforcement learning training job using multiple GPUs across multiple nodes with OSMO. It trains a robot policy based on [RSL-RL](https://github.com/leggedrobotics/rsl_rl) using PyTorch's distributed training capabilities and showcases key OSMO features including multi-node resource management, distributed coordination, dataset handling, and TensorBoard integration.

This workflow example contains:
- `train_policy.yaml`: An OSMO workflow configuration that orchestrates the multi-node training job

## Prerequisites

- Access to an OSMO cluster with multi-node GPU resources (default configuration uses 2 nodes with 2 GPUs each)
- (Optional) S3 or compatible storage for remote checkpointing

## Key Features

- **Multi-Node Training**: Uses PyTorch's `torch.distributed.run` across 2 nodes by default
- **Distributed Coordination**: Master-worker architecture with automatic node discovery
- **Configurable GPU Count**: The number of GPUs per node can be customized via the `num_gpu` parameter
- **Resource Management**: Automatically allocates appropriate CPU, memory, and storage resources across nodes
- **Fault Tolerance**: Uses C10d backend with rendezvous for robust distributed training

## Running this workflow

```bash
curl -O https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/reinforcement_learning/multi_node/train_policy.yaml
osmo workflow submit train_policy.yaml
```

### Customizing GPU Count

To run with a different number of GPUs per node, override the default value:

```bash
osmo workflow submit train_policy.yaml --set num_gpu=4
```

## Architecture

The workflow consists of two task groups:

- **Master Node** (`node_rank=0`): Coordinates the distributed training and serves as the rendezvous endpoint
- **Worker Node** (`node_rank=1`): Connects to the master node and participates in distributed training

Both nodes run the same training script but with different node ranks, enabling seamless multi-node coordination.
