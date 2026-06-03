//go:build integration

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

package roles_test

import (
	"context"
	"sort"
	"testing"

	"go.corp.nvidia.com/osmo/tests/common/database"
	"go.corp.nvidia.com/osmo/utils/roles"
)

// userRolesCount returns how many user_roles rows match (userID, roleName).
func userRolesCount(t *testing.T, fixture *database.PostgresFixture,
	userID, roleName string) int {
	t.Helper()
	var count int
	err := fixture.Pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM user_roles WHERE user_id = $1 AND role_name = $2`,
		userID, roleName).Scan(&count)
	if err != nil {
		t.Fatalf("count query failed: %v", err)
	}
	return count
}

// usersCount returns how many users rows have id == userID.
func usersCount(t *testing.T, fixture *database.PostgresFixture, userID string) int {
	t.Helper()
	var count int
	err := fixture.Pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM users WHERE id = $1`, userID).Scan(&count)
	if err != nil {
		t.Fatalf("count query failed: %v", err)
	}
	return count
}

// TestSyncUserRoles_Integration_CreatesUserAndReturnsEmpty covers the
// upsertUser INSERT branch (lines 83-88) and the empty-result code path of
// syncAndReturnRoles when no roles exist in the database. The function must
// create the users row, run the sync query without error, and return an
// empty role list.
func TestSyncUserRoles_Integration_CreatesUserAndReturnsEmpty(t *testing.T) {
	fixture := database.StartPostgresWithSchema(t)

	names, err := roles.SyncUserRoles(context.Background(), fixture.Client,
		"alice", []string{"ext-something"}, silentLogger())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(names) != 0 {
		t.Errorf("names = %v, want empty", names)
	}

	if got := usersCount(t, fixture, "alice"); got != 1 {
		t.Errorf("users count = %d, want 1 (upsertUser must INSERT new user)", got)
	}
}

// TestSyncUserRoles_Integration_UpsertUserIdempotent covers the
// ON CONFLICT (id) DO NOTHING clause: a second sync for the same user must
// not error and must leave only one users row.
func TestSyncUserRoles_Integration_UpsertUserIdempotent(t *testing.T) {
	fixture := database.StartPostgresWithSchema(t)

	if _, err := roles.SyncUserRoles(context.Background(), fixture.Client,
		"alice", nil, silentLogger()); err != nil {
		t.Fatalf("first sync failed: %v", err)
	}
	if _, err := roles.SyncUserRoles(context.Background(), fixture.Client,
		"alice", nil, silentLogger()); err != nil {
		t.Fatalf("second sync failed: %v", err)
	}

	if got := usersCount(t, fixture, "alice"); got != 1 {
		t.Errorf("users count = %d, want 1 (ON CONFLICT DO NOTHING)", got)
	}
}

// TestSyncUserRoles_Integration_NilExternalRolesNormalizedToEmpty covers the
// `if len(externalRoles) == 0 { externalRoles = []string{} }` branch
// (lines 63-64). Passing nil must not panic the SQL driver and must run the
// sync query successfully.
func TestSyncUserRoles_Integration_NilExternalRolesNormalizedToEmpty(t *testing.T) {
	fixture := database.StartPostgresWithSchema(t)

	fixture.ExecSQL(t,
		`INSERT INTO roles (name, sync_mode) VALUES ($1, $2)`,
		"developer", "force")

	names, err := roles.SyncUserRoles(context.Background(), fixture.Client,
		"alice", nil, silentLogger())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(names) != 0 {
		t.Errorf("names = %v, want empty", names)
	}
}

// TestSyncUserRoles_Integration_ImportAddsMappedRole covers the to_add CTE
// branch under sync_mode='import': a role that maps to one of the user's
// external roles must be added to user_roles, with assigned_by='idp-sync',
// and returned in the role-name list.
func TestSyncUserRoles_Integration_ImportAddsMappedRole(t *testing.T) {
	fixture := database.StartPostgresWithSchema(t)

	fixture.ExecSQL(t,
		`INSERT INTO roles (name, sync_mode) VALUES ($1, $2)`,
		"developer", "import")
	fixture.ExecSQL(t,
		`INSERT INTO role_external_mappings (role_name, external_role) VALUES ($1, $2)`,
		"developer", "ext-dev")

	names, err := roles.SyncUserRoles(context.Background(), fixture.Client,
		"alice", []string{"ext-dev"}, silentLogger())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(names) != 1 || names[0] != "developer" {
		t.Errorf("names = %v, want [developer]", names)
	}

	if got := userRolesCount(t, fixture, "alice", "developer"); got != 1 {
		t.Errorf("user_roles count = %d, want 1", got)
	}

	var assignedBy string
	if err := fixture.Pool.QueryRow(context.Background(),
		`SELECT assigned_by FROM user_roles WHERE user_id=$1 AND role_name=$2`,
		"alice", "developer").Scan(&assignedBy); err != nil {
		t.Fatalf("query failed: %v", err)
	}
	if assignedBy != "idp-sync" {
		t.Errorf("assigned_by = %q, want %q", assignedBy, "idp-sync")
	}
}

// TestSyncUserRoles_Integration_ImportNeverRemoves covers the negative side
// of the to_remove CTE: a role with sync_mode='import' that the user holds
// but that no longer maps to any external role MUST stay assigned.
func TestSyncUserRoles_Integration_ImportNeverRemoves(t *testing.T) {
	fixture := database.StartPostgresWithSchema(t)

	fixture.ExecSQL(t, `INSERT INTO users (id) VALUES ($1)`, "alice")
	fixture.ExecSQL(t,
		`INSERT INTO roles (name, sync_mode) VALUES ($1, $2)`,
		"developer", "import")
	fixture.ExecSQL(t,
		`INSERT INTO user_roles (user_id, role_name, assigned_by)
		 VALUES ($1, $2, 'idp-sync')`,
		"alice", "developer")

	names, err := roles.SyncUserRoles(context.Background(), fixture.Client,
		"alice", []string{}, silentLogger())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(names) != 1 || names[0] != "developer" {
		t.Errorf("names = %v, want [developer] (import must not revoke)", names)
	}
	if got := userRolesCount(t, fixture, "alice", "developer"); got != 1 {
		t.Errorf("user_roles count = %d, want 1", got)
	}
}

// TestSyncUserRoles_Integration_ForceRemovesUnmappedRole covers the to_remove
// CTE under sync_mode='force': a role currently held by the user, whose
// external mapping is no longer present in the request, must be deleted from
// user_roles and absent from the returned role list.
func TestSyncUserRoles_Integration_ForceRemovesUnmappedRole(t *testing.T) {
	fixture := database.StartPostgresWithSchema(t)

	fixture.ExecSQL(t, `INSERT INTO users (id) VALUES ($1)`, "alice")
	fixture.ExecSQL(t,
		`INSERT INTO roles (name, sync_mode) VALUES ($1, $2)`,
		"admin", "force")
	fixture.ExecSQL(t,
		`INSERT INTO role_external_mappings (role_name, external_role) VALUES ($1, $2)`,
		"admin", "ext-admin")
	fixture.ExecSQL(t,
		`INSERT INTO user_roles (user_id, role_name, assigned_by)
		 VALUES ($1, $2, 'idp-sync')`,
		"alice", "admin")

	names, err := roles.SyncUserRoles(context.Background(), fixture.Client,
		"alice", []string{"ext-unrelated"}, silentLogger())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(names) != 0 {
		t.Errorf("names = %v, want empty (admin must have been revoked)", names)
	}
	if got := userRolesCount(t, fixture, "alice", "admin"); got != 0 {
		t.Errorf("user_roles count = %d, want 0", got)
	}
}

// TestSyncUserRoles_Integration_IgnoreSkipsRole covers the WHERE
// `r.sync_mode != $3` predicate (where $3 is SyncModeIgnore): a role with
// sync_mode='ignore' that DOES map to an external role must not be added.
func TestSyncUserRoles_Integration_IgnoreSkipsRole(t *testing.T) {
	fixture := database.StartPostgresWithSchema(t)

	fixture.ExecSQL(t,
		`INSERT INTO roles (name, sync_mode) VALUES ($1, $2)`,
		"manual-role", "ignore")
	fixture.ExecSQL(t,
		`INSERT INTO role_external_mappings (role_name, external_role) VALUES ($1, $2)`,
		"manual-role", "ext-manual")

	names, err := roles.SyncUserRoles(context.Background(), fixture.Client,
		"alice", []string{"ext-manual"}, silentLogger())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(names) != 0 {
		t.Errorf("names = %v, want empty (ignore-mode role must not sync)", names)
	}
	if got := userRolesCount(t, fixture, "alice", "manual-role"); got != 0 {
		t.Errorf("user_roles count = %d, want 0", got)
	}
}

// TestSyncUserRoles_Integration_IgnoreDoesNotRevoke covers that an existing
// user_roles row for an ignore-mode role survives the sync untouched. The
// CTE filters ignore-mode roles out before the to_remove computation runs,
// so the row must remain after a sync that no longer maps to it.
func TestSyncUserRoles_Integration_IgnoreDoesNotRevoke(t *testing.T) {
	fixture := database.StartPostgresWithSchema(t)

	fixture.ExecSQL(t, `INSERT INTO users (id) VALUES ($1)`, "alice")
	fixture.ExecSQL(t,
		`INSERT INTO roles (name, sync_mode) VALUES ($1, $2)`,
		"manual-role", "ignore")
	fixture.ExecSQL(t,
		`INSERT INTO user_roles (user_id, role_name, assigned_by)
		 VALUES ($1, $2, 'manual')`,
		"alice", "manual-role")

	if _, err := roles.SyncUserRoles(context.Background(), fixture.Client,
		"alice", []string{}, silentLogger()); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if got := userRolesCount(t, fixture, "alice", "manual-role"); got != 1 {
		t.Errorf("user_roles count = %d, want 1 (ignore-mode role must survive)", got)
	}
}

// TestSyncUserRoles_Integration_ExistingRolePreserved covers the 'existing'
// branch in syncAndReturnRoles: a force-mode role the user already holds,
// whose external mapping is still present, must be returned in RoleNames
// (so the role survives) without being re-added.
func TestSyncUserRoles_Integration_ExistingRolePreserved(t *testing.T) {
	fixture := database.StartPostgresWithSchema(t)

	fixture.ExecSQL(t, `INSERT INTO users (id) VALUES ($1)`, "alice")
	fixture.ExecSQL(t,
		`INSERT INTO roles (name, sync_mode) VALUES ($1, $2)`,
		"developer", "force")
	fixture.ExecSQL(t,
		`INSERT INTO role_external_mappings (role_name, external_role) VALUES ($1, $2)`,
		"developer", "ext-dev")
	fixture.ExecSQL(t,
		`INSERT INTO user_roles (user_id, role_name, assigned_by)
		 VALUES ($1, $2, 'previous-assigner')`,
		"alice", "developer")

	names, err := roles.SyncUserRoles(context.Background(), fixture.Client,
		"alice", []string{"ext-dev"}, silentLogger())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(names) != 1 || names[0] != "developer" {
		t.Errorf("names = %v, want [developer]", names)
	}

	// The original assigned_by must not be overwritten because the role was
	// preserved as 'existing', not re-INSERTed.
	var assignedBy string
	if err := fixture.Pool.QueryRow(context.Background(),
		`SELECT assigned_by FROM user_roles WHERE user_id=$1 AND role_name=$2`,
		"alice", "developer").Scan(&assignedBy); err != nil {
		t.Fatalf("query failed: %v", err)
	}
	if assignedBy != "previous-assigner" {
		t.Errorf("assigned_by = %q, want %q (existing row must not be overwritten)",
			assignedBy, "previous-assigner")
	}
}

// TestSyncUserRoles_Integration_AddRemoveAndExistingTogether exercises every
// branch of the sync CTE in a single call: alice gains 'engineer'
// (mapped now), keeps 'developer' (still mapped — 'existing' branch), and
// loses 'admin' (no longer mapped, force-mode). This also covers the
// log-on-change path (lines 72-77) because both Added and Removed are
// non-empty.
func TestSyncUserRoles_Integration_AddRemoveAndExistingTogether(t *testing.T) {
	fixture := database.StartPostgresWithSchema(t)

	fixture.ExecSQL(t, `INSERT INTO users (id) VALUES ($1)`, "alice")

	fixture.ExecSQL(t,
		`INSERT INTO roles (name, sync_mode) VALUES ($1, $2)`,
		"engineer", "force")
	fixture.ExecSQL(t,
		`INSERT INTO roles (name, sync_mode) VALUES ($1, $2)`,
		"developer", "force")
	fixture.ExecSQL(t,
		`INSERT INTO roles (name, sync_mode) VALUES ($1, $2)`,
		"admin", "force")

	fixture.ExecSQL(t,
		`INSERT INTO role_external_mappings (role_name, external_role) VALUES ($1, $2)`,
		"engineer", "ext-eng")
	fixture.ExecSQL(t,
		`INSERT INTO role_external_mappings (role_name, external_role) VALUES ($1, $2)`,
		"developer", "ext-dev")
	fixture.ExecSQL(t,
		`INSERT INTO role_external_mappings (role_name, external_role) VALUES ($1, $2)`,
		"admin", "ext-admin")

	fixture.ExecSQL(t,
		`INSERT INTO user_roles (user_id, role_name, assigned_by)
		 VALUES ($1, $2, 'idp-sync')`,
		"alice", "developer")
	fixture.ExecSQL(t,
		`INSERT INTO user_roles (user_id, role_name, assigned_by)
		 VALUES ($1, $2, 'idp-sync')`,
		"alice", "admin")

	// External roles drop 'ext-admin' and add 'ext-eng' while keeping
	// 'ext-dev' — so admin should be removed, engineer added, developer
	// preserved.
	names, err := roles.SyncUserRoles(context.Background(), fixture.Client,
		"alice", []string{"ext-eng", "ext-dev"}, silentLogger())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	sort.Strings(names)
	if len(names) != 2 {
		t.Fatalf("len(names) = %d, want 2 (got %v)", len(names), names)
	}
	if names[0] != "developer" {
		t.Errorf("names[0] = %q, want %q", names[0], "developer")
	}
	if names[1] != "engineer" {
		t.Errorf("names[1] = %q, want %q", names[1], "engineer")
	}

	if got := userRolesCount(t, fixture, "alice", "admin"); got != 0 {
		t.Errorf("admin row count = %d, want 0 (must be revoked)", got)
	}
	if got := userRolesCount(t, fixture, "alice", "developer"); got != 1 {
		t.Errorf("developer row count = %d, want 1 (must be preserved)", got)
	}
	if got := userRolesCount(t, fixture, "alice", "engineer"); got != 1 {
		t.Errorf("engineer row count = %d, want 1 (must be added)", got)
	}
}

// TestSyncUserRoles_Integration_AddOnConflictIsIdempotent covers the
// `ON CONFLICT (user_id, role_name) DO NOTHING` clause inside the inserted
// CTE: running the same sync twice must not double-insert the row, and the
// second call must report the role as 'existing' rather than 'added'.
func TestSyncUserRoles_Integration_AddOnConflictIsIdempotent(t *testing.T) {
	fixture := database.StartPostgresWithSchema(t)

	fixture.ExecSQL(t,
		`INSERT INTO roles (name, sync_mode) VALUES ($1, $2)`,
		"developer", "import")
	fixture.ExecSQL(t,
		`INSERT INTO role_external_mappings (role_name, external_role) VALUES ($1, $2)`,
		"developer", "ext-dev")

	if _, err := roles.SyncUserRoles(context.Background(), fixture.Client,
		"alice", []string{"ext-dev"}, silentLogger()); err != nil {
		t.Fatalf("first sync failed: %v", err)
	}

	names, err := roles.SyncUserRoles(context.Background(), fixture.Client,
		"alice", []string{"ext-dev"}, silentLogger())
	if err != nil {
		t.Fatalf("second sync failed: %v", err)
	}
	if len(names) != 1 || names[0] != "developer" {
		t.Errorf("names = %v, want [developer]", names)
	}
	if got := userRolesCount(t, fixture, "alice", "developer"); got != 1 {
		t.Errorf("user_roles count = %d, want 1 (no duplicates)", got)
	}
}
