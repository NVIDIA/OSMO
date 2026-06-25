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

<a id="workflow-spec"></a>

# Specification

<a id="workflow-spec-workflow"></a>

## Workflow

| Field Name   | Type     | Required              | Description                                                                   |
|--------------|----------|-----------------------|-------------------------------------------------------------------------------|
| `name`       | `string` | **Yes**               | The name of the workflow.                                                     |
| `pool`       | `string` | No                    | The pool to submit the workflow to.                                           |
| `timeout`    | `dict`   | No                    | [Timeout configuration](timeouts.md#workflow-spec-timeouts)                   |
| `resources`  | `dict`   | No                    | Dictionary of [resource specifications](resources.md#workflow-spec-resources) |
| `tasks`      | `list`   | **Yes** (or `groups`) | List of [task definitions](#workflow-spec-task).                              |
| `groups`     | `list`   | **Yes** (or `tasks`)  | List of [group definitions](#workflow-spec-group).                            |

<a id="workflow-spec-task"></a>

## Task

| Field Name     | Type      | Required   | Description                                                                                                                                                                                                                                  |
|----------------|-----------|------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `name`         | `string`  | **Yes**    | The name of the task (unique within the workflow).                                                                                                                                                                                           |
| `image`        | `string`  | **Yes**    | The container image registry and image tag, ex: `ubuntu:22.04`                                                                                                                                                                               |
| `lead`         | `boolean` | No         | The group leader designation of the task. Only applicable if the task is part of a [Group](#workflow-spec-group).                                                                                                                            |
| `command`      | `list`    | **Yes**    | The command to run in the container.                                                                                                                                                                                                         |
| `args`         | `list`    | No         | The arguments to pass to the command.                                                                                                                                                                                                        |
| `environment`  | `dict`    | No         | The environment variables to set in the container.                                                                                                                                                                                           |
| `credentials`  | `dict`    | No         | The credentials to inject into the container. See [Secrets](secrets.md#workflow-spec-secrets) for more information.                                                                                                                          |
| `inputs`       | `list`    | No         | The inputs to download into the task container. See [Inputs](inputs_and_outputs.md#workflow-spec-inputs) for more information.                                                                                                               |
| `outputs`      | `list`    | No         | The outputs to upload after completion. See [Outputs](inputs_and_outputs.md#workflow-spec-outputs) for more information.                                                                                                                     |
| `files`        | `list`    | No         | The files to mount into the task container. See [File Injection](file_injection.md#workflow-spec-file-injection) for more information.                                                                                                       |
| `resource`     | `string`  | No         | Reference to the `resources` spec defined at the [workflow](#workflow-spec-workflow) level.                                                                                                                                                  |
| `volumeMounts` | `list`    | No         | The volumes to mount into the task container. See [Host Mounts](host_mounts.md#workflow-spec-host-mounts) for more information.                                                                                                              |
| `exitActions`  | `dict`    | No         | The exit actions to perform after the task terminates. See [Exit Actions](exit_actions.md#workflow-spec-exit-actions) for more information.                                                                                                  |
| `checkpoint`   | `list`    | No         | The checkpoint specifications to use for this task. See [Checkpointing](checkpointing.md#workflow-spec-checkpointing) for more information.                                                                                                  |
| `privileged`   | `boolean` | No         | The privileged mode setting that grants containers nearly unrestricted access to the host system.<br/><br/>> **Note**<br/>><br/>> Please consult your administrator to enable this feature.                                                  |
| `hostNetwork`  | `boolean` | No         | The task pod host network setting that allows a pod to use the host node’s network namespace<br/>instead of having its own isolated network stack.<br/><br/>> **Note**<br/>><br/>> Please consult your administrator to enable this feature. |

<a id="workflow-spec-group"></a>

## Group

| Field Name            | Type      | Required   | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
|-----------------------|-----------|------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `name`                | `string`  | **Yes**    | The name of the group (unique within the workflow).                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `barrier`             | `boolean` | No         | Default is `true`. When enabled, the tasks in the group will be synchronized<br/>and execution will start only when all tasks in the group are ready.<br/><br/>See [Barriers](barriers.md#workflow-spec-barriers) for more information.                                                                                                                                                                                                                                                                    |
| `ignoreNonleadStatus` | `boolean` | No         | Default is `true`. When set to `true`, a failure of a non-lead task will not cause<br/>the group to fail.<br/><br/>When set to `false`, the group will fail if any task (lead or non-lead) fails.<br/><br/>> **Note**<br/>><br/>> When a task gets rescheduled, the other tasks in the group continue running.<br/><br/>> If you want the other tasks to be restarted, please set `ignoreNonleadStatus` to `false`.<br/>> Learn more at [Group Lifecycle](../lifecycle/index.md#workflow-lifecycle-group). |
| `tasks`               | `list`    | **Yes**    | The list of tasks in the group. See [Task](#workflow-spec-task) for more information.<br/><br/>> **Important**<br/>><br/>> Each group must have 1 **lead** task.                                                                                                                                                                                                                                                                                                                                           |

#### SEE ALSO
Already have a workflow spec and ready to submit? See [Workflow Submission](../submission.md#workflow-submission) for more information.
