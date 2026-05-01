"""
SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long

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
"""

import datetime
import re
from typing import List, Optional

import pydantic

from src.lib.utils import common, osmo_errors
from src.utils import auth, configmap_state, connectors


class AccessToken(pydantic.BaseModel):
    """Access Token entry."""
    user_name: str
    token_name: str
    expires_at: datetime.datetime
    description: str

    @classmethod
    def list_from_db(cls, database: connectors.PostgresConnector,
                     user_name: str) -> List['AccessToken']:
        """Fetches the list of access tokens from the access token table for a user."""
        fetch_cmd = '''
            SELECT user_name, token_name, expires_at, description
            FROM access_token WHERE user_name = %s;
        '''
        spec_rows = database.execute_fetch_command(fetch_cmd, (user_name,), True)
        return [AccessToken(**spec_row) for spec_row in spec_rows]

    @classmethod
    def list_with_roles_from_db(cls, database: connectors.PostgresConnector,
                                user_name: str) -> List['AccessTokenWithRoles']:
        """Fetch access tokens with their roles for a user.

        DB mode: roles come from access_token_roles JOINed against
        user_roles (per-token role subsetting is supported here).

        ConfigMap mode: tokens carry the user's full set of declared
        roles from the ConfigMap snapshot. access_token_roles is not
        consulted — the user_roles table is empty in this mode and
        per-token subsetting isn't a feature ConfigMap mode supports.
        """
        if configmap_state.is_configmap_mode():
            fetch_cmd = '''
                SELECT user_name, token_name, expires_at, description
                FROM access_token WHERE user_name = %s
                ORDER BY token_name;
            '''
            spec_rows = database.execute_fetch_command(
                fetch_cmd, (user_name,), True)
            roles = configmap_state.get_declarative_user_roles(user_name) or []
            sorted_roles = sorted(roles)
            return [
                AccessTokenWithRoles(
                    **spec_row,
                    roles=sorted_roles,
                    roles_source='per_user',
                )
                for spec_row in spec_rows
            ]

        fetch_cmd = '''
            SELECT
                at.user_name,
                at.token_name,
                at.expires_at,
                at.description,
                COALESCE(
                    ARRAY_AGG(ur.role_name ORDER BY ur.role_name)
                    FILTER (WHERE ur.role_name IS NOT NULL),
                    ARRAY[]::text[]
                ) as roles
            FROM access_token at
            LEFT JOIN access_token_roles pr ON at.user_name = pr.user_name AND at.token_name = pr.token_name
            LEFT JOIN user_roles ur ON pr.user_role_id = ur.id
            WHERE at.user_name = %s
            GROUP BY at.user_name, at.token_name, at.expires_at, at.description
            ORDER BY at.token_name;
        '''
        spec_rows = database.execute_fetch_command(fetch_cmd, (user_name,), True)
        return [AccessTokenWithRoles(**spec_row) for spec_row in spec_rows]

    @classmethod
    def fetch_from_db(cls, database: connectors.PostgresConnector,
                      token_name: str, user_name: str) -> 'AccessToken':
        """Fetches the access token from the access token table."""
        fetch_cmd = '''
            SELECT user_name, token_name, expires_at, description
            FROM access_token WHERE token_name = %s AND user_name = %s;
        '''
        spec_rows = database.execute_fetch_command(fetch_cmd, (token_name, user_name), True)
        if not spec_rows:
            raise osmo_errors.OSMOUserError(f'Access token {token_name} does not exist.')
        return AccessToken(**spec_rows[0])

    @classmethod
    def delete_from_db(cls, database: connectors.PostgresConnector,
                       token_name: str, user_name: str):
        """Delete an entry from the access token table."""
        cls.fetch_from_db(database, token_name, user_name)
        # access_token_roles will be deleted via ON DELETE CASCADE
        delete_cmd = '''
            DELETE FROM access_token
            WHERE token_name = %s AND user_name = %s;
        '''
        database.execute_commit_command(delete_cmd, (token_name, user_name))

    @classmethod
    def insert_into_db(cls, database: connectors.PostgresConnector, user_name: str,
                       token_name: str, access_token: str, expires_at: str,
                       description: str, roles: List[str], assigned_by: str):
        """Create an access token entry and (in DB mode) assign roles.

        DB mode: a single CTE validates that every requested role is in
        the user's `user_roles` rows AND inserts the token +
        access_token_roles rows atomically. Per-token role subsetting
        is supported here.

        ConfigMap mode: roles aren't stored per-token. The token always
        carries the user's full set of declared roles from the snapshot
        at validation time. The `roles` argument must equal that
        declared set (or be a subset of it for the caller's check) —
        we validate and then INSERT only the access_token row, no
        access_token_roles rows.
        """
        if not re.fullmatch(common.TOKEN_NAME_REGEX, token_name):
            raise osmo_errors.OSMOUserError(
                f'Token name {token_name} must match regex {common.TOKEN_NAME_REGEX}')

        if not common.valid_date_format(expires_at, '%Y-%m-%d'):
            raise osmo_errors.OSMOUserError(
                f'Invalid date format {expires_at}. Date must be in '
                'YYYY-MM-DD format (e.g. 2025-12-31)')

        # Convert YYYY-MM-DD string to datetime and validate it's in the future
        expires_date = common.convert_str_to_time(expires_at, '%Y-%m-%d')
        current_date = datetime.datetime.utcnow().date()
        if expires_date.date() <= current_date:
            raise osmo_errors.OSMOUserError(
                f'Expiration date must be past the current date ({current_date})')

        if not roles:
            raise osmo_errors.OSMOUserError(
                'At least one role must be specified for the access token.')

        now = datetime.datetime.now(datetime.timezone.utc)
        hashed_token = auth.hash_access_token(access_token)

        if configmap_state.is_configmap_mode():
            cls._insert_configmap_mode(
                database, user_name, token_name, hashed_token,
                expires_at, description, roles)
            return

        # Atomic insert with role validation using CTEs
        # The query validates roles and inserts in a single transaction.
        # access_token roles reference user_roles.id via FK, so:
        # - Token is only created if ALL requested roles exist in user_roles
        # - When a user role is later deleted, access_token roles cascade delete automatically
        #
        # The role_check CTE verifies all roles exist before any insert happens.
        # If the count doesn't match, the WHERE clause prevents token creation.
        insert_cmd = '''
            WITH matching_user_roles AS (
                SELECT ur.id as user_role_id, ur.role_name
                FROM user_roles ur
                WHERE ur.user_id = %s AND ur.role_name = ANY(%s::text[])
            ),
            role_check AS (
                SELECT COUNT(*) = %s AS all_roles_found FROM matching_user_roles
            ),
            token_insert AS (
                INSERT INTO access_token
                (user_name, token_name, access_token, expires_at, description)
                SELECT %s, %s, %s, %s, %s
                WHERE (SELECT all_roles_found FROM role_check)
                RETURNING user_name, token_name
            ),
            role_insert AS (
                INSERT INTO access_token_roles (user_name, token_name, user_role_id, assigned_by, assigned_at)
                SELECT ti.user_name, ti.token_name, mur.user_role_id, %s, %s
                FROM token_insert ti
                CROSS JOIN matching_user_roles mur
                RETURNING user_role_id
            )
            SELECT
                (SELECT all_roles_found FROM role_check) as all_roles_found,
                (SELECT COUNT(*) FROM token_insert) as token_created;
        '''
        args = (
            user_name, roles, len(roles),
            user_name, token_name, hashed_token, expires_at, description,
            assigned_by, now
        )

        try:
            result = database.execute_fetch_command(insert_cmd, args, True)
            if result:
                all_roles_found = result[0].get('all_roles_found', False)
                token_created = result[0].get('token_created', 0)
                if not all_roles_found or token_created == 0:
                    raise osmo_errors.OSMOUserError(
                        'User does not have all the requested roles. '
                        'Token creation failed.')
        except osmo_errors.OSMODatabaseError as e:
            error_str = str(e).lower()
            if 'already exists' in error_str or 'duplicate key' in error_str:
                raise osmo_errors.OSMOUserError(
                    f'Token name {token_name} already exists.') from e
            raise

    @staticmethod
    def _insert_configmap_mode(database: connectors.PostgresConnector,
                               user_name: str, token_name: str,
                               hashed_token: bytes, expires_at: str,
                               description: str, roles: List[str]) -> None:
        # ConfigMap mode: tokens carry the user's full declared role set;
        # there's no per-token storage in access_token_roles. We still
        # validate that every requested role is in the user's snapshot
        # entry — that catches admins asking for a role the user doesn't
        # have, even though the token will end up carrying the full set.
        declared = configmap_state.get_declarative_user_roles(user_name)
        if declared is None:
            raise osmo_errors.OSMOUserError(
                f'Cannot mint access token for {user_name}: user is not '
                f'declared in the ConfigMap users: block. IDP users do not '
                f'have OSMO-managed access tokens — use IDP authentication '
                f'instead.')

        declared_set = set(declared)
        missing = [r for r in roles if r not in declared_set]
        if missing:
            raise osmo_errors.OSMOUserError(
                f'User {user_name} does not have role(s) {missing}. '
                f'Token creation failed.')

        insert_token_cmd = '''
            INSERT INTO access_token
            (user_name, token_name, access_token, expires_at, description)
            VALUES (%s, %s, %s, %s, %s);
        '''

        try:
            database.execute_commit_command(
                insert_token_cmd,
                (user_name, token_name, hashed_token, expires_at, description))
        except osmo_errors.OSMODatabaseError as e:
            error_str = str(e).lower()
            if 'already exists' in error_str or 'duplicate key' in error_str:
                raise osmo_errors.OSMOUserError(
                    f'Token name {token_name} already exists.') from e
            raise

    @classmethod
    def validate_access_token(cls, database: connectors.PostgresConnector, access_token: str) \
        -> Optional['AccessToken']:
        """Validate the access token.

        DB mode: hash match against access_token row.

        ConfigMap mode: same hash match, but the token is rejected
        unless the owning user is currently declared in the snapshot's
        users: block. This closes the privilege-expansion-on-flip
        window — a token minted in DB mode for a user who later
        appears in the ConfigMap with broader roles would otherwise
        silently inherit those roles. It also rejects tokens for users
        removed from the ConfigMap, giving operators a single
        revocation primitive (edit users:, redeploy).
        """
        fetch_cmd = '''
            SELECT user_name, token_name, expires_at, description
            FROM access_token WHERE access_token = %s;
        '''
        spec_rows = database.execute_fetch_command(
            fetch_cmd, (auth.hash_access_token(access_token),), True)
        if not spec_rows:
            return None
        token = AccessToken(**spec_rows[0])
        if configmap_state.is_configmap_mode():
            declared = configmap_state.get_declarative_user_roles(token.user_name)
            if declared is None:
                return None
        return token

    @classmethod
    def get_roles_for_token(cls, database: connectors.PostgresConnector,
                            user_name: str, token_name: str) -> List[str]:
        """Return the role names attached to an access token.

        DB mode: roles come from access_token_roles JOINed against
        user_roles, which lets the same user own multiple tokens with
        different role subsets.

        ConfigMap mode: tokens always carry the user's full set of
        declared roles from the snapshot. token_name is unused there —
        every token owned by `user_name` resolves to the same role set.
        """
        if configmap_state.is_configmap_mode():
            roles = configmap_state.get_declarative_user_roles(user_name)
            return sorted(roles) if roles else []

        fetch_cmd = '''
            SELECT ur.role_name
            FROM access_token_roles pr
            JOIN user_roles ur ON pr.user_role_id = ur.id
            WHERE pr.user_name = %s AND pr.token_name = %s
            ORDER BY ur.role_name;
        '''
        rows = database.execute_fetch_command(
            fetch_cmd, (user_name, token_name), True)
        return [row['role_name'] for row in rows]


class AccessTokenWithRoles(AccessToken):
    """Access Token with roles.

    `roles_source` discriminates how the role list was resolved:
    - `per_token`: roles are bound to this specific token (DB mode,
      `access_token_roles` rows). The same user can own multiple tokens
      with different role subsets.
    - `per_user`: roles come from the user's ConfigMap `users:` block,
      so all of the user's tokens carry the same role set in
      ConfigMap mode. Per-token subsetting is not supported.
    """
    roles: List[str] = []
    roles_source: str = 'per_token'


# =============================================================================
# User Management Objects
# =============================================================================

class UserRole(pydantic.BaseModel):
    """User role assignment.

    `assigned_at` is None for ConfigMap-mode users — the binding lives
    in the ConfigMap, not in a per-row timestamped grant.
    """
    role_name: str
    assigned_by: str
    assigned_at: Optional[datetime.datetime] = None


class User(pydantic.BaseModel):
    """User record."""
    id: str
    created_at: Optional[datetime.datetime] = None
    created_by: Optional[str] = None


class UserWithRoles(User):
    """User record with role assignments."""
    roles: List[UserRole] = []


class TokenRequest(pydantic.BaseModel):
    """Request body containing a token for JWT generation."""
    token: str


class CreateUserRequest(pydantic.BaseModel):
    """Request to create a new user."""
    id: str
    roles: Optional[List[str]] = None


class AssignRoleRequest(pydantic.BaseModel):
    """Request to assign a role to a user."""
    role_name: str


class UserRoleAssignment(pydantic.BaseModel):
    """User role assignment response."""
    user_id: str
    role_name: str
    assigned_by: str
    assigned_at: datetime.datetime


class UserListResponse(pydantic.BaseModel):
    """Response for listing users."""
    total_results: int
    start_index: int
    items_per_page: int
    users: List[User]


class UserRolesResponse(pydantic.BaseModel):
    """Response for listing user roles."""
    user_id: str
    roles: List[UserRole]


class RoleUsersResponse(pydantic.BaseModel):
    """Response for listing users with a role."""
    role_name: str
    users: List[dict]


class BulkAssignRequest(pydantic.BaseModel):
    """Request to bulk assign a role to users."""
    user_ids: List[str]


class BulkAssignResponse(pydantic.BaseModel):
    """Response for bulk role assignment."""
    role_name: str
    assigned: List[str]
    already_assigned: List[str]
    failed: List[str]


class AccessTokenRole(pydantic.BaseModel):
    """Access token role assignment.

    `assigned_at` is None for ConfigMap-mode tokens — the binding is
    declarative (ConfigMap users: block), not an explicit per-row grant.
    """
    role_name: str
    assigned_by: str
    assigned_at: Optional[datetime.datetime] = None


class AccessTokenRolesResponse(pydantic.BaseModel):
    """Response for listing access token roles."""
    user_name: str
    token_name: str
    roles: List[AccessTokenRole]


class JwtTokenResponse(pydantic.BaseModel):
    """Response for JWT token creation endpoints."""
    token: str | None = None
    expires_at: int | None = None
    error: str | None = None
