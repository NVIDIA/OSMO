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

<a id="concepts-resources-pools-platforms"></a>

# Overview

<a id="concepts-resources"></a>

## Resources

A `resource` refers to the machine which is used to run a workflow. These resources are grouped
into `pools` and `platforms` so that you can share resources between other users and specify
what type of hardware you want to run your workflow on.

The diagram below illustrates the organizational hierarchy in an OSMO cluster. Click on pools or
platforms to learn more about each layer.

![image](user_guide/resource_pools/pool_organization.svg)

The following sections explain each layer (i.e. `pools` and `platforms`) in detail.

<a id="concepts-pools"></a>

## Pools

A `pool` is a group of resources that are shared between users which contains `platforms`
to differentiate between different types of hardware. These pools are access controlled to enable
different teams to share resources.

### How do pools manage workflow priority and preemption?

Depending on the scheduler on the backend, a `pool` can have a quota imposed to limit the
number of `HIGH` or `NORMAL` priority workflows (see [Scheduling](scheduling/index.md#concepts-priority)).

`LOW` priority workflows can go beyond the pool quota by borrowing unused GPUs
available in the cluster. However, `LOW` maybe subjected to preemption (see [Borrowing](scheduling/index.md#concepts-borrowing)).

Pool Statuses

| **Status**   | **Description**                                                                                                                                                                                           |
|--------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| ONLINE       | The pool is ready to run workflows.                                                                                                                                                                       |
| OFFLINE      | Workflows can be submitted to the pool, but will be queued until the pool is online.                                                                                                                      |
| MAINTENANCE  | The pool is undergoing maintenance. You won’t be able to submit workflows to the pool.<br/><br/>> **Note**<br/>><br/>> Please contact your administrator for more information on pools under maintenance. |
Resource Types

| **Type**   | **Description**                             |
|------------|---------------------------------------------|
| SHARED     | The resource is shared with another pool.   |
| RESERVED   | The resource is only available to the pool. |

To view the pools, you can use [Pool List](../appendix/cli/cli_pool.md#cli_reference_pool_list).

To view the available resources in a pool, you can use [Resource List](../appendix/cli/cli_resource.md#cli_reference_resource_list).

<a id="concepts-platforms"></a>

## Platforms

A `platform` is a group of resources in a pool and denotes a specific type of hardware.

Resources are already assigned to a platform by the administrator. You can view more information
about the resource and its access configurations using [Resource Info](../appendix/cli/cli_resource.md#cli_reference_resource_info).

Platform Access Configurations

| **Configuration**         | **Type**       | **Description**                                                                                                                                                                                                               |
|---------------------------|----------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `Privileged Mode Allowed` | `boolean`      | Whether the platform allows privileged containers. If enabled, you can set `privileged`<br/>to `true` in the workflow spec (see [Task](../workflows/specification/index.md#workflow-spec-task)).                              |
| `Host Network Allowed`    | `boolean`      | Whether the platform allows host networking. If enabled, you can set `hostNetwork`<br/>to `true` in the workflow spec (see [Task](../workflows/specification/index.md#workflow-spec-task)).                                   |
| `Default Mounts`          | `list[string]` | Default volume mounts from the node to the task container for the platform.                                                                                                                                                   |
| `Allowed Mounts`          | `list[string]` | Volume mounts that are **allowed** for the platform. These are **not** mounted by default.<br/>You may add these to `volumeMounts` in the workflow spec (see [Task](../workflows/specification/index.md#workflow-spec-task)). |

> **Important**
>
> When you are submitting a workflow, you will need to specify a platform to target in the
> workflow resource spec. Learn more at [Resources](../workflows/specification/resources.md#workflow-spec-resources).
