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
Scheduler Configuration
=======================================================

After configuring :ref:`pools <pool>`, you can enable advanced scheduling features using the `KAI scheduler <https://github.com/NVIDIA/kai-scheduler>`_. This configuration controls how workflows compete for resources, enabling co-scheduling, preemption, and fair sharing across teams.


Why Use KAI Scheduler?
=============================

The KAI scheduler provides enterprise-grade resource management capabilities:

✓ **Co-Scheduling**
  Schedule multiple tasks together for distributed training, hardware-in-the-loop simulations, and parallel synthetic data generation.

✓ **Priority & Preemption**
  High-priority workflows can preempt low-priority ones, ensuring critical work proceeds even when clusters are fully utilized.

✓ **Fair Resource Sharing**
  Guarantee minimum resources per pool while allowing teams to burst above their baseline when capacity is available.

✓ **Maximize Utilization**
  Reclaim idle resources and redistribute them across pools based on configurable weights, minimizing waste.


How It Works
============

GPU Allocation Model
-------------------------

.. grid:: 3
    :gutter: 2

    .. grid-item-card::
        :class-header: sd-bg-success sd-text-white

        **Guarantee** 🔒
        ^^^

        Minimum resources

        +++

        Reserved, cannot be preempted

    .. grid-item-card::
        :class-header: sd-bg-warning sd-text-white

        **Weight** ⚖️
        ^^^

        Fair share ratio

        +++

        Proportional allocation above guarantee

    .. grid-item-card::
        :class-header: sd-bg-info sd-text-white

        **Maximum** 🚧
        ^^^

        Upper limit

        +++

        Cap total pool usage (-1 = unlimited)

Key Concepts
------------

- **Guarantee**: Minimum GPUs/resources reserved for a pool (non-preemptible workflows)
- **Weight**: Proportional share when pools exceed their guarantee (e.g., 1:3 ratio)
- **Maximum**: Hard cap on total resources a pool can use (-1 means unlimited)
- **Preemptible Workflows**: Use ``LOW`` priority; can be stopped to free resources
- **Non-Preemptible Workflows**: Use ``HIGH``/``NORMAL`` priority; protected from preemption

.. note::

   For detailed configuration fields, see :ref:`pool_config-resource-constraint` in the API reference.

.. warning::

   To enable preemption, ALL pools sharing the same nodes must configure ``guarantee``, ``weight``, and ``maximum``. Partial configuration disables preemption.

Practical Guide
===============

GPU Allocation
----------------------------------

**Example Cluster:** Assume a cluster with 100 GPUs total divided into two pools: Training (A) and Simulation (B).

.. list-table::
  :header-rows: 1
  :widths: 20 20 15 20

  * - **Pool**
    - **Guarantee**
    - **Weight**
    - **Maximum**
  * - Training (A)
    - 30 GPUs
    - 1
    - 70 GPUs
  * - Simulation (B)
    - 50 GPUs
    - 3
    - Unlimited (-1)

**Basic Allocation Behavior:**

- **Pool A** gets 30 GPUs guaranteed (non-preemptible workflows)
- **Pool B** gets 50 GPUs guaranteed (non-preemptible workflows)
- **Pool A** can burst up to 70 GPUs total (including preemptible)
- **Pool B** can use unlimited GPUs (including preemptible)

.. warning::

   When both pools exceed ``guarantees``, **Pool B** gets 3x **Pool A**'s allocation (weight ratio 1:3)

**Weight Ratio Example:**

When 20 GPUs become available and both pools want more:

- Pool A gets 5 GPUs (1 part)
- Pool B gets 15 GPUs (3 parts)


Preemption Scenarios
--------------------

.. dropdown:: **Scenario 1: Pool Below Guarantee Preempts**
    :color: info
    :icon: info

    **Current State:**

    - Pool A: 70 GPUs (30 non-preemptible + 40 preemptible)
    - Pool B: 30 GPUs (30 non-preemptible)
    - Cluster: Fully utilized (100/100)

    **New Workflow:** Pool B submits 4-GPU **non-preemptible** workflow

    **Result:** Pool B preempts 4 GPUs from Pool A's preemptible workflows

    **Why?**

    - Pool B is below its guarantee (30/50)
    - Non-preemptible workflows have priority over preemptible
    - Cluster is full, so preemption is necessary

.. dropdown:: **Scenario 2: Pool Cannot Preempt Itself with Low Priority**
    :color: info
    :icon: info

    **Current State:**

    - Pool A: 65 GPUs (25 non-preemptible + 40 preemptible)
    - Pool B: 35 GPUs (35 non-preemptible)
    - Cluster: Fully utilized (100/100)

    **New Workflow:** Pool A submits 5-GPU **preemptible** workflow

    **Result:** Workflow stays pending

    **Why?**

    - Preemptible workflows cannot preempt any other workflows
    - Must wait for resources to free up naturally

.. dropdown:: **Scenario 3: Pool Preempts Own Workflows**
    :color: info
    :icon: info

    **Current State:**

    - Pool A: 65 GPUs (25 non-preemptible + 40 preemptible)
    - Pool B: 35 GPUs (35 non-preemptible)
    - Cluster: Fully utilized (100/100)

    **New Workflow:** Pool A submits 5-GPU **non-preemptible** workflow

    **Result:** Pool A preempts 5 GPUs from its own preemptible workflows

    **Why?**

    - Pool A is below its guarantee (25/30 non-preemptible)
    - Non-preemptible workflows take priority
    - Pool preempts its own low-priority work


Troubleshooting
---------------

**Preemption Not Working**
  - Verify ALL pools have ``guarantee``, ``weight``, and ``maximum`` configured
  - Check pools share the same compute nodes
  - Ensure workflows use correct priority levels (``HIGH``/``NORMAL``/``LOW``)

**Unfair Resource Distribution**
  - Review weight ratios across pools
  - Verify guarantee values don't exceed cluster capacity
  - Check if pools are hitting their maximum limits

**Workflows Stuck in Pending**
  - Confirm total guarantees don't exceed cluster capacity
  - Check if pool has reached its maximum limit
  - Verify preemptible workflows are marked with ``LOW`` priority

.. tip::

   **Best Practices**

   - Set guarantees to cover baseline workload for each team
   - Use weights to reflect team priorities (higher weight = more burst capacity)
   - Set reasonable maximums to prevent one team from monopolizing resources
   - Mark exploratory/dev work as ``LOW`` priority (preemptible)
   - Reserve ``HIGH``/``NORMAL`` priority for production workloads
   - Monitor pool utilization and adjust settings quarterly

.. seealso::

  - Learn more about `KAI scheduler <https://github.com/NVIDIA/kai-scheduler>`_
  - Learn more about :ref:`scheduling in OSMO <concepts_priority>`
