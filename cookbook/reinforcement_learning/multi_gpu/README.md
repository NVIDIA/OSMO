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

# Isaac Lab: Multi-GPU Training Robot Policy with Reinforcement Learning

This example demonstrates how to run a reinforcement learning training job using multiple GPUs on a single node with OSMO. It trains a robot policy based on [RSL-RL](https://github.com/leggedrobotics/rsl_rl) using PyTorch's distributed training capabilities and showcases key OSMO features including multi-GPU resource management, dataset handling, and TensorBoard integration.

This workflow example contains:
- `train_policy.yaml`: An OSMO workflow configuration that orchestrates the multi-GPU training job

## Prerequisites

- Access to an OSMO cluster with multi-GPU resources (default configuration uses 2 GPUs)
- (Optional) S3 or compatible storage for remote checkpointing

## Key Features

- **Multi-GPU Training**: Uses PyTorch's `torch.distributed.run` with 2 GPUs by default
- **Distributed Training**: Leverages Isaac Lab's distributed training capabilities
- **Configurable GPU Count**: The number of GPUs can be customized via the `num_gpu` parameter
- **Resource Management**: Automatically allocates appropriate CPU, memory, and storage resources

## Running this workflow

```bash
curl -O https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/reinforcement_learning/multi_gpu/train_policy.yaml
osmo workflow submit train_policy.yaml
```

### Customizing GPU Count

To run with a different number of GPUs, override the default value:

```bash
osmo workflow submit train_policy.yaml --set num_gpu=4
```
