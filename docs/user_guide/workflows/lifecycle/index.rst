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

.. _workflow_lifecycle:

==================
Workflow Lifecycle
==================

When you submit a workflow, it progresses through distinct phases from submission to completion.
This page explains what happens at each stage and what you should expect to see.

Overview
========

Every successful workflow follows this path:

.. grid:: 3
    :gutter: 3

    .. grid-item-card::
        :class-header: card-pending text-dark

        **PENDING** ⏱️
        ^^^

        Setting up resources and preparing to run

        +++

        **What's happening:** Validating, queuing, and initializing

        :bdg-pending:`Active`

    .. grid-item-card::
        :class-header: card-running text-white

        **RUNNING** ▶️
        ^^^

        Your tasks are executing

        +++

        **What's happening:** Commands running, transferring data

        :bdg-running:`Active`

    .. grid-item-card::
        :class-header: card-completed text-white

        **COMPLETED** ✓
        ^^^

        All tasks finished successfully

        +++

        **What's happening:** Outputs uploaded, workflow done

        :bdg-completed:`Terminal`

.. tip::

   **Most workflows follow this simple progression.** If you see other statuses like :kbd:`WAITING`
   or various :kbd:`FAILED` states, see the sections below to understand what's happening.

----

Task Lifecycle
==============

.. tab-set::
   :class: lifecycle-tabs

   .. tab-item:: SUBMITTING
      :class-label: phase-tab

      **What's happening:**

      - Workflow YAML is being validated (syntax, names, resources)
      - Credentials are checked (registry and data access)
      - Resource requests are matched against pool capacity

      **Common issues:**

      - **Invalid/missing credentials** → Configure with ``osmo credential set``
      - **Resource requests too large** → Reduce GPU/CPU/memory or verify with ``osmo pool list`` or ``osmo resource list``

   .. tab-item:: WAITING
      :class-label: phase-tab

      **What's happening:**

      - Task is waiting for upstream tasks to complete
      - No resources are being consumed during this phase

      **Common issues:**

      - Upstream task failures will cause dependent tasks to fail
      - Long wait times if upstream tasks are slow or queued

   .. tab-item:: PROCESSING
      :class-label: phase-tab

      **What's happening:**

      - Converting task specification to backend format
      - Submitting task to backend scheduler

      **Common issues:**

      - Rare - usually internal processing errors
      - If stuck here, please contact your administrator

   .. tab-item:: SCHEDULING
      :class-label: phase-tab

      **What's happening:**

      - Task is in the backend queue
      - Waiting for nodes with requested resources (CPU, GPU, memory)
      - :ref:`Priority <concepts_priority>` and queue position determine the order in which tasks are scheduled

      **Common issues:**

      - **Insufficient resources in pool** → Check pool capacity: ``osmo pool list``
      - **Resource requests too large** → Reduce GPU/CPU/memory requests or request a larger pool
      - **Queue timeout exceeded** → Increase ``queue_timeout`` (see :ref:`workflow_spec_timeouts`)

   .. tab-item:: INITIALIZING
      :class-label: phase-tab

      **What's happening:**

      - Pulling Docker image (if not already cached on the node)
      - Running preflight tests
      - Preparing container environment

      **Common issues:**

      - **Image doesn't exist** → ``FAILED_IMAGE_PULL`` - Check image name and registry
      - **No pull credentials** → ``FAILED_IMAGE_PULL`` - Verify registry credentials
      - **Image pull timeout** → ``FAILED_START_TIMEOUT`` - Image too large or network issues
      - **Preflight test failures** → ``FAILED_START_ERROR`` - Container startup problems

   .. tab-item:: RUNNING
      :class-label: phase-tab

      **What's happening:**

      Three sequential activities occur during the :kbd:`RUNNING` phase:

      1. **Input download** - Sidecar container downloads any specified inputs from:

         - Upstream task outputs
         - Datasets
         - Cloud storage URLs

      2. **Command execution** - Your code runs in the container:

         - Standard output/error is captured in logs
         - Exec and port-forwarding are available during this time
         - You can interact with the running task

      3. **Output upload** - After your command completes, sidecar uploads outputs:

         - Files from the output directory are uploaded
         - Uploads to specified locations or intermediate storage
         - Happens before status changes to :kbd:`COMPLETED`

      **Common issues:**

      - **Execution timeout exceeded** → ``FAILED_EXEC_TIMEOUT`` - Increase ``exec_timeout`` or optimize code
      - **Memory limits exceeded** → ``FAILED_EVICTED`` - Request more memory or reduce usage
      - **Storage limits exceeded** → ``FAILED_EVICTED`` - Clean up intermediate files or request more storage
      - **Node failures** → ``FAILED_BACKEND_ERROR`` - Infrastructure issue, consider auto-reschedule
      - **Command exits with error** → ``FAILED`` - Check logs: ``osmo workflow logs <workflow-id> <task-name>``

   .. tab-item:: COMPLETED
      :class-label: phase-tab

      :bdg-completed:`COMPLETED`

      - Task finished successfully (exit code ``0``)
      - All outputs have been uploaded
      - Task is done and cannot transition to any other state

      :bdg-failed:`FAILED`

      - Task encountered an error and stopped
      - See :ref:`workflow_lifecycle_status` for all failure types
      - Check logs to diagnose: ``osmo workflow logs <workflow-id> <task-name>``
      - Check exit code (see :ref:`workflow_exit_codes`)

.. dropdown:: Task's Output Behavior
    :color: info
    :icon: file-moved

    **When are outputs uploaded?**

    Outputs are uploaded when the task completes successfully. However:

    .. attention::

        If the task is canceled or terminated (due to backend error, eviction, or preemption), outputs are **NOT uploaded**.

    **Where are outputs uploaded?**

    OSMO determines the upload destination based on your configuration:

    * **Custom location** - If you specify ``outputs`` in the task spec
      → See :ref:`workflow_spec_outputs`

    * **Intermediate storage** - In these cases:

      * Task has downstream dependencies (outputs needed by other tasks)
      * Task has no downstream dependencies **AND** no ``outputs`` specified (automatic backup)

.. dropdown:: How to recover from task failures?
    :color: info
    :icon: sync

    When tasks fail, you can configure automatic recovery using :ref:`workflow_spec_exit_actions`:

    - **Reschedule** (creates new task) - Use for:

      - Node failures (``FAILED_BACKEND_ERROR``)
      - Preemption (``FAILED_PREEMPTED``)
      - Image pull issues (``FAILED_IMAGE_PULL``)

    - **Restart** (re-runs command on same task) - Use for:

      - Code crashes that can resume from checkpoints
      - Timeouts where work can continue
      - Temporary failures that don't require a fresh start

    **Example configuration:**

    .. code-block:: yaml

        tasks:
          - name: resilient-task
            image: my-image
            ...

            exitActions:
              COMPLETE: 0-10
              RESTART: 11-20
              RESCHEDULE: 21-255

    .. note::

        Please contact your administrator to enable/configure maximum number of retries.

----

.. _workflow_lifecycle_group:

Group Lifecycle
===============

Groups allow multiple tasks to run together and communicate. Understanding group lifecycle
is important when using distributed training or multi-task coordination.

Groups follow a similar lifecycle to tasks, but represent the **collective state** of all
tasks within the group:

1. **SUBMITTING** → Group is being submitted
2. **WAITING** → Group waits for upstream groups (if any)
3. **PROCESSING** → Service is preparing the group
4. **SCHEDULING** → Group is waiting to be scheduled
5. **INITIALIZING** → Tasks are pulling images
6. **RUNNING** → At least one task in the group is running
7. **COMPLETED** or **FAILED** → Group finished

.. dropdown:: How ``ignoreNonleadStatus`` Affects Group Behavior
   :color: info
   :icon: gear

   Every group must have exactly one **lead task**. The ``ignoreNonleadStatus`` field (default: ``true``)
   determines how non-lead task failures affect the group:

   .. list-table::
      :header-rows: 1
      :widths: 10 45 45

      * - **Value**
        - **Finished Status**
        - **Reschedule Behavior**
      * - ``true``
        - The group's status is dependent **only on the lead task**.
        - When a task is rescheduled, other tasks in the group **continue running**.
      * - ``false``
        - The group's status is dependent on **all the tasks** in the group. If any task fails,
          the group will fail.
        - When a task is rescheduled, the other tasks in the group are restarted and the group
          status stays at ``RUNNING``.

   Learn more about group fields at :ref:`workflow_spec_group`.

.. _workflow_lifecycle_status:

Status Reference
================

.. dropdown:: Workflow Statuses
   :color: secondary
   :icon: list-unordered
   :open:

   .. list-table::
      :header-rows: 1
      :widths: 25 75

      * - **Status**
        - **Description**
      * - :bdg-pending:`PENDING`
        - Workflow is waiting for a group to start running
      * - :bdg-pending:`WAITING`
        - Workflow has started but doesn't have any tasks running. Either a downstream task is waiting to be scheduled, or a task is waiting to be rescheduled
      * - :bdg-running:`RUNNING`
        - Workflow is running at least one group
      * - :bdg-completed:`COMPLETED`
        - Workflow execution was successful and all tasks have completed
      * - :bdg-failed:`FAILED`
        - Workflow failed to complete. One or more tasks have failed
      * - :bdg-failed:`FAILED_EXEC_TIMEOUT`
        - Workflow was running longer than the set execution timeout (see :ref:`workflow_spec_timeouts`)
      * - :bdg-failed:`FAILED_QUEUE_TIMEOUT`
        - Workflow was queued longer than the set queue timeout (see :ref:`workflow_spec_timeouts`)
      * - :bdg-failed:`FAILED_SUBMISSION`
        - Workflow failed to submit due to resource or credential validation failure
      * - :bdg-failed:`FAILED_SERVER_ERROR`
        - Workflow failed due to internal server error
      * - :bdg-failed:`FAILED_CANCELED`
        - Workflow was canceled by a user

.. dropdown:: Task Statuses
   :color: secondary
   :icon: list-unordered
   :open:

   .. list-table::
      :header-rows: 1
      :widths: 25 75

      * - **Status**
        - **Description**
      * - :bdg-pending:`SUBMITTING`
        - Task is being submitted
      * - :bdg-pending:`WAITING`
        - Task is waiting for an upstream task to complete
      * - :bdg-pending:`PROCESSING`
        - Task is being processed by the service to be sent to the backend
      * - :bdg-pending:`SCHEDULING`
        - Task is in the backend queue waiting to run
      * - :bdg-pending:`INITIALIZING`
        - Task is pulling images and running preflight tests
      * - :bdg-running:`RUNNING`
        - Task is running (downloading inputs → executing command → uploading outputs)
      * - :bdg-failed:`RESCHEDULED`
        - Task has finished and a new task with the same spec has been created
      * - :bdg-completed:`COMPLETED`
        - Task has finished successfully
      * - :bdg-failed:`FAILED`
        - Task has failed (your command returned non-zero exit code)
      * - :bdg-failed:`FAILED_CANCELED`
        - Task was canceled by the user
      * - :bdg-failed:`FAILED_SERVER_ERROR`
        - Task has failed due to internal service error
      * - :bdg-failed:`FAILED_BACKEND_ERROR`
        - Task has failed due to some backend error like the node entering a Not Ready state
      * - :bdg-failed:`FAILED_EXEC_TIMEOUT`
        - Workflow ran longer than the set execution timeout (see :ref:`workflow_spec_timeouts`)
      * - :bdg-failed:`FAILED_QUEUE_TIMEOUT`
        - Workflow was queued longer than the set queue timeout (see :ref:`workflow_spec_timeouts`)
      * - :bdg-failed:`FAILED_IMAGE_PULL`
        - Task has failed to pull Docker image
      * - :bdg-failed:`FAILED_UPSTREAM`
        - Task has failed due to failed upstream dependencies
      * - :bdg-failed:`FAILED_EVICTED`
        - Task was evicted due to memory or storage usage exceeding limits
      * - :bdg-failed:`FAILED_PREEMPTED`
        - Task was preempted to make space for a higher priority task
      * - :bdg-failed:`FAILED_START_ERROR`
        - Task failed to start up properly during the initialization process
      * - :bdg-failed:`FAILED_START_TIMEOUT`
        - Task timed-out while initializing

.. dropdown:: Group Statuses
   :color: secondary
   :icon: list-unordered
   :open:

   .. list-table::
      :header-rows: 1
      :widths: 25 75

      * - **Status**
        - **Description**
      * - :bdg-pending:`SUBMITTING`
        - Group is being submitted
      * - :bdg-pending:`WAITING`
        - Group is waiting for an upstream group to complete
      * - :bdg-pending:`PROCESSING`
        - Group is being processed by the service to be sent to the backend
      * - :bdg-pending:`SCHEDULING`
        - Group is waiting to be scheduled in the backend
      * - :bdg-pending:`INITIALIZING`
        - All tasks in the group are initializing
      * - :bdg-running:`RUNNING`
        - Any task in the group is running
      * - :bdg-completed:`COMPLETED`
        - Task completed status as defined by the ``ignoreNonleadStatus`` field. See :ref:`workflow_lifecycle_group` for more information.
      * - :bdg-failed:`FAILED`
        - If the lead task has failed or if ``ignoreNonleadStatus`` is set to ``false`` and any of the non-lead tasks have failed
      * - :bdg-failed:`FAILED_UPSTREAM`
        - Upstream group has failed
      * - :bdg-failed:`FAILED_SERVER_ERROR`
        - Some OSMO internal error occurred
      * - :bdg-failed:`FAILED_PREEMPTED`
        - Any of the tasks in the group were preempted
      * - :bdg-failed:`FAILED_EVICTED`
        - Any of the tasks in the group were evicted

----

.. seealso::

   **Related Documentation:**

   - :ref:`workflow_spec_group` - Group configuration and behavior
   - :ref:`workflow_spec_timeouts` - Set execution and queue timeouts
   - :ref:`workflow_exit_codes` - Understanding exit codes
   - :ref:`workflow_spec_exit_actions` - Configure automatic retry behavior
