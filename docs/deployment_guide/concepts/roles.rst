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

.. _roles:

================================================
Access Control and Roles
================================================

Preconfigured roles
===================

By default, OSMO has the following preconfigured roles:

..  list-table::
  :header-rows: 1
  :widths: 40 80

  * - **Roles**
    - **Description**
  * - Admin
    - User who is responsible to deploy, setup & manage OSMO. They are able to:

      * Manage compute resources for OSMO deployment
      * Deploy OSMO using self-hosting deployment guide
      * Configure OSMO keycloak authentication
      * Create service accounts for backend registration
      * Manage user privileges for OSMO instance
      * Register compute and data backends for workflows

      They are able to access all the APIs except the websocket APIs used for backend or tasks.

  * - Users
    - OSMO users who are AI developers that use OSMO platform to run workflows and do not need management access to OSMO. They are able to:

      * Log into OSMO securely with Customer SSO
      * Log into OSMO with ``user`` privileges & run workflows

  * - Backend
    - Role for backend agents to communicate with OSMO. They are able to:

      * Register compute backend to OSMO
      * Create and delete user pods
      * Monitor the health of the backend

  * - Ctrl
    - Role for user tasks to communicate with OSMO. They are able to:

      * Send user logs to OSMO
      * Allow user access to port-forward and exec into the user task

  * - Default
    - Role for unauthenticated users. They are able to:

      * View the service version
      * Fetch new JWT tokens from service/user access tokens
      * Install the python library

.. note::

  Roles are only available when auth is enabled.

.. note::

  The Admin role is immutable and cannot be modified.


Policies
========

The way OSMO determines if a role has access to an action is by checking if the role has a
policy that matches the action.

OSMO goes through the list of each policy the user has access to depending on their roles and
checks if the action matches any of the policies.

The admin can also specify actions that the policy denies access to. To specify this, the admin
can add a not operator ``!`` in front of the path. For example, ``http:!/api/configs/*:GET``
denies access to all ``GET`` requests to the ``/api/configs/*`` path.

Role Examples
=============

To reference the fields of the role, please refer to :ref:`roles_config`.

The role below will allow the user to access ``/api/bucket/*`` and ``/api/credential/*``, but
not ``/api/pool`` since it is not in the ``actions`` list.

.. code-block:: json

  {
    "name": "example-role",
    "description": "Example Role",
    "policies": [
      {
        "actions": [
            "http:/api/bucket/*:*",
            "http:/api/credential/*:*"
        ]
      }
    ],
    "immutable": false
  }

The role below will allow the user to access ``/api/bucket/*``, ``/api/credential/*``,
and ``/api/pool`` even though the first policy explicitly denies access. This is because the second
policy allows access to ``/api/pool`` and each policy is evaluated independently.

.. code-block:: json

  {
    "name": "example-role",
    "description": "Example Role",
    "policies": [
      {
        "actions": [
            "http:/api/bucket/*:*",
            "http:/api/credential/*:*",
            "http:!/api/pool:*"
        ]
      },
      {
        "actions": [
            "http:/api/pool:*"
        ]
      }
    ],
    "immutable": false
  }

The role below will **NOT** allow the user to access ``/api/auth/access_token/service/*``
even though ``/api/auth/access_token/*`` and ``/api/auth/access_token/service/field`` are
allowed. This is because the any path which is denied such as the one defined
``!/api/auth/access_token/service/*`` will take precedence over the allowed paths no matter how
specific the allowed paths are.

.. code-block:: json

  {
    "name": "example-role",
    "description": "Example Role",
    "policies": [
      {
        "actions": [
            "http:!/api/auth/access_token/service/*:*",
            "http:/api/auth/access_token/*:*",
            "http:/api/auth/access_token/service/field:*"
        ]
      }
    ],
    "immutable": false
  }
