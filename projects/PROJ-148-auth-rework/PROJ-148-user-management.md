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

This document describes the design for adding user management to OSMO, including a `users` table, a unified `principal_roles` table for role assignments, and SCIM-compatible APIs for user management.

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

Both types of users can have Personal Access Tokens (PATs) for API access. PATs inherit roles from their owning user.

```sql
CREATE TABLE users (
    -- Primary identifier (IDP username or service account name)
    id TEXT PRIMARY KEY,

    -- Display name (from IDP claims or set manually)
    display_name TEXT,

    -- Email address (from IDP claims or set manually)
    email TEXT,

    -- External IDP identifier (for SCIM sync)
    external_id TEXT,

    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_by TEXT,  -- Username of who created this record
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMP WITH TIME ZONE
);

-- Index for email lookups (common in SCIM)
CREATE INDEX idx_users_email ON users(email);

-- Index for external ID lookups (SCIM sync)
CREATE INDEX idx_users_external_id ON users(external_id);
```

### User Roles Table

Maps users to roles. These are the maximum roles a user can have; PATs can use a subset.

```sql
CREATE TABLE user_roles (
    -- Auto-generated ID for easier reference
    id SERIAL PRIMARY KEY,

    -- User ID (references users.id)
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Role name (references roles.name)
    role_name TEXT NOT NULL REFERENCES roles(name) ON DELETE CASCADE,

    -- Audit metadata
    assigned_by TEXT NOT NULL,  -- Who assigned this role
    assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    -- Unique constraint prevents duplicate assignments
    UNIQUE(user_id, role_name)
);

-- Index for fast user lookups (most common query)
CREATE INDEX idx_user_roles_user ON user_roles(user_id);

-- Index for role-centric queries ("who has this role?")
CREATE INDEX idx_user_roles_role ON user_roles(role_name);
```

### PAT Roles Table

Maps Personal Access Tokens to roles. PAT roles must be a **subset** of the owning user's roles.

```sql
CREATE TABLE pat_roles (
    -- Auto-generated ID for easier reference
    id SERIAL PRIMARY KEY,

    -- Token identifier (references access_token)
    user_name TEXT NOT NULL,
    token_name TEXT NOT NULL,

    -- Role name (references roles.name)
    role_name TEXT NOT NULL REFERENCES roles(name) ON DELETE CASCADE,

    -- Audit metadata
    assigned_by TEXT NOT NULL,  -- Who assigned this role
    assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    -- Unique constraint prevents duplicate assignments
    UNIQUE(user_name, token_name, role_name),

    -- Foreign key to access_token
    FOREIGN KEY (user_name, token_name) REFERENCES access_token(user_name, token_name) ON DELETE CASCADE
);

-- Index for fast token lookups
CREATE INDEX idx_pat_roles_token ON pat_roles(user_name, token_name);

-- Index for role-centric queries
CREATE INDEX idx_pat_roles_role ON pat_roles(role_name);
```

**Validation Rule**: When assigning a role to a PAT, the system must verify:
```sql
-- Role must exist in user_roles for the token owner
SELECT 1 FROM user_roles
WHERE user_id = :user_name AND role_name = :role_name
```

If the user loses a role, all PATs owned by that user automatically lose that role too (enforced via application logic or triggers).

### Schema Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         DATABASE SCHEMA RELATIONSHIPS                        │
└─────────────────────────────────────────────────────────────────────────────┘

    ┌──────────────┐       ┌──────────────┐       ┌──────────────┐
    │    users     │       │  user_roles  │       │    roles     │
    ├──────────────┤       ├──────────────┤       ├──────────────┤
    │ id (PK)      │◄──────│ user_id (FK) │       │ name (PK)    │
    │ display_name │       │ role_name(FK)│──────►│ description  │
    │ email        │       │ assigned_by  │       │ policies     │
    │ external_id  │       │ assigned_at  │       │ immutable    │
    │ created_at   │       └──────────────┘       └──────────────┘
    │ created_by   │              ▲                      ▲
    │ updated_at   │              │ (subset)             │
    │ last_login_at│              │                      │
    └──────────────┘       ┌──────────────┐              │
           │               │  pat_roles   │              │
           │               ├──────────────┤              │
           │               │ user_name(FK)│              │
           │               │ token_name   │              │
           │ 1:N           │ role_name(FK)│──────────────┘
           │               │ assigned_by  │
           ▼               │ assigned_at  │
    ┌──────────────────┐   └──────────────┘
    │  access_token    │          ▲
    ├──────────────────┤          │
    │ user_name (PK,FK)│──────────┘
    │ token_name (PK)  │
    │ access_token     │
    │ expires_at       │
    │ description      │
    │ roles (DEPRECATED)│  ◄── To be removed
    └──────────────────┘

    PAT roles must be a SUBSET of the owning user's roles
```

### Service Account Workflow

Service accounts (for CI/CD pipelines, automation, etc.) follow the same pattern as regular users:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      SERVICE ACCOUNT CREATION FLOW                           │
└─────────────────────────────────────────────────────────────────────────────┘

  Step 1: Create a user for the service account
  ──────────────────────────────────────────────
    POST /api/users
    {
      "id": "ci-pipeline@myorg.local",
      "display_name": "CI Pipeline Service Account"
    }

  Step 2: Assign roles to the service account user
  ────────────────────────────────────────────────
    POST /api/users/ci-pipeline@myorg.local/roles
    {
      "role_name": "osmo-user"
    }

    POST /api/users/ci-pipeline@myorg.local/roles
    {
      "role_name": "osmo-ml-team"
    }

  Step 3: Create a PAT for programmatic access
  ────────────────────────────────────────────
    POST /api/auth/access_token/user/ci-pipeline-token
    (authenticated as admin or the service account user)

  Step 4: Assign roles to the PAT (subset of user's roles)
  ────────────────────────────────────────────────────────
    POST /api/access-tokens/ci-pipeline-token/roles
    {
      "role_name": "osmo-user"  // Must be one of the user's roles
    }

    // NOT assigning osmo-ml-team - this PAT has limited access

  Usage: Use the PAT for API authentication
  ─────────────────────────────────────────
    curl -H "Authorization: Bearer <PAT>" https://osmo.example.com/api/workflow
```

**Benefits of this approach:**

1. **Principle of least privilege** — PATs can have fewer roles than the user
2. **Unified user model** — Service accounts are just users, simplifying role management
3. **Centralized user roles** — User roles define the maximum permissions available
4. **Granular PAT access** — Different PATs can have different role subsets
5. **Easy rotation** — Create new PAT with same roles, delete old PAT

---

## User Management APIs

The User Management APIs follow SCIM-inspired patterns to enable future SCIM integration. All endpoints require the `user:Manage` action unless otherwise noted.

### API Summary

| Endpoint | Method | Action Required | Description |
|----------|--------|-----------------|-------------|
| `/api/users` | GET | `user:List` | List users with filtering |
| `/api/users` | POST | `user:Create` | Create a new user |
| `/api/users/{id}` | GET | `user:Read` | Get user details |
| `/api/users/{id}` | PUT | `user:Update` | Replace user (full update) |
| `/api/users/{id}` | PATCH | `user:Update` | Partial user update |
| `/api/users/{id}` | DELETE | `user:Delete` | Delete user |
| `/api/users/me` | GET | (authenticated) | Get current user's details |

### List Users

```
GET /api/users
```

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `filter` | string | SCIM-style filter (e.g., `email eq "user@example.com"`) |
| `start_index` | integer | Pagination start (1-based, default: 1) |
| `count` | integer | Results per page (default: 100, max: 1000) |

**Response:**
```json
{
  "total_results": 42,
  "start_index": 1,
  "items_per_page": 100,
  "users": [
    {
      "id": "user@example.com",
      "display_name": "John Doe",
      "email": "user@example.com",
      "external_id": "abc123",
      "created_at": "2026-01-15T10:30:00Z",
      "last_login_at": "2026-02-01T08:00:00Z"
    }
  ]
}
```

### Create User

```
POST /api/users
```

**Request Body:**
```json
{
  "id": "newuser@example.com",
  "display_name": "New User",
  "email": "newuser@example.com",
  "external_id": "idp-user-123",
  "roles": ["osmo-user"]
}
```

The `roles` field is optional and provides a convenient way to assign initial roles during user creation. This is equivalent to calling the role assignment API after user creation.

**Response:** `201 Created`
```json
{
  "id": "newuser@example.com",
  "display_name": "New User",
  "email": "newuser@example.com",
  "external_id": "idp-user-123",
  "created_at": "2026-02-03T14:30:00Z",
  "created_by": "admin@example.com"
}
```

### Get User

```
GET /api/users/{id}
```

**Response:**
```json
{
  "id": "user@example.com",
  "display_name": "John Doe",
  "email": "user@example.com",
  "external_id": "abc123",
  "created_at": "2026-01-15T10:30:00Z",
  "created_by": "system",
  "updated_at": "2026-02-01T08:00:00Z",
  "last_login_at": "2026-02-01T08:00:00Z",
  "roles": [
    {
      "role_name": "osmo-user",
      "assigned_by": "admin@example.com",
      "assigned_at": "2026-01-15T10:30:00Z"
    }
  ]
}
```

### Update User (Full Replace)

```
PUT /api/users/{id}
```

Replaces all mutable fields. Fields not provided are set to null/default.

**Request Body:**
```json
{
  "display_name": "John D. Doe",
  "email": "john.doe@example.com",
  "external_id": "new-idp-id"
}
```

### Update User (Partial)

```
PATCH /api/users/{id}
```

Updates only the provided fields.

**Request Body:**
```json
{
  "display_name": "John Doe Jr."
}
```

### Delete User

```
DELETE /api/users/{id}
```

Deletes the user, all associated role assignments, and all PATs owned by the user. Does NOT delete:
- Workflows submitted by the user
- Audit logs

**Response:** `204 No Content`

### Get Current User

```
GET /api/users/me
```

Returns the current authenticated user's details. Creates a user record if one doesn't exist (just-in-time provisioning).

**Response:** Same as `GET /api/users/{id}`

---

## Role Assignment APIs

These APIs manage the `user_roles` and `pat_roles` tables.

### API Summary

| Endpoint | Method | Action | Description |
|----------|--------|--------|-------------|
| `/api/users/{id}/roles` | GET | `role:Read` | List user's roles |
| `/api/users/{id}/roles` | POST | `role:Manage` | Assign role to user |
| `/api/users/{id}/roles/{role}` | DELETE | `role:Manage` | Remove role from user |
| `/api/roles/{name}/users` | GET | `role:Read` | List users with role |
| `/api/roles/{name}/users` | POST | `role:Manage` | Bulk assign role to users |
| `/api/access-tokens/{name}/roles` | GET | `role:Read` | List PAT's roles |
| `/api/access-tokens/{name}/roles` | POST | `role:Manage` | Assign role to PAT |
| `/api/access-tokens/{name}/roles/{role}` | DELETE | `role:Manage` | Remove role from PAT |

### List User Roles

```
GET /api/users/{id}/roles
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
POST /api/users/{id}/roles
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
DELETE /api/users/{id}/roles/{role_name}
```

**Response:** `204 No Content`

### List Users with Role

```
GET /api/roles/{role_name}/users
```

**Response:**
```json
{
  "role_name": "osmo-ml-team",
  "users": [
    {
      "user_id": "user1@example.com",
      "display_name": "User One",
      "assigned_by": "admin@example.com",
      "assigned_at": "2026-01-15T10:30:00Z"
    },
    {
      "user_id": "ci-pipeline@myorg.local",
      "display_name": "CI Pipeline Service Account",
      "assigned_by": "admin@example.com",
      "assigned_at": "2026-01-20T09:00:00Z"
    }
  ]
}
```

### Bulk Role Assignment

```
POST /api/roles/{role_name}/users
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

### PAT Role APIs

PAT roles must be a subset of the owning user's roles. The system validates this constraint on assignment.

#### List PAT Roles

```
GET /api/access-tokens/{token_name}/roles
```

**Response:**
```json
{
  "user_name": "ci-pipeline@myorg.local",
  "token_name": "ci-pipeline-token",
  "roles": [
    {
      "role_name": "osmo-user",
      "assigned_by": "admin@example.com",
      "assigned_at": "2026-01-15T10:30:00Z"
    }
  ]
}
```

#### Assign Role to PAT

```
POST /api/access-tokens/{token_name}/roles
```

**Request Body:**
```json
{
  "role_name": "osmo-user"
}
```

**Validation:** The role must exist in the owning user's `user_roles`. Returns `400 Bad Request` if the user doesn't have this role.

**Response:** `201 Created`
```json
{
  "user_name": "ci-pipeline@myorg.local",
  "token_name": "ci-pipeline-token",
  "role_name": "osmo-user",
  "assigned_by": "admin@example.com",
  "assigned_at": "2026-02-03T14:30:00Z"
}
```

#### Remove Role from PAT

```
DELETE /api/access-tokens/{token_name}/roles/{role_name}
```

**Response:** `204 No Content`

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
  │     Source 1: JWT Claims (if present)                                  │
  │       roles += token.groups OR token.roles                             │
  │                                                                        │
  │     Source 2: user_roles table                                         │
  │       SELECT role_name FROM user_roles WHERE user_id = ?               │
  │                                                                        │
  │   IF auth_type = PAT:                                                  │
  │     Source: pat_roles table                                            │
  │       SELECT role_name FROM pat_roles                                  │
  │       WHERE user_name = ? AND token_name = ?                           │
  │                                                                        │
  │   Source 3: Default roles (based on authentication status)             │
  │     Unauthenticated: [osmo-default]                                    │
  │     Authenticated: [osmo-user] (if configured)                         │
  │                                                                        │
  │   [DEPRECATED] Source 4: access_token.roles column                     │
  │     Only during migration period                                       │
  └────────────────────────────────────────────────────────────────────────┘
           │
           ▼
  ┌────────────────────────────────────────────────────────────────────────┐
  │ Step 3: Deduplicate and Return                                         │
  │                                                                        │
  │   roles = unique(all sources)                                          │
  └────────────────────────────────────────────────────────────────────────┘
```

**Key Difference:**
- **JWT users** get roles from `user_roles` (all roles assigned to the user)
- **PAT users** get roles from `pat_roles` (subset of user's roles assigned to this specific token)

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
  "displayName": "John Doe",
  "emails": [
    {
      "value": "user@example.com",
      "primary": true
    }
  ],
  "active": true,
  "externalId": "idp-user-123",
  "meta": {
    "resourceType": "User",
    "created": "2026-01-15T10:30:00Z",
    "lastModified": "2026-02-01T08:00:00Z"
  }
}
```

> **Note**: The `active` field is always `true` for existing users. OSMO does not support deactivating users; to revoke access, delete the user.

### Design Decisions for SCIM Compatibility

1. **User ID as username** — SCIM uses `id` as the primary identifier. By using the IDP username as our `users.id`, we maintain consistency.

2. **External ID** — The `external_id` field stores the IDP's internal user identifier, enabling bi-directional sync.

3. **Idempotent operations** — SCIM requires idempotent PUT operations, which our API supports.

4. **Filtering** — The `filter` query parameter supports SCIM filter syntax for common operations.

5. **Active field** — SCIM's `active` boolean will always be `true` for existing users. To deactivate a user, delete them from OSMO.

---

## Migration Strategy

### Phase 1: Add New Tables (Non-Breaking)

1. Create `users` table
2. Create `user_roles` table
3. Create `pat_roles` table
4. Keep `access_token.roles` column functional during migration

```sql
-- Migration script (Phase 1)
BEGIN;

-- Create users table (includes both IDP users and service accounts)
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    display_name TEXT,
    email TEXT,
    external_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_by TEXT,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_external_id ON users(external_id);

-- Create user_roles table (no expiration)
CREATE TABLE IF NOT EXISTS user_roles (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_name TEXT NOT NULL REFERENCES roles(name) ON DELETE CASCADE,
    assigned_by TEXT NOT NULL,
    assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, role_name)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role_name);

-- Create pat_roles table (PAT roles must be subset of user roles)
CREATE TABLE IF NOT EXISTS pat_roles (
    id SERIAL PRIMARY KEY,
    user_name TEXT NOT NULL,
    token_name TEXT NOT NULL,
    role_name TEXT NOT NULL REFERENCES roles(name) ON DELETE CASCADE,
    assigned_by TEXT NOT NULL,
    assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(user_name, token_name, role_name),
    FOREIGN KEY (user_name, token_name) REFERENCES access_token(user_name, token_name) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pat_roles_token ON pat_roles(user_name, token_name);
CREATE INDEX IF NOT EXISTS idx_pat_roles_role ON pat_roles(role_name);

COMMIT;
```

### Phase 2: Populate Users Table

Auto-provision users from:
1. Existing `access_token.user_name` entries (all tokens become PATs)
2. Existing `profile.user_name` entries
3. New logins via just-in-time provisioning

```sql
-- Migration script (Phase 2) - Populate users from existing data
-- Import all access token owners as users
INSERT INTO users (id, created_at, created_by)
SELECT DISTINCT
    user_name,
    NOW(),
    'migration'
FROM access_token
WHERE user_name NOT IN (SELECT id FROM users)
ON CONFLICT (id) DO NOTHING;

-- Import users from profile table
INSERT INTO users (id, created_at, created_by)
SELECT DISTINCT
    user_name,
    NOW(),
    'migration'
FROM profile
WHERE user_name NOT IN (SELECT id FROM users)
ON CONFLICT (id) DO NOTHING;
```

### Phase 3: Migrate Role Assignments

Copy roles from `access_token.roles` to both `user_roles` and `pat_roles`:

```sql
-- Migration script (Phase 3) - Migrate token roles

-- Step 1: Each user gets the union of all roles from their tokens
INSERT INTO user_roles (user_id, role_name, assigned_by)
SELECT DISTINCT
    user_name,
    unnest(roles),
    'migration'
FROM access_token
WHERE roles IS NOT NULL AND array_length(roles, 1) > 0
ON CONFLICT (user_id, role_name) DO NOTHING;

-- Step 2: Each PAT gets the same roles it had before (now in pat_roles)
INSERT INTO pat_roles (user_name, token_name, role_name, assigned_by)
SELECT
    user_name,
    token_name,
    unnest(roles),
    'migration'
FROM access_token
WHERE roles IS NOT NULL AND array_length(roles, 1) > 0
ON CONFLICT (user_name, token_name, role_name) DO NOTHING;
```

### Phase 4: Update Role Resolution

1. Enable dual-read from both `access_token.roles` and `user_roles`
2. Monitor for discrepancies
3. Gradually shift traffic to new table

### Phase 5: Deprecate Legacy Columns

1. Stop writing to `access_token.roles`
2. Remove dual-read logic
3. Drop the `roles` and `access_type` columns

```sql
-- Migration script (Phase 5) - Remove legacy columns
ALTER TABLE access_token DROP COLUMN roles;
ALTER TABLE access_token DROP COLUMN access_type;
```

---

## Security Considerations

### Authorization for User Management

| Action | Required Permission | Notes |
|--------|---------------------|-------|
| List users | `user:List` | Included in `osmo-admin` |
| Create user | `user:Create` | Included in `osmo-admin` |
| Read user | `user:Read` | Users can read their own record |
| Update user | `user:Update` | Users can update limited fields on their own record |
| Delete user | `user:Delete` | Included in `osmo-admin` |
| Manage roles | `role:Manage` | Fine-grained by resource pattern |

### Self-Service Restrictions

Users can access `/api/users/me` and limited operations on their own record:

- **Allowed**: Read own profile, update display_name
- **Not allowed**: Assign roles, view other users, delete own account

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

2. **How to handle existing SERVICE access tokens during migration?**
   - Create users for each unique SERVICE token owner (token_name as user_id)
   - Migrate roles from the token to the new user
   - Convert SERVICE tokens to regular PATs

---

## Action Registry Additions

Add the following actions to the authorization middleware:

| Action | Path Pattern | Methods |
|--------|--------------|---------|
| `user:List` | `/api/users` | GET |
| `user:Create` | `/api/users` | POST |
| `user:Read` | `/api/users/*` | GET |
| `user:Update` | `/api/users/*` | PUT, PATCH |
| `user:Delete` | `/api/users/*` | DELETE |
| `role:Read` | `/api/users/*/roles` | GET |
| `role:Read` | `/api/roles/*/users` | GET |
| `role:Read` | `/api/access-tokens/*/roles` | GET |
| `role:Manage` | `/api/users/*/roles` | POST |
| `role:Manage` | `/api/users/*/roles/*` | DELETE |
| `role:Manage` | `/api/roles/*/users` | POST |
| `role:Manage` | `/api/access-tokens/*/roles` | POST |
| `role:Manage` | `/api/access-tokens/*/roles/*` | DELETE |

---

## Next Steps

1. **Review and approve** this design document
2. **Implement database migrations** (Phase 1)
3. **Implement User Management APIs** with tests
4. **Implement Role Assignment APIs** with tests
5. **Update authorization middleware** for new role resolution
6. **Run migration scripts** (Phase 2-3)
7. **Validate** all existing access patterns unchanged
8. **Deprecate** legacy `access_token.roles` column (Phase 4-5)
9. **Document** user-facing APIs and migration guide
