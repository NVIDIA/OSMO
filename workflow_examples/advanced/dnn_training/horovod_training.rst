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

.. _horovod_training:

====================================================
Using Horovod (multi-node)
====================================================

In this tutorial, you train the ResNet-50 neural network using two training nodes.
Before starting, you must create a data credential, if you have not already. Refer to the :ref:`data credentials section <credentials_data>`.

Create Workflow
-----------------

1. If you have not created a `workflow_specs` folder, create one with this command:

.. code-block:: bash

  $ mkdir -p ~/workflow_specs

2. Create a new file ``multinode_training.yaml`` in the folder:

.. code-block:: bash

  $ vim ~/workflow_specs/multinode_training.yaml

3. Copy this workflow spec into that file:

.. literalinclude:: ../../../../samples/dnn_training/horovod_training.yaml
  :language: yaml

This workflow creates two tasks and requests a GPU for each task. The `control` task runs ``horovodrun``, which sends the signal to the
worker node to start the training process. ``horovodrun`` uses SSH to communicate with different worker tasks.

SSH Credentials
----------------------

1. Because this workflow requires a pair of SSH private and public keys, generate the keys by running the following:

.. code-block:: bash

  $ ssh-keygen -t ed25519

.. note:: Make sure you do not overwrite your pre-existing key.

2. When the command prompts you to enter a path to store the key, enter the path:

.. code-block:: bash

  $ /tmp/id_ed25519

3. Create a generic secret that the workflow uses to set the SSH keys. Use the `--payload-file` option to pass the path of the SSH
keys:

.. code-block:: bash

  $ osmo credential set ssh_cred --type GENERIC --payload-file SSH_PUBLICKEY=/tmp/id_ed25519.pub SSH_PRIVATEKEY=/tmp/id_ed25519

Submit Workflow
---------------------

1. After the credential is created, submit the workflow:

.. code-block:: bash

  $ osmo workflow submit ~/workflow_specs/multinode_training.yaml

2. Validate that the workflow has completed by querying for the workflow:

.. code-block:: bash

  $ osmo workflow query <workflow ID>

  The workflow typically takes **15** minutes to run. If the status is either ``PENDING`` or ``RUNNING``, run the query command in a few minutes to check on the status. After the workflow completes, it uploads the generated dataset to data storage. Refer to :ref:`concepts_ds`.

Download Model
----------------

1. Create a new folder and download the model to it:

.. code-block:: bash

  $ mkdir -p ~/models
  $ osmo dataset download model-sample ~/models

Optional Modifications
-------------------------

You can customize some parameters that are used in the workflow spec.

To increase the number of epochs run, you can modify the workflow spec that sets the number of epochs for training:

.. code-block:: bash

  --epoch <number>

If you change the epoch number, make sure to update the model name so that the workflow can upload the correct model:

.. code-block:: bash

  $ mv checkpoint-<number>.pth.tar {{output}}
