"""
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
"""

import psycopg2
import json
import time
from typing import List, Dict, Any, Optional
from dataclasses import dataclass
import fnmatch


@dataclass
class RoleAction:
    base: str
    path: str
    method: str


@dataclass
class RolePolicy:
    actions: List[RoleAction]


@dataclass
class Role:
    name: str
    description: str
    policies: List[RolePolicy]
    immutable: bool

    def has_access(self, path: str, method: str) -> bool:
        """Check if this role has access to the given path and method."""
        allowed = False

        for policy in self.policies:
            for action in policy.actions:
                # Check method match
                if action.method != "*" and action.method.lower() != method.lower():
                    continue

                # Check path match
                if action.path.startswith("!"):
                    # Deny pattern
                    deny_path = action.path[1:]
                    if fnmatch.fnmatch(path, deny_path):
                        allowed = False
                        break
                else:
                    # Allow pattern
                    if fnmatch.fnmatch(path, action.path):
                        allowed = True

            if allowed:
                return True

        return allowed


class PostgresRoleCache:
    """Simple in-memory cache for roles with TTL."""

    def __init__(self, ttl_seconds: int = 300):
        self.cache: Dict[str, tuple[List[Role], float]] = {}
        self.ttl = ttl_seconds

    def get(self, role_names: List[str]) -> Optional[List[Role]]:
        """Get roles from cache if not expired."""
        key = ",".join(sorted(role_names))
        if key in self.cache:
            roles, expires_at = self.cache[key]
            if time.time() < expires_at:
                return roles
            else:
                del self.cache[key]
        return None

    def set(self, role_names: List[str], roles: List[Role]):
        """Store roles in cache with expiration."""
        key = ",".join(sorted(role_names))
        expires_at = time.time() + self.ttl
        self.cache[key] = (roles, expires_at)


class AccessControlMiddleware:
    """
    Python implementation of access control middleware for performance testing.
    Simplified version of the actual AccessControlMiddleware.
    """

    def __init__(self, db_config: Dict[str, Any]):
        self.db_config = db_config
        self.cache = PostgresRoleCache(ttl_seconds=300)
        self._conn = None

    def _get_connection(self):
        """Get or create database connection."""
        if self._conn is None or self._conn.closed:
            self._conn = psycopg2.connect(
                host=self.db_config['host'],
                port=self.db_config['port'],
                database=self.db_config['database'],
                user=self.db_config['user'],
                password=self.db_config['password']
            )
        return self._conn

    def _fetch_roles(self, role_names: List[str]) -> List[Role]:
        """Fetch roles from PostgreSQL."""
        if not role_names:
            return []

        conn = self._get_connection()
        cursor = conn.cursor()

        query = """
            SELECT name, description, array_to_json(policies)::text as policies, immutable
            FROM roles
            WHERE name = ANY(%s)
            ORDER BY name
        """

        cursor.execute(query, (role_names,))
        rows = cursor.fetchall()

        roles = []
        for row in rows:
            name, description, policies_json, immutable = row

            # Parse policies
            policies_array = json.loads(policies_json)
            policies = []

            for policy_dict in policies_array:
                actions = [
                    RoleAction(**action)
                    for action in policy_dict['actions']
                ]
                policies.append(RolePolicy(actions=actions))

            roles.append(Role(
                name=name,
                description=description,
                policies=policies,
                immutable=immutable
            ))

        cursor.close()
        return roles

    def check_access(self, path: str, method: str, roles_header: str) -> bool:
        """
        Check if the user has access to the given path and method.

        Args:
            path: Request path (e.g., "/api/workflow")
            method: HTTP method (e.g., "GET")
            roles_header: Comma-separated role names from x-osmo-roles header

        Returns:
            True if access is allowed, False otherwise
        """
        # Parse roles from header
        role_names = []
        if roles_header:
            role_names = [r.strip() for r in roles_header.split(',')]

        # Always add default role
        role_names.append('osmo-default')

        # Try cache first
        roles = self.cache.get(role_names)
        if roles is None:
            # Cache miss - query database
            roles = self._fetch_roles(role_names)
            self.cache.set(role_names, roles)

        # Check each role for access
        for role in roles:
            if role.has_access(path, method):
                return True

        return False

    def close(self):
        """Close database connection."""
        if self._conn and not self._conn.closed:
            self._conn.close()

