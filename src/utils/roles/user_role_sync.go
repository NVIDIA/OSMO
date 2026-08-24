/*
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
*/

package roles

import (
	"context"
	"fmt"
	"log/slog"

	"go.corp.nvidia.com/osmo/utils/postgres"
)

const (
	SyncModeIgnore = "ignore"
	SyncModeImport = "import"
	SyncModeForce  = "force"

	idpSyncAssigner = "idp-sync"
)

// SyncUserRoles synchronises the user_roles table for a given user based on
// the external IDP roles carried in the request, and returns the complete set
// of OSMO role names the user holds after the sync.
//
// The entire read-compute-write cycle runs as a single SQL statement so
// concurrent requests for the same user cannot observe an intermediate state.
//
// Sync modes (per role):
//   - ignore: skip entirely
//   - import: add the role if the user's external roles map to it, never remove
//   - force:  add if mapped, remove if the user has it but it is no longer mapped
func SyncUserRoles(
	ctx context.Context,
	client *postgres.PostgresClient,
	userName string,
	externalRoles []string,
	logger *slog.Logger,
) ([]string, error) {
	if userName == "" {
		return nil, nil
	}

	if err := upsertUser(ctx, client, userName); err != nil {
		return nil, fmt.Errorf("upsert user: %w", err)
	}

	if len(externalRoles) == 0 {
		externalRoles = []string{}
	}

	result, err := syncAndReturnRoles(ctx, client, userName, externalRoles)
	if err != nil {
		return nil, fmt.Errorf("sync user roles: %w", err)
	}

	if len(result.Added) > 0 || len(result.Removed) > 0 {
		logger.Info("synced user roles",
			slog.String("user", userName),
			slog.Any("added", result.Added),
			slog.Any("removed", result.Removed),
		)
	}

	return result.RoleNames, nil
}

func upsertUser(ctx context.Context, client *postgres.PostgresClient, userName string) error {
	query := `INSERT INTO users (id, created_at, created_by)
	          VALUES ($1, NOW(), $1)
	          ON CONFLICT (id) DO NOTHING`
	_, err := client.Pool().Exec(ctx, query, userName)
	return err
}

type syncResult struct {
	RoleNames []string
	Added     []string
	Removed   []string
}

// syncAndReturnRoles performs the full sync as a single atomic SQL statement:
//  1. Reads role definitions, external mappings, and the user's current
//     role assignments in one snapshot.
//  2. Computes which roles to add (import/force) and remove (force).
//  3. Applies the inserts and deletes.
//  4. Returns which roles were added, removed, and the final set.
//
// Because the entire operation is one statement, concurrent calls for the same
// user serialise naturally via PostgreSQL row-level locks; no TOCTOU gap exists.
func syncAndReturnRoles(
	ctx context.Context,
	client *postgres.PostgresClient,
	userName string,
	externalRoles []string,
) (*syncResult, error) {
	// Each row comes back as (role_name, change_type) where change_type is
	// 'added', 'removed', or 'existing'.
	query := `
		WITH sync_info AS (
			SELECT
				r.name,
				r.sync_mode,
				EXISTS (
					SELECT 1 FROM role_external_mappings rem
					WHERE rem.role_name = r.name AND rem.external_role = ANY($2)
				) AS in_header
			FROM roles r
			WHERE r.sync_mode != $3
		),
		current_roles AS (
			SELECT role_name
			FROM user_roles
			WHERE user_id = $1
			  AND role_name IN (SELECT name FROM sync_info)
		),
		to_add AS (
			SELECT si.name
			FROM sync_info si
			WHERE si.in_header
			  AND si.sync_mode IN ('import', 'force')
			  AND si.name NOT IN (SELECT role_name FROM current_roles)
		),
		to_remove AS (
			SELECT si.name
			FROM sync_info si
			WHERE NOT si.in_header
			  AND si.sync_mode = 'force'
			  AND si.name IN (SELECT role_name FROM current_roles)
		),
		inserted AS (
			INSERT INTO user_roles (user_id, role_name, assigned_by, assigned_at)
			SELECT $1, name, $4, NOW()
			FROM to_add
			ON CONFLICT (user_id, role_name) DO NOTHING
			RETURNING role_name
		),
		deleted AS (
			DELETE FROM user_roles
			WHERE user_id = $1
			  AND role_name IN (SELECT name FROM to_remove)
			RETURNING role_name
		)
		SELECT role_name, 'added' AS change_type FROM inserted
		UNION ALL
		SELECT role_name, 'removed' AS change_type FROM deleted
		UNION ALL
		SELECT role_name, 'existing' AS change_type
		FROM user_roles
		WHERE user_id = $1
		  AND role_name NOT IN (SELECT role_name FROM inserted)
		  AND role_name NOT IN (SELECT role_name FROM deleted)`

	rows, err := client.Pool().Query(
		ctx, query, userName, externalRoles, SyncModeIgnore, idpSyncAssigner)
	if err != nil {
		return nil, fmt.Errorf("exec sync query: %w", err)
	}
	defer rows.Close()

	res := &syncResult{}
	for rows.Next() {
		var name, changeType string
		if err := rows.Scan(&name, &changeType); err != nil {
			return nil, fmt.Errorf("scan sync result: %w", err)
		}
		switch changeType {
		case "added":
			res.Added = append(res.Added, name)
			res.RoleNames = append(res.RoleNames, name)
		case "removed":
			res.Removed = append(res.Removed, name)
		case "existing":
			res.RoleNames = append(res.RoleNames, name)
		}
	}
	return res, rows.Err()
}
