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
     - List of policies which define actions/apis the role can perform/reach.
     - ``[]``

Policy
======

A policy is dictionary that currently only supports the ``actions`` key.
The corresponding value for the ``actions`` key is an array of actions.

Action
======

An Action is defined as such:

..  list-table::
  :header-rows: 1
  :widths: auto

  * - **Field**
    - **Description**
  * - Base
    - Currently only ``http`` is supported.
  * - Path
    - API path defined in glob format
  * - Method
    - Method of the action. (i.e. ``*``, ``GET``, ``POST``, ``PUT``, ``PATCH``, ``DELETE``, ``WEBSOCKET``)
