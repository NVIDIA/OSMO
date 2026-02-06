<!--
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
-->

# User Management and Role Mapping Design

**Author**: @RyaliNvidia<br>
**PIC**: @RyaliNvidia<br>
**Proposal Issue**: [#148](https://github.com/NVIDIA/OSMO/issues/148)

## Overview

This document describes the design for adding user management to OSMO, including a `users` table, `user_roles` and `pat_roles` tables for role assignments, and SCIM-compatible APIs for user management.

> **Implementation Status**: This design has been implemented. See `migration/6_0_2.sql` for the database migration and `external/src/service/core/auth/auth_service.py` for the API implementation.

### Motivation

- **User visibility** — Currently, OSMO has no concept of "users" as first-class entities. Users exist only implicitly through IDP authentication or access token ownership.
- **Centralized role management** — Roles are currently stored as a `TEXT[]` column in the `access_token` table. This makes it difficult to manage role assignments across users and tokens consistently.
- **SCIM readiness** — Many enterprise identity providers support SCIM (System for Cross-domain Identity Management) for automated user provisioning. Designing SCIM-compatible APIs now will ease future integration.
- **Audit and compliance** — Storing users explicitly enables better audit trails for who has access to what.

### Problem

The current OSMO authorization model has several gaps:

1. **No User Table** — Users are identified by their IDP username (extracted from JWT claims), but OSMO doesn't store user records. This means:
   - No way to list all users who have ever accessed OSMO
   - No way to pre-provision users before their first login

2. **Roles Embedded in Access Tokens** — The `access_token` table stores roles as a `TEXT[]` column:
   ```sql
   CREATE TABLE access_token (
       user_name TEXT,
       token_name TEXT,
       ...
       roles TEXT[],  -- Roles are embedded here
       ...
   );
   ```
   This approach has limitations:
   - Changing a user's roles doesn't affect existing tokens
   - No audit trail for when/who assigned roles
   - No support for time-bound role assignments
   - Inconsistent with the user-role model in `PROJ-148-direct-idp-integration.md`

3. **No Unified Role Assignment** — With direct IDP integration (removing Keycloak), we need a single source of truth for role assignments that covers:
   - Users (authenticated via IDP or created for programmatic access)
   - Future: Groups (for bulk role assignment)

### Related Documents

- [PROJ-148-direct-idp-integration.md](./PROJ-148-direct-idp-integration.md) — Describes Role Management APIs and `user_roles` table
- [PROJ-148-resource-action-model.md](./PROJ-148-resource-action-model.md) — Describes the new resource-action permission model

This document extends those designs with:
- A proper `users` table for storing user records
- A unified `principal_roles` table (replacing the earlier `user_roles` concept)
- SCIM-compatible API design

---

## Table of Contents

1. [Requirements](#requirements)
2. [Database Schema](#database-schema)
3. [User Management APIs](#user-management-apis)
4. [Role Assignment APIs](#role-assignment-apis)
5. [Role Resolution](#role-resolution)
6. [SCIM Compatibility](#scim-compatibility)
7. [Migration Strategy](#migration-strategy)
8. [Security Considerations](#security-considerations)

---

## Requirements

| Title | Description | Type |
|-------|-------------|------|
| User table | System shall store user records with unique identifiers and metadata | Functional |
| User-centric roles | Role assignments shall be made to users; PATs inherit roles from their owner | Functional |
| Role assignment metadata | Each role assignment shall track who assigned it, when, and optional expiration | Functional |
| SCIM-compatible user APIs | User APIs shall follow SCIM patterns for create, read, update, delete operations | Functional |
| Just-in-time provisioning | Users authenticating via IDP shall be auto-provisioned on first login | Functional |
| Service account pattern | Service accounts shall be users with PATs for programmatic access | Functional |
| Backward compatibility | Existing access tokens with embedded roles shall continue to work during migration | Functional |
| Role resolution latency | Role lookups shall complete in <5ms at p99 (cached) | KPI |

---

## Database Schema

### Users Table

Stores all user records, including:
- **IDP users** — Authenticated via external identity provider (auto-provisioned on first login)
- **Service accounts** — Created for programmatic access (CI/CD pipelines, automation, etc.)

Both types of users can have Personal Access Tokens (PATs) for API access. PATs inherit roles from their owning user at creation time.

```sql
CREATE TABLE users (
    -- Primary identifier (IDP username or service account name)
    id TEXT PRIMARY KEY,

    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_by TEXT  -- Username of who created this record
);
```

> **Note**: The `display_name`, `email`, `external_id`, and `updated_at` fields were removed from the implementation. User identity information is managed by the IDP.

### User Roles Table

Maps users to roles. These are the maximum roles a user can have; PATs can use a subset.

```sql
CREATE TABLE user_roles (
    -- Unique identifier for this assignment (used as FK in pat_roles)
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- User ID (references users.id)
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Role name (references roles.name)
    role_name TEXT NOT NULL REFERENCES roles(name) ON DELETE CASCADE,

    -- Audit metadata
    assigned_by TEXT NOT NULL,  -- Who assigned this role
    assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    -- Unique constraint on user + role combination
    UNIQUE (user_id, role_name)
);

-- Index for fast user lookups (most common query)
CREATE INDEX idx_user_roles_user ON user_roles(user_id);

-- Index for role-centric queries ("who has this role?")
CREATE INDEX idx_user_roles_role ON user_roles(role_name);
```

### PAT Roles Table

Maps Personal Access Tokens to roles via a foreign key to `user_roles.id`. This design ensures:
- PAT roles can only reference roles the user actually has
- When a user loses a role, all PAT roles referencing it are automatically deleted via CASCADE

```sql
CREATE TABLE pat_roles (
    -- Token identifier (references access_token)
    user_name TEXT NOT NULL,
    token_name TEXT NOT NULL,

    -- References the user_role assignment (cascades on delete)
    user_role_id UUID NOT NULL REFERENCES user_roles(id) ON DELETE CASCADE,

    -- Audit metadata
    assigned_by TEXT NOT NULL,  -- Who created the token (may be admin or user)
    assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    -- Composite primary key
    PRIMARY KEY (user_name, token_name, user_role_id),

    -- Foreign key to access_token
    FOREIGN KEY (user_name, token_name) REFERENCES access_token(user_name, token_name) ON DELETE CASCADE
);

-- Index for fast token lookups
CREATE INDEX idx_pat_roles_token ON pat_roles(user_name, token_name);

-- Index for user_role lookups
CREATE INDEX idx_pat_roles_user_role ON pat_roles(user_role_id);
```

> **Note**: PAT roles are immutable after creation. To change a PAT's roles, delete the token and create a new one. When a user loses a role, all PATs that had that role automatically lose it as well.

### Access Token Table

Stores Personal Access Tokens (PATs). The `roles` and `access_type` columns have been removed; roles are now stored in the `pat_roles` table. Tokens are owned by users and are deleted when the user is deleted.

```sql
CREATE TABLE access_token (
    user_name TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_name TEXT NOT NULL,
    access_token BYTEA,
    expires_at TIMESTAMP,
    description TEXT,
    last_seen_at TIMESTAMP WITH TIME ZONE,  -- Last usage timestamp
    PRIMARY KEY (user_name, token_name),
    CONSTRAINT unique_access_token UNIQUE (access_token)
);
```

### Roles Table

The roles table now includes a `sync_mode` column to control how roles are synchronized with IDP claims.

```sql
CREATE TABLE roles (
    name TEXT PRIMARY KEY,
    description TEXT,
    policies JSONB[],
    immutable BOOLEAN,
    sync_mode TEXT NOT NULL DEFAULT 'import'  -- 'force', 'import', or 'ignore'
);
```

**Sync Mode Values:**
- `force` — Always apply this role to all users (e.g., for system roles)
- `import` — Role is imported from IDP claims or `user_roles` table (default)
- `ignore` — Ignore this role in IDP sync (role is managed manually)

### Role External Mappings Table

Maps external IDP role names to OSMO roles. This enables flexible role mapping when IDP role names differ from OSMO role names.

```sql
CREATE TABLE role_external_mappings (
    -- OSMO role name (references roles.name)
    role_name TEXT NOT NULL REFERENCES roles(name) ON DELETE CASCADE,

    -- External role name from IDP (e.g., from x-osmo-roles header)
    external_role TEXT NOT NULL,

    -- Composite primary key ensures unique mappings
    PRIMARY KEY (role_name, external_role)
);

-- Index for fast lookups by external role name (used during IDP role resolution)
CREATE INDEX idx_role_external_mappings_external_role ON role_external_mappings (external_role);
```

**Key Characteristics:**

1. **Many-to-many mapping** — Multiple external roles can map to the same OSMO role, and one external role can map to multiple OSMO roles
2. **Default mapping** — During migration, each existing role automatically gets a 1:1 mapping (role name → same external role name)
3. **Flexible IDP integration** — Supports scenarios where IDP uses different naming conventions

**Example Use Cases:**

| External Role (IDP) | OSMO Role | Use Case |
|---------------------|-----------|----------|
| `LDAP_ML_TEAM` | `osmo-ml-team` | Map LDAP group name to OSMO role |
| `ad-developers` | `osmo-user` | Map AD group to OSMO role |
| `ad-developers` | `osmo-dev-team` | Same external role grants multiple OSMO roles |
| `senior-engineer` | `osmo-admin` | Map job title to admin role |
| `junior-engineer` | `osmo-admin` | Multiple external roles can grant admin |

### Related Tables with Foreign Keys

The following tables reference the `users` table:

```sql
-- Profile table (user preferences)
CREATE TABLE profile (
    user_name TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    slack_notification BOOLEAN,
    email_notification BOOLEAN,
    bucket TEXT,
    pool TEXT,
    PRIMARY KEY (user_name)
);

-- User encryption keys table
CREATE TABLE ueks (
    uid TEXT REFERENCES users(id) ON DELETE CASCADE,
    keys HSTORE,
    PRIMARY KEY (uid)
);
```

### Schema Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         DATABASE SCHEMA RELATIONSHIPS                       │
└─────────────────────────────────────────────────────────────────────────────┘

                              ┌──────────────┐
                              │    roles     │
                              ├──────────────┤
                              │ name (PK)    │
                              │ description  │
                              │ policies     │
                              │ immutable    │
                              │ sync_mode    │
                              └──────────────┘
                                     ▲
                ┌────────────────────┼────────────────────┐
                │                    │                    │
  ┌─────────────────────────┐ ┌──────────────┐     ┌──────────────┐
  │ role_external_mappings  │ │  user_roles  │     │  pat_roles   │
  ├─────────────────────────┤ ├──────────────┤     ├──────────────┤
  │ role_name (PK,FK)       │ │ id (PK,UUID) │◄────│user_role_id  │
  │ external_role (PK)      │ │ user_id (FK) │     │  (FK)        │
  └─────────────────────────┘ │ role_name(FK)│     │ user_name(FK)│
        ▲                     │ assigned_by  │     │ token_name   │
        │                     │ assigned_at  │     │ assigned_by  │
        │                     └──────────────┘     │ assigned_at  │
  (IDP role lookup)                  ▲             └──────────────┘
                                     │                    ▲
                                     │                    │
                                     │             ┌──────────────────┐
                                     │             │  access_token    │
                                     │             ├──────────────────┤
                                     │             │ user_name(PK,FK) │
                                     │             │ token_name (PK)  │
                                     │             │ access_token     │
                                     │             │ expires_at       │
                                     │             │ description      │
                                     │             │ last_seen_at     │
                                     │             └──────────────────┘
                                     │                    │
                                     │                    │ N:1 (FK)
                                     │                    ▼
              ┌──────────────────────┴────────────────────────────────┐
              │                        users                          │
              ├───────────────────────────────────────────────────────┤
              │ id (PK)                                               │
              │ created_at, created_by                                │
              └───────────────────────────────────────────────────────┘
                     ▲                                        ▲
                     │ 1:1                                    │ 1:1
                     │                                        │
              ┌──────────────┐                         ┌──────────────┐
              │   profile    │                         │     ueks     │
              ├──────────────┤                         ├──────────────┤
              │ user_name(FK)│                         │ uid (FK)     │
              │ ...          │                         │ keys         │
              └──────────────┘                         └──────────────┘

    - PAT roles reference user_roles.id via FK (ON DELETE CASCADE)
    - When a user loses a role, all PAT roles referencing it are auto-deleted
    - access_token.user_name references users.id (ON DELETE CASCADE)
    - Profile and ueks have 1:1 foreign key to users (ON DELETE CASCADE)
    - user_roles has N:1 foreign key to users
    - role_external_mappings maps external IDP roles to OSMO roles (many-to-many)
```

### Service Account Workflow

Service accounts (for CI/CD pipelines, automation, etc.) follow the same pattern as regular users. PATs automatically inherit all roles from the user at creation time.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      SERVICE ACCOUNT CREATION FLOW                           │
└─────────────────────────────────────────────────────────────────────────────┘

  Step 1: Create a user for the service account
  ──────────────────────────────────────────────
    POST /api/auth/user
    {
      "id": "ci-pipeline@myorg.local",
      "roles": ["osmo-user", "osmo-ml-team"]  // Optional: assign roles during creation
    }

  Step 2: (Optional) Assign additional roles to the service account user
  ───────────────────────────────────────────────────────────────────────
    POST /api/auth/user/ci-pipeline@myorg.local/roles
    {
      "role_name": "osmo-admin"
    }

  Step 3: Create a PAT for programmatic access (admin creates for user)
  ─────────────────────────────────────────────────────────────────────
    POST /api/auth/user/ci-pipeline@myorg.local/access_token/ci-token
    ?expires_at=2027-01-01&description=CI%20Pipeline%20Token

    The PAT automatically inherits all of the user's current roles.

  Usage: Use the PAT for API authentication
  ─────────────────────────────────────────
    curl -H "Authorization: Bearer <PAT>" https://osmo.example.com/api/workflow
```

**Benefits of this approach:**

1. **Simplified role management** — PATs inherit user roles automatically at creation
2. **Unified user model** — Service accounts are just users, simplifying role management
3. **Centralized user roles** — User roles define the permissions for all PATs
4. **Admin-created PATs** — Admins can create PATs for any user via the admin API
5. **Easy rotation** — Create new PAT (inherits current roles), delete old PAT

> **Note**: PAT roles cannot be added after creation. However, when a role is removed from a user, it is also automatically removed from all of that user's PATs. This ensures PATs cannot have roles that the user no longer has.

---

## User Management APIs

The User Management APIs follow SCIM-inspired patterns. All endpoints are under the `/api/auth/` prefix.

### API Summary

| Endpoint | Method | Action Required | Description |
|----------|--------|-----------------|-------------|
| `/api/auth/user` | GET | `user:List` | List users with filtering |
| `/api/auth/user` | POST | `user:Create` | Create a new user |
| `/api/auth/user/{id}` | GET | `user:Read` | Get user details with roles |
| `/api/auth/user/{id}` | DELETE | `user:Delete` | Delete user |

### List Users

```
GET /api/auth/user
```

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `start_index` | integer | Pagination start (1-based, default: 1) |
| `count` | integer | Results per page (default: 100, max: 1000) |
| `id_prefix` | string | Filter users whose ID starts with this prefix |
| `roles` | list | Filter users who have ANY of these roles (use multiple params: `?roles=admin&roles=user`) |

**Response:**
```json
{
  "total_results": 42,
  "start_index": 1,
  "items_per_page": 100,
  "users": [
    {
      "id": "user@example.com",
      "created_at": "2026-01-15T10:30:00Z",
      "created_by": "admin@example.com"
    }
  ]
}
```

### Create User

```
POST /api/auth/user
```

**Request Body:**
```json
{
  "id": "newuser@example.com",
  "roles": ["osmo-user"]
}
```

The `roles` field is optional and provides a convenient way to assign initial roles during user creation.

**Response:** `201 Created`
```json
{
  "id": "newuser@example.com",
  "created_at": "2026-02-03T14:30:00Z",
  "created_by": "admin@example.com"
}
```

### Get User

```
GET /api/auth/user/{id}
```

**Response:**
```json
{
  "id": "user@example.com",
  "created_at": "2026-01-15T10:30:00Z",
  "created_by": "system",
  "roles": [
    {
      "role_name": "osmo-user",
      "assigned_by": "admin@example.com",
      "assigned_at": "2026-01-15T10:30:00Z"
    }
  ]
}
```

### Delete User

```
DELETE /api/auth/user/{id}
```

Deletes the user and all associated data (role assignments, PATs, profile, encryption keys) via cascading foreign keys. Does NOT delete:
- Workflows submitted by the user
- Audit logs

**Response:** `204 No Content`

---

## Role Assignment APIs

These APIs manage the `user_roles` table. All endpoints are under the `/api/auth/` prefix.

### API Summary

| Endpoint | Method | Action | Description |
|----------|--------|--------|-------------|
| `/api/auth/user/{id}/roles` | GET | `role:Read` | List user's roles |
| `/api/auth/user/{id}/roles` | POST | `role:Manage` | Assign role to user |
| `/api/auth/user/{id}/roles/{role}` | DELETE | `role:Manage` | Remove role from user |
| `/api/auth/roles/{name}/users` | GET | `role:Read` | List users with role |
| `/api/auth/roles/{name}/users` | POST | `role:Manage` | Bulk assign role to users |

### List User Roles

```
GET /api/auth/user/{id}/roles
```

**Response:**
```json
{
  "user_id": "user@example.com",
  "roles": [
    {
      "role_name": "osmo-user",
      "assigned_by": "admin@example.com",
      "assigned_at": "2026-01-15T10:30:00Z"
    },
    {
      "role_name": "osmo-ml-team",
      "assigned_by": "admin@example.com",
      "assigned_at": "2026-01-20T09:00:00Z"
    }
  ]
}
```

### Assign Role to User

```
POST /api/auth/user/{id}/roles
```

**Request Body:**
```json
{
  "role_name": "osmo-ml-team"
}
```

**Response:** `201 Created`
```json
{
  "user_id": "user@example.com",
  "role_name": "osmo-ml-team",
  "assigned_by": "admin@example.com",
  "assigned_at": "2026-02-03T14:30:00Z"
}
```

**Idempotent behavior:** If the role is already assigned, the operation succeeds and returns the existing assignment.

### Remove Role from User

```
DELETE /api/auth/user/{id}/roles/{role_name}
```

Removes the role from the user **and from all PATs owned by that user**. This ensures PATs cannot have roles that the user no longer has.

**Response:** `204 No Content`

### List Users with Role

```
GET /api/auth/roles/{role_name}/users
```

**Response:**
```json
{
  "role_name": "osmo-ml-team",
  "users": [
    {
      "user_id": "user1@example.com",
      "assigned_by": "admin@example.com",
      "assigned_at": "2026-01-15T10:30:00Z"
    },
    {
      "user_id": "ci-pipeline@myorg.local",
      "assigned_by": "admin@example.com",
      "assigned_at": "2026-01-20T09:00:00Z"
    }
  ]
}
```

### Bulk Role Assignment

```
POST /api/auth/roles/{role_name}/users
```

**Request Body:**
```json
{
  "user_ids": [
    "user1@example.com",
    "user2@example.com",
    "ci-pipeline@myorg.local"
  ]
}
```

**Response:**
```json
{
  "role_name": "osmo-ml-team",
  "assigned": ["user1@example.com", "ci-pipeline@myorg.local"],
  "already_assigned": ["user2@example.com"],
  "failed": []
}
```

---

## Access Token (PAT) APIs

These APIs manage Personal Access Tokens. All endpoints are under the `/api/auth/` prefix.

### API Summary

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/access_token/{token_name}` | POST | Create a PAT for the authenticated user |
| `/api/auth/access_token/{token_name}` | DELETE | Delete a PAT |
| `/api/auth/access_token` | GET | List all PATs for the authenticated user |
| `/api/auth/user/{user_id}/access_token/{token_name}` | POST | **Admin API**: Create a PAT for any user |
| `/api/auth/user/{user_id}/access_token` | GET | **Admin API**: List all PATs for any user |
| `/api/auth/user/{user_id}/access_token/{token_name}` | DELETE | **Admin API**: Delete any user's PAT |

### Create Access Token (Self)

```
POST /api/auth/access_token/{token_name}?expires_at=YYYY-MM-DD&description=...&roles=role1&roles=role2
```

Creates a PAT for the authenticated user.

**Role Assignment Behavior:**
- If `roles` is not specified: The token inherits **all** of the user's current roles from `user_roles`
- If `roles` is specified: The token is assigned only the specified roles (must be a subset of the user's roles)
- At least one role must be assigned to the token
- Role validation is atomic — if any specified role is not assigned to the user, the entire operation fails

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `expires_at` | string | Yes | Expiration date in YYYY-MM-DD format |
| `description` | string | No | Optional description for the token |
| `roles` | list | No | Roles to assign (multiple params: `?roles=admin&roles=user`). If omitted, inherits all user roles. |

**Response:** The generated access token string (store securely, shown only once)

**Error Cases:**
- `400 Bad Request` — If any specified role is not assigned to the user
- `400 Bad Request` — If the resulting role list is empty

### Create Access Token (Admin)

```
POST /api/auth/user/{user_id}/access_token/{token_name}?expires_at=YYYY-MM-DD&description=...
```

Admin API to create a PAT for any user. The token inherits the target user's roles, and the `assigned_by` field records the admin who created the token.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `user_id` | string | The user ID to create the token for |
| `token_name` | string | Name for the access token |

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `expires_at` | string | Yes | Expiration date in YYYY-MM-DD format |
| `description` | string | No | Optional description for the token |
| `roles` | list | No | Roles to assign (multiple params: `?roles=admin&roles=user`). If omitted, inherits all target user's roles. |

**Response:** The generated access token string

### Delete Access Token (Self)

```
DELETE /api/auth/access_token/{token_name}
```

Deletes a PAT owned by the authenticated user.

**Response:** `204 No Content`

### Delete Access Token (Admin)

```
DELETE /api/auth/user/{user_id}/access_token/{token_name}
```

Admin API to delete any user's PAT.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `user_id` | string | The user ID who owns the token |
| `token_name` | string | Name of the access token to delete |

**Response:** `204 No Content`

### List Access Tokens (Self)

```
GET /api/auth/access_token
```

Lists all PATs owned by the authenticated user.

**Response:**
```json
[
  {
    "user_name": "user@example.com",
    "token_name": "my-token",
    "expires_at": "2027-01-01T00:00:00Z",
    "description": "CI Pipeline Token"
  }
]
```

### List Access Tokens (Admin)

```
GET /api/auth/user/{user_id}/access_token
```

Admin API to list all PATs for any user.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `user_id` | string | The user ID to list tokens for |

**Response:**
```json
[
  {
    "user_name": "target-user@example.com",
    "token_name": "user-token",
    "expires_at": "2027-01-01T00:00:00Z",
    "description": "User's token"
  }
]
```

> **Note**: The actual access token value is never returned after creation for security reasons.

---

## Role Resolution

When a request comes in, the authorization middleware resolves roles based on how the user authenticated.

### Resolution Order

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           ROLE RESOLUTION FLOW                               │
└─────────────────────────────────────────────────────────────────────────────┘

  Request with JWT or PAT
           │
           ▼
  ┌────────────────────────────────────────────────────────────────────────┐
  │ Step 1: Identify Authentication Method                                 │
  │                                                                        │
  │   JWT Token (browser/IDP flow):                                        │
  │     auth_type = JWT                                                    │
  │     user_id = user_claim (e.g., preferred_username, email)             │
  │                                                                        │
  │   PAT (programmatic access):                                           │
  │     auth_type = PAT                                                    │
  │     user_name = access_token.user_name                                 │
  │     token_name = access_token.token_name                               │
  └────────────────────────────────────────────────────────────────────────┘
           │
           ▼
  ┌────────────────────────────────────────────────────────────────────────┐
  │ Step 2: Collect Roles Based on Auth Type                               │
  │                                                                        │
  │   IF auth_type = JWT:                                                  │
  │     Source 1: IDP Claims (mapped via role_external_mappings)           │
  │       external_roles = x-osmo-roles header OR token.groups/roles       │
  │       roles += SELECT role_name FROM role_external_mappings            │
  │                WHERE external_role IN (external_roles)                 │
  │                AND sync_mode != 'ignore'                               │
  │                                                                        │
  │     Source 2: user_roles table                                         │
  │       SELECT role_name FROM user_roles WHERE user_id = ?               │
  │                                                                        │
  │     Source 3: Forced roles (sync_mode = 'force')                       │
  │       SELECT name FROM roles WHERE sync_mode = 'force'                 │
  │                                                                        │
  │   IF auth_type = PAT:                                                  │
  │     Source: pat_roles joined with user_roles                           │
  │       SELECT ur.role_name FROM pat_roles pr                            │
  │       JOIN user_roles ur ON pr.user_role_id = ur.id                    │
  │       WHERE pr.user_name = ? AND pr.token_name = ?                     │
  │                                                                        │
  │   Source 4: Default roles (based on authentication status)             │
  │     Unauthenticated: [osmo-default]                                    │
  │     Authenticated: [osmo-user] (if configured)                         │
  └────────────────────────────────────────────────────────────────────────┘
           │
           ▼
  ┌────────────────────────────────────────────────────────────────────────┐
  │ Step 3: Deduplicate and Return                                         │
  │                                                                        │
  │   roles = unique(all sources)                                          │
  └────────────────────────────────────────────────────────────────────────┘
```

**Key Differences:**
- **JWT users** get roles from `user_roles` (all roles assigned to the user) plus IDP roles mapped via `role_external_mappings`
- **PAT users** get roles from `pat_roles` (subset of user's roles assigned to this specific token)
- **External role mapping** translates IDP role names to OSMO role names, enabling integration with IDPs that use different naming conventions

---

## SCIM Compatibility

The API design follows SCIM 2.0 patterns to enable future integration with SCIM-enabled identity providers.

### SCIM Mapping

| OSMO Concept | SCIM Resource | Notes |
|--------------|---------------|-------|
| User | `/Users` | Core user resource (includes service accounts) |
| Role Assignment | Extension or `/Groups` | Can be modeled as group membership |

### Future SCIM Endpoint Structure

When SCIM is implemented, it will be available under `/scim/v2/`:

```
/scim/v2/Users              - SCIM User operations
/scim/v2/Groups             - SCIM Group operations (role assignments)
/scim/v2/ServiceProviderConfig
/scim/v2/ResourceTypes
/scim/v2/Schemas
```

### SCIM User Schema Mapping

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "id": "user@example.com",
  "userName": "user@example.com",
  "active": true,
  "meta": {
    "resourceType": "User",
    "created": "2026-01-15T10:30:00Z"
  }
}
```

> **Note**: The `active` field is always `true` for existing users. OSMO does not support deactivating users; to revoke access, delete the user. Fields like `displayName`, `emails`, `externalId`, and `lastModified` are not stored in OSMO as user identity information is managed by the IDP.

### Design Decisions for SCIM Compatibility

1. **User ID as username** — SCIM uses `id` as the primary identifier. By using the IDP username as our `users.id`, we maintain consistency.

2. **Idempotent operations** — SCIM requires idempotent PUT operations, which our API supports.

3. **Filtering** — The `id_prefix` and `roles` query parameters enable common filtering operations.

4. **Active field** — SCIM's `active` boolean will always be `true` for existing users. To deactivate a user, delete them from OSMO.

---

### Breaking Changes

1. **SERVICE tokens removed** — All SERVICE type access tokens are deleted during migration
2. **Token roles column removed** — Roles are now stored in the `pat_roles` table
3. **access_type column removed** — All tokens are now Personal Access Tokens (PATs)
4. **Foreign key constraints** — Profile and ueks entries without a corresponding user are deleted

---

## Security Considerations

### Authorization for User Management

| Action | Required Permission | Notes |
|--------|---------------------|-------|
| List users | `user:List` | Included in `osmo-admin` |
| Create user | `user:Create` | Included in `osmo-admin` |
| Read user | `user:Read` | Users can read their own record |
| Delete user | `user:Delete` | Included in `osmo-admin` |
| Manage roles | `role:Manage` | Fine-grained by resource pattern |

### Self-Service Restrictions

Users can perform limited operations on their own tokens:

- **Allowed**: Create PATs for themselves, list own PATs, delete own PATs
- **Not allowed**: Assign roles, view other users, delete own account, create PATs for other users

### Audit Logging

All user management and role assignment operations should be logged:

```json
{
  "timestamp": "2026-02-03T14:30:00Z",
  "actor": "admin@example.com",
  "action": "user:Create",
  "resource": "user/newuser@example.com",
  "details": {
    "display_name": "New User",
    "roles_assigned": ["osmo-user"]
  }
}
```

---

## Open Questions

1. **Should we support user groups?**
   - Groups would enable bulk role assignment
   - Implementation deferred to future work
   - Schema can be extended to add a `groups` table and `group_roles` table

2. ~~**How to handle existing SERVICE access tokens during migration?**~~
   - **RESOLVED**: SERVICE tokens are deleted during migration. Service accounts should be recreated as regular users with PATs.

---

## Action Registry Additions

Add the following actions to the authorization middleware:

| Action | Path Pattern | Methods |
|--------|--------------|---------|
| `user:List` | `/api/auth/user` | GET |
| `user:Create` | `/api/auth/user` | POST |
| `user:Read` | `/api/auth/user/*` | GET |
| `user:Delete` | `/api/auth/user/*` | DELETE |
| `role:Read` | `/api/auth/user/*/roles` | GET |
| `role:Read` | `/api/auth/roles/*/users` | GET |
| `role:Manage` | `/api/auth/user/*/roles` | POST |
| `role:Manage` | `/api/auth/user/*/roles/*` | DELETE |
| `role:Manage` | `/api/auth/roles/*/users` | POST |
| `token:Create` | `/api/auth/access_token/*` | POST |
| `token:Delete` | `/api/auth/access_token/*` | DELETE |
| `token:List` | `/api/auth/access_token` | GET |
| `token:AdminCreate` | `/api/auth/user/*/access_token/*` | POST |

---

## Implementation Status

This design has been implemented:

- [x] Database migration (`migration/6_0_2.sql`)
- [x] Users table with foreign key relationships
- [x] User roles table
- [x] PAT roles table
- [x] Access token schema updates (removed `access_type`, `roles`; added `last_seen_at`)
- [x] Roles table `sync_mode` column
- [x] Role external mappings table (IDP role name → OSMO role mapping)
- [x] User Management APIs (`/api/auth/user/*`)
- [x] Role Assignment APIs (`/api/auth/user/*/roles`, `/api/auth/roles/*/users`)
- [x] Access Token APIs (`/api/auth/access_token/*`)
- [x] Admin API for creating PATs for any user
- [x] Authorization middleware role synchronization with sync_mode

## Next Steps

1. **Add tests** for all new APIs
2. **Document** user-facing APIs and migration guide

## Implementation Notes

### Just-in-Time User Provisioning

Users are automatically provisioned on first access via the `upsert_user` function in `postgres.py`. This function creates a new user record if the user doesn't exist.

This is called from the `AccessControlMiddleware`, ensuring users are created when they first access the system.

### Role Synchronization from IDP

The `AccessControlMiddleware` synchronizes user roles from IDP headers on each request via the `sync_user_roles` function. The process involves two steps:

#### Step 1: External Role Mapping

When roles arrive from the IDP (via the `x-osmo-roles` header or JWT claims), they are first translated to OSMO roles using the `role_external_mappings` table:

```
IDP sends: ["LDAP_ML_TEAM", "ad-developers"]
                    │
                    ▼
    ┌─────────────────────────────────────┐
    │     role_external_mappings          │
    ├─────────────────────────────────────┤
    │ LDAP_ML_TEAM    → osmo-ml-team      │
    │ ad-developers   → osmo-user         │
    │ ad-developers   → osmo-dev-team     │
    └─────────────────────────────────────┘
                    │
                    ▼
Resolved OSMO roles: ["osmo-ml-team", "osmo-user", "osmo-dev-team"]
```

This mapping enables:
- **Different naming conventions** — Map LDAP/AD group names to OSMO role names
- **Role consolidation** — Map multiple IDP roles to a single OSMO role
- **Role expansion** — Map one IDP role to multiple OSMO roles

#### Step 2: Sync Mode Application

After mapping, the behavior depends on each role's `sync_mode`:

| Sync Mode | IDP has role | User has role | Action |
|-----------|--------------|---------------|--------|
| `ignore`  | -            | -             | No action (role is managed manually) |
| `import`  | Yes          | No            | Add role to user |
| `import`  | No           | Yes           | No action (keep existing role) |
| `force`   | Yes          | No            | Add role to user |
| `force`   | No           | Yes           | **Remove role from user** |

**Key Behaviors:**
- **ignore**: The role is never modified by IDP sync. Use this for manually assigned roles.
- **import**: Roles are added from IDP but never removed. Useful for accumulating roles from different sources.
- **force**: The user's roles exactly match what the IDP provides. If the IDP stops providing a role, it is removed.

**Example:** If a role `osmo-team-lead` has `sync_mode = 'force'`, and a user logs in without that role in their IDP claims (after external mapping), the role will be removed from their `user_roles` mapping.

#### Default External Mappings

During migration, each existing role automatically gets a 1:1 mapping where the external role name equals the OSMO role name. This ensures backward compatibility — if your IDP already sends role names that match OSMO role names, no additional configuration is needed.

### CLI Commands

The `osmo user` CLI provides the following commands:

- `osmo user list` — List all users with optional filtering
- `osmo user create <user_id>` — Create a new user with optional roles
- `osmo user get <user_id>` — Get user details including roles
- `osmo user update <user_id>` — Add or remove roles from a user (uses role assignment APIs, not PUT/PATCH)
- `osmo user delete <user_id>` — Delete a user

The `osmo token` CLI has been updated:
- Removed service token functionality
- Added `--user` flag for admin operations on other users' tokens

### Role Removal Cascading

When a role is removed from a user (via CLI or API), the role is also automatically removed from all PATs owned by that user. This ensures that:
- PATs cannot retain roles that the user no longer has
- Role revocation is immediate and complete
- No manual cleanup of PAT roles is required
