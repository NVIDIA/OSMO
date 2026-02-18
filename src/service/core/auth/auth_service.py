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
import secrets
import time
from typing import List, Optional

import fastapi

from src.lib.utils import common, osmo_errors
from src.utils.job import task as task_lib
from src.service.core.auth import objects
from src.utils import auth, connectors


router = fastapi.APIRouter(
    tags = ['Auth API']
)


# =============================================================================
# Authentication APIs
# =============================================================================

@router.get('/api/auth/login', include_in_schema=False)
def get_login_info() -> auth.LoginInfo:
    postgres = connectors.PostgresConnector.get_instance()
    service_config = postgres.get_service_configs()
    return service_config.service_auth.login_info


@router.get('/api/auth/keys', include_in_schema=False)
def get_keys():
    postgres = connectors.PostgresConnector.get_instance()
    service_config = postgres.get_service_configs()
    return service_config.service_auth.get_keyset()


@router.get('/api/auth/jwt/refresh_token')
def get_new_jwt_token(refresh_token: str, workflow_id: str,
                      group_name: str, task_name: str, retry_id: int = 0):
    """
    API to fetch for a new access token using a refresh token.
    """
    postgres = connectors.PostgresConnector.get_instance()
    service_config = postgres.get_service_configs()

    # Validate refresh token
    fetch_cmd = '''
        SELECT t.*, w.submitted_by
        FROM tasks t
        JOIN workflows w ON t.workflow_id = w.workflow_id
        WHERE t.workflow_id = %s \
        AND t.name = %s AND t.group_name = %s AND t.retry_id = %s;
    '''

    tasks = postgres.execute_fetch_command(fetch_cmd,
                                           (workflow_id, task_name, group_name, retry_id),
                                           True)
    # Check if there exists a task that satisfies these conditions
    if not tasks:
        raise osmo_errors.OSMOUserError(
            f'Workflow {workflow_id} with task {task_name} does not exist')
    task = tasks[0]
    if task['status'] == 'PENDING':
        payload= {'token': None,
                  'expires_at': None,
                  'error': 'PENDING'}
        raise fastapi.HTTPException(status_code=400, detail=payload)

    if task_lib.TaskGroupStatus(task['status']).finished():
        payload= {'token': None,
                  'expires_at': None,
                  'error': 'FINISHED'}
        raise fastapi.HTTPException(status_code=400, detail=payload)

    if task['refresh_token'] is None:
        raise osmo_errors.OSMOUserError(
            f'Workflow {workflow_id} task {task_name} is missing refresh token')
    # Check if the refresh token matches the one stored in the database
    hashed_refresh_token = bytes(task['refresh_token'])
    if auth.hash_access_token(refresh_token) != hashed_refresh_token:
        raise osmo_errors.OSMOUserError(
            f'Workflow {workflow_id} with task {task_name} refresh token is invalid')

    user = task['submitted_by']
    end_timeout = int(time.time() + common.ACCESS_TOKEN_TIMEOUT)
    token = service_config.service_auth.create_idtoken_jwt(end_timeout,
                                                           user,
                                                           service_config.service_auth.ctrl_roles,
                                                           workflow_id=workflow_id)
    return {'token': token,
            'expires_at': end_timeout,
            'error': None}


@router.get('/api/auth/jwt/access_token')
def get_jwt_token_from_access_token(access_token: str):
    """
    API to create a new jwt token from an access token.
    """
    postgres = connectors.PostgresConnector.get_instance()
    token = objects.AccessToken.validate_access_token(postgres, access_token)
    if not token:
        raise osmo_errors.OSMOUserError('Access Token is invalid')

    if token.expires_at.date() <= datetime.datetime.utcnow().date():
        raise osmo_errors.OSMOUserError('Access Token has expired')

    # Get roles from access_token_roles table
    roles = objects.AccessToken.get_roles_for_token(postgres, token.user_name, token.token_name)

    service_config = postgres.get_service_configs()

    end_timeout = int(time.time() + common.ACCESS_TOKEN_TIMEOUT)
    jwt_token = service_config.service_auth.create_idtoken_jwt(end_timeout, token.user_name,
                                                               roles=roles,
                                                               token_name=token.token_name)
    return {'token': jwt_token,
            'expires_at': end_timeout,
            'error': None}


@router.post('/api/auth/access_token/{token_name}')
def create_access_token(token_name: str,
                        expires_at: str,
                        description: str = '',
                        roles: Optional[List[str]] = fastapi.Query(default=None),
                        user_name: str = fastapi.Depends(connectors.parse_username)):
    """
    API to create a new access token.

    If roles are specified, all specified roles must be assigned to the user.
    If any role is not assigned to the user, the request fails and no token
    is created. If no roles are specified, the access token inherits all of the user's
    current roles from the user_roles table.
    """
    postgres = connectors.PostgresConnector.get_instance()

    access_token = secrets.token_urlsafe(task_lib.REFRESH_TOKEN_LENGTH)

    if roles is None:
        # No roles specified - inherit all user's roles
        token_roles = _get_user_role_names(postgres, user_name)
    else:
        # Use the specified roles - validation happens in insert_into_db
        token_roles = roles

    objects.AccessToken.insert_into_db(
        postgres, user_name, token_name, access_token,
        expires_at, description, token_roles, user_name)

    return access_token


@router.delete('/api/auth/access_token/{token_name}')
def delete_access_token(token_name: str,
                        user_name: str = fastapi.Depends(connectors.parse_username)):
    """
    API to delete an access token.
    """
    postgres = connectors.PostgresConnector.get_instance()
    objects.AccessToken.delete_from_db(postgres, token_name, user_name)


@router.get('/api/auth/access_token/{token_name}/roles',
            response_model=objects.AccessTokenRolesResponse)
def list_access_token_roles(
    token_name: str,
    user_name: str = fastapi.Depends(connectors.parse_username),
) -> objects.AccessTokenRolesResponse:
    """
    List all roles assigned to an access token.

    Args:
        token_name: The token name
        user_name: Authenticated user (owner of the token)

    Returns:
        AccessTokenRolesResponse with list of role assignments
    """
    postgres = connectors.PostgresConnector.get_instance()

    # Verify token exists and belongs to user
    fetch_token_cmd = '''
        SELECT user_name, token_name FROM access_token
        WHERE token_name = %s AND user_name = %s;
    '''
    token_rows = postgres.execute_fetch_command(
        fetch_token_cmd, (token_name, user_name), True)

    if not token_rows:
        raise osmo_errors.OSMOUserError(
            f'Token {token_name} not found or does not belong to current user')

    # Fetch access token roles by joining with user_roles to get role_name
    fetch_cmd = '''
        SELECT ur.role_name, pr.assigned_by, pr.assigned_at
        FROM access_token_roles pr
        JOIN user_roles ur ON pr.user_role_id = ur.id
        WHERE pr.user_name = %s AND pr.token_name = %s
        ORDER BY ur.role_name;
    '''
    rows = postgres.execute_fetch_command(fetch_cmd, (user_name, token_name), True)

    roles = [objects.AccessTokenRole(
        role_name=row['role_name'],
        assigned_by=row['assigned_by'],
        assigned_at=row['assigned_at']
    ) for row in rows]

    return objects.AccessTokenRolesResponse(
        user_name=user_name,
        token_name=token_name,
        roles=roles
    )


@router.get('/api/auth/access_token')
def list_access_tokens(
        user_name: str = fastapi.Depends(connectors.parse_username)
) -> List[objects.AccessTokenWithRoles]:
    """
    API to list all access tokens for a user, including their assigned roles.
    """
    postgres = connectors.PostgresConnector.get_instance()
    return objects.AccessToken.list_with_roles_from_db(postgres, user_name)


@router.post('/api/auth/user/{user_id}/access_token/{token_name}')
def admin_create_access_token(
    user_id: str,
    token_name: str,
    expires_at: str,
    description: str = '',
    roles: Optional[List[str]] = fastapi.Query(default=None),
    admin_user: str = fastapi.Depends(connectors.parse_username),
):
    """
    Admin API to create an access token for a specific user.

    This endpoint allows administrators to create an access token
    on behalf of any user in the system.

    If roles are specified, all specified roles must be assigned to the target
    user. If any role is not assigned to the user, the request fails and no
    token is created. If no roles are specified, the access token inherits all of the
    target user's current roles from the user_roles table.

    Args:
        user_id: The user ID to create the token for
        token_name: Name for the access token
        expires_at: Expiration date in YYYY-MM-DD format
        description: Optional description for the token
        roles: Optional list of roles to assign (must all be assigned to user)
        admin_user: Authenticated admin user making the request

    Returns:
        The generated access token string
    """
    postgres = connectors.PostgresConnector.get_instance()

    access_token = secrets.token_urlsafe(task_lib.REFRESH_TOKEN_LENGTH)

    if roles is None:
        # No roles specified - inherit all user's roles
        token_roles = _get_user_role_names(postgres, user_id)
    else:
        # Use the specified roles - validation happens in insert_into_db
        token_roles = roles

    objects.AccessToken.insert_into_db(
        postgres, user_id, token_name, access_token,
        expires_at, description, token_roles, admin_user)

    return access_token


@router.get('/api/auth/user/{user_id}/access_tokens')
def admin_list_access_tokens(user_id: str) -> List[objects.AccessTokenWithRoles]:
    """
    Admin API to list all access tokens for a specific user, including their assigned roles.

    Args:
        user_id: The user ID to list tokens for

    Returns:
        List of AccessTokenWithRoles objects
    """
    postgres = connectors.PostgresConnector.get_instance()

    # Validate the target user exists
    _validate_user_exists(postgres, user_id)

    return objects.AccessToken.list_with_roles_from_db(postgres, user_id)


@router.delete('/api/auth/user/{user_id}/access_token/{token_name}')
def admin_delete_access_token(user_id: str, token_name: str):
    """
    Admin API to delete an access token for a specific user.

    Args:
        user_id: The user ID who owns the token
        token_name: Name of the token to delete
    """
    postgres = connectors.PostgresConnector.get_instance()

    # Validate the target user exists
    _validate_user_exists(postgres, user_id)

    objects.AccessToken.delete_from_db(postgres, token_name, user_id)


# =============================================================================
# User Management Helper Functions
# =============================================================================

def _get_user_from_db(postgres: connectors.PostgresConnector,
                      user_id: str) -> Optional[dict]:
    """Fetch a user record from the database."""
    fetch_cmd = '''
        SELECT id, created_at, created_by
        FROM users WHERE id = %s;
    '''
    rows = postgres.execute_fetch_command(fetch_cmd, (user_id,), True)
    return rows[0] if rows else None


def _get_user_roles_from_db(postgres: connectors.PostgresConnector,
                            user_id: str) -> List[objects.UserRole]:
    """Fetch all roles assigned to a user."""
    fetch_cmd = '''
        SELECT role_name, assigned_by, assigned_at
        FROM user_roles WHERE user_id = %s
        ORDER BY role_name;
    '''
    rows = postgres.execute_fetch_command(fetch_cmd, (user_id,), True)
    return [objects.UserRole(
        role_name=row['role_name'],
        assigned_by=row['assigned_by'],
        assigned_at=row['assigned_at']
    ) for row in rows]


def _get_user_role_names(postgres: connectors.PostgresConnector,
                         user_id: str) -> List[str]:
    """Fetch all role names assigned to a user."""
    fetch_cmd = '''
        SELECT role_name FROM user_roles WHERE user_id = %s ORDER BY role_name;
    '''
    rows = postgres.execute_fetch_command(fetch_cmd, (user_id,), True)
    return [row['role_name'] for row in rows]


def _validate_role_exists(postgres: connectors.PostgresConnector, role_name: str):
    """Validate that a role exists in the database."""
    fetch_cmd = 'SELECT 1 FROM roles WHERE name = %s;'
    rows = postgres.execute_fetch_command(fetch_cmd, (role_name,), True)
    if not rows:
        raise osmo_errors.OSMOUserError(f'Role {role_name} does not exist')


def _validate_user_exists(postgres: connectors.PostgresConnector, user_id: str):
    """Validate that a user exists in the database."""
    if not _get_user_from_db(postgres, user_id):
        raise osmo_errors.OSMOUserError(f'User {user_id} not found')


# =============================================================================
# User Management APIs
# =============================================================================

@router.get('/api/auth/user', response_model=objects.UserListResponse)
def list_users(
    start_index: int = 1,
    count: int = 100,
    id_prefix: Optional[str] = None,
    roles: Optional[List[str]] = fastapi.Query(default=None),
) -> objects.UserListResponse:
    """
    List all users with optional filtering.

    Args:
        start_index: Pagination start (1-based, default: 1)
        count: Results per page (default: 100, max: 1000)
        id_prefix: Filter users whose ID starts with this prefix
        roles: List of role names. Returns users who have ANY of these roles.
               Use multiple query params: ?roles=admin&roles=user

    Returns:
        UserListResponse with paginated user list
    """
    postgres = connectors.PostgresConnector.get_instance()

    # Validate pagination parameters
    start_index = max(start_index, 1)
    count = max(count, 1)
    count = min(count, 1000)

    # Build WHERE clause and args
    where_conditions = []
    filter_args: List = []

    # Add id_prefix filter
    if id_prefix:
        where_conditions.append('u.id LIKE %s')
        filter_args.append(f'{id_prefix}%')

    # Add roles filter (users who have ANY of the specified roles)
    role_list = roles if roles else []

    # Build the query
    if role_list:
        # Join with user_roles to filter by roles
        role_placeholders = ', '.join(['%s'] * len(role_list))
        filter_args.extend(role_list)

        where_clause = ''
        if where_conditions:
            where_clause = ' AND ' + ' AND '.join(where_conditions)

        # Count query with role filter
        count_cmd = f'''
            SELECT COUNT(DISTINCT u.id) as total
            FROM users u
            JOIN user_roles ur ON u.id = ur.user_id
            WHERE ur.role_name IN ({role_placeholders}){where_clause};
        '''

        # Fetch query with role filter
        fetch_cmd = f'''
            SELECT DISTINCT u.id, u.created_at, u.created_by
            FROM users u
            JOIN user_roles ur ON u.id = ur.user_id
            WHERE ur.role_name IN ({role_placeholders}){where_clause}
            ORDER BY u.created_at DESC
            LIMIT %s OFFSET %s;
        '''
    else:
        # No role filter - query users table directly
        where_clause = ''
        if where_conditions:
            where_clause = ' WHERE ' + ' AND '.join(where_conditions)

        count_cmd = f'SELECT COUNT(*) as total FROM users u{where_clause};'
        fetch_cmd = f'''
            SELECT u.id, u.created_at, u.created_by
            FROM users u{where_clause}
            ORDER BY u.created_at DESC
            LIMIT %s OFFSET %s;
        '''

    # Get total count
    count_result = postgres.execute_fetch_command(count_cmd, tuple(filter_args), True)
    total_results = count_result[0]['total'] if count_result else 0

    # Calculate offset (start_index is 1-based)
    offset = start_index - 1

    # Fetch users with pagination
    rows = postgres.execute_fetch_command(
        fetch_cmd, tuple(filter_args) + (count, offset), True)

    users = [objects.User(
        id=row['id'],
        created_at=row['created_at'],
        created_by=row['created_by']
    ) for row in rows]

    return objects.UserListResponse(
        total_results=total_results,
        start_index=start_index,
        items_per_page=len(users),
        users=users
    )


@router.post('/api/auth/user', response_model=objects.User)
def create_user(
    request: objects.CreateUserRequest,
    created_by: str = fastapi.Depends(connectors.parse_username),
) -> objects.User:
    """
    Create a new user.

    Args:
        request: CreateUserRequest with user details
        created_by: Authenticated user making the request

    Returns:
        Created User object
    """
    postgres = connectors.PostgresConnector.get_instance()

    # Check if user already exists
    existing_user = _get_user_from_db(postgres, request.id)
    if existing_user:
        raise osmo_errors.OSMOUserError(f'User {request.id} already exists')

    # Validate roles if provided
    if request.roles:
        for role_name in request.roles:
            _validate_role_exists(postgres, role_name)

    now = datetime.datetime.now(datetime.timezone.utc)

    # Insert user
    insert_cmd = '''
        INSERT INTO users (id, created_at, created_by)
        VALUES (%s, %s, %s)
        RETURNING id, created_at, created_by;
    '''
    result = postgres.execute_fetch_command(
        insert_cmd,
        (request.id, now, created_by),
        True
    )

    if not result:
        raise osmo_errors.OSMODatabaseError('Failed to create user')

    # Assign initial roles if provided
    if request.roles:
        for role_name in request.roles:
            assign_cmd = '''
                INSERT INTO user_roles (user_id, role_name, assigned_by, assigned_at)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (user_id, role_name) DO NOTHING;
            '''
            postgres.execute_commit_command(
                assign_cmd, (request.id, role_name, created_by, now))

    row = result[0]
    return objects.User(
        id=row['id'],
        created_at=row['created_at'],
        created_by=row['created_by']
    )


@router.get('/api/auth/user/{user_id}', response_model=objects.UserWithRoles)
def get_user(user_id: str) -> objects.UserWithRoles:
    """
    Get a specific user's details including their roles.

    Args:
        user_id: The user ID to fetch

    Returns:
        UserWithRoles object
    """
    postgres = connectors.PostgresConnector.get_instance()

    user_row = _get_user_from_db(postgres, user_id)
    if not user_row:
        raise osmo_errors.OSMOUserError(f'User {user_id} not found')

    roles = _get_user_roles_from_db(postgres, user_id)

    return objects.UserWithRoles(
        id=user_row['id'],
        created_at=user_row['created_at'],
        created_by=user_row['created_by'],
        roles=roles
    )


@router.delete('/api/auth/user/{user_id}')
def delete_user(user_id: str):
    """
    Delete a user and all associated role assignments and PATs.

    Args:
        user_id: The user ID to delete
    """
    postgres = connectors.PostgresConnector.get_instance()

    # Check if user exists
    _validate_user_exists(postgres, user_id)

    # Delete user (cascades to user_roles due to ON DELETE CASCADE)
    delete_cmd = 'DELETE FROM users WHERE id = %s;'
    postgres.execute_commit_command(delete_cmd, (user_id,))


# =============================================================================
# User Role Assignment APIs
# =============================================================================

@router.get('/api/auth/user/{user_id}/roles', response_model=objects.UserRolesResponse)
def list_user_roles(user_id: str) -> objects.UserRolesResponse:
    """
    List all roles assigned to a user.

    Args:
        user_id: The user ID

    Returns:
        UserRolesResponse with list of role assignments
    """
    postgres = connectors.PostgresConnector.get_instance()

    # Validate user exists
    _validate_user_exists(postgres, user_id)

    roles = _get_user_roles_from_db(postgres, user_id)

    return objects.UserRolesResponse(
        user_id=user_id,
        roles=roles
    )


@router.post('/api/auth/user/{user_id}/roles',
             response_model=objects.UserRoleAssignment)
def assign_role_to_user(
    user_id: str,
    request: objects.AssignRoleRequest,
    assigned_by: str = fastapi.Depends(connectors.parse_username),
) -> objects.UserRoleAssignment:
    """
    Assign a role to a user.

    Args:
        user_id: The user ID
        request: AssignRoleRequest with role_name
        assigned_by: Authenticated user making the request

    Returns:
        UserRoleAssignment with assignment details
    """
    postgres = connectors.PostgresConnector.get_instance()

    # Validate role exists (user existence is enforced by FK constraint on user_roles)
    _validate_role_exists(postgres, request.role_name)

    now = datetime.datetime.now(datetime.timezone.utc)

    # Insert role assignment (idempotent - returns existing if already assigned)
    # FK constraint on user_id will reject if user doesn't exist
    insert_cmd = '''
        INSERT INTO user_roles (user_id, role_name, assigned_by, assigned_at)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (user_id, role_name) DO UPDATE SET user_id = EXCLUDED.user_id
        RETURNING id, assigned_by, assigned_at;
    '''
    try:
        result = postgres.execute_fetch_command(
            insert_cmd, (user_id, request.role_name, assigned_by, now), True)
    except osmo_errors.OSMODatabaseError as err:
        raise osmo_errors.OSMOUserError(f'User {user_id} not found') from err

    row = result[0]
    return objects.UserRoleAssignment(
        user_id=user_id,
        role_name=request.role_name,
        assigned_by=row['assigned_by'],
        assigned_at=row['assigned_at']
    )


@router.delete('/api/auth/user/{user_id}/roles/{role_name}')
def remove_role_from_user(user_id: str, role_name: str):
    """
    Remove a role from a user and all their PATs.

    When a role is removed from a user, it is automatically removed from all PATs
    owned by that user via the FK cascade from access_token_roles to user_roles.

    Args:
        user_id: The user ID
        role_name: The role to remove
    """
    postgres = connectors.PostgresConnector.get_instance()

    # Delete role assignment from user_roles
    # access_token_roles entries referencing this user_role are auto-deleted via ON DELETE CASCADE
    delete_cmd = 'DELETE FROM user_roles WHERE user_id = %s AND role_name = %s;'
    postgres.execute_commit_command(delete_cmd, (user_id, role_name))


@router.get('/api/auth/roles/{role_name}/users', response_model=objects.RoleUsersResponse)
def list_users_with_role(role_name: str) -> objects.RoleUsersResponse:
    """
    List all users who have a specific role.

    Args:
        role_name: The role name

    Returns:
        RoleUsersResponse with list of users
    """
    postgres = connectors.PostgresConnector.get_instance()

    # Validate role exists
    _validate_role_exists(postgres, role_name)

    fetch_cmd = '''
        SELECT ur.user_id, ur.assigned_by, ur.assigned_at
        FROM user_roles ur
        JOIN users u ON ur.user_id = u.id
        WHERE ur.role_name = %s
        ORDER BY ur.assigned_at DESC;
    '''
    rows = postgres.execute_fetch_command(fetch_cmd, (role_name,), True)

    users = [{
        'user_id': row['user_id'],
        'assigned_by': row['assigned_by'],
        'assigned_at': row['assigned_at'].isoformat() if row['assigned_at'] else None
    } for row in rows]

    return objects.RoleUsersResponse(
        role_name=role_name,
        users=users
    )


@router.post('/api/auth/roles/{role_name}/users',
             response_model=objects.BulkAssignResponse)
def bulk_assign_role(
    role_name: str,
    request: objects.BulkAssignRequest,
    assigned_by: str = fastapi.Depends(connectors.parse_username),
) -> objects.BulkAssignResponse:
    """
    Bulk assign a role to multiple users.

    Args:
        role_name: The role to assign
        request: BulkAssignRequest with list of user_ids
        assigned_by: Authenticated user making the request

    Returns:
        BulkAssignResponse with results
    """
    postgres = connectors.PostgresConnector.get_instance()

    # Validate role exists
    _validate_role_exists(postgres, role_name)

    assigned: List[str] = []
    already_assigned: List[str] = []
    failed: List[str] = []

    now = datetime.datetime.now(datetime.timezone.utc)

    for user_id in request.user_ids:
        # Check if user exists
        user = _get_user_from_db(postgres, user_id)
        if not user:
            failed.append(user_id)
            continue

        # Check if already assigned
        check_cmd = '''
            SELECT 1 FROM user_roles WHERE user_id = %s AND role_name = %s;
        '''
        existing = postgres.execute_fetch_command(check_cmd, (user_id, role_name), True)

        if existing:
            already_assigned.append(user_id)
        else:
            # Assign role
            insert_cmd = '''
                INSERT INTO user_roles (user_id, role_name, assigned_by, assigned_at)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (user_id, role_name) DO NOTHING;
            '''
            postgres.execute_commit_command(
                insert_cmd, (user_id, role_name, assigned_by, now))
            assigned.append(user_id)

    return objects.BulkAssignResponse(
        role_name=role_name,
        assigned=assigned,
        already_assigned=already_assigned,
        failed=failed
    )
