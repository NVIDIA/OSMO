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

.. _pool_config:

===========================
Pool Config
===========================

Pool config is used to configure compute pools for workload distribution and resource management.

Top-Level Configuration
========================

Top-level configuration is used to configure compute pools.

.. list-table::
   :header-rows: 1
   :widths: 30 30 55

   * - **Field**
     - **Type**
     - **Description**
   * - ``pools``
     - Dict[String, `Pool`_]
     - Dictionary of pool name to compute pool configurations.

Pool
====

.. list-table::
   :header-rows: 1
   :widths: 30 40 55

   * - **Field**
     - **Type**
     - **Description**
   * - ``name``
     - String
     - Unique identifier for the pool.
   * - ``description``
     - String
     - Human-readable description of the pool and its purpose.
   * - ``enable_maintenance``
     - Boolean
     - Whether maintenance mode is enabled for the pool.
   * - ``backend``
     - String
     - Name of the backend associated with this pool.
   * - ``default_platform``
     - String
     - Default platform identifier to use for tasks in this pool.
   * - ``default_exec_timeout``
     - String
     - Default execution timeout for tasks. Must be in the format of <integer><unit> (for example, 10m, 1h, 1d). Default is 60d.
   * - ``default_queue_timeout``
     - String
     - Default queue timeout for tasks. Must be in the format of <integer><unit> (for example, 10m, 1h, 1d). Default is 60d.
   * - ``max_exec_timeout``
     - String
     - Maximum allowed execution timeout for tasks. Must be in the format of <integer><unit> (for example, 10m, 1h, 1d). Default is 60d.
   * - ``max_queue_timeout``
     - String
     - Maximum allowed queue timeout for tasks. Must be in the format of <integer><unit> (for example, 10m, 1h, 1d). Default is 60d.
   * - ``default_exit_actions``
     - Dict[String, Integer]
     - Default actions to perform when tasks exit with a specific exit code. The available actions are: `COMPLETE`, `FAIL`, `RESCHEDULE`.
   * - ``action_permissions``
     - `Action Permissions`_
     - Permissions for various pool actions.
   * - ``resources``
     - Dict[String, `Resource Constraint`_]
     - Resource allocation configuration for the pool.
   * - ``common_default_variables``
     - Dict[String, String]
     - Default values for variables used in pod templates.
   * - ``common_resource_validations``
     - Array[String]
     - List of resource validation names applied to all platforms in the pool. Read more about resource validation in :ref:`resource_validation`.
   * - ``common_pod_template``
     - Array[String]
     - List of pod template names applied to all platforms in the pool. Read more about pod templates in :ref:`pod_template`.
   * - ``platforms``
     - Dict[String, `Platform`_]
     - Dictionary of platform configurations available in this pool.

Permission Level
================

.. list-table::
   :header-rows: 1
   :widths: 30 55

   * - **Permission Level**
     - **Description**
   * - ``PUBLIC``
     - Access available to all authenticated users
   * - ``POOL``
     - Access available to all users with pool access
   * - ``PRIVATE``
     - Access restricted to the user who submitted the workflow

Action Permissions
==================

.. list-table::
   :header-rows: 1
   :widths: 30 30 55

   * - **Field**
     - **Type**
     - **Description**
   * - ``execute``
     - `Permission Level`_
     - Permission level required to execute tasks.
   * - ``portforward``
     - `Permission Level`_
     - Permission level required for port forwarding operations.
   * - ``cancel``
     - `Permission Level`_
     - Permission level required to cancel tasks.
   * - ``rsync``
     - `Permission Level`_
     - Permission level required for rsync operations.


.. _pool_config-resource-constraint:

Resource Constraint
===================

For more explanations and examples, see :ref:`scheduler`.

.. list-table::
   :header-rows: 1
   :widths: 30 15 55

   * - **Field**
     - **Type**
     - **Description**
   * - ``guarantee``
     - Integer
     - Guaranteed minimum number of resources allocated to the pool for non-preemptible workflows. Default is -1 (unlimited).
   * - ``maximum``
     - Integer
     - Maximum number of resources that can be allocated to the pool. Default is -1 (unlimited).
   * - ``weight``
     - Integer
     - Scheduling weight for resource allocation priority relative to other pools. Default is 1.

.. warning::

  To set up priority and preemption for pools sharing the same resource nodes, admins need to configure ALL pools
  with the `guarantee`, `weight`, and `maximum` settings. Otherwise, preemption will not be enabled across pools
  (e.g. Pool A cannot preempt a workflow from Pool B).

Platform
========

.. list-table::
   :header-rows: 1
   :widths: 30 40 55

   * - **Field**
     - **Type**
     - **Description**
   * - ``description``
     - String
     - Human-readable description of the platform.
   * - ``host_network_allowed``
     - Boolean
     - Whether tasks can use host networking.
   * - ``privileged_allowed``
     - Boolean
     - Whether privileged containers are allowed.
   * - ``allowed_mounts``
     - Array[String]
     - List of mount paths that are allowed for tasks.
   * - ``default_mounts``
     - Array[String]
     - Default mount configurations applied to tasks.
   * - ``default_variables``
     - Dict[String, String]
     - Default values for variables used in pod templates. If the variable is defined in the pool setting, this will override the pool setting.
   * - ``resource_validations``
     - Array[String]
     - Platform-specific resource validation rules. Read more about resource validation in :ref:`resource_validation`.
   * - ``override_pod_template``
     - Array[String]
     - Pod template overrides specific to this platform. Read more about pod templates in :ref:`pod_template`.
