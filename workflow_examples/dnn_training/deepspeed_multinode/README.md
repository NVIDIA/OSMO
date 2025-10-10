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

# NVIDIA OSMO - DeepSpeed Multi-Node DNN Training

This example demonstrates how to run a distributed PyTorch training job across multiple nodes using OSMO with [DeepSpeed](https://www.deepspeed.ai/).
DeepSpeed is a deep learning optimization library that makes distributed training easy, efficient, and effective.

The workflow uses Jinja2 templating for flexible configuration of node count, GPUs, and training parameters.

## Workflow Structure

The workflow creates `n_nodes` tasks (configurable), each with `n_gpus_per_node` GPUs. Training is coordinated across nodes using DeepSpeed's no-ssh mode:

- A **master task** that coordinates the distributed training and saves model outputs
- Multiple **worker tasks** that communicate with the master
- Each task runs DeepSpeed for efficient distributed training
- Model snapshots are saved to the output dataset

## Files

- `train.py`: PyTorch training script that uses DeepSpeed for distributed training on MNIST
- `train.yaml`: Jinja2-templated workflow configuration with DeepSpeed setup including:
  - Hostfile generation for multi-node coordination
  - DeepSpeed configuration JSON with optimizer and batch size settings

## Prerequisites

- Access to an OSMO cluster with GPU resources

## Running this workflow

```bash
curl -O https://raw.githubusercontent.com/NVIDIA/OSMO/main/workflow_examples/dnn_training/deepspeed_multinode/train.py
curl -O https://raw.githubusercontent.com/NVIDIA/OSMO/main/workflow_examples/dnn_training/deepspeed_multinode/train.yaml
osmo workflow submit train.yaml --set n_nodes=2 n_gpus_per_node=4 n_epochs=10
```

> **Note:** The DeepSpeed configuration file (`/tmp/ds_config.json`) in the workflow specifies
> training parameters like batch size, optimizer settings, and gradient accumulation steps.
> You can customize these parameters based on your training needs.

> **Note:** The hostfile (`/tmp/hostfile`) contains the list of nodes participating in the training,
> with each line specifying a hostname and the number of available GPU slots.
> The file is first parsed by Jinja when the workflow is submitted and then the tokens
> `{{host:task_name}}` are substituted by OSMO with the actual hostnames.
> You can use `osmo workflow submit <workflow_path> --dry-run` to see the Jinja-parsed hostfile.
