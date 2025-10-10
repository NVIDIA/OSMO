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

# NVIDIA OSMO - Weights & Biases Integration

This example demonstrates distributed neural network training using Weights & Biases (wandb) for experiment tracking. It launches multiple nodes with GPUs to train a model in parallel using PyTorch's distributed training (torchrun).

This workflow example contains:
- `train.py`: A PyTorch training script with wandb integration
- `train.yaml`: An OSMO workflow configuration for distributed training with wandb

## Prerequisites

- Access to an OSMO cluster with GPU resources
- Weights & Biases account and API key

## Setup

Before starting, you must create a data credential for Weights & Biases. Set your W&B API key by running the following command and replacing `<YOUR_API_KEY>` with your key:

```bash
osmo credential set wandb --type GENERIC --payload wandb_api_key=<YOUR_API_KEY>
```

## Running this workflow

```bash
curl -O https://raw.githubusercontent.com/NVIDIA/OSMO/main/workflow_examples/integration_and_tools/wandb/train.yaml
curl -O https://raw.githubusercontent.com/NVIDIA/OSMO/main/workflow_examples/integration_and_tools/wandb/train.py
osmo workflow submit train.yaml
```

## Monitoring Training

Once the workflow is running, you can go to your W&B project page at [https://wandb.ai](https://wandb.ai) to monitor your training progress, view metrics, and analyze results in real-time.

