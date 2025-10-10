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

=======================================================
OSMO Keycloak Roles and Group Management
=======================================================

This appendix describes how to configure Keycloak roles and groups to manage access to pools in the OSMO platform.

Configuration Process Overview
-------------------------------

OSMO uses Keycloak's role-based access control to manage permissions for pool access. The configuration follows a hierarchical structure:

1. **Roles**: Represent specific permissions within OSMO. For example, the role `osmo-group1` grants permission to submit workflows to the `group1-*` pools.

2. **Groups**: Collections of users that share the same access requirements. When a role is assigned to a group, all members of that group inherit the permissions associated with that role.

3. **Users**: Individual accounts that belong to one or more groups and inherit the roles assigned to those groups.

This hierarchical approach simplifies access management by allowing administrators to grant permissions to entire teams at once rather than configuring each user individually. The following sections provide detailed instructions for setting up this access control structure in Keycloak.

Creating Roles in Keycloak
---------------------------

1. Access the Keycloak admin console and select the OSMO realm.
2. Navigate to the "Clients" tab and select the "osmo-browser-flow" client.
3. Click on the "Roles" tab, then click "Create Role".
4. Enter a name for the role following the format "osmo-<pool-group-name>", for example "osmo-group1".
5. Repeat the same steps for the "osmo-device" client.

.. note::
    The role name is format-sensitive, so make sure to use the exact format as specified above.

Creating Groups in Keycloak
----------------------------

1. In the Keycloak admin console, select the OSMO realm.
2. Navigate to the "Groups" tab and click "Create Group".
3. Enter a name for the group following the format "OSMO <pool-group-name>", for example "OSMO group1".
4. After creating the group:

   a. Click into the group
   b. Select the "Role Mapping" tab
   c. Click "Assign Role"
   d. Click on the filter to select 'Filter by clients'
   e. Search for 'osmo-<pool-group-name>' for the client
   f. Select the roles you created in the previous step with 'osmo-browser-flow' and 'osmo-device'
   g. Click "Assign"

Adding Users to Groups
-----------------------

1. Navigate to the "Users" tab in the Keycloak admin console.
2. Select the user you want to add to the group.
3. Click on the "Groups" tab.
4. Select the group you want to add the user to.
5. Click "Assign".

Configuring Identity Provider Mappings
--------------------------------------

If you are using an external identity provider, and you would like to  automatically assign users to Keycloak groups based on roles provided by the identity provider, you can configure the identity provider to map the Keycloak groups and roles:

1. Navigate to the "Identity Providers" tab in the Keycloak admin console.
2. Select the identity provider you want to configure.
3. Click on the "Mappings" tab and click "Add Mapper".
4. Configure the mapper with the following settings:

   a. Enter a name for the mapper, for example "osmo-group1-mapper"
   b. Set Sync mode override to 'Force'
   c. For claims, set Key to 'roles' and Value to 'osmo-<pool-group-name>'
   d. Click on "Select Group" and pick the Keycloak group you created earlier
   e. Click "Save"

Creating Pools in OSMO
-----------------------

When creating a pool in OSMO, the name of the pool needs to match the Keycloak role name:

1. If you created a role called "osmo-group1", the pool name in OSMO must start with "group1".
2. For example, a valid pool name could be "group1-h100-gpu".

.. seealso::

   * For more information on how to create a pool in OSMO, please refer to the :ref:`register_pool` section.


Troubleshooting
----------------

If users are unable to access pools after configuration:

1. **Role Configuration**:

   - Verify that roles are correctly named with the "osmo-" prefix
   - Ensure roles are created for both "osmo-browser-flow" and "osmo-device" clients

2. **Group Configuration**:

   - Confirm that groups are correctly named with the "OSMO " prefix
   - Check that groups have the appropriate role mappings
   - After a user logs in, go to the Keycloak admin console and check if the user is in the group. If the user is not in the expected groups, the Identity Provider mapping may not be working correctly

4. **Pool Naming**:

   - Ensure that pool names in OSMO pool configuration match the corresponding role names in Keycloak

