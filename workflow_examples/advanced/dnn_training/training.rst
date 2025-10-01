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

.. _training:

================================================
Using PyTorch (Single Node)
================================================

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

This workflow demonstrates training a PyTorch model on the MNIST dataset
It performs the following steps:

1. Uses the NVIDIA PyTorch container with CUDA support
2. Sets up directories for:

   - Storing the best trained model
   - Experiment metadata and checkpoints (This checkpointing saves at the end.
     It is **NOT** continuous checkpointing. Refer to the note above for continuous checkpointing.)
   - TensorBoard logs

3. Runs training using train.py script which:

   - Trains a CNN model on MNIST
   - Saves checkpoints during training
   - Logs metrics to TensorBoard
   - Saves the best model

4. Optionally launches TensorBoard for monitoring
5. Outputs the trained model as a dataset

.. md-tab-set::

  .. md-tab-item:: Workflow

    .. literalinclude:: ../../../../samples/dnn_training/mnist_training.yaml
      :language: yaml

    Create a scripts folder, if it has not been created and download the script
    :download:`train.py <../../../../samples/dnn_training/scripts/train.py>`, and copy the file to
    the scripts folder:

    .. code-block:: bash

      $ mkdir -p <location of mnist_training.yaml>/scripts

  .. md-tab-item:: App

    .. code-block:: bash

      $ osmo app submit sample-mnist-training

The workflow should take around **5** minutes to run. Once the training is done, the logs will
show that TensorBoard is running:

.. code-block:: bash

  2023/11/22 23:52:14 [train] TensorBoard 2.6.0 at http://train-ia4tatat7nfchovhwaipd7o7hy:6006/ (Press CTRL+C to quit)

Viewing TensorBoard
~~~~~~~~~~~~~~~~~~~

TensorBoard is a tool for providing the measurements and visualizations needed during the machine
learning workflow.

1. To see the visualization of the model training process, run the port-forward command:

.. code-block:: bash

  $ osmo workflow port-forward <workflow ID> train --port 6006:6006 --connect-timeout 1000

2. Open your browser and visit ``http://localhost:6006`` to see the TensorBoard:

.. image:: tensorboard.png
  :width: 800
  :align: center

3. Because this workflow continues to run forever unless it hits the default timeout, cancel
the workflow after you are done:

.. code-block:: bash

  $ osmo workflow cancel <workflow ID>

The system ends the workflow and cleans up resources, which frees up the resource for
another workflow.
