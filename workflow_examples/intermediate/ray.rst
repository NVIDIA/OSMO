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

.. _ray_framework:

==============
Launching Ray
==============

Concepts
--------

`Ray <https://www.ray.io/>`_ is a unified framework for scaling AI and Python applications.
OSMO provides native support for running Ray clusters, making it easy to leverage Ray's
distributed computing capabilities.

To launch a Ray cluster, you can add this to your lead task main run script:

.. code-block:: yaml

  - image: nvcr.io/nvidia/pytorch:24.03-py3
    command: [bash]
    args: [/tmp/entry.sh]
    lead: true
    files:
    - path: /tmp/entry.sh
      contents: |
        pip install ray"[train,default,tune]" --upgrade
        ray start --head --port={{ray_port}}
        ray metrics launch-prometheus

        # Rest of your main script

        sleep infinity

For the worker nodes, you can add this to your worker task main run script:

.. code-block:: yaml

  - image: nvcr.io/nvidia/pytorch:24.03-py3
    command: [bash]
    args: [/tmp/entry.sh]
    files:
      - path: /tmp/entry.sh
        contents: |
          pip install ray"[train,default,tune]" --upgrade
          ray start --address={{host:master}}:{{ray_port}}
          ray metrics launch-prometheus

          # Rest of your main script

          sleep infinity

Example
-------

This workflow launches a Ray cluster with one master node and one or more worker nodes
The master node runs the Ray head process that coordinates the cluster
Worker nodes connect to the master to form a distributed compute cluster

The cluster uses the PyTorch container with Ray installed for distributed ML workloads.

Key features:

- Configurable number of nodes (default: 2 - 1 master + 1 worker)
- Resource allocation per node (GPU, CPU, memory, storage)
- Ray dashboard accessible on port 8265
- Prometheus metrics on port 9090
- Configurable timeout to auto-terminate the cluster

.. md-tab-set::

  .. md-tab-item:: Workflow

    .. literalinclude:: ../../../samples/remote_tools/ray.yaml
      :language: jinja

  .. md-tab-item:: App

    .. code-block:: bash

      $ osmo app submit sample-ray

This configuration creates a Ray cluster with one master node and one worker node.
The master node starts the Ray head process, while worker nodes connect to it.

Accessing the Ray Cluster
~~~~~~~~~~~~~~~~~~~~~~~~~

Port-forward the dashboard ports to access the Ray dashboard and Prometheus metrics:

.. code-block:: bash

  osmo workflow port-forward <workflow ID> master --port 8265,9090

The Ray dashboard will be available at ``http://localhost:8265``.
The Prometheus dashboard will be available at ``http://localhost:9090``.

Set the Ray address environment variable to use Ray CLI:

.. code-block:: bash

  export RAY_ADDRESS="http://localhost:8265"

Best Practices
--------------

1. **Resource Allocation**: Ensure your resource requests match your workload requirements.
   Ray works best when it has accurate information about available resources.
   You can modify the default resource allocation in the workflow or app spec:

.. md-tab-set::

  .. md-tab-item:: Workflow

    .. code-block:: yaml

      num_nodes: 2          # Number of nodes in the cluster (1 master + 1 workers)
      default-values:
        resources:
          default:
            gpu: 1          # GPUs per node
            cpu: 10         # CPUs per node
            memory: 60Gi    # Memory per node
            storage: 120Gi  # Storage per node

  .. md-tab-item:: App

    You can update the values in the command below, and omit the ones you don't want to change:

    .. code-block:: yaml

      $ osmo app submit ray-tutorial --set num_nodes=2 gpu=1 cpu=10 memory=60Gi storage=120Gi

2. **Monitoring**: Use the Ray dashboard to monitor cluster health, task progress, and resource utilization.

3. **Port Configuration**: The default Ray port (6376) can be customized using the ``ray_port`` parameter if needed.

4. **Timeouts**: Consider setting appropriate timeouts to manage cluster lifecycle:

.. code-block:: yaml

  timeout:
    exec_timeout: 1h  # Cluster will be terminated after 1 hour
