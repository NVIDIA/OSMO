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

# NVIDIA OSMO - TorchRun Multi-Node DNN Training with Rescheduling

This example demonstrates how to run a PyTorch training job across multiple nodes using OSMO with torchrun and automatic rescheduling capabilities.
The workflow uses Jinja2 templating for flexible configuration of node count, GPUs, and checkpoint settings.

This workflow example contains:
- `train.py`: PyTorch training script that uses torchrun for distributed training on MNIST
- `train.yaml`: Jinja2-templated workflow configuration with configurable node count, GPU allocation, and checkpointing

## Prerequisites

- Access to an OSMO cluster with GPU resources
- S3 or compatible storage for remote checkpointing

## Running this workflow

```bash
curl -O https://raw.githubusercontent.com/NVIDIA/OSMO/main/workflow_examples/dnn_training/torchrun_reschedule/train.py
curl -O https://raw.githubusercontent.com/NVIDIA/OSMO/main/workflow_examples/dnn_training/torchrun_reschedule/train.yaml
osmo workflow submit train.yaml --set upload_location=<s3://my_bucket/path> checkpoint_cadence=2m
```
