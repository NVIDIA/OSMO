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

import logging


def create_scim_tables(database) -> None:
    """
    Create the SCIM-related database tables.

    This should be called during service initialization to ensure
    the SCIM tables exist.

    Tables created:
    - scim_users: Stores user identity information provisioned via SCIM
    - scim_user_roles: Maps SCIM users to OSMO roles (for group sync)
    """
    logging.info("Creating SCIM database tables if they don't exist...")

    # Create SCIM users table
    create_scim_users_cmd = """
        CREATE TABLE IF NOT EXISTS scim_users (
            id TEXT PRIMARY KEY,
            external_id TEXT UNIQUE,
            username TEXT NOT NULL UNIQUE,
            display_name TEXT,
            given_name TEXT,
            family_name TEXT,
            email TEXT,
            active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        );
    """
    database.execute_commit_command(create_scim_users_cmd, ())

    # Create indexes for SCIM users
    create_indexes = [
        "CREATE INDEX IF NOT EXISTS idx_scim_users_external_id ON scim_users(external_id);",
        "CREATE INDEX IF NOT EXISTS idx_scim_users_username ON scim_users(username);",
        "CREATE INDEX IF NOT EXISTS idx_scim_users_email ON scim_users(email);",
        "CREATE INDEX IF NOT EXISTS idx_scim_users_active ON scim_users(active);",
    ]
    for index_cmd in create_indexes:
        database.execute_commit_command(index_cmd, ())

    # Create SCIM user-role assignments table
    # This links SCIM users to OSMO roles (for SCIM Group sync)
    create_scim_user_roles_cmd = """
        CREATE TABLE IF NOT EXISTS scim_user_roles (
            id SERIAL PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES scim_users(id) ON DELETE CASCADE,
            role_name TEXT NOT NULL REFERENCES roles(name) ON DELETE CASCADE,
            assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
            UNIQUE(user_id, role_name)
        );
    """
    database.execute_commit_command(create_scim_user_roles_cmd, ())

    # Create indexes for user-role assignments
    create_role_indexes = [
        "CREATE INDEX IF NOT EXISTS idx_scim_user_roles_user_id ON scim_user_roles(user_id);",
        "CREATE INDEX IF NOT EXISTS idx_scim_user_roles_role_name ON scim_user_roles(role_name);",
    ]
    for index_cmd in create_role_indexes:
        database.execute_commit_command(index_cmd, ())

    logging.info("SCIM database tables created successfully")
