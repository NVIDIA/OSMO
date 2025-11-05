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

.. _tutorials_gang_scheduling:

==========================
Hardware In The Loop (HIL)
==========================

.. important::

  Prerequisites:

  * :ref:`Requesting Resources <tutorials_requesting_resources>`
  * :ref:`Parallel Workflows <tutorials_parallel_workflows>`
  * :ref:`Combination Workflows <tutorials_combination_workflows>`

  This tutorial also assumes you have necessary hardware in your pool to run tasks
  on different platforms.

This tutorial teaches you how to use achieve Hardware-In-The-Loop (HIL) workflow - one of OSMO's
most powerful features.

HIL is achieved through **heterogeneous gang scheduling** where tasks across different hardware
platforms (x86, ARM, GPU) run simultaneously within the same group.

By the end, you'll understand:

- What **heterogeneous gang scheduling** means in OSMO
- How to target **multiple** hardware platforms in a group
- How tasks in a group communicate with each other

.. tip::

  In addition to HIL, heterogeneous gang scheduling is also useful for:

  - **Cross-platform testing** - Test x86 and ARM builds simultaneously
  - **Distributed systems** - Deploy services across different hardware types
  - **Hybrid workloads** - Combine GPU compute, ARM inference, and x86 orchestration

What is Heterogeneous Gang Scheduling?
======================================

In :ref:`Parallel Workflows <tutorials_parallel_workflows>` and :ref:`Combination Workflows <tutorials_combination_workflows>`,
you learned about groups where tasks run together. **Gang scheduling** means OSMO schedules all tasks
in a group as a unit—they all start simultaneously.

.. important::

  **Gang scheduling** - Multiple tasks scheduled together as a unit (all start at the same time)

  **Heterogeneous** - Tasks can run on different hardware platforms (x86, ARM, GPU, etc.)

Targeting Multiple Platforms in a Group
=======================================

OSMO allows you to target multiple hardware platforms in a group. This enables a mix of hardware
types coordinating together in a single workflow.

Use the ``platform`` field in resource specifications to target specific platforms:

.. code-block:: yaml

  resources:
    gpu-compute:
      cpu: 4
      gpu: 1
      memory: 16Gi
      platform: ovx-a40 # (1)

    arm-controller:
      cpu: 2
      memory: 8Gi
      platform: agx-orin-jp6 # (2)

.. code-annotations::

  1. Target x86 nodes with specific GPU type
  2. Target ARM-based edge devices

.. tip::

  Check available platforms in your pool:

  .. code-block:: bash

    $ osmo resource list --pool <pool_name>

Robot Simulation Example
========================

Let's create a workflow that runs a physics simulation on a GPU and a robot controller on an ARM device:
:download:`robot_simulation.yaml <robot_simulation.yaml>`.

.. important::

   Please make sure to modify the workflow to use the correct platform and resource for your setup.
   For more information, please refer to the :ref:`Resources <workflow_spec_resources>` documentation.

.. literalinclude:: robot_simulation.yaml
  :language: yaml
  :start-after: SPDX-License-Identifier: Apache-2.0

.. code-annotations::

  1. GPU task runs physics simulation and serves results via HTTP.
  2. ARM task runs the robot controller.
  3. Use ``{{host:task-name}}`` to communicate between tasks in the group.

**What Happens:**

1. **Gang scheduling**: OSMO finds resources on both GPU and ARM platforms
2. **Simultaneous start**: Both tasks start together once resources are available
3. **Communication**: ARM controller connects to GPU simulation using ``{{host:physics-sim}}``
4. **Control loop**: ARM reads simulation data and makes real-time control decisions

.. important::

  **Key Point**: OSMO waits for resources on ALL platforms before starting ANY task in the group.
  This ensures synchronized execution across heterogeneous hardware.

.. note::

  The above example has a 15 minute timeout built-in to ensure the workflow completes within a reasonable time.

  Please make sure to modify the timeout to your needs. For more information, please refer to the
  :ref:`Timeouts <workflow_spec_timeouts>` documentation.

Next Steps
==========

**Continue Learning:**

- :ref:`Advanced Patterns <tutorials_advanced_patterns>` - Workflow templates, checkpointing, error handling, and more
- :ref:`Hardware-in-the-Loop How-To <guides_hil>` - Production HIL workflow with Isaac Lab and Jetson

.. seealso::

  **Related Documentation:**

  - :ref:`Resources <workflow_spec_resources>` - Full resource and platform specification
  - :ref:`Groups <workflow_spec_group>` - Full specification for groups
  - :ref:`Scheduling <concepts_priority>` - How OSMO schedules workflows
