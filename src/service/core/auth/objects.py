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
from src.utils import auth, connectors


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
        """Fetches access tokens with their roles for a user."""
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
        """Create an entry in the access token table and assign roles via access_token_roles.

        This operation is atomic - the role validation and all inserts happen in a
        single SQL transaction. If any requested role is not assigned to the user
        in the user_roles table at the moment of insert, the entire operation fails
        and no token is created.
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
        max_token_duration = database.get_service_configs().service_auth.max_token_duration
        max_date = current_date + common.to_timedelta(max_token_duration)
        if expires_date.date() > max_date:
            raise osmo_errors.OSMOUserError(
                f'Access token cannot last longer than {max_token_duration}')

        if not roles:
            raise osmo_errors.OSMOUserError(
                'At least one role must be specified for the access token.')

        now = datetime.datetime.now(datetime.timezone.utc)
        hashed_token = auth.hash_access_token(access_token)

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

    @classmethod
    def validate_access_token(cls, database: connectors.PostgresConnector, access_token: str) \
        -> Optional['AccessToken']:
        """Validate the access token."""
        fetch_cmd = '''
            SELECT user_name, token_name, expires_at, description
            FROM access_token WHERE access_token = %s;
        '''
        spec_rows = database.execute_fetch_command(
            fetch_cmd, (auth.hash_access_token(access_token),), True)
        if not spec_rows:
            return None
        return AccessToken(**spec_rows[0])

    @classmethod
    def get_roles_for_token(cls, database: connectors.PostgresConnector,
                            user_name: str, token_name: str) -> List[str]:
        """
        Get the roles assigned to a access_token by joining access_token_roles with user_roles.
        """
        fetch_cmd = '''
            SELECT ur.role_name
            FROM access_token_roles pr
            JOIN user_roles ur ON pr.user_role_id = ur.id
            WHERE pr.user_name = %s AND pr.token_name = %s
            ORDER BY ur.role_name;
        '''
        rows = database.execute_fetch_command(fetch_cmd, (user_name, token_name), True)
        return [row['role_name'] for row in rows]


class AccessTokenWithRoles(AccessToken):
    """Access Token with roles."""
    roles: List[str] = []


# =============================================================================
# User Management Objects
# =============================================================================

class UserRole(pydantic.BaseModel):
    """User role assignment."""
    role_name: str
    assigned_by: str
    assigned_at: datetime.datetime


class User(pydantic.BaseModel):
    """User record."""
    id: str
    created_at: Optional[datetime.datetime] = None
    created_by: Optional[str] = None


class UserWithRoles(User):
    """User record with role assignments."""
    roles: List[UserRole] = []


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
    """Access token role assignment."""
    role_name: str
    assigned_by: str
    assigned_at: datetime.datetime


class AccessTokenRolesResponse(pydantic.BaseModel):
    """Response for listing access token roles."""
    user_name: str
    token_name: str
    roles: List[AccessTokenRole]
