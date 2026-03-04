..
  SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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

.. _roles_config:

===========================
/api/configs/role
===========================

Roles config is used to configure user roles and permissions for access control.

Role
====

.. list-table::
   :header-rows: 1
   :widths: 25 12 43 20

   * - **Field**
     - **Type**
     - **Description**
     - **Default Values**
   * - ``name``
     - String
     - Name of the role.
     - Required field
   * - ``description``
     - String
     - Quick explanation of the purpose of the role.
     - Required field
   * - ``immutable``
     - Boolean
     - If true, the role cannot be modified. This cannot be set for any role besides the admin role.
     - ``False``
   * - ``policies``
     - List[`Policy`_]
     - List of policies which define the actions, resources, and effect for the role.
     - ``[]``

Policy
======

A policy defines which actions a role can or cannot perform, optionally scoped to specific resources.

.. list-table::
   :header-rows: 1
   :widths: 20 12 48 20

   * - **Field**
     - **Type**
     - **Description**
     - **Default Values**
   * - ``effect``
     - String
     - Whether the policy allows or denies access. Must be ``"Allow"`` or ``"Deny"``. Deny takes precedence over Allow.
     - ``"Allow"``
   * - ``actions``
     - List[String]
     - List of semantic action strings (e.g., ``"workflow:Create"``, ``"pool:List"``). See :ref:`actions_resources_reference` for all available actions.
     - Required field
   * - ``resources``
     - List[String]
     - List of resource patterns this policy applies to (e.g., ``["*"]``, ``["pool/my-pool"]``, ``["bucket/my-data"]``). Supports wildcards. If omitted, the policy only matches globally-scoped actions. Set to ``["*"]`` to match all resources.
     - ``[]``

Action
======

An action is a string in the format ``<resource_type>:<action_name>``.

.. list-table::
   :header-rows: 1
   :widths: auto

   * - **Component**
     - **Description**
   * - ``resource_type``
     - The type of resource (e.g., ``workflow``, ``pool``, ``dataset``, ``config``). See :ref:`actions_resources_reference`.
   * - ``action_name``
     - The operation to perform (e.g., ``Create``, ``Read``, ``List``, ``Update``, ``Delete``).

Wildcards are supported:

- ``*:*`` -- matches all actions on all resources
- ``workflow:*`` -- matches all workflow actions
- ``*:Read`` -- matches all Read actions across all resource types

See :ref:`actions_resources_reference` for the full list of actions and resource scoping rules.

