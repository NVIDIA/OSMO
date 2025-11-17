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

.. _keycloak_roles_group_management:
.. _keycloak_setup:

================================================
Keycloak Group and Role Management
================================================

This guide describes how to configure Keycloak roles and groups to manage access control in the OSMO platform.

Overview
========

OSMO uses Keycloak's role-based access control to manage permissions for pool access and other resources. The configuration follows a hierarchical structure:

1. **Roles**: Represent specific permissions within OSMO (e.g., ``osmo-group1`` grants permission to submit workflows to ``group1-*`` pools)
2. **Groups**: Collections of users that share the same access requirements. When a role is assigned to a group, all members inherit the associated permissions
3. **Users**: Individual accounts that belong to one or more groups and inherit the roles assigned to those groups

This hierarchical approach simplifies access management by allowing administrators to grant permissions to entire teams at once rather than configuring each user individually.

Configuration Workflow
======================

The typical workflow for setting up access control is:

1. Create roles in Keycloak clients (``osmo-browser-flow`` and ``osmo-device``)
2. Create groups in Keycloak
3. Assign roles to groups
4. Add users to groups (manually or via identity provider mappings)
5. Create matching pools in OSMO
6. Verify access

.. _keycloak_create_roles:

Creating Roles in Keycloak
===========================

Roles must be created in both Keycloak clients that OSMO uses:

1. Access the Keycloak admin console and select the OSMO realm
2. Navigate to the "Clients" tab and select the ``osmo-browser-flow`` client
3. Click on the "Roles" tab, then click "Create Role"
4. Enter a name for the role following the format ``osmo-<pool-group-name>``

   For example: ``osmo-group1``

5. Click "Save"
6. Repeat steps 2-5 for the ``osmo-device`` client

.. note::

   The role name is format-sensitive. You must use the exact format ``osmo-<pool-group-name>`` for pool access roles.

.. _keycloak_create_groups:

Creating Groups in Keycloak
============================

Groups are used to organize users and assign roles to multiple users at once:

1. In the Keycloak admin console, select the OSMO realm
2. Navigate to the "Groups" tab and click "Create Group"
3. Enter a name for the group following the format ``OSMO <pool-group-name>``

   For example: ``OSMO group1``

4. Click "Save"

.. _keycloak_assign_roles_to_groups:

Assigning Roles to Groups
--------------------------

After creating the group, assign the appropriate roles:

1. Click into the group you just created
2. Select the "Role Mapping" tab
3. Click "Assign Role"
4. Click on the filter dropdown and select "Filter by clients"
5. Search for ``osmo-<pool-group-name>`` (e.g., ``osmo-group1``)
6. Select both roles (one from ``osmo-browser-flow`` and one from ``osmo-device`` client)
7. Click "Assign"

.. note::

   The ``osmo-browser-flow`` client is used for the Web UI and the ``osmo-device`` client is used for the CLI.
   You must assign roles from both clients for full functionality.

.. _keycloak_assign_users_to_groups:

Managing Users
==============

Adding Users Manually
----------------------

To manually add users to groups:

1. Navigate to the "Users" tab in the Keycloak admin console
2. Search for and select the user you want to add
3. Click on the "Groups" tab
4. Click "Join Group"
5. Select the group you want to add the user to
6. Click "Join"

.. _identity_provider_mappings:

Configuring Identity Provider Mappings
--------------------------------------
Instead of manually adding users to groups, you can configure identity provider mappings to automatically add users to groups based on claims or metadata provided by the identity provider.
For more information, see the `Keycloak documentation <https://www.keycloak.org/docs/latest/server_admin/index.html#_mappers>`__.

Verification and Testing
========================

Verifying User Access
---------------------

To verify that a user has the correct roles:

1. Have the user log in to OSMO
2. In the Keycloak admin console, go to "Users" and find the user
3. Click on the user and select the "Groups" tab
4. Verify the user is in the expected groups
5. Select the "Role Mapping" tab and click "View all assigned roles"
6. Confirm the user has the expected roles (both from ``osmo-browser-flow`` and ``osmo-device``)

Testing Pool Access
-------------------

Test that the user can access the pool:

1. Log in to OSMO as the user
2. List available pools:

   .. code-block:: bash

      $ osmo pool list

3. Submit a test workflow to the pool:

   .. code-block:: bash

      $ osmo workflow submit my-workflow.yaml --pool group1-h100-gpu

4. If successful, the user has proper access

Troubleshooting
===============

User Cannot Access Pool
------------------------

**Symptoms**: User receives "Permission denied" or cannot see the pool

**Solutions**:

1. **Verify Role Policy in OSMO**:

   - Ensure the corresponding role has been created in OSMO.
   - Follow the steps in :ref:`troubleshooting_roles_policies`.

2. **Verify Role Names**:

   - Pool access roles must start with ``osmo-`` prefix (See :ref:`role_naming_for_pools`).
   - Pool names must match the role suffix
   - Example: Role ``osmo-team1`` will make pools named ``team1*`` visible

3. **Check Both Clients**:

   - Ensure roles are created in **both** ``osmo-browser-flow`` and ``osmo-device`` clients
   - Both roles must be assigned to the group

4. **Verify Group Membership**:

   - In Keycloak admin console, check if the user appears in the group
   - If using IdP Mappings (see :ref:`identity_provider_mappings`):

      - Verify the mapping configuration
      - Check IdP logs to ensure claims are being sent
      - Have the user log out and log back in again. Check Keycloak logs during login and verify that the IdP claim matches the mapper configuration.

Roles Not Appearing in JWT Token
---------------------------------

**Symptoms**: User can log in but has no permissions

**Solutions**:

1. **Check Client Scope**:

   - Verify that ``osmo-browser-flow`` client has the correct client scopes
   - Verify that ``osmo-device`` client has the correct client scopes

2. **Review Token**:

   - Decode the JWT token to see what roles are included
   - Use a tool like jwt.io to inspect the token

Best Practices
==============

Naming Conventions
------------------

- **Roles**: Use lowercase with hyphens: ``osmo-<team>-<purpose>``
- **Groups**: Use title case: ``OSMO <Team> <Purpose>``
- **Pools**: Match role suffix: ``<team>-<resource-type>``

Examples:
   - Role: ``osmo-ml-team``
   - Group: ``OSMO ML Team``
   - Pools: ``ml-team-training``, ``ml-team-inference``

Group Organization
------------------

1. **Use Hierarchy**: Create parent groups for departments and child groups for teams
2. **Document Purpose**: Add descriptions to groups explaining their purpose
3. **Regular Audits**: Periodically review group memberships

Security Considerations
-----------------------

1. **Principle of Least Privilege**: Only grant necessary pool access
2. **Regular Reviews**: Audit role assignments quarterly
3. **Offboarding**: Remove users from groups when they leave teams
4. **Monitor Access**: Review Keycloak audit logs for unusual activity
5. **Test Changes**: Always test role/group changes with a test user first

See Also
========

- :doc:`roles_policies` for understanding OSMO roles and policies
- :doc:`authentication_flow` for authentication flow details
- :doc:`../../install_backend/configure_pool` for pool configuration
- `Keycloak Documentation <https://www.keycloak.org/documentation>`_

