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

.. _torchrun_elastic_training:

==========================================================================
Using TorchRun (Elastic Multi-node)
==========================================================================

.. note::

  If you want to checkpoint the model while training, you can follow the tutorial
  :ref:`continuous_checkpointing_osmo_cli`.

  If you want to use Weights and Biases for logging, you can follow the tutorial
  :ref:`wandb_training`.

Example
-------
Setup
~~~~~

Before starting, you must create a data credential to upload your dataset, if you have not already.
Refer to the data credentials :ref:`section <credentials_data>`.

Workflow
~~~~~~~~

This workflow trains a neural network with **fault-tolerant distributed training** using
`torchrun <https://pytorch.org/docs/stable/elastic/run.html>`_.
It creates up to ``max_nodes`` tasks (default 4), each with ``n_gpus_per_node`` GPUs (default 2).
Training can proceed as long as ``min_nodes`` tasks are available (default 2).

The workflow consists of:

- A master task that coordinates the distributed training
- Multiple worker tasks that communicate with the master
- Each task runs torchrun to enable fault-tolerant distributed training
- Model snapshots are saved to the output dataset

.. md-tab-set::

  .. md-tab-item:: Workflow

    .. literalinclude:: ../../../../samples/dnn_training/torchrun_elastic_training.yaml
      :language: jinja

    Create a scripts folder, if it has not been created and download the script
    :download:`torchrun.py <../../../../samples/dnn_training/scripts/torchrun.py>`, and copy the file to
    the scripts folder:

    .. code-block:: bash

      $ mkdir -p <location of torchrun_elastic_training.yaml>/scripts

    After the workflow completes, it uploads the generated dataset to data storage. Refer to :ref:`concepts_ds`.

    For different configurations, you can change default values with the commandline. For example:

    .. code-block:: bash

      $ osmo workflow submit ~/workflow_specs/torchrun_elastic_training.yaml --set max_nodes=8 min_nodes=4 n_gpus_per_node=8

  .. md-tab-item:: App

    .. code-block:: bash

      $ osmo app submit sample-elastic-torchrun

    For different configurations, you can change default values with the commandline. For example:

    .. code-block:: bash

      $ osmo app submit sample-elastic-torchrun --set max_nodes=8 min_nodes=4 n_gpus_per_node=8
