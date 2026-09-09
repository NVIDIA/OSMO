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

type SyncMode string

const (
	SyncModeIgnore SyncMode = "ignore"
	SyncModeImport SyncMode = "import"
	SyncModeForce  SyncMode = "force"

	idpSyncAssigner = "idp-sync"
)

// RoleSyncPlan is derived exclusively from ConfigMap role definitions.
type RoleSyncPlan struct {
	MatchedRoles     []string
	ForceRoles       []string
	DefinedRoles     []string
	IDPEligibleRoles []string
}

// SyncUserRoles synchronizes IDP-derived assignment state and returns the
// user's currently eligible roles. Import assignments are sticky, force
// assignments are removed on the next human request without a matching claim,
// ignore roles are never synchronized, and manual assignments always survive.
func SyncUserRoles(
	ctx context.Context,
	client *postgres.PostgresClient,
	store *FileRoleStore,
	userName string,
	externalRoles []string,
	logger *slog.Logger,
) ([]string, error) {
	if userName == "" {
		return nil, nil
	}
	plan := store.BuildSyncPlan(externalRoles)
	if client == nil {
		return nil, fmt.Errorf("PostgreSQL client is required for human role synchronization")
	}

	tx, err := client.Pool().Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin role sync: %w", err)
	}
	defer tx.Rollback(ctx) // no-op after Commit

	// Serialize IDP sync with manual assignment and PAT creation for this user.
	if _, err = tx.Exec(ctx,
		`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, userName); err != nil {
		return nil, fmt.Errorf("lock user role state: %w", err)
	}
	if _, err = tx.Exec(ctx, `
		INSERT INTO users (id, created_at, created_by)
		VALUES ($1, NOW(), $1)
		ON CONFLICT (id) DO NOTHING`, userName); err != nil {
		return nil, fmt.Errorf("upsert user: %w", err)
	}

	if _, err = tx.Exec(ctx, `
		INSERT INTO user_roles (user_id, role_name, assigned_by, assigned_at)
		SELECT $1, role_name, $3, NOW()
		FROM unnest($2::text[]) AS role_name
		ON CONFLICT (user_id, role_name) DO NOTHING`,
		userName, plan.MatchedRoles, idpSyncAssigner); err != nil {
		return nil, fmt.Errorf("add IDP role assignments: %w", err)
	}
	if _, err = tx.Exec(ctx, `
		DELETE FROM user_roles
		WHERE user_id = $1
		  AND assigned_by = $4
		  AND role_name = ANY($2::text[])
		  AND NOT (role_name = ANY($3::text[]))`,
		userName, plan.ForceRoles, plan.MatchedRoles, idpSyncAssigner); err != nil {
		return nil, fmt.Errorf("remove stale force role assignments: %w", err)
	}

	rows, err := tx.Query(ctx, `
		SELECT role_name, assigned_by,
		       role_name = ANY($2::text[]) AS defined,
		       role_name = ANY($3::text[]) AS idp_eligible
		FROM user_roles
		WHERE user_id = $1
		ORDER BY role_name`,
		userName, plan.DefinedRoles, plan.IDPEligibleRoles)
	if err != nil {
		return nil, fmt.Errorf("synchronize user roles: %w", err)
	}

	var roleNames []string
	for rows.Next() {
		var roleName, assignedBy string
		var defined, idpEligible bool
		if err := rows.Scan(&roleName, &assignedBy, &defined, &idpEligible); err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan synchronized role: %w", err)
		}
		if defined && (assignedBy != idpSyncAssigner || idpEligible) {
			roleNames = append(roleNames, roleName)
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, fmt.Errorf("read synchronized roles: %w", err)
	}
	rows.Close()
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit role sync: %w", err)
	}

	logger.Debug("synchronized user roles from ConfigMap definitions",
		slog.String("user", userName), slog.Any("roles", roleNames))
	return roleNames, nil
}
