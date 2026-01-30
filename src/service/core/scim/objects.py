"""
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
"""

import datetime
import enum
import re
import uuid
from typing import Any, Dict, List, Optional, Tuple

import pydantic

from src.lib.utils import osmo_errors
from src.utils import connectors


# SCIM 2.0 Schema URNs
SCIM_USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User"
SCIM_GROUP_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:Group"
SCIM_LIST_RESPONSE_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse"
SCIM_ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error"
SCIM_PATCH_OP_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp"


class SCIMEmail(pydantic.BaseModel):
    """SCIM Email object"""
    value: str
    type: Optional[str] = None
    primary: Optional[bool] = False

    class Config:
        extra = "allow"


class SCIMMeta(pydantic.BaseModel):
    """SCIM Meta object for resource metadata"""
    resourceType: str
    created: Optional[datetime.datetime] = None
    lastModified: Optional[datetime.datetime] = None
    location: Optional[str] = None
    version: Optional[str] = None


class SCIMName(pydantic.BaseModel):
    """SCIM Name object"""
    formatted: Optional[str] = None
    familyName: Optional[str] = None
    givenName: Optional[str] = None
    middleName: Optional[str] = None
    honorificPrefix: Optional[str] = None
    honorificSuffix: Optional[str] = None


class SCIMGroupMember(pydantic.BaseModel):
    """SCIM Group Member reference"""
    value: str  # User ID
    display: Optional[str] = None  # Display name
    ref: Optional[str] = pydantic.Field(None, alias="$ref")  # URI reference

    class Config:
        populate_by_name = True


class SCIMUserRequest(pydantic.BaseModel):
    """SCIM User object for create/update requests"""
    schemas: List[str] = [SCIM_USER_SCHEMA]
    externalId: Optional[str] = None
    userName: str
    name: Optional[SCIMName] = None
    displayName: Optional[str] = None
    emails: Optional[List[SCIMEmail]] = None
    active: bool = True

    class Config:
        extra = "allow"


class SCIMUserResponse(pydantic.BaseModel):
    """SCIM User object for responses"""
    schemas: List[str] = [SCIM_USER_SCHEMA]
    id: str
    externalId: Optional[str] = None
    userName: str
    name: Optional[SCIMName] = None
    displayName: Optional[str] = None
    emails: Optional[List[SCIMEmail]] = None
    active: bool = True
    groups: Optional[List[Dict[str, str]]] = None
    meta: SCIMMeta

    class Config:
        extra = "allow"


class SCIMGroupRequest(pydantic.BaseModel):
    """SCIM Group object for create/update requests"""
    schemas: List[str] = [SCIM_GROUP_SCHEMA]
    externalId: Optional[str] = None
    displayName: str
    members: Optional[List[SCIMGroupMember]] = None

    class Config:
        extra = "allow"


class SCIMGroupResponse(pydantic.BaseModel):
    """SCIM Group object for responses"""
    schemas: List[str] = [SCIM_GROUP_SCHEMA]
    id: str
    externalId: Optional[str] = None
    displayName: str
    members: Optional[List[SCIMGroupMember]] = None
    meta: SCIMMeta

    class Config:
        extra = "allow"


class SCIMListResponse(pydantic.BaseModel):
    """SCIM List Response object"""
    schemas: List[str] = [SCIM_LIST_RESPONSE_SCHEMA]
    totalResults: int
    startIndex: int = 1
    itemsPerPage: int
    Resources: List[Any] = []  # Can be users or groups


class SCIMErrorResponse(pydantic.BaseModel):
    """SCIM Error Response object"""
    schemas: List[str] = [SCIM_ERROR_SCHEMA]
    status: str
    scimType: Optional[str] = None
    detail: str


class SCIMPatchOperation(pydantic.BaseModel):
    """Single SCIM Patch operation"""
    op: str  # add, remove, replace
    path: Optional[str] = None
    value: Optional[Any] = None


class SCIMPatchRequest(pydantic.BaseModel):
    """SCIM Patch Request object"""
    schemas: List[str] = [SCIM_PATCH_OP_SCHEMA]
    Operations: List[SCIMPatchOperation]


class SCIMUser(pydantic.BaseModel):
    """SCIM User database model"""
    id: str
    external_id: Optional[str] = None
    username: str
    display_name: Optional[str] = None
    given_name: Optional[str] = None
    family_name: Optional[str] = None
    email: Optional[str] = None
    active: bool = True
    created_at: datetime.datetime
    updated_at: datetime.datetime

    @classmethod
    def _parse_filter(cls, filter_str: Optional[str]) -> Tuple[str, Tuple]:
        """
        Parse SCIM filter string into SQL WHERE clause.
        Supports basic filters like: userName eq "john@example.com"
        """
        if not filter_str:
            return "", ()

        # Basic filter parsing for common patterns
        # Format: attribute op "value"
        eq_match = re.match(r'(\w+)\s+eq\s+"([^"]+)"', filter_str, re.IGNORECASE)
        if eq_match:
            attr, value = eq_match.groups()
            attr_map = {
                "userName": "username",
                "externalId": "external_id",
                "displayName": "display_name",
                "id": "id",
            }
            db_attr = attr_map.get(attr, attr.lower())
            return f"WHERE {db_attr} = %s", (value,)

        # Contains/startsWith for userName (common in Okta)
        sw_match = re.match(r'(\w+)\s+sw\s+"([^"]+)"', filter_str, re.IGNORECASE)
        if sw_match:
            attr, value = sw_match.groups()
            attr_map = {
                "userName": "username",
                "displayName": "display_name",
            }
            db_attr = attr_map.get(attr, attr.lower())
            return f"WHERE {db_attr} LIKE %s", (f"{value}%",)

        return "", ()

    @classmethod
    def list_from_db(
        cls,
        database: connectors.PostgresConnector,
        filter_str: Optional[str] = None,
        start_index: int = 1,
        count: int = 100
    ) -> Tuple[List['SCIMUser'], int]:
        """
        Fetch users from database with optional SCIM filter.
        Returns tuple of (users, total_count).
        """
        where_clause, params = cls._parse_filter(filter_str)

        # Get total count
        count_cmd = f"SELECT COUNT(*) as total FROM scim_users {where_clause};"
        count_result = database.execute_fetch_command(count_cmd, params, return_raw=True)
        total = count_result[0]['total'] if count_result else 0

        # Fetch paginated results (SCIM uses 1-based indexing)
        offset = start_index - 1
        fetch_cmd = f"""
            SELECT * FROM scim_users {where_clause}
            ORDER BY created_at
            LIMIT %s OFFSET %s;
        """
        fetch_params = params + (count, offset)
        rows = database.execute_fetch_command(fetch_cmd, fetch_params, return_raw=True)

        users = [cls(**row) for row in rows]
        return users, total

    @classmethod
    def fetch_from_db(cls, database: connectors.PostgresConnector, user_id: str) -> 'SCIMUser':
        """Fetch a single user by ID"""
        fetch_cmd = "SELECT * FROM scim_users WHERE id = %s;"
        rows = database.execute_fetch_command(fetch_cmd, (user_id,), return_raw=True)
        if not rows:
            raise osmo_errors.OSMOUserError(f"SCIM User {user_id} does not exist.")
        return cls(**rows[0])

    @classmethod
    def fetch_by_username(
        cls, database: connectors.PostgresConnector, username: str
    ) -> Optional['SCIMUser']:
        """Fetch a single user by username"""
        fetch_cmd = "SELECT * FROM scim_users WHERE username = %s;"
        rows = database.execute_fetch_command(fetch_cmd, (username,), return_raw=True)
        if not rows:
            return None
        return cls(**rows[0])

    @classmethod
    def fetch_by_external_id(
        cls, database: connectors.PostgresConnector, external_id: str
    ) -> Optional['SCIMUser']:
        """Fetch a single user by external ID"""
        fetch_cmd = "SELECT * FROM scim_users WHERE external_id = %s;"
        rows = database.execute_fetch_command(fetch_cmd, (external_id,), return_raw=True)
        if not rows:
            return None
        return cls(**rows[0])

    @classmethod
    def create_in_db(
        cls,
        database: connectors.PostgresConnector,
        request: SCIMUserRequest
    ) -> 'SCIMUser':
        """Create a new SCIM user in the database"""
        # Check if user already exists
        existing = cls.fetch_by_username(database, request.userName)
        if existing:
            raise osmo_errors.OSMOUserError(
                f"User with userName '{request.userName}' already exists."
            )

        user_id = str(uuid.uuid4())
        now = datetime.datetime.utcnow()

        # Extract email from emails list
        email = None
        if request.emails:
            primary_email = next((e for e in request.emails if e.primary), None)
            email = primary_email.value if primary_email else request.emails[0].value

        # Extract name components
        given_name = request.name.givenName if request.name else None
        family_name = request.name.familyName if request.name else None

        insert_cmd = """
            INSERT INTO scim_users
            (id, external_id, username, display_name, given_name, family_name, email, active,
             created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *;
        """
        rows = database.execute_fetch_command(
            insert_cmd,
            (user_id, request.externalId, request.userName, request.displayName,
             given_name, family_name, email, request.active, now, now),
            return_raw=True
        )

        # Also create a default user profile for OSMO services
        connectors.UserProfile.insert_default_profile(database, request.userName)

        return cls(**rows[0])

    @classmethod
    def update_in_db(
        cls,
        database: connectors.PostgresConnector,
        user_id: str,
        request: SCIMUserRequest
    ) -> 'SCIMUser':
        """Update an existing SCIM user in the database"""
        # Verify user exists
        cls.fetch_from_db(database, user_id)

        now = datetime.datetime.utcnow()

        # Extract email from emails list
        email = None
        if request.emails:
            primary_email = next((e for e in request.emails if e.primary), None)
            email = primary_email.value if primary_email else request.emails[0].value

        # Extract name components
        given_name = request.name.givenName if request.name else None
        family_name = request.name.familyName if request.name else None

        update_cmd = """
            UPDATE scim_users SET
                external_id = %s,
                username = %s,
                display_name = %s,
                given_name = %s,
                family_name = %s,
                email = %s,
                active = %s,
                updated_at = %s
            WHERE id = %s
            RETURNING *;
        """
        rows = database.execute_fetch_command(
            update_cmd,
            (request.externalId, request.userName, request.displayName,
             given_name, family_name, email, request.active, now, user_id),
            return_raw=True
        )

        return cls(**rows[0])

    @classmethod
    def patch_in_db(
        cls,
        database: connectors.PostgresConnector,
        user_id: str,
        operations: List[SCIMPatchOperation]
    ) -> 'SCIMUser':
        """Apply SCIM PATCH operations to a user"""
        user = cls.fetch_from_db(database, user_id)
        user_dict = user.dict()

        # Map SCIM attribute paths to database columns
        attr_map = {
            "userName": "username",
            "displayName": "display_name",
            "name.givenName": "given_name",
            "name.familyName": "family_name",
            "active": "active",
            "externalId": "external_id",
        }

        for op in operations:
            path = op.path
            if path and path in attr_map:
                db_field = attr_map[path]
                if op.op.lower() == "replace":
                    user_dict[db_field] = op.value
                elif op.op.lower() == "add":
                    user_dict[db_field] = op.value
                elif op.op.lower() == "remove":
                    user_dict[db_field] = None
            elif op.op.lower() == "replace" and not path:
                # Bulk replace without path
                if isinstance(op.value, dict):
                    for key, value in op.value.items():
                        if key in attr_map:
                            user_dict[attr_map[key]] = value

        now = datetime.datetime.utcnow()
        update_cmd = """
            UPDATE scim_users SET
                external_id = %s,
                username = %s,
                display_name = %s,
                given_name = %s,
                family_name = %s,
                active = %s,
                updated_at = %s
            WHERE id = %s
            RETURNING *;
        """
        rows = database.execute_fetch_command(
            update_cmd,
            (user_dict.get('external_id'), user_dict.get('username'),
             user_dict.get('display_name'), user_dict.get('given_name'),
             user_dict.get('family_name'), user_dict.get('active'), now, user_id),
            return_raw=True
        )

        return cls(**rows[0])

    @classmethod
    def delete_from_db(cls, database: connectors.PostgresConnector, user_id: str):
        """Delete a SCIM user from the database"""
        # Verify user exists
        user = cls.fetch_from_db(database, user_id)

        # Remove from SCIM users table
        delete_cmd = "DELETE FROM scim_users WHERE id = %s;"
        database.execute_commit_command(delete_cmd, (user_id,))

        # Also remove user role assignments
        delete_roles_cmd = "DELETE FROM scim_user_roles WHERE user_id = %s;"
        database.execute_commit_command(delete_roles_cmd, (user_id,))

    def to_scim_response(self, base_url: str) -> SCIMUserResponse:
        """Convert database model to SCIM response format"""
        name = None
        if self.given_name or self.family_name:
            formatted = " ".join(filter(None, [self.given_name, self.family_name]))
            name = SCIMName(
                formatted=formatted or None,
                givenName=self.given_name,
                familyName=self.family_name
            )

        emails = None
        if self.email:
            emails = [SCIMEmail(value=self.email, primary=True, type="work")]

        return SCIMUserResponse(
            id=self.id,
            externalId=self.external_id,
            userName=self.username,
            displayName=self.display_name,
            name=name,
            emails=emails,
            active=self.active,
            meta=SCIMMeta(
                resourceType="User",
                created=self.created_at,
                lastModified=self.updated_at,
                location=f"{base_url}/api/scim/v2/Users/{self.id}"
            )
        )


class SCIMGroup(pydantic.BaseModel):
    """SCIM Group model - maps to OSMO Roles"""
    id: str
    external_id: Optional[str] = None
    display_name: str
    created_at: datetime.datetime
    updated_at: datetime.datetime

    @classmethod
    def list_from_db(
        cls,
        database: connectors.PostgresConnector,
        filter_str: Optional[str] = None,
        start_index: int = 1,
        count: int = 100
    ) -> Tuple[List['SCIMGroup'], int]:
        """
        Fetch groups from database. SCIM groups map to OSMO roles.
        """
        # Get roles from OSMO roles table
        roles = connectors.Role.list_from_db(database)
        total = len(roles)

        # Apply pagination (SCIM uses 1-based indexing)
        offset = start_index - 1
        paginated_roles = roles[offset:offset + count]

        # Convert roles to SCIM groups
        now = datetime.datetime.utcnow()
        groups = [
            cls(
                id=role.name,  # Use role name as ID
                external_id=None,
                display_name=role.name,
                created_at=now,
                updated_at=now
            )
            for role in paginated_roles
        ]

        return groups, total

    @classmethod
    def fetch_from_db(cls, database: connectors.PostgresConnector, group_id: str) -> 'SCIMGroup':
        """Fetch a single group (role) by ID"""
        role = connectors.Role.fetch_from_db(database, group_id)
        now = datetime.datetime.utcnow()
        return cls(
            id=role.name,
            external_id=None,
            display_name=role.name,
            created_at=now,
            updated_at=now
        )

    @classmethod
    def get_members(
        cls, database: connectors.PostgresConnector, group_id: str
    ) -> List[SCIMGroupMember]:
        """Get all members of a group (role)"""
        fetch_cmd = """
            SELECT sur.user_id, su.username, su.display_name
            FROM scim_user_roles sur
            JOIN scim_users su ON sur.user_id = su.id
            WHERE sur.role_name = %s;
        """
        rows = database.execute_fetch_command(fetch_cmd, (group_id,), return_raw=True)

        return [
            SCIMGroupMember(
                value=row['user_id'],
                display=row['display_name'] or row['username']
            )
            for row in rows
        ]

    @classmethod
    def add_member(
        cls,
        database: connectors.PostgresConnector,
        group_id: str,
        user_id: str
    ):
        """Add a user to a group (assign role)"""
        # Verify group exists
        cls.fetch_from_db(database, group_id)

        # Verify user exists
        SCIMUser.fetch_from_db(database, user_id)

        insert_cmd = """
            INSERT INTO scim_user_roles (user_id, role_name, assigned_at)
            VALUES (%s, %s, %s)
            ON CONFLICT (user_id, role_name) DO NOTHING;
        """
        database.execute_commit_command(
            insert_cmd, (user_id, group_id, datetime.datetime.utcnow())
        )

    @classmethod
    def remove_member(
        cls,
        database: connectors.PostgresConnector,
        group_id: str,
        user_id: str
    ):
        """Remove a user from a group (revoke role)"""
        delete_cmd = """
            DELETE FROM scim_user_roles WHERE user_id = %s AND role_name = %s;
        """
        database.execute_commit_command(delete_cmd, (user_id, group_id))

    @classmethod
    def patch_members(
        cls,
        database: connectors.PostgresConnector,
        group_id: str,
        operations: List[SCIMPatchOperation]
    ):
        """Apply SCIM PATCH operations to group membership"""
        for op in operations:
            if op.path == "members" or not op.path:
                if op.op.lower() == "add" and op.value:
                    # Add members
                    members = op.value if isinstance(op.value, list) else [op.value]
                    for member in members:
                        user_id = member.get("value") if isinstance(member, dict) else member
                        if user_id:
                            cls.add_member(database, group_id, user_id)

                elif op.op.lower() == "remove":
                    if op.value:
                        # Remove specific members
                        members = op.value if isinstance(op.value, list) else [op.value]
                        for member in members:
                            user_id = member.get("value") if isinstance(member, dict) else member
                            if user_id:
                                cls.remove_member(database, group_id, user_id)
                    elif op.path and "members[" in op.path:
                        # Parse path like 'members[value eq "user-id"]'
                        match = re.search(r'members\[value eq "([^"]+)"\]', op.path)
                        if match:
                            user_id = match.group(1)
                            cls.remove_member(database, group_id, user_id)

                elif op.op.lower() == "replace" and op.value:
                    # Replace all members - first remove all, then add new
                    delete_cmd = "DELETE FROM scim_user_roles WHERE role_name = %s;"
                    database.execute_commit_command(delete_cmd, (group_id,))

                    members = op.value if isinstance(op.value, list) else [op.value]
                    for member in members:
                        user_id = member.get("value") if isinstance(member, dict) else member
                        if user_id:
                            cls.add_member(database, group_id, user_id)

    def to_scim_response(
        self,
        base_url: str,
        database: connectors.PostgresConnector
    ) -> SCIMGroupResponse:
        """Convert database model to SCIM response format"""
        members = self.get_members(database, self.id)

        return SCIMGroupResponse(
            id=self.id,
            externalId=self.external_id,
            displayName=self.display_name,
            members=members if members else None,
            meta=SCIMMeta(
                resourceType="Group",
                created=self.created_at,
                lastModified=self.updated_at,
                location=f"{base_url}/api/scim/v2/Groups/{self.id}"
            )
        )
