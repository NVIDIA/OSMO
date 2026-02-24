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
IdP Role Mapping and Sync Modes
================================================

When you use an identity provider (IdP) with OSMO, your IdP sends group or role claims in the JWT at login (e.g. a ``groups`` claim from Microsoft Entra ID, or a custom claim from Okta). OSMO uses these claims to determine which OSMO roles a user should receive. This page explains how that mapping works and how **sync modes** control whether IdP claims can add, remove, or leave roles unchanged.

For creating users and assigning roles directly via the CLI (with or without an IdP), see :doc:`managing_users`.

How IdP roles connect to OSMO roles
=====================================

OSMO does not use IdP group names directly as role names. Instead, it maintains a mapping layer (``role_external_mappings``) that translates **external** names (what your IdP sends) into **OSMO role** names.

**Flow:** IdP group claim (e.g. ``LDAP_ML_TEAM``) → external mapping → OSMO role (e.g. ``ml-team``) → policies → allow/deny

Key points:

- **Many-to-many mapping:** Multiple external names can map to one OSMO role, and one external name can map to multiple OSMO roles.
- **Default 1:1 mapping:** When a role is created in OSMO, it automatically gets a mapping from its own name (e.g. role ``osmo-user`` maps from external name ``osmo-user``). If your IdP already sends OSMO role names, no extra configuration is needed.
- **Custom mappings:** If your IdP sends different names (e.g. ``ad-developers`` instead of ``osmo-user``), configure the ``external_roles`` field on the role to map from those names. See :ref:`configuring_external_mappings` below.

Example
-------

Your IdP sends a ``groups`` claim with the value ``["LDAP_ML_TEAM", "ad-developers"]`` for a user. You have configured:

- OSMO role ``ml-team`` with ``external_roles: ["LDAP_ML_TEAM"]``
- OSMO role ``osmo-user`` with ``external_roles: ["ad-developers", "osmo-user"]``

On login, OSMO resolves the IdP groups through the mapping and assigns ``ml-team`` and ``osmo-user`` to the user (subject to each role's sync mode).

.. _configuring_external_mappings:

Configuring external mappings
-----------------------------

External mappings are configured via the ``external_roles`` field on each role. Use the ``osmo config`` CLI to update a role's mappings:

.. code-block:: bash

   # View current role definition including external_roles
   $ osmo config show ROLE ml-team

   # Update the role to map from specific IdP group names
   $ cat > ml-team-role.json <<EOF
   [
     {
       "name": "ml-team",
       "description": "ML team role",
       "external_roles": ["LDAP_ML_TEAM", "ml-engineering"],
       "policies": [
         {
           "actions": ["workflow:*", "pool:List"],
           "resources": ["pool/ml-training"]
         }
       ]
     }
   ]
   EOF

   $ osmo config update ROLE -f ml-team-role.json

The ``external_roles`` field accepts:

- ``null`` (not set): Preserves existing mappings. For new roles, OSMO creates a default 1:1 mapping.
- ``[]`` (empty list): Clears all external mappings. The role will not be assigned via IdP sync.
- ``["group-a", "group-b"]``: Maps the specified external names to this role.

.. _role_sync_modes:

Role sync modes
===============

When OSMO syncs roles from the IdP on each request, each role has a **sync mode** that controls whether the IdP can add the role, leave it unchanged, or remove it. Sync mode applies only to roles that are **not** ``ignore``; roles with ``ignore`` are never changed by IdP sync and are managed only via the CLI.

The following table describes the behavior for each mode. "IDP has role" means the IdP (after external mapping) is providing this role for the user on this request. "User has role" means the user already has this role in OSMO's ``user_roles`` table.

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
     - No action. Role is never modified by IdP sync; manage it only via the CLI.
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

- **ignore** -- IdP sync never touches this role. Use for roles you assign only via the CLI (e.g. a manually granted ``osmo-admin`` or a pool role that is not reflected in the IdP).

- **import** -- Roles are **added** when the IdP provides them, but **never removed** by IdP sync. If the user already has the role and the IdP stops sending it, the user keeps the role. Good for accumulating roles from the IdP and from manual assignment.

- **force** -- The user's set of roles for this mode is driven **entirely** by the IdP. If the IdP provides the role, it is added; if the IdP does **not** provide the role on a request, it is **removed** from the user. Use when you want IdP group membership to be the single source of truth for that role (e.g. "team-lead" only while the user is in the IdP group).

Example (force mode)
--------------------

Role ``team-lead`` has ``sync_mode = 'force'``. User ``alice@example.com`` has that role in ``user_roles``. On her next login, the IdP no longer includes the group that maps to ``team-lead``. During role sync, OSMO sees that the IdP does not provide ``team-lead`` and that the user currently has it, so it **removes** the role from the user. If you want her to keep the role even when the IdP drops her from the group, use ``import`` instead of ``force`` for that role.

Where sync mode is set
----------------------

Sync mode is a property of the **role** in the OSMO database (e.g. ``roles.sync_mode``). Default is ``import``. You can view or update role definitions via the ``osmo config show ROLE`` and ``osmo config update ROLE`` CLI commands.

.. seealso::

   - :doc:`managing_users` for creating users and assigning roles via the CLI
   - :doc:`index` for authentication overview with and without an IdP
   - :doc:`roles_policies` for role and policy definitions
   - :doc:`identity_provider_setup` for IdP configuration
