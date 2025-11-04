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

This guide describes how to configure Keycloak roles and groups, and identity provider mappings to manage access control in the OSMO platform.

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

Creating Groups in Keycloak
============================

Groups are used to organize users and assign roles to multiple users at once:

1. In the Keycloak admin console, select the OSMO realm
2. Navigate to the "Groups" tab and click "Create Group"
3. Enter a name for the group following the format ``OSMO <pool-group-name>``

   For example: ``OSMO group1``

4. Click "Save"

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

   You must assign roles from both clients (``osmo-browser-flow`` and ``osmo-device``) for full functionality.

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

Configuring Identity Provider Mappings
---------------------------------------

For automatic user-to-group assignment based on identity provider claims:

1. Navigate to the "Identity Providers" tab in the Keycloak admin console
2. Select the identity provider you want to configure
3. Click on the "Mappers" tab and click "Add Mapper"
4. Configure the mapper with the following settings:

   a. **Name**: Enter a descriptive name (e.g., ``osmo-group1-mapper``)
   b. **Sync mode override**: Set to ``Force``
   c. **Mapper Type**: Select "Attribute Importer" or "Claim to Role" depending on your IdP
   d. **Claims**:

      - Set **Key** to ``roles`` (or the claim name your IdP uses)
      - Set **Value** to ``osmo-<pool-group-name>`` (e.g., ``osmo-group1``)

   e. **Group**: Click "Select Group" and choose the Keycloak group you created earlier
   f. Click "Save"


Creating Pools in OSMO
======================

Pool names must follow a naming convention that matches the Keycloak role:

**Rule**: If you created a role called ``osmo-<group-name>``, the pool name in OSMO must start with ``<group-name>``

Examples:
   - Role: ``osmo-group1`` → Valid pool names: ``group1``, ``group1-h100-gpu``, ``group1-dev``
   - Role: ``osmo-ml-team`` → Valid pool names: ``ml-team``, ``ml-team-training``, ``ml-team-inference``

To create a pool:

.. code-block:: bash

   $ osmo config set POOL group1-h100-gpu \
     --backend my-backend \
     --description "H100 GPU pool for group1"

See :doc:`../../install_backend/configure_pool` for more details on pool configuration.

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

1. **Verify Role Names**:

   - Roles must start with ``osmo-`` prefix
   - Pool names must match the role suffix
   - Example: Role ``osmo-team1`` requires pools named ``team1*``

2. **Check Both Clients**:

   - Ensure roles are created in **both** ``osmo-browser-flow`` and ``osmo-device`` clients
   - Both roles must be assigned to the group

3. **Verify Group Membership**:

   - In Keycloak admin console, check if the user appears in the group
   - If using IdP mappings, verify the mapping configuration
   - Check IdP logs to ensure claims are being sent

4. **Test IdP Mapping**:

   - Have the user log out and log back in
   - Check Keycloak logs during login
   - Verify the IdP claim matches the mapper configuration

5. **Pool Name Mismatch**:

   - Ensure pool names in OSMO match the role naming pattern
   - Role ``osmo-ml-team`` only grants access to pools starting with ``ml-team``

User in Wrong Group After Login
--------------------------------

**Symptoms**: User is assigned to incorrect Keycloak groups

**Solutions**:

1. **Check Mapper Sync Mode**:

   - Ensure sync mode is set to ``Force`` to override existing assignments
   - ``Import`` mode only applies on first login

2. **Verify Claim Values**:

   - Check that the IdP claim value exactly matches the mapper configuration
   - Claims are case-sensitive

3. **Review Mapper Logic**:

   - Ensure the claim key is correct (usually ``roles`` or ``groups``)
   - Verify the claim value matches what the IdP sends

4. **Manual Override**:

   - Temporarily remove user from incorrect groups
   - Have user log out and log back in
   - Verify automatic assignment works correctly

Roles Not Appearing in JWT Token
---------------------------------

**Symptoms**: User can log in but has no permissions

**Solutions**:

1. **Check Client Scope**:

   - Verify that ``osmo-browser-flow`` client has the correct client scopes
   - Ensure role mapper is enabled in the client scope

2. **Verify Token Mapper**:

   - In the client configuration, check "Client Scopes" tab
   - Ensure the role mapper is configured to include roles in the token

3. **Review Token**:

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
4. **Automation**: Use IdP mappings whenever possible to reduce manual maintenance

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

