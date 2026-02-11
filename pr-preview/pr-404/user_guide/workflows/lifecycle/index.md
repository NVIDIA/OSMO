<!-- SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

SPDX-License-Identifier: Apache-2.0 -->

<a id="workflow-lifecycle"></a>

# Workflow Lifecycle

When you submit a workflow, it progresses through distinct phases from submission to completion.
This page explains what happens at each stage and what you should expect to see.

## Overview

Every successful workflow follows this path:

**PENDING** ⏱️

Setting up resources and preparing to run

**What’s happening:** Validating, queuing, and initializing

Active

**RUNNING** ▶️

Your tasks are executing

**What’s happening:** Commands running, transferring data

Active

**COMPLETED** ✓

All tasks finished successfully

**What’s happening:** Outputs uploaded, workflow done

Terminal

> **Tip**
>
> **Most workflows follow this simple progression.** If you see other statuses like `WAITING`
> or various `FAILED` states, see the sections below to understand what’s happening.

---

## Task Lifecycle

### SUBMITTING

**What’s happening:**

- Workflow YAML is being validated (syntax, names, resources)
- Credentials are checked (registry and data access)
- Resource requests are matched against pool capacity

**Common issues:**

- **Invalid/missing credentials** → Configure with `osmo credential set`
- **Resource requests too large** → Reduce GPU/CPU/memory or verify with `osmo pool list` or `osmo resource list`

### WAITING

**What’s happening:**

- Task is waiting for upstream tasks to complete
- No resources are being consumed during this phase

**Common issues:**

- Upstream task failures will cause dependent tasks to fail
- Long wait times if upstream tasks are slow or queued

### PROCESSING

**What’s happening:**

- Converting task specification to backend format
- Submitting task to backend scheduler

**Common issues:**

- Rare - usually internal processing errors
- If stuck here, please contact your administrator

### SCHEDULING

**What’s happening:**

- Task is in the backend queue
- Waiting for nodes with requested resources (CPU, GPU, memory)
- [Priority](../../resource_pools/scheduling/index.md#concepts-priority) and queue position determine the order in which tasks are scheduled

**Common issues:**

- **Insufficient resources in pool** → Check pool capacity: `osmo pool list`
- **Resource requests too large** → Reduce GPU/CPU/memory requests or request a larger pool
- **Queue timeout exceeded** → Increase `queue_timeout` (see [Timeouts](../specification/timeouts.md#workflow-spec-timeouts))

### INITIALIZING

**What’s happening:**

- Pulling Docker image (if not already cached on the node)
- Running preflight tests
- Preparing container environment

**Common issues:**

- **Image doesn’t exist** → `FAILED_IMAGE_PULL` - Check image name and registry
- **No pull credentials** → `FAILED_IMAGE_PULL` - Verify registry credentials
- **Image pull timeout** → `FAILED_START_TIMEOUT` - Image too large or network issues
- **Preflight test failures** → `FAILED_START_ERROR` - Container startup problems

### RUNNING

**What’s happening:**

Three sequential activities occur during the `RUNNING` phase:

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
   - Happens before status changes to `COMPLETED`

**Common issues:**

- **Execution timeout exceeded** → `FAILED_EXEC_TIMEOUT` - Increase `exec_timeout` or optimize code
- **Memory limits exceeded** → `FAILED_EVICTED` - Request more memory or reduce usage
- **Storage limits exceeded** → `FAILED_EVICTED` - Clean up intermediate files or request more storage
- **Node failures** → `FAILED_BACKEND_ERROR` - Infrastructure issue, consider auto-reschedule
- **Command exits with error** → `FAILED` - Check logs: `osmo workflow logs <workflow-id> <task-name>`

### COMPLETED

COMPLETED

- Task finished successfully (exit code `0`)
- All outputs have been uploaded
- Task is done and cannot transition to any other state

FAILED

- Task encountered an error and stopped
- See [Status Reference](#workflow-lifecycle-status) for all failure types
- Check logs to diagnose: `osmo workflow logs <workflow-id> <task-name>`
- Check exit code (see [Exit Codes](../exit_codes.md#workflow-exit-codes))

### Task’s Output Behavior

**When are outputs uploaded?**

Outputs are uploaded when the task completes successfully. However:

> **Attention**
>
> If the task is canceled or terminated (due to backend error, eviction, or preemption), outputs are **NOT uploaded**.

**Where are outputs uploaded?**

OSMO determines the upload destination based on your configuration:

* **Custom location** - If you specify `outputs` in the task spec
  → See [Outputs](../specification/inputs_and_outputs.md#workflow-spec-outputs)
* **Intermediate storage** - In these cases:
  * Task has downstream dependencies (outputs needed by other tasks)
  * Task has no downstream dependencies **AND** no `outputs` specified (automatic backup)

### How to recover from task failures?

When tasks fail, you can configure automatic recovery using [Exit Actions](../specification/exit_actions.md#workflow-spec-exit-actions):

- **Reschedule** (creates new task) - Use for:
  - Node failures (`FAILED_BACKEND_ERROR`)
  - Preemption (`FAILED_PREEMPTED`)
  - Image pull issues (`FAILED_IMAGE_PULL`)
- **Restart** (re-runs command on same task) - Use for:
  - Code crashes that can resume from checkpoints
  - Timeouts where work can continue
  - Temporary failures that don’t require a fresh start

**Example configuration:**

```yaml
tasks:
  - name: resilient-task
    image: my-image
    ...

    exitActions:
      COMPLETE: 0-10
      RESTART: 11-20
      RESCHEDULE: 21-255
```

> **Note**
>
> Please contact your administrator to enable/configure maximum number of retries.

---

<a id="workflow-lifecycle-group"></a>

## Group Lifecycle

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

### How `ignoreNonleadStatus` Affects Group Behavior

Every group must have exactly one **lead task**. The `ignoreNonleadStatus` field (default: `true`)
determines how non-lead task failures affect the group:

| **Value**   | **Finished Status**                                                                                            | **Reschedule Behavior**                                                                                             |
|-------------|----------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------|
| `true`      | The group’s status is dependent **only on the lead task**.                                                     | When a task is rescheduled, other tasks in the group **continue running**.                                          |
| `false`     | The group’s status is dependent on **all the tasks** in the group. If any task fails,<br/>the group will fail. | When a task is rescheduled, the other tasks in the group are restarted and the group<br/>status stays at `RUNNING`. |

Learn more about group fields at [Group](../specification/index.md#workflow-spec-group).

<a id="workflow-lifecycle-status"></a>

## Status Reference

### Workflow Statuses

| **Status**           | **Description**                                                                                                                                      |
|----------------------|------------------------------------------------------------------------------------------------------------------------------------------------------|
| PENDING              | Workflow is waiting for a group to start running                                                                                                     |
| WAITING              | Workflow has started but doesn’t have any tasks running. Either a downstream task is waiting to be scheduled, or a task is waiting to be rescheduled |
| RUNNING              | Workflow is running at least one group                                                                                                               |
| COMPLETED            | Workflow execution was successful and all tasks have completed                                                                                       |
| FAILED               | Workflow failed to complete. One or more tasks have failed                                                                                           |
| FAILED_EXEC_TIMEOUT  | Workflow was running longer than the set execution timeout (see [Timeouts](../specification/timeouts.md#workflow-spec-timeouts))                     |
| FAILED_QUEUE_TIMEOUT | Workflow was queued longer than the set queue timeout (see [Timeouts](../specification/timeouts.md#workflow-spec-timeouts))                          |
| FAILED_SUBMISSION    | Workflow failed to submit due to resource or credential validation failure                                                                           |
| FAILED_SERVER_ERROR  | Workflow failed due to internal server error                                                                                                         |
| FAILED_CANCELED      | Workflow was canceled by a user                                                                                                                      |

### Task Statuses

| **Status**           | **Description**                                                                                                             |
|----------------------|-----------------------------------------------------------------------------------------------------------------------------|
| SUBMITTING           | Task is being submitted                                                                                                     |
| WAITING              | Task is waiting for an upstream task to complete                                                                            |
| PROCESSING           | Task is being processed by the service to be sent to the backend                                                            |
| SCHEDULING           | Task is in the backend queue waiting to run                                                                                 |
| INITIALIZING         | Task is pulling images and running preflight tests                                                                          |
| RUNNING              | Task is running (downloading inputs → executing command → uploading outputs)                                                |
| RESCHEDULED          | Task has finished and a new task with the same spec has been created                                                        |
| COMPLETED            | Task has finished successfully                                                                                              |
| FAILED               | Task has failed (your command returned non-zero exit code)                                                                  |
| FAILED_CANCELED      | Task was canceled by the user                                                                                               |
| FAILED_SERVER_ERROR  | Task has failed due to internal service error                                                                               |
| FAILED_BACKEND_ERROR | Task has failed due to some backend error like the node entering a Not Ready state                                          |
| FAILED_EXEC_TIMEOUT  | Workflow ran longer than the set execution timeout (see [Timeouts](../specification/timeouts.md#workflow-spec-timeouts))    |
| FAILED_QUEUE_TIMEOUT | Workflow was queued longer than the set queue timeout (see [Timeouts](../specification/timeouts.md#workflow-spec-timeouts)) |
| FAILED_IMAGE_PULL    | Task has failed to pull Docker image                                                                                        |
| FAILED_UPSTREAM      | Task has failed due to failed upstream dependencies                                                                         |
| FAILED_EVICTED       | Task was evicted due to memory or storage usage exceeding limits                                                            |
| FAILED_PREEMPTED     | Task was preempted to make space for a higher priority task                                                                 |
| FAILED_START_ERROR   | Task failed to start up properly during the initialization process                                                          |
| FAILED_START_TIMEOUT | Task timed-out while initializing                                                                                           |

### Group Statuses

| **Status**          | **Description**                                                                                                                             |
|---------------------|---------------------------------------------------------------------------------------------------------------------------------------------|
| SUBMITTING          | Group is being submitted                                                                                                                    |
| WAITING             | Group is waiting for an upstream group to complete                                                                                          |
| PROCESSING          | Group is being processed by the service to be sent to the backend                                                                           |
| SCHEDULING          | Group is waiting to be scheduled in the backend                                                                                             |
| INITIALIZING        | All tasks in the group are initializing                                                                                                     |
| RUNNING             | Any task in the group is running                                                                                                            |
| COMPLETED           | Task completed status as defined by the `ignoreNonleadStatus` field. See [Group Lifecycle](#workflow-lifecycle-group) for more information. |
| FAILED              | If the lead task has failed or if `ignoreNonleadStatus` is set to `false` and any of the non-lead tasks have failed                         |
| FAILED_UPSTREAM     | Upstream group has failed                                                                                                                   |
| FAILED_SERVER_ERROR | Some OSMO internal error occurred                                                                                                           |
| FAILED_PREEMPTED    | Any of the tasks in the group were preempted                                                                                                |
| FAILED_EVICTED      | Any of the tasks in the group were evicted                                                                                                  |

---

#### SEE ALSO
**Related Documentation:**

- [Group](../specification/index.md#workflow-spec-group) - Group configuration and behavior
- [Timeouts](../specification/timeouts.md#workflow-spec-timeouts) - Set execution and queue timeouts
- [Exit Codes](../exit_codes.md#workflow-exit-codes) - Understanding exit codes
- [Exit Actions](../specification/exit_actions.md#workflow-spec-exit-actions) - Configure automatic retry behavior
