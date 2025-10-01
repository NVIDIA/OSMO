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

:orphan:

.. _pytorch_dist_training:

==========================================================================
Using PyTorch Distributed (multi-node)
==========================================================================

In this tutorial, you train a neural network using two training nodes utilizing multiple GPUs with Pytorch distributed.
Before starting, you must create a data credential, if you have not already. Refer to the :ref:`data credentials section <credentials_data>`.

Create Workflow
-----------------

1. If you have not created a `workflow_specs` folder, create one with this command:

.. code-block:: bash

  $ mkdir -p ~/workflow_specs

2. Create a new file ``pytorch_dist_training.yaml`` in the folder:

.. code-block:: bash

  $ vim ~/workflow_specs/pytorch_dist_training.yaml

3. Copy this workflow spec into that file:

.. literalinclude:: ../../../../samples/dnn_training/pytorch_dist_training.yaml
  :language: yaml

This workflow creates two tasks and requests multiple GPUs for each task. The ``worker`` task communicates to the ``master`` task
and the ``master`` class syncs up the training process once training is done on all the processes.

4. Create a scripts folder, if it has not been created:

.. code-block:: bash

  $ mkdir -p <location of pytorch_dist_training.yaml>/scripts

5. Download :download:`train_dist.py <../../../../samples/dnn_training/scripts/train_dist.py>` and copy the file to the scripts folder:

.. code-block:: bash

  $ cp <script path> ~/workflow_specs/scripts/

Submit Workflow
---------------------

1. After the credential is created, submit the workflow:

.. code-block:: bash

  $ osmo workflow submit ~/workflow_specs/pytorch_dist_training.yaml

2. Validate that the workflow has completed by querying for the workflow:

.. code-block:: bash

  $ osmo workflow query <workflow ID>

The workflow typically takes **15** minutes to run. If the status is either ``PENDING`` or ``RUNNING``, run the query command in a few minutes to check on the status. After the workflow completes, it uploads the generated dataset to data storage. Refer to :ref:`concepts_ds`.


Optional Modifications
-------------------------

You can add more worker tasks to participate in the training process.
For example, you can add another task to the workflow spec, and use the following training command:

.. code-block:: bash

  python3 /train_dist.py --offset 16 --size 8 --world_size 24

The ``--size`` flag is used for determining how many training processes to create for this task.
Each training process will occupy a dedicated GPU.

The ``--offset`` flag is used along with the size flag for calculating the global rank for each training process that is created.
If the master task has processes with ranks 0 to 7, the first worker task has processes with ranks 8 to 15,
and the second worker task has processes 16 to 23.

Here is a visualization from the Pytorch documentation:

.. image:: distributed.png

The ``--world_size`` flag is used to tell the Pytorch distributed process the total number of training processes among
all the machines.

.. note::

  This also means that you will need to change the world size parameter for the other tasks if you add a new worker task.
