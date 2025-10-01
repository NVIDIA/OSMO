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

.. _concepts_priority:

================================================
Priority, Preemption, and Borrowing
================================================

Priority
================================================

Workflows can be assigned one of three priority levels, in decreasing order of priority:

..  list-table::
    :header-rows: 1
    :widths: auto

    * - **Priority**
      - **Preemptible**
      - **Can borrow GPUs from other pools**
      - **When to use**
    * - HIGH
      - No
      - No
      - For time-critical workflows that need to skip the queue and start running as soon as possible, but can't be interrupted.
    * - NORMAL
      - No
      - No
      - For most standard workflows that can't be interrupted.
    * - LOW
      - Yes
      - Yes
      - Batch jobs that can handle being interrupted and restarted, and shouldn't block other workflows. These may actually be scheduled before
        ``HIGH`` and ``NORMAL`` priority workflows because they can borrow GPUs from other pools (see :ref:`concepts_borrowing`).


The scheduler will always try to schedule higher priority workflows before lower priority workflows.

Within the same priority level, workflows are scheduled in the order they are submitted.

In the example below, the workflows are submitted in order from ``WF1`` to ``WF6``. ``WF1`` and ``WF2`` start running immediately because there
are two GPUs available. The rest of the workflows are queued by order of priority and then by order of submit time.

.. image:: priority_queueing_order.png

By default, workflow will have the ``NORMAL`` priority. You can set the priority for a workflow by
using the ``--priority`` flag when submitting the workflow. For more information, see :ref:`wf_submit`.

.. code-block:: bash

  # No priority provided, so this workflow will have the "NORMAL" priority.
  osmo workflow submit my-normal-priority-workflow.yaml

  # Submit this with "HIGH" priority
  osmo workflow submit --priority HIGH my-high-priority-workflow.yaml

  # Submit this with "LOW" priority
  osmo workflow submit --priority LOW my-low-priority-workflow.yaml


Preemption
================================================

Workflows submitted with the ``LOW`` priority will be preempted if a higher priority workflow (``NORMAL`` or ``HIGH``) is queued
and would be able to start running if the lower priority workflow was gone. The preempted workflow will fail with the ``FAILED_PREEMPTED`` status (exit code 3006).

In the example below, ``WF1`` and ``WF2`` are running, and ``WF1`` has ``LOW`` priority. If ``WF1`` was preempted, then ``WF3`` in the queue
would be able to start running, so the scheduler goes ahead and preempts ``WF1`` to allow ``WF3`` to start.

.. image:: priority_preemption.png

Preemption allows you to submit as many ``LOW`` priority workflows as you want to keep the cluster busy without needing to worry about blocking other workflows.

Preempted workflows may or may not be rescheduled based on how the admin has configured the pool.
You can manually configure a workflow to automatically reschedule on preemption by using the ``exitActions`` field in the workflow spec, for example:

.. code-block:: yaml

  workflow:
    name: my-auto-retry-background-workflow
    task:
    - name: task1
      image: ubuntu:22.04
      command: [sleep, 1000]
      # Reschedule on FAILED_PREEMPTED status
      exitActions:
        RESCHEDULE: 3006

.. note::

  Contact your admin to know the default ``exitActions`` behavior for preemption, and whether a preempted workflow will be rescheduled, or it will fail.

.. _concepts_borrowing:

Borrowing
================================================

Multiple pools may share the same physical GPUs (if they are in the same cluster/backend). Each pool may have a quota set on how many GPUs it is allowed to use at a time.

In this example, there are two pools ``pool1`` and ``pool2`` that share the same 4 GPUs. Both pools have a quota of 2 GPUs each.

``pool1`` is only using 1 of its 2 allocated GPUs, so ``pool1`` can "borrow" the other GPU from ``pool2`` to run the ``LOW`` priority workflow ``WF3``.

.. image:: priority_borrowing.png

Borrowing allows you to run more workflows than you have GPUs available to you, by allowing you to use GPUs from other pools.

.. note::

  Only workflows with ``LOW`` priority can run on borrowed GPUs. This is because ``LOW`` priority workflows are preemptible, and they will be preempted
  immediately if the borrowed GPU is needed by the pool that owns it.

If another workflow, ``WF5``, is submitted to ``pool2`` that needs the borrowed GPU, then the scheduler will preempt ``WF3`` to allow ``WF5`` to start.

.. image:: priority_reclaim.png
