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

.. _wf_resource:

================================================
Resource
================================================

To see both usage and capacity of the resources available, use the ``resource list`` command:

.. code-block:: bash

  usage: osmo resource list [-h] [--pool POOL [POOL ...]] [--platform PLATFORM [PLATFORM ...]] [--all] [--format-type {json,text}] [--mode {free,used}]

  Resource display formats:
    Used mode (default): Shows "used/total" (e.g., 40/100 means 40 Gi used out of 100 Gi total memory)
    Free mode: Shows available resources as a single number (e.g., 60 means 60 Gi of memory is available for use)
  This applies to all allocatable resources: CPU, memory, storage, and GPU.

  options:
    -h, --help            show this help message and exit
    --pool POOL [POOL ...], -p POOL [POOL ...]
                          Display resources for specified pool.
    --platform PLATFORM [PLATFORM ...]
                          Display resources for specified platform.
    --all, -a             Show all resources from all pools.
    --format-type {json,text}, -t {json,text}
                          Specify the output format type (Default text).
    --mode {free,used}, -m {free,used}
                          Show free or used resources (Default used).
    --ignore-low-priority, -lp
                          Ignore low priority workflow resource usage.

The command shows a table with allocatable resources (capacity) and the workload on them.

.. code-block:: bash

  $ osmo resource list
  Node                    Pool        Platform          Storage [Gi]   CPU [#]   Memory [Gi]   GPU [#]
  ====================================================================================================
  ovx-01                  isaac       ovx-a40           0/6382         1/128     1/1006        0/8
  ovx-02                  isaac       ovx-a40           0/12770        1/128     1/1006        0/8
  ovx-03                  isaac       ovx-a40           0/6382         1/128     1/1006        0/8
  osmo-orin-01            isaac       agx-orin-jp6      0/1647         1/11      1/28          0
  osmo-orin-02            isaac       agx-orin-jp6      0/1646         1/11      1/28          0
  ====================================================================================================
                                                        0/28827        5/406     5/3074        0/24

For each type of allocatable (CPU, memory, storage, GPU), the numerator denotes the amount of resource occupied and the denominator denotes the max capacity of that allocatable resource for that resource node.
For example, the `ovx-01` node has 1/1006 for memory, which means that users are using 1 Gi of memory out of 1006 Gi that is supported for that node.

To see the available resources, use the ``--mode free`` flag:

.. code-block:: bash

  $ osmo resource list --mode free
  Node                    Pool        Platform          Storage [Gi]   CPU [#]   Memory [Gi]   GPU [#]
  ====================================================================================================
  ovx-01                  isaac       ovx-a40           6382           127       1005          8
  ovx-02                  isaac       ovx-a40           12770          127       1005          8
  ovx-03                  isaac       ovx-a40           6382           127       1005          8
  osmo-orin-01            isaac       agx-orin-jp6      1647           10        27            0
  osmo-orin-02            isaac       agx-orin-jp6      1646           10        27            0
  ====================================================================================================
                                                        28827          401       3069          24

For each type of allocatable (CPU, memory, storage, GPU), the single number denotes the amount of resource available for use.

The platform value usually provides insight for the hardware present in that node. For example, the ``ovx-01`` node has a platform name of ``ovx-a40``, which indicates that this resource node has the ``A40`` GPUs.
To target a resource node like the ``ovx-01`` node, you will use the platform field in the resource spec. To determine the amount
of resources to request, you can use the ``--mode free`` flag to see the amount of available resources.

.. code-block:: yaml

  resources:
    default:
      gpu: 1
      cpu: 4
      memory: 10Gi
      storage: 30Gi
      platform: ovx-a40

To see the resources in another pool, append the ``--pool`` flag:

.. code-block:: bash

  $ osmo resource list --pool <pool name>

.. note::

  If the backend flag is not supplied, the command will return the resources from the default pool
  set in your profile.

To see all the resources in all pools, append the ``--all`` flag.

.. code-block:: bash

  $ osmo resource list --all

Different resource nodes allow for different host mounts, and settings for host network and privileged mode.
To see the configurations of a resource of interest, use the ``resource info`` command:

.. code-block:: bash

  $ osmo resource info -h
  usage: osmo resource info [-h] [--pool POOL] [--platform PLATFORM] node_name

  positional arguments:
    node_name             Name of node.

  options:
    -h, --help            show this help message and exit
    --pool POOL, -p POOL  Specify the pool to see specific allocatable and configurations.
    --platform PLATFORM, -pl PLATFORM
                          Specify the platform to see specific allocatable and configurations.

The command will result in an output like this:

.. code-block:: bash

  $ osmo resource info ovx-01
  Resource Name: ovx-01

  Pool Specification:

  Pool        Platform
  ====================
  isaac-hil   ovx-a40

  * (Using configuration for isaac-hil/ovx-a40):
  Resource Capacity
  -----------------
  Storage: 6382Gi
  CPU: 128
  Memory: 1006Gi
  GPU: 8

  Task Configurations
  -------------------
  Host Network Allowed: False
  Privileged Mode Allowed: True
  Default Mounts:
  - /dev/shm
  Allowed Mounts: []


If your task targets this particular machine, you can add ``/dev/shm`` in as a host mount and set the
hostNetwork and privileged flag in your task spec, like this:

.. code-block:: bash

  resources:
    default:
      cpu: 1
      memory: 16Gi
      storage: 50Gi
      volumeMounts: ['/dev/shm']
      hostNetwork: false
      privileged: true

However, if the ``resource info`` command output shows false for ``host network`` or ``privileged``,
then your task cannot set those flags as true; doing so will result in a validation error.
