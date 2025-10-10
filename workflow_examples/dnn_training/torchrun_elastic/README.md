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

# NVIDIA OSMO - TorchRun Elastic Multi-Node DNN Training

This example demonstrates how to run a PyTorch elastic training job across multiple nodes using OSMO with torchrun.
Elastic training allows the job to dynamically scale between a minimum and maximum number of nodes, and automatically handles node failures with restarts.
The workflow uses Jinja2 templating for flexible configuration of node count, GPUs, and training parameters.

This workflow example contains:
- `train.py`: PyTorch training script that uses torchrun for distributed elastic training on MNIST
- `train.yaml`: Jinja2-templated workflow configuration with elastic node scaling (min/max nodes), GPU allocation, and automatic restart capabilities

## Prerequisites

- Access to an OSMO cluster with GPU resources

## Running this workflow

```bash
curl -O https://raw.githubusercontent.com/NVIDIA/OSMO/main/workflow_examples/dnn_training/torchrun_elastic/train.py
curl -O https://raw.githubusercontent.com/NVIDIA/OSMO/main/workflow_examples/dnn_training/torchrun_elastic/train.yaml
osmo workflow submit train.yaml --set min_nodes=2 max_nodes=4 n_epochs=10
```
