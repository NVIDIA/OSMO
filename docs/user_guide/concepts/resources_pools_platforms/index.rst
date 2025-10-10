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

.. _concepts_resources_pools_platforms:

================================================
Resources, Pools, & Platforms
================================================

.. _concepts_resources:

Resources
==========

A ``resource`` refers to the machine which is used to run a workflow. These resources are grouped
into ``pools`` and ``platforms`` so that you can share resources between other users and specify
what type of hardware you want to run your workflow on.

.. _concepts_pools:

Pools
======

A ``pool`` is a group of resources that are shared between users which contains ``platforms``
to differentiate between different types of hardware. These pools are access controlled to enable
different teams to share resources.

Depending on the scheduler on the backend, the ``pool`` can have a quota imposed to limit the
number of ``HIGH`` or ``NORMAL`` priority workflows that can run on the pool. However, ``LOW``
priority workflows can go beyond the pool quota by borrowing unused GPUs available in the cluster.

Learn more about priority and preemption in :ref:`concepts_priority`.

Pools have 3 types of statuses:

..  list-table::
  :header-rows: 1
  :widths: auto

  * - **Status**
    - **Description**
  * - ONLINE
    - The pool is ready to run workflows.
  * - OFFLINE
    - Workflows can be submitted to the pool, but will be queued until the pool is online.
  * - MAINTENANCE
    - The pool is undergoing maintenance. You won't be able to submit workflows to the pool Unless
      you have administrative access.

Resources in a pool can have two types:

..  list-table::
  :header-rows: 1
  :widths: auto

  * - **Type**
    - **Description**
  * - SHARED
    - The resource is shared with another pool.
  * - PRIVATE
    - The resource is only available to the pool.

To view the pools, you can use :ref:`Pool List <cli_reference_pool_list>`.

To view the available resources in a pool, you can use :ref:`Resource List <cli_reference_resource_list>`.

.. _concepts_platforms:

Platforms
=========

A ``platform`` is a group of resources in a pool and denotes a specific type of hardware.

Each platform can also have different access types:

- **privileged**: Whether the platform allows privileged containers.
- **host network**: Whether the platform allows host networking.
- **allowed mounts**: Whether the platform allows specific volume mounts from the node to the task container.
- **default mounts**: The default volume mounts from the node to the task container for the platform.

You can see if these access types are allowed in the resource info output of :ref:`cli_reference_resource_info`.

If **privileged**, **host network**, or **allowed mounts** are allowed, you can set them in the
workflow spec. Learn more at :ref:`concepts_tasks`.

When you are submitting a workflow, you will need to specify a platform to target in the
workflow resource spec. Learn more at :ref:`concepts_wf_resources`.
