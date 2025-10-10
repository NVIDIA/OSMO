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

# NVIDIA OSMO - Single Node DNN Training

This example demonstrates how to run a PyTorch training job on a single node using OSMO. It trains a simple CNN on the MNIST dataset and showcases key OSMO features including resource management, dataset handling, checkpointing, and TensorBoard integration.

This workflow example contains:
- `train.py`: A PyTorch training script that trains a CNN on the MNIST dataset
- `train.yaml`: An OSMO workflow configuration that orchestrates the training job

## Prerequisites

- Access to an OSMO cluster with GPU resources
- (Optional) S3 or compatible storage for remote checkpointing

## Running this workflow

```bash
curl -O https://raw.githubusercontent.com/NVIDIA/OSMO/main/workflow_examples/dnn_training/single_node/train.yaml
curl -O https://raw.githubusercontent.com/NVIDIA/OSMO/main/workflow_examples/dnn_training/single_node/train.py
osmo workflow submit train.yaml
```

## Open Tensorboard

While the workflow is running, you can monitor training using TensorBoard:

```bash
# Get the workflow ID from the submit command output
osmo workflow port-forward <workflow-id> train --port 6006
```

Then open your browser and navigate to `http://localhost:6006` to view training metrics.
