
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

.. _training_multi_node:

Moving forward to Multi-Node Distributed Training
-------------------------------------------------

This section uses TorchRun as an example to demonstrate how to train a model distributively on multiple nodes in OMSO.

The complete workflow example is available `here <https://github.com/NVIDIA/OSMO/tree/main/workflow_examples/dnn_training/torchrun_multinode>`_.
More examples with other distributed training frameworks can be found in :ref:`workflow_examples`.

Making a TorchRun Multi-Node Training Script
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

To train a model on multiple nodes in OMSO, you need to first make your training script compatible with distributed training,
for example, using `train.py <https://github.com/NVIDIA/OSMO/tree/main/workflow_examples/dnn_training/torchrun_multinode/train.py>`_.

Training on Two Nodes
~~~~~~~~~~~~~~~~~~~~~

``groups`` enables tasks to be launched simultaneously and allow network communication between tasks.
OSMO token ``{{host:<task_name>}}`` can be used to get the hostname of the lead task for TorchRun setup.

Taking a two-node training as an example, the workflow spec can be written as follows:

.. code-block:: yaml

  workflow:
    name: train-multi-gpu
    resources:
      default:  # Resources of each task
        gpu: 8
        cpu: 16
        memory: 30Gi
        storage: 30Gi
    groups:
    - name: training
      tasks:
      - name: master  # Master task for torchrun
        image: nvcr.io/nvidia/pytorch:24.03-py3
        lead: true  # Set to the lead of the group
        command: [bash]
        args: [/tmp/master.sh]
        files:
        - path: /tmp/master.sh
          contents: |
            set -ex
            mkdir -p {{output}}/models

            # Launch training
            torchrun --nnodes 2 --nproc_per_node 8 --node_rank 0 \
                      --master_addr {{host:master}} --master_port 29400 \
                      /tmp/train.py --total_epochs 10 --batch_size 32 \
                      --snapshot_path {{output}}/models/snapshot.pth
        - path: /tmp/train.py
          localpath: train.py

      - name: worker  # Worker task that will communicate with the master task
        image: nvcr.io/nvidia/pytorch:24.03-py3
        command: [bash]
        args: [/tmp/worker.sh]
        files:
        - path: /tmp/worker.sh
          contents: |
            set -ex
            mkdir -p {{output}}/models

            # Launch training
            torchrun --nnodes 2 --nproc_per_node 8 --node_rank 1 \
                      --master_addr {{host:master}} --master_port 29400 \
                      /tmp/train.py --total_epochs 10 --batch_size 32 \
                      --snapshot_path {{output}}/models/snapshot.pth
        - path: /tmp/train.py
          localpath: train.py

In some cases, you may want to get the IP address of the task instead of the hostname.
Use ``nslookup`` as an example to resolve the hostname to an IP address:

.. code-block:: bash

  TASK_IP=$(nslookup {{host:master}} | grep -oP \
    'Address: \K\d[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}' | head -n1)

Scaling up to Arbitrary Number of Nodes
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Once the two-node training is successful, you can scale up the training to more nodes with templating:

.. code-block:: jinja

  workflow:
    name: train-multi-gpu
    resources:
      default:  # Resources of each task
        gpu: {{ n_gpus_per_node }}
        cpu: 16
        memory: 30Gi
        storage: 30Gi
    groups:
    - name: training
      tasks:
      {% for item in range(n_nodes) %}
      {% if item == 0 %}
      - name: master  # Master task for torchrun
        lead: true  # Set to the lead of the group
        outputs:  # Only save the trained model in lead task
        - dataset:
            name: {{ output_dataset }}
            path: models
      {% else %}
      - name: worker_{{item}}  # Worker task that will communicate with the master task
      {% endif %}
        image: nvcr.io/nvidia/pytorch:24.03-py3
        command: [bash]
        args: [/tmp/run.sh]
        files:
        - path: /tmp/run.sh
          contents: |
            set -ex
            mkdir -p {{output}}/models

            # Launch training
            torchrun --nnodes {{n_nodes}} --nproc_per_node {{n_gpus_per_node}} --node_rank {{item}} \
                      --master_addr {{host:master}} --master_port {{master_port}} \
                      /tmp/train.py --total_epochs {{n_epochs}} --batch_size {{batch_size}} \
                      --snapshot_path {{output}}/models/snapshot.pth
        - path: /tmp/train.py
          localpath: train.py
      {% endfor %}

  default-values:
    n_gpus_per_node: 8
    n_nodes: 2
    master_port: 29400
    n_epochs: 10
    batch_size: 32
    output_dataset: my-trained-model  # The name of the output dataset

Now you can change default values with the commandline. For example,
this shows how to submit the workflow with 4 nodes and 4 GPUs per node:

.. code-block:: bash

  $ osmo workflow submit <your workflow spec path> --set n_nodes=4 n_gpus_per_node=4

Synchronizing Training Starting time by Yourself
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

OSMO makes sure that all tasks in the same group start entry commands at the same time.
This prevents different initialization time causing timeout issues.

In some cases, you may want to synchronize the training starting time by yourself.
For example, you need to install some heavy dependencies before the training starts and that can take varies of time.
You can use the a barrier script like `osmo_barrier.py <https://github.com/NVIDIA/OSMO/tree/main/workflow_examples/dnn_training/torchrun_multinode/osmo_barrier.py>`_ to synchronize before the training launches.

.. code-block:: jinja

  groups:
  - name: training
    tasks:
    {% for item in range(n_nodes) %}
    {% if item == 0 %}
    - name: master
    {% else %}
    - name: worker_{{item}}
    {% endif %}
      files:
      - path: /tmp/run.sh
        contents: |
          # Time varying code

          # Synchronize the master and all workers
          python3 /tmp/osmo_barrier.py --num_nodes {{n_nodes}} --connect {{host:master}} --rank {{item}}

          # Launch training
      - path: /tmp/train.py
        localpath: train.py
      - path: /tmp/osmo_barrier.py
        localpath: osmo_barrier.py
    {% endfor %}
