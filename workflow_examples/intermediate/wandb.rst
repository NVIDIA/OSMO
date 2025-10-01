..
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

.. _wandb_training:

=========================
Using Weights & Biases
=========================

In this tutorial, you can train a neural network using multiple nodes with `wandb <https://wandb.ai/>`_.

Example
-------

Setup
~~~~~

Before starting, you must create a data credential, if you have not already.
Refer to the :ref:`data credentials section <credentials_data>`.

Set W&B API key by running the following command and replacing ``<YOUR_API_KEY>`` with your key:

.. code-block:: bash

  $ osmo credential set wandb --type GENERIC --payload wandb_api_key=<YOUR_API_KEY>

Workflow
~~~~~~~~

This workflow demonstrates distributed neural network training using Weights & Biases (wandb) for experiment tracking.
It launches multiple nodes with GPUs to train a model in parallel using PyTorch's distributed training (torchrun).

Key features:

- Uses wandb for logging training metrics and experiment tracking
- Supports multi-node, multi-GPU training via torchrun
- Master node coordinates training and saves model checkpoints
- Worker nodes participate in distributed training
- Mounts credentials for wandb authentication
- Uses PyTorch NGC container as the base image
- Configurable number of nodes, GPUs per node, epochs, and batch size

.. md-tab-set::

  .. md-tab-item:: Workflow

    .. literalinclude:: ../../../samples/dnn_training/wandb_training.yaml
      :language: jinja

    Create a scripts folder, if it has not been created and download
    :download:`train_wandb.py <../../../samples/dnn_training/scripts/train_wandb.py>` and copy the file
    to the scripts folder:

    .. code-block:: bash

      $ mkdir -p <location of wandb_training.yaml>/scripts

  .. md-tab-item:: App

    .. code-block:: bash

      $ osmo app submit sample-wandb

Once the workflow is running, you can go to your W&B project page to monitor your training.
