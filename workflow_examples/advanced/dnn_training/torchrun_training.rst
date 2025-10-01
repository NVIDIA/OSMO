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

.. _torchrun_training:

==========================================================================
Using TorchRun (Multi-node)
==========================================================================

.. note::

  If you want to checkpoint the model while training, you can follow the tutorial
  :ref:`continuous_checkpointing_osmo_cli`.

  If you want to use Weights and Biases for logging, you can follow the tutorial
  :ref:`wandb_training`.

  If you want to implement automatic rescheduling for backend errors, you can follow the tutorial
  :ref:`reschedule_training_backend_errors`.

Example
-------

Setup
~~~~~

Before starting, you must create a data credential to upload your dataset, if you have not already.
Refer to the data credentials :ref:`section <credentials_data>`.

Workflow
~~~~~~~~

This workflow trains a MNIST model on a single GPU with
`torchrun <https://pytorch.org/docs/stable/elastic/run.html>`_.
It consists of one task that:

1. Sets up directories for model storage, checkpoints, and tensorboard logs
2. Trains a neural network on MNIST using the provided ``train.py`` script
3. Optionally launches tensorboard for monitoring training progress
4. Saves the trained model and metadata as OSMO datasets

Key outputs:

- Trained model saved to ``{{dataset}}`` OSMO dataset
- Training metrics and checkpoints saved as metadata
- Optional tensorboard visualization

.. md-tab-set::

  .. md-tab-item:: Workflow

    .. literalinclude:: ../../../../samples/dnn_training/torchrun_training.yaml
      :language: yaml

    This workflow creates 2 tasks and requests 8 GPUs for each task. The ``worker`` task communicates to the ``master`` task
    and the ``master`` task syncs up the training process once training is done on all the processes.

    Create a scripts folder, if it has not been created and download the scripts
    :download:`torchrun.py <../../../../samples/dnn_training/scripts/torchrun.py>` and
    :download:`osmo_barrier.py <../../../../samples/dnn_training/scripts/osmo_barrier.py>`
    into the folder.

  .. md-tab-item:: App

    .. code-block:: bash

      $ osmo app submit sample-mnist-torchrun

After the workflow completes, it uploads the generated dataset to data storage.
Refer to :ref:`concepts_ds`.

Example template
------------------------

Using the workflow below, you can change the number of nodes and GPUs per node.

.. literalinclude:: ../../../../samples/dnn_training/torchrun_training_template.yaml
    :language: jinja

For example, now you can change default values with the commandline.
This shows how to submit the workflow with 4 nodes and 4 GPUs per node:

.. code-block:: bash

  $ osmo workflow submit ~/workflow_specs/torchrun_training_template.yaml --set n_nodes=4 n_gpus_per_node=4
