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

.. _deepspeed_training:

===============
Using DeepSpeed
===============

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

This tutorial demonstrates how to use `DeepSpeed <https://www.deepspeed.ai/>`_ for efficient
distributed training of deep learning models.

It creates ``n_nodes`` tasks (configurable), each with ``n_gpus_per_node`` GPUs.
Training is coordinated across nodes using DeepSpeed's no-ssh mode.

The workflow consists of:

- A master task that coordinates the distributed training
- Multiple worker tasks that communicate with the master
- Each task runs DeepSpeed for efficient distributed training
- Model snapshots are saved to the output dataset

.. md-tab-set::

  .. md-tab-item:: Workflow

    .. literalinclude:: ../../../../samples/dnn_training/deepspeed_training.yaml
      :language: jinja

    Create a scripts folder, if it has not been created and download the script
    :download:`train_deepspeed.py <../../../../samples/dnn_training/scripts/train_deepspeed.py>`,
    and copy the file to the scripts folder:

    .. code-block:: bash

      $ mkdir -p <location of deepspeed_training.yaml>/scripts

  .. md-tab-item:: App

    .. code-block:: bash

      $ osmo app submit sample-deepspeed

After the workflow completes, it uploads the generated dataset to data storage.
Refer to :ref:`concepts_ds`.

.. note::
    The DeepSpeed configuration file (``/tmp/ds_config.json``) in the workflow specifies
    training parameters like batch size, optimizer settings, and gradient accumulation steps.
    You can customize these parameters based on your training needs.

.. note::
    The hostfile (``/tmp/hostfile``) contains the list of nodes participating in the training,
    with each line specifying a hostname and the number of available GPU slots.
    The file is first parsed by Jinja when the workflow is submitted and then the tokens
    ``{{host:task_name}}`` are substituted by OSMO with the actual hostnames.
    You can use ``osmo workflow submit <workflow_path> --dry-run`` to see the Jinja-parsed hostfile.
