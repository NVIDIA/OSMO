..
  SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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

.. _managing_users:

======================================
Creating Users and Assigning Roles
======================================

This guide covers how to create users and assign roles to them in OSMO using the ``osmo user`` CLI. These operations require the ``osmo-admin`` role.

.. note::

   If you use an identity provider (IdP), users can also be created automatically when they first log in (just-in-time provisioning). In that case, you may only need the CLI to manage roles for existing users. See :doc:`idp_role_mapping` for how IdP group claims map to OSMO roles.

Prerequisites
=============

- OSMO CLI installed and logged in
- Admin privileges (``osmo-admin`` role)

Creating a user
===============

Create a new user with ``osmo user create``. Optionally assign initial roles at creation time with ``--roles``.

.. code-block:: bash

   # Create a user with no initial roles
   $ osmo user create alice@example.com

   # Create a user with initial roles
   $ osmo user create bob@example.com --roles osmo-user osmo-ml-team

**Example output:**

.. code-block:: text

   User created: bob@example.com
   Roles assigned: osmo-user, osmo-ml-team

See :ref:`preconfigured_roles` for a description of each built-in role, or :ref:`custom_roles_policies` if you need to create custom roles.

Viewing user details
====================

Retrieve a user's information and current role assignments:

.. code-block:: bash

   $ osmo user get alice@example.com

**Example output:**

.. code-block:: text

   User ID: alice@example.com
   Created At: 2026-02-20
   Created By: admin

   Roles:
     - osmo-user (assigned by admin on 2026-02-20)

Listing users
=============

List all users, or filter by ID prefix or role:

.. code-block:: bash

   # List all users
   $ osmo user list

   # Filter by ID prefix
   $ osmo user list --id-prefix alice

   # Filter by role
   $ osmo user list --roles osmo-admin

Assigning and removing roles
============================

Use ``osmo user update`` to add or remove roles from an existing user.

Adding roles
------------

.. code-block:: bash

   $ osmo user update alice@example.com --add-roles osmo-admin

Removing roles
--------------

.. code-block:: bash

   $ osmo user update alice@example.com --remove-roles osmo-ml-team

You can combine both in a single command:

.. code-block:: bash

   $ osmo user update alice@example.com --add-roles osmo-admin --remove-roles osmo-user

.. note::

   When a role is removed from a user, it is automatically removed from all of that user's access tokens.

Deleting a user
===============

Delete a user and all associated data (tokens, roles, profile):

.. code-block:: bash

   $ osmo user delete alice@example.com

Use ``--force`` to skip the confirmation prompt:

.. code-block:: bash

   $ osmo user delete alice@example.com --force

Creating access tokens
======================

After creating a user and assigning roles, you can create access tokens for programmatic access. Tokens inherit the user's roles (or a subset specified with ``--roles``).

.. code-block:: bash

   # Create a token for yourself
   $ osmo token set my-token --expires-at 2027-01-01

   # Admin: create a token for another user with specific roles
   $ osmo token set service-token \
       --user alice@example.com \
       --expires-at 2027-01-01 \
       --roles osmo-user

.. important::

   Save the token securely -- it is only displayed once at creation time.

See :doc:`service_accounts` for detailed guidance on service account patterns and token management.

.. seealso::

   - :ref:`preconfigured_roles` for built-in role descriptions
   - :doc:`idp_role_mapping` for IdP role mapping and sync modes
   - :doc:`service_accounts` for service account and token management patterns
   - :ref:`cli_reference_user` for full ``osmo user`` CLI reference
   - :ref:`cli_reference_token` for full ``osmo token`` CLI reference
