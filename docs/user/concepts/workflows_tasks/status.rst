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

.. _concepts_wf_status:

================================================
Status
================================================

Every workflow has a current **status** that changes based on the workflow's progression. Initially,
the workflow's status is **PENDING**, indicating that the first group of tasks is being scheduled
and none have started execution yet. When a group of tasks begins execution, the workflow's status
changes to **RUNNING**. This status remains until the workflow completes all of its tasks.

If all groups of tasks successfully finish with no errors (represented by exit code = 0), the
workflow's status changes to **COMPLETED**. However, if any task group ends with an error
(represented by non-zero exit code) or fails to meet it's prerequisites to run the workflow's
status changes to **FAILED**. For example, a failed prerequisite could include a failure to pull
an image or a failure to download the data.

Workflow Status Transition Diagram
-----------------------------------

The following workflow status transition diagram shows the state transition during the lifecycle
of each workflow. The workflow status is derived through the aggregation of individual task group
statuses that make up the workflow.

.. image:: status.png
  :width: 1200

Workflow Status and Descriptions
-----------------------------------

The following is a list of possible workflow statuses and their descriptions:

..  list-table::
    :header-rows: 1
    :widths: auto

    * - **Field**
      - **Description**
    * - PENDING
      - Workflow is submitted to the pool, but not scheduled yet
    * - RUNNING
      - Workflow is running
    * - WAITING
      - Workflow has started but doesn't have any tasks running. Either a downstream task is waiting to be scheduled, or a task is waiting to be rescheduled
    * - COMPLETED
      - Workflow execution was successful and all tasks had exit code 0
    * - FAILED
      - Workflow failed to complete. One or more tasks returned non zero error exit code
    * - FAILED_EXEC_TIMEOUT
      - Workflow was running longer than the set execution timeout
    * - FAILED_QUEUE_TIMEOUT
      - Workflow was queued longer than the set queued timeout
    * - FAILED_SUBMISSION
      - Workflow failed to submit due to resource or credential validation failure
    * - FAILED_SERVER_ERROR
      - Workflow failed due to internal server error
    * - FAILED_CANCELED
      - Workflow was canceled by a user
    * - FAILED_BACKEND_ERROR
      - Workflow failed due to some occurrence in the backend cluster
    * - FAILED_IMAGE_PULL
      - Workflow failed due to image pull issues
    * - FAILED_EVICTED
      - Workflow failed due to eviction
    * - FAILED_START_ERROR
      - Workflow failed to start the pod
    * - FAILED_START_TIMEOUT
      - Workflow failed because a task took too long to start the pod
    * - FAILED_PREEMPTED
      - Workflow was preempted by a higher priority workflow

Status for Individual Task Groups
-----------------------------------

The following table shows the possible status for individual task groups with in a workflow:

..  list-table::
    :header-rows: 1
    :widths: auto

    * - **Field**
      - **Description**
    * - SUBMITTING
      - Task is being submitted
    * - WAITING
      - Task is waiting for an upstream task to complete
    * - PROCESSING
      - Task is being processed by the service
    * - SCHEDULING
      - Task is in the backend queue waiting to run
    * - INITIALIZING
      - Task is pulling images and running preflight tests
    * - RUNNING
      - Task is running
    * - RESCHEDULED
      - Task has finished and a new task with the same spec has been created
    * - COMPLETED
      - Task has finished successfully
    * - FAILED
      - Task has failed with non-zero exit code
    * - FAILED_CANCELED
      - Task was canceled by the user
    * - FAILED_SERVER_ERROR
      - Task has failed due to internal service error
    * - FAILED_BACKEND_ERROR
      - Task has failed due to some backend error like the node entering a Not Ready state
    * - FAILED_EXEC_TIMEOUT
      - Task ran longer than the set execution timeout
    * - FAILED_QUEUE_TIMEOUT
      - Task was queued longer than the set queue timeout
    * - FAILED_IMAGE_PULL
      - Task has failed to pull docker image
    * - FAILED_UPSTREAM
      - Task has failed due to failed upstream dependencies
    * - FAILED_EVICTED
      - Task was evicted due to memory or storage usage exceeding limits
    * - FAILED_PREEMPTED
      - Task was preempted to make space for a higher priority task
