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

// insertSyncRole inserts a role row with an explicit sync_mode used by the
// IDP-sync tests below. Description, immutable, and policies are left at
// their defaults since this file only exercises the sync logic.
func insertSyncRole(t *testing.T, fixture *database.PostgresFixture,
	name, syncMode string) {
	t.Helper()
	fixture.ExecSQL(t,
		`INSERT INTO roles (name, description, immutable, sync_mode)
		 VALUES ($1, '', FALSE, $2)`,
		name, syncMode)
}

// insertExternalMapping wires an IDP role string to an OSMO role name in
// role_external_mappings, the table the sync query reads from to decide
// whether an OSMO role is "in_header".
func insertExternalMapping(t *testing.T, fixture *database.PostgresFixture,
	roleName, externalRole string) {
	t.Helper()
	fixture.ExecSQL(t,
		`INSERT INTO role_external_mappings (role_name, external_role)
		 VALUES ($1, $2)`,
		roleName, externalRole)
}

// insertUser inserts a row directly into the users table without going through
// SyncUserRoles. Used to set up pre-existing state for "user already known"
// scenarios so the test does not depend on the sync's own upsertUser side
// effect.
func insertUser(t *testing.T, fixture *database.PostgresFixture, userName string) {
	t.Helper()
	fixture.ExecSQL(t,
		`INSERT INTO users (id, created_by) VALUES ($1, $1)
		 ON CONFLICT (id) DO NOTHING`,
		userName)
}

// assignUserRole inserts directly into user_roles to set up a pre-existing
// role assignment so we can verify how the sync treats it (keep, remove, or
// "existing" passthrough).
func assignUserRole(t *testing.T, fixture *database.PostgresFixture,
	userName, roleName string) {
	t.Helper()
	fixture.ExecSQL(t,
		`INSERT INTO user_roles (user_id, role_name, assigned_by)
		 VALUES ($1, $2, 'test-setup')`,
		userName, roleName)
}

// TestSyncUserRoles_Integration_EmptyUserName covers the early-return branch
// at user_role_sync.go:55-56: passing an empty userName must short-circuit
// and return (nil, nil) without touching the database.
func TestSyncUserRoles_Integration_EmptyUserName(t *testing.T) {
	fixture := database.StartPostgresWithSchema(t)

	got, err := roles.SyncUserRoles(context.Background(), fixture.Client,
		"", []string{"idp-anything"}, silentLogger())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != nil {
		t.Errorf("got = %v, want nil for empty userName", got)
	}

	// Also verify upsertUser was NOT called: no row should exist in users.
	var count int
	if err := fixture.Pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM users`).Scan(&count); err != nil {
		t.Fatalf("count users: %v", err)
	}
	if count != 0 {
		t.Errorf("users count = %d, want 0 — empty userName should skip upsert", count)
	}
}

// TestSyncUserRoles_Integration_AddsForceRoleFromMapping covers the "added"
// switch arm and the force sync_mode add path: a user with no prior
// assignments gains an OSMO role whose external mapping matches the inbound
// IDP roles.
func TestSyncUserRoles_Integration_AddsForceRoleFromMapping(t *testing.T) {
	fixture := database.StartPostgresWithSchema(t)

	insertSyncRole(t, fixture, "osmo-admin", roles.SyncModeForce)
	insertExternalMapping(t, fixture, "osmo-admin", "idp-admin")

	got, err := roles.SyncUserRoles(context.Background(), fixture.Client,
		"alice", []string{"idp-admin"}, silentLogger())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 1 || got[0] != "osmo-admin" {
		t.Errorf("got = %v, want [osmo-admin]", got)
	}

	// Assignment must be persisted.
	var assignedBy string
	if err := fixture.Pool.QueryRow(context.Background(),
		`SELECT assigned_by FROM user_roles
		 WHERE user_id = $1 AND role_name = $2`,
		"alice", "osmo-admin").Scan(&assignedBy); err != nil {
		t.Fatalf("read user_roles: %v", err)
	}
	// The constant idpSyncAssigner is private to the package, but the contract
	// is that the sync writes a non-empty assigner string different from the
	// 'test-setup' value the test fixture uses.
	if assignedBy == "" || assignedBy == "test-setup" {
		t.Errorf("assigned_by = %q, want sync-managed assigner", assignedBy)
	}
}

// TestSyncUserRoles_Integration_AddsImportRoleFromMapping covers the same
// "added" path but for sync_mode=import — both modes share the IN ('import',
// 'force') predicate in the to_add CTE.
func TestSyncUserRoles_Integration_AddsImportRoleFromMapping(t *testing.T) {
	fixture := database.StartPostgresWithSchema(t)

	insertSyncRole(t, fixture, "osmo-viewer", roles.SyncModeImport)
	insertExternalMapping(t, fixture, "osmo-viewer", "idp-viewer")

	got, err := roles.SyncUserRoles(context.Background(), fixture.Client,
		"bob", []string{"idp-viewer"}, silentLogger())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 1 || got[0] != "osmo-viewer" {
		t.Errorf("got = %v, want [osmo-viewer]", got)
	}
}

// TestSyncUserRoles_Integration_RemovesForceRoleNoLongerMapped covers the
// "removed" switch arm and the force sync_mode remove path: a user previously
// assigned a force-managed OSMO role loses it when no inbound IDP role still
// maps to it.
func TestSyncUserRoles_Integration_RemovesForceRoleNoLongerMapped(t *testing.T) {
	fixture := database.StartPostgresWithSchema(t)

	insertSyncRole(t, fixture, "osmo-admin", roles.SyncModeForce)
	insertExternalMapping(t, fixture, "osmo-admin", "idp-admin")
	insertUser(t, fixture, "carol")
	assignUserRole(t, fixture, "carol", "osmo-admin")

	got, err := roles.SyncUserRoles(context.Background(), fixture.Client,
		"carol", []string{"idp-other"}, silentLogger())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("got = %v, want []", got)
	}

	// The assignment must actually be deleted from user_roles.
	var count int
	if err := fixture.Pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM user_roles
		 WHERE user_id = $1 AND role_name = $2`,
		"carol", "osmo-admin").Scan(&count); err != nil {
		t.Fatalf("count user_roles: %v", err)
	}
	if count != 0 {
		t.Errorf("user_roles count = %d, want 0", count)
	}
}

// TestSyncUserRoles_Integration_ImportNeverRemoves covers the contract that
// makes import distinct from force: the to_remove CTE filters on
// sync_mode = 'force', so an import role assigned to a user must persist
// across syncs even when its IDP mapping disappears. The role should round-
// trip through the "existing" change_type branch.
func TestSyncUserRoles_Integration_ImportNeverRemoves(t *testing.T) {
	fixture := database.StartPostgresWithSchema(t)

	insertSyncRole(t, fixture, "osmo-keeper", roles.SyncModeImport)
	insertExternalMapping(t, fixture, "osmo-keeper", "idp-keeper")
	insertUser(t, fixture, "dave")
	assignUserRole(t, fixture, "dave", "osmo-keeper")

	got, err := roles.SyncUserRoles(context.Background(), fixture.Client,
		"dave", []string{"idp-other"}, silentLogger())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 1 || got[0] != "osmo-keeper" {
		t.Errorf("got = %v, want [osmo-keeper] (import role must persist)", got)
	}
}

// TestSyncUserRoles_Integration_IgnoreRoleNotTouched covers the
// `WHERE r.sync_mode != 'ignore'` filter in the sync_info CTE: roles in
// ignore mode are excluded from add/remove processing. A pre-existing
// assignment to such a role must be preserved and surfaced via the
// "existing" change_type branch in the final UNION ALL.
func TestSyncUserRoles_Integration_IgnoreRoleNotTouched(t *testing.T) {
	fixture := database.StartPostgresWithSchema(t)

	insertSyncRole(t, fixture, "osmo-manual", roles.SyncModeIgnore)
	insertUser(t, fixture, "eve")
	assignUserRole(t, fixture, "eve", "osmo-manual")

	got, err := roles.SyncUserRoles(context.Background(), fixture.Client,
		"eve", []string{"idp-anything"}, silentLogger())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 1 || got[0] != "osmo-manual" {
		t.Errorf("got = %v, want [osmo-manual] (ignore mode must keep role)", got)
	}
}

// TestSyncUserRoles_Integration_EmptyExternalRolesNormalised covers the
// `len(externalRoles) == 0` branch at user_role_sync.go:63-64 (the nil →
// []string{} normalisation needed so the SQL ANY($2) clause receives a typed
// array). Verifies that with no inbound IDP roles, force-managed assignments
// are dropped while import-managed assignments persist.
func TestSyncUserRoles_Integration_EmptyExternalRolesNormalised(t *testing.T) {
	fixture := database.StartPostgresWithSchema(t)

	insertSyncRole(t, fixture, "osmo-force", roles.SyncModeForce)
	insertSyncRole(t, fixture, "osmo-import", roles.SyncModeImport)
	insertExternalMapping(t, fixture, "osmo-force", "idp-force")
	insertExternalMapping(t, fixture, "osmo-import", "idp-import")

	insertUser(t, fixture, "frank")
	assignUserRole(t, fixture, "frank", "osmo-force")
	assignUserRole(t, fixture, "frank", "osmo-import")

	got, err := roles.SyncUserRoles(context.Background(), fixture.Client,
		"frank", nil, silentLogger())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	sort.Strings(got)
	if len(got) != 1 || got[0] != "osmo-import" {
		t.Errorf("got = %v, want [osmo-import] (force should drop, import stay)", got)
	}
}

// TestSyncUserRoles_Integration_AddsAndRemovesInOneCall covers the joint
// path where the same sync simultaneously adds and removes roles. This
// exercises:
//   - The logger.Info branch at user_role_sync.go:72-77, which only fires
//     when len(Added) > 0 || len(Removed) > 0.
//   - All three change_type branches of the final UNION ALL: 'added',
//     'removed', and 'existing'.
func TestSyncUserRoles_Integration_AddsAndRemovesInOneCall(t *testing.T) {
	fixture := database.StartPostgresWithSchema(t)

	insertSyncRole(t, fixture, "osmo-old", roles.SyncModeForce)
	insertSyncRole(t, fixture, "osmo-new", roles.SyncModeForce)
	insertSyncRole(t, fixture, "osmo-keep", roles.SyncModeImport)
	insertExternalMapping(t, fixture, "osmo-old", "idp-old")
	insertExternalMapping(t, fixture, "osmo-new", "idp-new")
	insertExternalMapping(t, fixture, "osmo-keep", "idp-keep")

	insertUser(t, fixture, "grace")
	assignUserRole(t, fixture, "grace", "osmo-old")
	assignUserRole(t, fixture, "grace", "osmo-keep")

	got, err := roles.SyncUserRoles(context.Background(), fixture.Client,
		"grace", []string{"idp-new", "idp-keep"}, silentLogger())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	sort.Strings(got)
	want := []string{"osmo-keep", "osmo-new"}
	if len(got) != len(want) {
		t.Fatalf("got = %v, want %v", got, want)
	}
	if got[0] != want[0] || got[1] != want[1] {
		t.Errorf("got = %v, want %v", got, want)
	}

	// And the database must reflect the sync: osmo-old gone, osmo-new
	// inserted, osmo-keep untouched.
	rows, err := fixture.Pool.Query(context.Background(),
		`SELECT role_name FROM user_roles WHERE user_id = $1 ORDER BY role_name`,
		"grace")
	if err != nil {
		t.Fatalf("read user_roles: %v", err)
	}
	defer rows.Close()
	var assigned []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatalf("scan: %v", err)
		}
		assigned = append(assigned, name)
	}
	if len(assigned) != 2 || assigned[0] != "osmo-keep" || assigned[1] != "osmo-new" {
		t.Errorf("user_roles = %v, want [osmo-keep osmo-new]", assigned)
	}
}

// TestSyncUserRoles_Integration_NoChangesSkipsLogger covers the path where
// the sync produces neither adds nor removes — Added and Removed both empty,
// so the `if` block at user_role_sync.go:72-77 must NOT fire. The function
// still returns the user's role names from the "existing" change_type
// branch.
func TestSyncUserRoles_Integration_NoChangesSkipsLogger(t *testing.T) {
	fixture := database.StartPostgresWithSchema(t)

	insertSyncRole(t, fixture, "osmo-stable", roles.SyncModeForce)
	insertExternalMapping(t, fixture, "osmo-stable", "idp-stable")
	insertUser(t, fixture, "henry")
	assignUserRole(t, fixture, "henry", "osmo-stable")

	got, err := roles.SyncUserRoles(context.Background(), fixture.Client,
		"henry", []string{"idp-stable"}, silentLogger())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 1 || got[0] != "osmo-stable" {
		t.Errorf("got = %v, want [osmo-stable]", got)
	}
}

// TestSyncUserRoles_Integration_UpsertUserIdempotent covers the upsertUser
// helper at user_role_sync.go:83-88. The first call inserts the row; the
// second call must not error thanks to ON CONFLICT (id) DO NOTHING.
func TestSyncUserRoles_Integration_UpsertUserIdempotent(t *testing.T) {
	fixture := database.StartPostgresWithSchema(t)

	insertSyncRole(t, fixture, "osmo-role", roles.SyncModeForce)
	insertExternalMapping(t, fixture, "osmo-role", "idp-role")

	first, err := roles.SyncUserRoles(context.Background(), fixture.Client,
		"ivy", []string{"idp-role"}, silentLogger())
	if err != nil {
		t.Fatalf("first sync error: %v", err)
	}
	if len(first) != 1 || first[0] != "osmo-role" {
		t.Errorf("first sync got %v, want [osmo-role]", first)
	}

	second, err := roles.SyncUserRoles(context.Background(), fixture.Client,
		"ivy", []string{"idp-role"}, silentLogger())
	if err != nil {
		t.Fatalf("second sync error: %v", err)
	}
	if len(second) != 1 || second[0] != "osmo-role" {
		t.Errorf("second sync got %v, want [osmo-role]", second)
	}

	// users table should still hold exactly one row for ivy.
	var count int
	if err := fixture.Pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM users WHERE id = $1`, "ivy").Scan(&count); err != nil {
		t.Fatalf("count users: %v", err)
	}
	if count != 1 {
		t.Errorf("users count = %d, want 1 (upsert must be idempotent)", count)
	}
}

// TestSyncUserRoles_Integration_NoMappedRolesNoChange covers the case where
// no roles are configured at all: sync_info is empty, no adds, no removes.
// Returns an empty slice with no error.
func TestSyncUserRoles_Integration_NoMappedRolesNoChange(t *testing.T) {
	fixture := database.StartPostgresWithSchema(t)

	got, err := roles.SyncUserRoles(context.Background(), fixture.Client,
		"jack", []string{"idp-anything"}, silentLogger())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("got = %v, want empty (no mapped roles → no assignments)", got)
	}
}
