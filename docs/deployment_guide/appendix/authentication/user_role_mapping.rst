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

.. _user_role_mapping:

================================================
Managing User Role Mapping in OSMO
================================================

This section describes how to manage which roles users have in OSMO: by assigning roles directly via APIs, by mapping roles from your identity provider (IdP), and how **role sync mode** controls whether IdP claims can add or remove roles.

Ways to assign roles
====================

**1. Direct assignment via OSMO APIs**

Roles can be assigned to users regardless of whether you use an IdP:

- **Assign a role to a user:** ``POST /api/auth/user/{user_id}/roles`` with body ``{"role_name": "osmo-ml-team"}``
- **Remove a role:** ``DELETE /api/auth/user/{user_id}/roles/{role_name}``
- **List a user’s roles:** ``GET /api/auth/user/{user_id}/roles``
- **Bulk assign a role to multiple users:** ``POST /api/auth/roles/{role_name}/users`` with ``{"user_ids": ["user1@example.com", "user2@example.com"]}``

When you create a user with ``POST /api/auth/user``, you can optionally pass ``roles`` in the body to assign initial roles. Only callers with the ``role:Manage`` action (e.g. users with the ``osmo-admin`` role) can assign or remove roles.

**2. IdP group/role claims (when using an IdP)**

When users log in via an IdP, the IdP may send group or role names in the JWT (e.g. ``groups`` or a custom claim). OSMO can map those **external** names to OSMO role names using the ``role_external_mappings`` table, then apply those roles to the user according to each role’s **sync mode** (see below).

- **External name → OSMO role:** e.g. map ``LDAP_ML_TEAM`` → ``osmo-ml-team``, or ``ad-developers`` → ``osmo-user``. Multiple external roles can map to one OSMO role, and one external role can map to multiple OSMO roles.
- **Where to configure:** Role external mappings are managed in the database (e.g. via migrations or admin tooling). By default, each OSMO role gets a 1:1 mapping (OSMO role name ↔ same external name) so if your IdP already sends OSMO role names, no extra mapping is needed.

Role sync modes
===============

When OSMO syncs roles from the IdP on each request, each role has a **sync mode** that controls whether the IdP can add the role, leave it unchanged, or remove it. Sync mode applies only to roles that are **not** ``ignore``; roles with ``ignore`` are never changed by IdP sync and are managed only via the OSMO APIs.

The following table describes the behavior for each mode. “IDP has role” means the IdP (after external mapping) is providing this role for the user on this request. “User has role” means the user already has this role in OSMO’s ``user_roles`` table.

.. list-table::
   :header-rows: 1
   :widths: 12 18 18 50

   * - **Sync mode**
     - **IdP has role**
     - **User has role**
     - **Action**
   * - ``ignore``
     - (any)
     - (any)
     - No action. Role is never modified by IdP sync; manage it only via APIs.
   * - ``import``
     - Yes
     - No
     - **Add** role to user.
   * - ``import``
     - No
     - Yes
     - No action (keep existing role).
   * - ``force``
     - Yes
     - No
     - **Add** role to user.
   * - ``force``
     - No
     - Yes
     - **Remove** role from user.

Summary by mode
---------------

- **ignore** — IdP sync never touches this role. Use for roles you assign only via the OSMO user/role APIs (e.g. a manually granted ``osmo-admin`` or a pool role that is not reflected in the IdP).

- **import** — Roles are **added** when the IdP provides them, but **never removed** by IdP sync. If the user already has the role and the IdP stops sending it, the user keeps the role. Good for accumulating roles from the IdP and from manual assignment.

- **force** — The user’s set of roles for this mode is driven **entirely** by the IdP. If the IdP provides the role, it is added; if the IdP does **not** provide the role on a request, it is **removed** from the user. Use when you want IdP group membership to be the single source of truth for that role (e.g. “osmo-team-lead” only while the user is in the IdP group).

Example (force mode)
--------------------

Role ``osmo-team-lead`` has ``sync_mode = 'force'``. User ``alice@example.com`` has that role in ``user_roles``. On her next login, the IdP no longer includes the group that maps to ``osmo-team-lead``. During role sync, OSMO sees that the IdP does not provide ``osmo-team-lead`` and that the user currently has it, so it **removes** the role from the user. If you want her to keep the role even when the IdP drops her from the group, use ``import`` instead of ``force`` for that role.

Where sync mode is set
----------------------

Sync mode is a property of the **role** in the OSMO database (e.g. ``roles.sync_mode``). Default is ``import``. You can view or update role definitions via the OSMO config/role APIs or database, depending on how roles are managed in your deployment.

.. seealso::

   - :doc:`index` for authentication overview with and without an IdP
   - :doc:`roles_policies` for role and policy definitions
   - :doc:`identity_provider_setup` for IdP configuration
   - Design docs: ``external/projects/PROJ-148-auth-rework/PROJ-148-user-management.md`` (user/role APIs and sync behavior)
