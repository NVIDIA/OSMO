<!-- SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

SPDX-License-Identifier: Apache-2.0 -->

<a id="roles"></a>

<a id="roles-appendix"></a>

# Roles and Policies

This guide explains OSMO’s role-based access control (RBAC) system, including preconfigured roles, how to create custom roles, and how policies determine access permissions.

## Overview

OSMO uses role-based access control to manage user permissions. The authorization model consists of:

- **Roles**: Named sets of permissions that grant access to specific resources
- **Policies**: Rules that define which API endpoints and actions a role can access
- **Actions**: HTTP methods on API paths (e.g., `GET /api/workflows`)

> **Note**
>
> Roles are only available when authentication is enabled.

## Preconfigured Roles

By default, OSMO includes the following preconfigured roles:

| **Role**       | **Description**                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
|----------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `osmo-admin`   | User who is responsible to deploy, setup & manage OSMO. They are able to access all APIs except websocket APIs used for backend or tasks (`osmo-backend` and `osmo-ctrl` roles).<br/>For example, they can:<br/>\* Submit/cancel workflows from any pool<br/>\* Create and modify pools<br/>\* Modify other configuration like workflow and dataset settings<br/>\* Create, modify and delete roles and policies.<br/>\* Create service account tokens for backend registration |
| `osmo-user`    | OSMO users who are AI developers that use OSMO platform to run workflows and do not need management access to OSMO. They are able to:<br/><br/>* View and search workflows<br/>* View and search pools<br/>* Create and use apps<br/>* Store and modify user credentials<br/>* Submit/cancel workflows in the `default` pool and port-forward/exec into those workflows                                                                                                         |
| `osmo-backend` | Role for backend agents to communicate with OSMO. They are able to:<br/><br/>* Register compute backend to OSMO<br/>* Create and delete user pods<br/>* Monitor the health of the backend                                                                                                                                                                                                                                                                                       |
| `osmo-ctrl`    | Role for user tasks to communicate with OSMO. They are able to:<br/><br/>* Send user logs to OSMO<br/>* Allow user access to port-forward and exec into the user task                                                                                                                                                                                                                                                                                                           |
| `osmo-default` | Role for unauthenticated users. They are able to:<br/><br/>* View the service version<br/>* Fetch new JWT tokens from service/user access tokens                                                                                                                                                                                                                                                                                                                                |

> **Note**
>
> The Admin role is immutable and cannot be modified.

## Understanding Policies

### How Policies Work

OSMO determines if a role has access to an action by checking if the role has a policy that matches the action.

OSMO evaluates each policy the user has access to (based on their roles) and checks if the action matches any of the policies. Each policy is evaluated independently.

### Allow and Deny Actions

Policies can specify actions to allow or deny:

- **Allow**: Grant access to specific API paths and methods
- **Deny**: Explicitly deny access by prefixing the path with `!`

**Important**: Any path that is denied (using the `!` operator) takes precedence over allowed paths, regardless of how specific the allowed paths are.

### Action Format

Actions follow the format: `http:<path>:<method>`

- **Path**: The API endpoint (supports wildcards `*`. Wildcards are evaluated like the bash glob syntax)
- **Method**: HTTP method (`GET`, `POST`, `PUT`, `DELETE`, `PATCH`, or `*` for all)

Examples:
: - `http:/api/workflows/*:GET` - Allow GET requests to all workflow endpoints
  - `http:/api/pool:*` - Allow all methods on the pool endpoint
  - `http:!/api/configs/*:*` - Deny all requests to config endpoints

<a id="role-naming-for-pools"></a>

### Role Naming for Pools

Although the `actions` and `policies` assigned to a role ultimately determine what that role allows a user to do (e.g., submit workflows to a pool),
the **name** of the role determines which pools are visible to the user (In the UI and when using `osmo pool list` CLI command).
OSMO will check if a user has roles of the format `osmo-<prefix>` and will show that user all pools
that start with the given prefix.

For this reason, roles for accessing a pool should follow the pattern `osmo-<pool-name>` or for a role that gives access to a group of similarly named pools,
`osmo-<pool-prefix>`.

<a id="roles-policies-example"></a>

## Policy Examples

### Example 1: Basic Role

This role allows access to bucket and credential APIs, but not pool APIs:

```json
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
```

### Example 2: Multiple Policies

This role allows access to bucket, credential, and pool APIs. Even though the first policy denies `/api/pool`, the second policy allows it (policies are evaluated independently):

```json
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
```

### Example 3: Deny Takes Precedence

This role will **NOT** allow access to `/api/auth/access_token/service/*` even though `/api/auth/access_token/*` and `/api/auth/access_token/service/field` are allowed. Deny actions always take precedence:

```json
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
```

## Creating Custom Roles

### Using the OSMO CLI

To create a custom role using the OSMO CLI:

1. **Fetch Existing Roles**

   First, retrieve the current roles configuration:
   ```bash
   $ osmo config show ROLE > roles.json
   ```
2. **Edit the Configuration**

   Add your new role to the `roles.json` file:
   ```json
   [
     {
       "name": "new-role",
       "description": "Demo new role",
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
   ]
   ```
3. **Update the Roles**

   Apply the updated configuration:
   ```bash
   $ osmo config update ROLE -f roles.json
   Successfully updated ROLE config
   ```

## Quality of Life Features

<a id="auto-generating-pool-roles"></a>

### Auto-Generating Pool Roles

For pool and backend roles, use the `osmo config set` CLI to automatically generate roles with required policies:

```bash
$ osmo config set ROLE osmo-my-pool pool
Successfully set ROLE config "osmo-my-pool"
```

This generates a role with the necessary permissions:

```bash
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
```

> **Note**
>
> Pool role names must start with `osmo-<pool-prefix>` to be recognized as pool roles (See [Role Naming for Pools](#role-naming-for-pools) for more information).

Learn more about the CLI at [osmo config set](../../references/config_cli/config_set.md#cli-reference-config-set).

## Common Use Cases

### Creating a Role for a Pool

When creating a pool named `my-pool`, create a corresponding role:

1. **Generate the Role**
   ```bash
   $ osmo config set ROLE osmo-my-pool -p my-pool
   Successfully created ROLE config
   ```
2. **Configure Pool Access in Keycloak**

   Follow the [Keycloak Group and Role Management](keycloak_setup.md) guide to create Keycloak groups and map them to the role.
3. **Assign Users**

   Add users to the Keycloak group to grant them access to the pool.

### Assigning Roles to Service Access Tokens

To create a service access token with specific roles:

```bash
$ osmo token set service-token-name \
  --expires-at 2026-01-01 \
  --description "Service token for my-role" \
  --role osmo-my-role
```

> **Note**
>
> For pool access tokens, include the `osmo-user` role in addition to the pool role. The pool role only allows workflow submission by default, while the `osmo-user` role provides access to workflow management APIs (cancel, query, etc.).

Example:

```bash
$ osmo token set pool-token \
  --expires-at 2026-01-01 \
  --description "Token for pool access" \
  --role osmo-my-pool \
  --role osmo-user
```

## Best Practices

1. **Use Descriptive Names**: Name roles clearly to indicate their purpose (e.g., `osmo-ml-team`, `osmo-robotics-pool`)
2. **Follow Naming Conventions**:
   - Pool roles: `osmo-<pool-group-name>`
   - Custom roles: `<organization>-<purpose>`
3. **Principle of Least Privilege**: Grant only the minimum permissions needed for users to perform their tasks
4. **Document Custom Roles**: Maintain documentation of custom roles and their intended use cases
5. **Regular Audits**: Periodically review role assignments and policies to ensure they remain appropriate
6. **Test Thoroughly**: Test new roles with a test user before deploying to production

<a id="troubleshooting-roles-policies"></a>

## Troubleshooting

### Role Not Working as Expected

1. **Verify Role Assignment**: Confirm the user has the role in their JWT token
2. **Check Policy Format**: Ensure actions follow the correct format (`http:<path>:<method>`)
3. **Review Deny Rules**: Check if any deny rules are blocking access
4. **Test with Admin**: Verify the API works with admin privileges to isolate the issue

### Pool Access Issues

1. **Verify Role Name**: Ensure the role name starts with `osmo-` and matches the pool prefix
2. **Check Keycloak Configuration**: Verify the role is properly configured in Keycloak
3. **Confirm Group Membership**: Ensure the user is in the correct Keycloak group
4. **Review Pool Name**: The pool name must match the role pattern (e.g., role `osmo-team1` → pool `team1-*`)

## See Also

- [Keycloak Group and Role Management](keycloak_setup.md) for configuring roles in Keycloak
- [Authentication Flow](authentication_flow.md) for understanding authentication
- [/api/configs/role](../../references/configs_definitions/roles.md#roles-config) for complete role configuration reference
- [Create Resource Pools](../../install_backend/configure_pool.md) for pool configuration
