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

.. _roles:
.. _roles_appendix:

================================================
Roles and Policies
================================================

OSMO ships with preconfigured roles that cover common use cases out of the box.
**Most administrators do not need to create or modify roles** — simply assign users to the built-in roles described below.

If you need more fine-grained access control (for example, restricting users to specific pools
or denying certain operations), see :ref:`custom_roles_policies` later in this guide.

.. note::

   Roles are only available when authentication is enabled.

.. _preconfigured_roles:

Preconfigured Roles (Default)
==============================

OSMO includes the following roles by default. No configuration is required — these roles are created automatically when authentication is enabled.

.. list-table::
   :header-rows: 1
   :widths: 40 80

   * - **Role**
     - **Description**
   * - ``osmo-admin``
     - User who is responsible to deploy, setup & manage OSMO. They are able to access all APIs except websocket APIs used for backend or tasks (``osmo-backend`` and ``osmo-ctrl`` roles).
       For example, they can:

       * Submit/cancel workflows from any pool
       * Create and modify pools
       * Modify other configuration like workflow and dataset settings
       * Create, modify and delete roles and policies.
       * Create service account tokens for backend registration

   * - ``osmo-user``
     - OSMO users who are AI developers that use OSMO platform to run workflows and do not need management access to OSMO. They are able to:

       * View and search workflows
       * View and search pools
       * Create and use apps
       * Store and modify user credentials
       * Submit/cancel workflows in the ``default`` pool and port-forward/exec into those workflows

   * - ``osmo-backend``
     - Role for backend agents to communicate with OSMO. They are able to:

       * Register compute backend to OSMO
       * Create and delete user pods
       * Monitor the health of the backend

   * - ``osmo-ctrl``
     - Role for user tasks to communicate with OSMO. They are able to:

       * Send user logs to OSMO
       * Allow user access to port-forward and exec into the user task

   * - ``osmo-default``
     - Role that all users have access to. They are able to:

       * View the service version
       * Fetch new JWT tokens from service/user access tokens

.. note::

   The ``osmo-admin`` role is immutable and cannot be modified.

Role Fields
-----------

Each role has the following fields:

.. list-table::
   :header-rows: 1
   :widths: 20 15 65

   * - **Field**
     - **Default**
     - **Description**
   * - ``name``
     - (required)
     - Unique name for the role.
   * - ``description``
     - (required)
     - Human-readable description of the role.
   * - ``policies``
     - (required)
     - List of policies that define what this role can do. See :ref:`custom_roles_policies` for details.
   * - ``immutable``
     - ``false``
     - If ``true``, the role cannot be modified or deleted. The preconfigured ``osmo-admin``, ``osmo-backend``, ``osmo-ctrl``, and ``osmo-default`` roles are immutable.
   * - ``sync_mode``
     - ``"import"``
     - Controls how IdP role sync affects this role. One of:

       * ``"import"`` -- Roles are **added** when the IdP provides them, but **never removed** by IdP sync.
       * ``"force"`` -- Role membership is driven entirely by the IdP. Added when present, **removed** when absent.
       * ``"ignore"`` -- IdP sync never touches this role; manage it only via the CLI.

       See :ref:`role_sync_modes` for full details.
   * - ``external_roles``
     - ``null``
     - Maps external IdP group/role names to this OSMO role. When users log in via an IdP, OSMO uses these mappings to determine which OSMO roles to assign.

       * ``null`` (not set): For **new** roles, OSMO creates a default 1:1 mapping using the role's own name (e.g., a role named ``ml-team`` automatically maps from an external role named ``ml-team``). For existing roles, the current mappings are preserved.
       * ``[]`` (empty list): Explicitly clears all external mappings. The role will not be assigned via IdP sync.
       * ``["group-a", "group-b"]``: Maps the specified external names to this role. If a user's IdP claims include any of these names, the role is assigned (subject to :ref:`sync_mode <role_sync_modes>`).

       See :doc:`identity_provider_setup` for configuring IdP integration.

All preconfigured roles use the defaults (``sync_mode: "import"``, ``external_roles: null``), which means each is automatically mapped 1:1 from its own name in IdP claims. For example, if your IdP sends a group claim containing ``osmo-user``, that user will automatically receive the ``osmo-user`` role in OSMO without any additional configuration.

.. tip::

   For most deployments, assigning users to ``osmo-admin`` or ``osmo-user`` is sufficient. You only
   need to read further if you want to create custom roles or understand how policies work internally.

.. _custom_roles_policies:

Custom Roles and Policies (Advanced)
=====================================

This section is for administrators who need more fine-grained access control beyond the
preconfigured roles. For example, you may want to:

- Restrict users to specific pools
- Create read-only roles
- Deny certain operations for specific teams
- Scope dataset access to particular buckets

If the preconfigured roles meet your needs, you can skip this section.

Understanding Policies
-----------------------

How Policies Work
^^^^^^^^^^^^^^^^^

OSMO determines if a role has access to perform an operation by checking if the role has a policy that matches the requested action and resource.

When a user makes an API request, OSMO:

1. Resolves the API path and HTTP method to a **semantic action** (e.g., ``GET /api/workflow/123`` becomes ``workflow:Read``) and a **resource** (e.g., ``pool/my-pool``).
2. Evaluates each policy the user has access to (based on their roles) and checks if the action and resource match.
3. If any policy with effect ``Deny`` matches, access is denied regardless of other policies.
4. If any policy with effect ``Allow`` matches (and no Deny matched), access is granted.

Policy Structure
^^^^^^^^^^^^^^^^

Each policy has three fields:

- **effect**: ``"Allow"`` (default) or ``"Deny"``. Deny always takes precedence over Allow.
- **actions**: A list of semantic action strings that the policy applies to.
- **resources**: A list of resource patterns the policy is scoped to. If omitted, the policy only matches globally-scoped actions. Set to ``["*"]`` to match all resources.

Action Format
^^^^^^^^^^^^^

Actions use the semantic format: ``<resource_type>:<action_name>``

- **resource_type**: The category of resource (e.g., ``workflow``, ``pool``, ``dataset``, ``credentials``)
- **action_name**: The operation (e.g., ``Create``, ``Read``, ``List``, ``Update``, ``Delete``)

Wildcards are supported in action strings:

- ``*:*`` -- matches all actions on all resource types
- ``workflow:*`` -- matches all workflow actions (Create, List, Read, Update, Delete, Cancel, etc.)
- ``*:Read`` -- matches all Read actions across all resource types

Examples:

- ``"workflow:Create"`` -- allow creating workflows
- ``"pool:List"`` -- allow listing pools
- ``"dataset:*"`` -- allow all dataset operations
- ``"*:Read"`` -- allow all read operations

See :ref:`actions_resources_reference` for the complete list of actions.

Resource Format
^^^^^^^^^^^^^^^

Resources scope a policy to specific instances. They use the format ``<scope>/<identifier>``.

- ``"*"`` -- matches all resources
- ``"pool/my-pool"`` -- matches the specific pool ``my-pool``
- ``"pool/*"`` -- matches all pools
- ``"bucket/my-data"`` -- matches the specific bucket ``my-data``
- ``"config/*"`` -- matches all config types

See :ref:`resource_scoping` for details on how different resource types are scoped.

Allow and Deny Policies
^^^^^^^^^^^^^^^^^^^^^^^

Policies can have an ``effect`` of ``"Allow"`` or ``"Deny"``:

- **Allow**: Grant access to the specified actions on the specified resources.
- **Deny**: Explicitly deny access to the specified actions on the specified resources.

**Important**: Any ``Deny`` policy takes precedence over ``Allow`` policies, regardless of how specific the allow policies are. Within a single role, if both a Deny and Allow policy match, the Deny wins.

.. _role_naming_for_pools:

Role Naming for Pools
^^^^^^^^^^^^^^^^^^^^^

Pool access is determined entirely by a role's **policies**, not its name. A role grants access to a pool when it has a policy allowing ``workflow:Create`` (or other workflow actions) scoped to that pool's resource (e.g., ``pool/my-pool``).

Role names can be anything descriptive. For example, ``ml-training-role``, ``team-alpha``, or ``production-pool-access`` are all valid.

.. _roles_policies_example:

Policy Examples
---------------

.. dropdown:: Example 1: Basic Role
   :color: info

   This role allows all dataset and credential operations:

   .. code-block:: json

      {
        "name": "example-role",
        "description": "Example Role",
        "policies": [
          {
            "actions": [
                "dataset:*",
                "credentials:*"
            ]
          }
        ],
        "immutable": false
      }

.. dropdown:: Example 2: Scoped Pool Access
   :color: info

   This role allows creating and managing workflows only in the ``production`` pool:

   .. code-block:: json

      {
        "name": "osmo-production",
        "description": "Production pool access",
        "policies": [
          {
            "actions": [
                "workflow:Create",
                "workflow:Read",
                "workflow:Cancel",
                "workflow:List",
                "pool:List"
            ],
            "resources": ["pool/production"]
          },
          {
            "actions": [
                "profile:*",
                "credentials:*"
            ]
          }
        ],
        "immutable": false
      }

.. dropdown:: Example 3: Deny Takes Precedence
   :color: info

   This role allows all actions except config updates. Even though ``*:*`` would normally include ``config:Update``, the explicit ``Deny`` policy takes precedence:

   .. code-block:: json

      {
        "name": "example-role",
        "description": "Read-only admin",
        "policies": [
          {
            "effect": "Allow",
            "actions": ["*:*"]
          },
          {
            "effect": "Deny",
            "actions": ["config:Update"]
          }
        ],
        "immutable": false
      }

.. dropdown:: Example 4: Multi-Pool Role
   :color: info

   This role grants workflow access to multiple pools using separate resource-scoped policies:

   .. code-block:: json

      {
        "name": "osmo-ml-team",
        "description": "ML team pool access",
        "policies": [
          {
            "actions": [
                "workflow:*",
                "pool:List"
            ],
            "resources": ["pool/ml-training", "pool/ml-inference"]
          },
          {
            "actions": [
                "dataset:*",
                "credentials:*",
                "app:*",
                "profile:*"
            ]
          }
        ],
        "immutable": false
      }

Creating Custom Roles
----------------------

Using the OSMO CLI
^^^^^^^^^^^^^^^^^^

To create a custom role using the OSMO CLI:

1. **Fetch Existing Roles**

   First, retrieve the current roles configuration:

   .. code-block:: bash

      $ osmo config show ROLE > roles.json

2. **Edit the Configuration**

   Add your new role to the ``roles.json`` file:

   .. code-block:: json

      [
        {
          "name": "new-role",
          "description": "Demo new role",
          "policies": [
            {
              "actions": [
                  "dataset:*",
                  "credentials:*"
              ]
            }
          ],
          "immutable": false
        }
      ]

3. **Update the Roles**

   Apply the updated configuration:

   .. code-block:: bash

      $ osmo config update ROLE -f roles.json
      Successfully updated ROLE config

Quality of Life Features
-------------------------

.. _auto_generating_pool_roles:

Auto-Generating Pool Roles
^^^^^^^^^^^^^^^^^^^^^^^^^^^

For pool and backend roles, use the ``osmo config set`` CLI to automatically generate roles with required policies:

.. code-block:: bash

   $ osmo config set ROLE osmo-my-pool pool
   Successfully set ROLE config "osmo-my-pool"

This generates a role with the necessary permissions:

.. code-block:: bash

   $ osmo config show ROLE osmo-my-pool
   {
     "name": "osmo-my-pool",
     "policies": [
       {
         "actions": [
           "http:/api/pool/my-pool*:Post",
           "http:/api/profile/*:*"
         ]
       }
     ],
     "immutable": false,
     "description": "Generated Role for pool my-pool"
   }

.. note::

   Pool access is determined by the role's policies, not its name. See :ref:`role_naming_for_pools` for more information.

Learn more about the CLI at :ref:`cli_reference_config_set`.

Common Use Cases
-----------------

Creating a Role for a Pool
^^^^^^^^^^^^^^^^^^^^^^^^^^^

When creating a pool named ``my-pool``, create a corresponding role:

1. **Generate the Role**

   .. code-block:: bash

      $ osmo config set ROLE osmo-my-pool -p my-pool
      Successfully created ROLE config

2. **Assign the role to users**

   Use the ``osmo user update`` CLI to assign the role to users:

   .. code-block:: bash

      $ osmo user update <user_id> --add-roles osmo-my-pool

   See :doc:`managing_users` for full details on user creation and role assignment. If you use an identity provider, you can instead (or additionally) map IdP groups to this role via ``external_roles``; see :doc:`idp_role_mapping`.

Assigning roles to users and creating access tokens
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

Roles are assigned to **users** in OSMO (via the ``osmo user`` CLI or, when using an IdP, via IdP group mapping). **Access tokens** are then created for a user and inherit that user's roles (or a subset) at creation time.

- To create a user and assign roles: use ``osmo user create <user_id> --roles <role_name>`` or ``osmo user update <user_id> --add-roles <role_name>``. See :doc:`managing_users`.
- To create an access token for the current user: use ``osmo token set <token_name>``. An admin can create an access token for another user via ``osmo token set <token_name> --user <user_id>``.

For pool access, assign a role with the appropriate pool-scoped workflow policies, along with ``osmo-user`` (or equivalent) so the token can also use workflow management commands (cancel, query, etc.).

.. _troubleshooting_roles_policies:

Troubleshooting
================

Role Not Working as Expected
------------------------------

1. **Verify Role Assignment**: Confirm the user has the role in their JWT token
2. **Check Action Format**: Ensure actions follow the semantic format (``<resource_type>:<action_name>``, e.g., ``workflow:Create``)
3. **Review Deny Policies**: Check if any policy with ``"effect": "Deny"`` is blocking access
4. **Check Resource Scoping**: If the policy uses ``resources``, verify the resource pattern matches the target (e.g., ``pool/my-pool``)
5. **Test with Admin**: Verify the operation works with admin privileges to isolate the issue

Pool Access Issues
--------------------

1. **Check role policies**: Ensure the role has a policy allowing ``workflow:Create`` scoped to the target pool (e.g., ``resources: ["pool/my-pool"]``)
2. **Check role assignment**: Ensure the user has the role in OSMO (via ``osmo user roles list <user_id>`` or IdP role mapping)
3. **Review resource scope**: Verify the policy's ``resources`` field matches the pool name (e.g., ``pool/my-pool`` or ``pool/*``)

.. _actions_resources_reference:

Actions and Resources Reference
================================

This section provides a complete reference of all semantic actions and resource types available in OSMO's authorization model.

Action Format
-------------

All actions follow the format ``<resource_type>:<action_name>``. When writing policies, you can use wildcards:

- ``*:*`` -- all actions on all resource types
- ``<resource_type>:*`` -- all actions for a resource type (e.g., ``workflow:*``)
- ``*:<action_name>`` -- a specific action across all resource types (e.g., ``*:Read``)

.. dropdown:: Workflow Actions
   :color: info

   Actions for managing workflows, tasks, and interactive sessions. Workflow actions (except ``workflow:List``) are scoped to the pool that owns the workflow (e.g., ``pool/my-pool``).

   .. list-table::
      :header-rows: 1
      :widths: 30 40 30

      * - **Action**
        - **Description**
        - **Resource Scope**
      * - ``workflow:Create``
        - Submit a new workflow to a pool.
        - ``pool/<pool_name>``
      * - ``workflow:List``
        - List and search workflows and tasks.
        - Global (no scope)
      * - ``workflow:Read``
        - View details of a specific workflow.
        - ``pool/<pool_name>``
      * - ``workflow:Update``
        - Modify a workflow.
        - ``pool/<pool_name>``
      * - ``workflow:Delete``
        - Delete a workflow.
        - ``pool/<pool_name>``
      * - ``workflow:Cancel``
        - Cancel a running workflow.
        - ``pool/<pool_name>``
      * - ``workflow:Exec``
        - Execute commands in a workflow container.
        - ``pool/<pool_name>``
      * - ``workflow:PortForward``
        - Port-forward or access a webserver on a workflow.
        - ``pool/<pool_name>``
      * - ``workflow:Rsync``
        - Rsync files to/from a workflow.
        - ``pool/<pool_name>``

.. dropdown:: Dataset Actions
   :color: info

   Actions for managing dataset buckets. Dataset actions (except ``dataset:List``) are scoped to the specific bucket (e.g., ``bucket/my-data``).

   .. list-table::
      :header-rows: 1
      :widths: 30 40 30

      * - **Action**
        - **Description**
        - **Resource Scope**
      * - ``dataset:List``
        - List all datasets/buckets.
        - Global (no scope)
      * - ``dataset:Read``
        - View a specific dataset/bucket.
        - ``bucket/<bucket_name>``
      * - ``dataset:Write``
        - Create or update a dataset/bucket.
        - ``bucket/<bucket_name>``
      * - ``dataset:Delete``
        - Delete a dataset/bucket.
        - ``bucket/<bucket_name>``

.. dropdown:: Credentials Actions
   :color: info

   Actions for managing user credentials (e.g., cloud provider keys, registry secrets).

   .. list-table::
      :header-rows: 1
      :widths: 30 40 30

      * - **Action**
        - **Description**
        - **Resource Scope**
      * - ``credentials:Create``
        - Create a new credential.
        - Global (no scope)
      * - ``credentials:Read``
        - View credentials.
        - Global (no scope)
      * - ``credentials:Update``
        - Update a credential.
        - Global (no scope)
      * - ``credentials:Delete``
        - Delete a credential.
        - Global (no scope)

.. dropdown:: Pool Actions
   :color: info

   Actions for pool management.

   .. list-table::
      :header-rows: 1
      :widths: 30 40 30

      * - **Action**
        - **Description**
        - **Resource Scope**
      * - ``pool:List``
        - List pools and pool quotas.
        - Global (no scope)

.. dropdown:: Profile Actions
   :color: info

   Actions for managing user profile settings.

   .. list-table::
      :header-rows: 1
      :widths: 30 40 30

      * - **Action**
        - **Description**
        - **Resource Scope**
      * - ``profile:Read``
        - View profile settings.
        - Global (no scope)
      * - ``profile:Update``
        - Update profile settings.
        - Global (no scope)

.. dropdown:: User Actions
   :color: info

   Actions for user management.

   .. list-table::
      :header-rows: 1
      :widths: 30 40 30

      * - **Action**
        - **Description**
        - **Resource Scope**
      * - ``user:List``
        - List users.
        - Global (no scope)

.. dropdown:: App Actions
   :color: info

   Actions for managing apps.

   .. list-table::
      :header-rows: 1
      :widths: 30 40 30

      * - **Action**
        - **Description**
        - **Resource Scope**
      * - ``app:Create``
        - Create a new app.
        - Global (no scope)
      * - ``app:Read``
        - View apps.
        - Global (no scope)
      * - ``app:Update``
        - Update an app.
        - Global (no scope)
      * - ``app:Delete``
        - Delete an app.
        - Global (no scope)

.. dropdown:: Resources Actions
   :color: info

   Actions for viewing cluster resources.

   .. list-table::
      :header-rows: 1
      :widths: 30 40 30

      * - **Action**
        - **Description**
        - **Resource Scope**
      * - ``resources:Read``
        - View cluster resource information.
        - Global (no scope)

.. dropdown:: Config Actions
   :color: info

   Actions for managing OSMO configuration. Config actions are scoped to the config type (e.g., ``config/ROLE``).

   .. list-table::
      :header-rows: 1
      :widths: 30 40 30

      * - **Action**
        - **Description**
        - **Resource Scope**
      * - ``config:Read``
        - View configuration.
        - ``config/<config_type>``
      * - ``config:Update``
        - Modify configuration.
        - ``config/<config_type>``

.. dropdown:: Auth Actions
   :color: info

   Actions for authentication and token management. The ``auth:Token`` action can be scoped to a specific user (e.g., ``user/<user_id>``).

   .. list-table::
      :header-rows: 1
      :widths: 30 40 30

      * - **Action**
        - **Description**
        - **Resource Scope**
      * - ``auth:Login``
        - Initiate login and retrieve auth keys.
        - Global (no scope)
      * - ``auth:Refresh``
        - Refresh JWT tokens from refresh or access tokens.
        - Global (no scope)
      * - ``auth:Token``
        - Create and manage access tokens.
        - ``user/<user_id>`` or Global

.. dropdown:: System Actions
   :color: info

   Public system actions available to all users.

   .. list-table::
      :header-rows: 1
      :widths: 30 40 30

      * - **Action**
        - **Description**
        - **Resource Scope**
      * - ``system:Health``
        - Health check endpoint.
        - Global (no scope)
      * - ``system:Version``
        - View service version.
        - Global (no scope)

.. dropdown:: Internal Actions
   :color: info

   Restricted actions for internal OSMO components (backends, loggers, routers). Internal actions are scoped to specific backend instances (e.g., ``backend/<backend_id>``).

   .. list-table::
      :header-rows: 1
      :widths: 30 40 30

      * - **Action**
        - **Description**
        - **Resource Scope**
      * - ``internal:Operator``
        - Backend agent communication (listener and worker registration).
        - ``backend/<backend_id>``
      * - ``internal:Logger``
        - Task log forwarding.
        - ``backend/<backend_id>``
      * - ``internal:Router``
        - Router backend communication.
        - ``backend/<backend_id>``

.. _resource_scoping:

Resource Scope Patterns
-----------------------

The **Resource Scope** column in the tables above indicates how each action is scoped. When writing policies, use the following patterns:

.. list-table::
   :header-rows: 1
   :widths: 25 30 45

   * - **Scope**
     - **Pattern Examples**
     - **Description**
   * - Global (no scope)
     - Not required
     - The action applies globally and does not need a ``resources`` field in the policy.
   * - ``pool/<pool_name>``
     - ``pool/my-pool``, ``pool/*``
     - Restricts workflow actions to a specific pool or all pools.
   * - ``bucket/<bucket_name>``
     - ``bucket/my-data``, ``bucket/*``
     - Restricts dataset actions to a specific bucket or all buckets.
   * - ``config/<config_type>``
     - ``config/ROLE``, ``config/WORKFLOW``, ``config/*``
     - Restricts config actions to a specific config type or all types.
   * - ``user/<user_id>``
     - ``user/abc123``, ``user/*``
     - Restricts ``auth:Token`` to managing tokens for a specific user.
   * - ``backend/<backend_id>``
     - ``backend/my-backend``, ``backend/*``
     - Restricts internal actions to a specific backend instance.

When a policy does not specify ``resources``, it only matches actions with global scope (no resource). To match scoped actions (e.g., workflow actions on a specific pool), you must explicitly set ``resources`` (e.g., ``["pool/my-pool"]`` or ``["*"]`` for all).

See Also
========

- :doc:`identity_provider_setup` for configuring an IdP and role mapping
- :doc:`authentication_flow` for understanding authentication
- :ref:`roles_config` for complete role configuration reference
- :doc:`../../install_backend/configure_pool` for pool configuration
- ``osmo user --help`` and ``osmo token --help`` for user and token management CLI commands
