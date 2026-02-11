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

# Isaac Lab: Training Robot Policy with Reinforcement Learning

This example demonstrates how to run a reinforcement learning training job on a single node using OSMO. It trains a robot policy based on [Stable Baselines 3](https://stable-baselines3.readthedocs.io/en/master/) and showcases key OSMO features including resource management, dataset handling, and TensorBoard integration.

This workflow example contains:
- `train_policy.yaml`: An OSMO workflow configuration that orchestrates the training job

## Prerequisites

- Access to an OSMO cluster with GPU resources
- (Optional) S3 or compatible storage for remote checkpointing

## Running this workflow

```bash
curl -O https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/reinforcement_learning/single_gpu/train_policy.yaml
osmo workflow submit train_policy.yaml
```

## Open Tensorboard

While the workflow is running, you can monitor training using TensorBoard:

```bash
# Get the workflow ID from the submit command output
osmo workflow port-forward <workflow-id> train --port 6006
```

Then open your browser and navigate to `http://localhost:6006` to view training metrics.
