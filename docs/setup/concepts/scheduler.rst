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

.. _scheduler:

=======================================================
Scheduler
=======================================================

A scheduler is a component that is responsible for orchestrating tasks in a backend.

There are three supported schedulers:

.. list-table:: Supported Schedulers
  :header-rows: 1
  :widths: auto

  * -
    - **KAI (Recommended)**
    - **Scheduler Plugins**
    - **Default**
  * - **Co-scheduling**
    - Yes
    - Yes
    - No
  * - **Performance for large groups**
    - Good
    - Poor
    - Not Supported
  * - **Preemption supported with groups**
    - Yes
    - No
    - No

`Co-scheduling` allows multiple tasks to be scheduled together.
This enables many unique and essential use cases, such as:

- Spinning up a distributed training cluster
- Running hardware-in-the-loop simulations, where one task runs a simulation application and another task runs applications on robotics hardware (such as NVIDIA AGX platform)
- Running many instances of synthetic data generation in parallel

We **strongly recommend** using the KAI scheduler for OSMO.

KAI Scheduler
~~~~~~~~~~~~~

`KAI scheduler <https://github.com/NVIDIA/kai-scheduler>`_ is the recommended backend scheduler for OSMO.
It is the most compatible scheduler with OSMO, supporting:

- Workload priority and preemption with a hierarchical queue system
- Fair sharing of resources between different teams and pools
- Reclaim resources and maximize utilization across different teams and pools

Each pool has three configurable settings:

- **Guarantee**: The minimum number of resources that the pool can use which cannot be preempted
- **Weight**: When multiple pools in a cluster are consuming resources over their limit, they are given resources proportional to their weight
- **Maximum**: The maximum number of resources that the pool can use (both preemptible and non-preemptible)

To see the config settings for priority, please refer to the :ref:`pool_config-resource-constraint` section in Pool Configs.

.. warning::

  To set up priority and preemption for pools sharing the same resource nodes, admins need to configure ALL pools
  with the `guarantee`, `weight`, and `maximum` settings. Otherwise, preemption will not be enabled.

Example
-------

For example, if a compute cluster has 100 GPUs and two pools with the following settings:

.. list-table:: Example Pool Configuration
  :header-rows: 1
  :widths: auto

  * - **Pool**
    - **Guarantee**
    - **Weight**
    - **Maximum**
  * - Pool A
    - 30
    - 1
    - 70
  * - Pool B
    - 50
    - 3
    - -1

Basic behavior
~~~~~~~~~~~~~~

- Pool A is guaranteed 30 GPUs that can be used by non-preemptible workflows (`HIGH`/`NORMAL` priority)
- Pool B is guaranteed 50 GPUs that can be used by non-preemptible workflows
- Pool A can use up to 70 GPUs for both preemptible and non-preemptible workflows
- Setting `Maximum` to `-1` means that Pool B can use as many GPUs as it wants for both preemptible and non-preemptible workflows
- When both pools exceed their guarantee, resources are allocated proportionally based on their weights (1:3 ratio):

  * Scheduler schedules 1 GPU for `Pool A` for every 3 GPUs for `Pool B`
  * These workflows need to be preemptible (`LOW` priority)

Preemption Example
~~~~~~~~~~~~~~~~~~

Using the previous example, we now introduce a new scenario:

.. code-block:: text

  Pool A is using 70 GPUs: 30 non-preemptible and 40 preemptible.
  Pool B is using 30 GPUs: 30 non-preemptible only.

With this scenario, the pools will have the following preemption behavior:

- When Pool B receives a `non-preemptible` workflow for 4 GPUs, Pool B will preempt a workflow from Pool A to get 4 GPUs

  * This is because Pool B has not hit its guarantee of 50 GPUs
  * This workflow is `non-preemptible` and has higher priority, so it will preempt a `preemptible` workflow from Pool A
  * A workflow needs to be preempted because the cluster is completely occupied

Here we have another scenario:

.. code-block:: text

  Pool A is using 65 GPUs: 25 non-preemptible and 40 preemptible.
  Pool B is using 35 GPUs: 35 non-preemptible only.

For the next workflow submission, let's consider the following cases:

- When Pool A receives a `non-preemptible` workflow for 5 GPUs, Pool A will preempt a workflow from its own pool to get 5 GPUs

  * This is because Pool A has not hit its guarantee of 30 GPUs
  * This workflow is `non-preemptible` and has higher priority, so it will preempt a `non-preemptible` workflow from its own pool
  * A workflow needs to be preempted because the cluster is completely occupied

- When Pool A receives a `preemptible` workflow for 5 GPUs instead, this new workflow will be in pending

  * Preemptible workflows cannot preempt other workflows
  * This new workflow will only schedule once a workflow from either pool has finished

- When Pool B receives a `non-preemptible` workflow for 5 GPUs, Pool B will preempt a `preemptible` workflow from Pool A to get 5 GPUs

  * This is because Pool B has not hit its guarantee of 30 GPUs
  * A `preemptible` workflow will be preempted to allow this `non-preemptible` workflow to schedule
