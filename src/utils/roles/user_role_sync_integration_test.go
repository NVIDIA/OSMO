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
	"strings"
	"testing"

	"go.corp.nvidia.com/osmo/tests/common/database"
	"go.corp.nvidia.com/osmo/utils/roles"
)

// insertRoleWithSyncMode writes a roles row with the given sync_mode and an
// empty policies list. The roles table has a NOT NULL DEFAULT for policies,
// so the minimal insert is enough for the role-sync tests below.
func insertRoleWithSyncMode(t *testing.T, fixture *database.PostgresFixture,
	name, syncMode string) {
	t.Helper()
	fixture.ExecSQL(t,
		`INSERT INTO roles (name, sync_mode) VALUES ($1, $2)`, name, syncMode)
}

// insertRoleMapping creates an external→internal role mapping row.
func insertRoleMapping(t *testing.T, fixture *database.PostgresFixture,
	roleName, externalRole string) {
	t.Helper()
	fixture.ExecSQL(t,
		`INSERT INTO role_external_mappings (role_name, external_role)
		 VALUES ($1, $2)`, roleName, externalRole)
}

// insertUser creates a users row directly (bypassing SyncUserRoles' upsert) so
// pre-existing role assignments can be set up before the function under test
// runs.
func insertUser(t *testing.T, fixture *database.PostgresFixture, userID string) {
	t.Helper()
	fixture.ExecSQL(t,
		`INSERT INTO users (id, created_by) VALUES ($1, $1)`, userID)
}

// insertUserRole writes a user_roles row directly.
func insertUserRole(t *testing.T, fixture *database.PostgresFixture,
	userID, roleName string) {
	t.Helper()
	fixture.ExecSQL(t,
		`INSERT INTO user_roles (user_id, role_name) VALUES ($1, $2)`,
		userID, roleName)
}

// readUserRoleNames returns the role names currently assigned to userID,
// ordered by role_name for deterministic comparison.
func readUserRoleNames(t *testing.T, fixture *database.PostgresFixture,
	userID string) []string {
	t.Helper()
	rows, err := fixture.Pool.Query(context.Background(),
		`SELECT role_name FROM user_roles WHERE user_id = $1 ORDER BY role_name`,
		userID)
	if err != nil {
		t.Fatalf("failed to query user_roles: %v", err)
	}
	defer rows.Close()

	var names []string
	for rows.Next() {
		var name string
		if scanErr := rows.Scan(&name); scanErr != nil {
			t.Fatalf("scan failed: %v", scanErr)
		}
		names = append(names, name)
	}
	return names
}

// containsString reports whether slice contains target. Helper kept outside
// test bodies to avoid in-test loops.
func containsString(slice []string, target string) bool {
	for _, item := range slice {
		if item == target {
			return true
		}
	}
	return false
}

// TestSyncUserRoles_Integration_EmptyUserName covers the early-return guard
// for empty user names: SyncUserRoles must return (nil, nil) without writing
// to or reading from the database.
func TestSyncUserRoles_Integration_EmptyUserName(t *testing.T) {
	fixture := database.StartPostgresWithSchema(t)

	result, err := roles.SyncUserRoles(context.Background(), fixture.Client,
		"", []string{"idp-admins"}, silentLogger())
	if err != nil {
		t.Fatalf("expected nil error for empty userName, got: %v", err)
	}
	if result != nil {
		t.Errorf("expected nil result for empty userName, got: %v", result)
	}
}

// TestSyncUserRoles_Integration_ImportMode_AddsMappedRole covers the success
// path that exercises upsertUser, the syncAndReturnRoles SQL, the "added"
// change_type branch, and the logger.Info emit (because Added is non-empty).
// The role row pre-exists in the roles table; the user row is created by
// upsertUser inside SyncUserRoles.
func TestSyncUserRoles_Integration_ImportMode_AddsMappedRole(t *testing.T) {
	fixture := database.StartPostgresWithSchema(t)

	insertRoleWithSyncMode(t, fixture, "osmo-admin", roles.SyncModeImport)
	insertRoleMapping(t, fixture, "osmo-admin", "idp-admins")

	result, err := roles.SyncUserRoles(context.Background(), fixture.Client,
		"alice", []string{"idp-admins"}, silentLogger())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !containsString(result, "osmo-admin") {
		t.Errorf("expected returned roles to contain %q, got: %v",
			"osmo-admin", result)
	}

	stored := readUserRoleNames(t, fixture, "alice")
	if !containsString(stored, "osmo-admin") {
		t.Errorf("expected user_roles to contain %q after sync, got: %v",
			"osmo-admin", stored)
	}
}

// TestSyncUserRoles_Integration_ForceMode_RemovesUnmappedRole covers the
// "force" sync semantics that strip a role when its external mapping is
// absent from the request, and exercises the "removed" change_type branch
// of the row-scan switch.
func TestSyncUserRoles_Integration_ForceMode_RemovesUnmappedRole(t *testing.T) {
	fixture := database.StartPostgresWithSchema(t)

	insertRoleWithSyncMode(t, fixture, "osmo-eng", roles.SyncModeForce)
	insertRoleMapping(t, fixture, "osmo-eng", "idp-eng")
	insertUser(t, fixture, "bob")
	insertUserRole(t, fixture, "bob", "osmo-eng")

	// External roles do NOT include "idp-eng", so force-mode removes osmo-eng.
	result, err := roles.SyncUserRoles(context.Background(), fixture.Client,
		"bob", []string{"idp-other"}, silentLogger())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if containsString(result, "osmo-eng") {
		t.Errorf("expected returned roles NOT to contain force-removed %q, got: %v",
			"osmo-eng", result)
	}

	stored := readUserRoleNames(t, fixture, "bob")
	if containsString(stored, "osmo-eng") {
		t.Errorf("expected user_roles NOT to contain %q after force sync, got: %v",
			"osmo-eng", stored)
	}
}

// TestSyncUserRoles_Integration_ImportMode_DoesNotRemoveExisting covers the
// "import" semantics: an existing role is preserved even when its external
// mapping is absent. The role flows through the union as change_type
// "existing" and is returned in RoleNames without being deleted.
func TestSyncUserRoles_Integration_ImportMode_DoesNotRemoveExisting(t *testing.T) {
	fixture := database.StartPostgresWithSchema(t)

	insertRoleWithSyncMode(t, fixture, "osmo-viewer", roles.SyncModeImport)
	insertRoleMapping(t, fixture, "osmo-viewer", "idp-viewers")
	insertUser(t, fixture, "carol")
	insertUserRole(t, fixture, "carol", "osmo-viewer")

	result, err := roles.SyncUserRoles(context.Background(), fixture.Client,
		"carol", []string{"idp-other"}, silentLogger())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !containsString(result, "osmo-viewer") {
		t.Errorf("expected import-mode role to be retained, got: %v", result)
	}

	stored := readUserRoleNames(t, fixture, "carol")
	if !containsString(stored, "osmo-viewer") {
		t.Errorf("expected user_roles to still contain %q, got: %v",
			"osmo-viewer", stored)
	}
}

// TestSyncUserRoles_Integration_IgnoreMode_NotAddedEvenWhenMapped covers the
// SQL filter "WHERE r.sync_mode != $3" (where $3 is SyncModeIgnore): roles
// configured with sync_mode='ignore' are entirely outside the sync set, so
// even a matching external role does not cause assignment.
func TestSyncUserRoles_Integration_IgnoreMode_NotAddedEvenWhenMapped(t *testing.T) {
	fixture := database.StartPostgresWithSchema(t)

	insertRoleWithSyncMode(t, fixture, "osmo-static", roles.SyncModeIgnore)
	insertRoleMapping(t, fixture, "osmo-static", "idp-static")

	result, err := roles.SyncUserRoles(context.Background(), fixture.Client,
		"dave", []string{"idp-static"}, silentLogger())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if containsString(result, "osmo-static") {
		t.Errorf("expected ignore-mode role NOT to be added, got: %v", result)
	}

	stored := readUserRoleNames(t, fixture, "dave")
	if containsString(stored, "osmo-static") {
		t.Errorf("expected user_roles NOT to contain ignore-mode role, got: %v",
			stored)
	}
}

// TestSyncUserRoles_Integration_NilExternalRoles covers the
// "if len(externalRoles) == 0 { externalRoles = []string{} }" normalization:
// passing nil must not crash and must produce a usable text[] for the SQL
// driver. With force-mode roles defined but no current assignments, no
// inserts or deletes are performed.
func TestSyncUserRoles_Integration_NilExternalRoles(t *testing.T) {
	fixture := database.StartPostgresWithSchema(t)

	insertRoleWithSyncMode(t, fixture, "osmo-keep", roles.SyncModeForce)
	insertRoleMapping(t, fixture, "osmo-keep", "idp-keep")

	result, err := roles.SyncUserRoles(context.Background(), fixture.Client,
		"eve", nil, silentLogger())
	if err != nil {
		t.Fatalf("unexpected error for nil externalRoles: %v", err)
	}
	if len(result) != 0 {
		t.Errorf("expected empty result for new user with no external roles, got: %v",
			result)
	}
}

// TestSyncUserRoles_Integration_NoChanges_ReturnsExistingRole covers the
// "existing" change_type branch where the user already has the role, the
// external mapping still matches, and neither Added nor Removed is populated.
// This is the path where the logger.Info emit is skipped.
func TestSyncUserRoles_Integration_NoChanges_ReturnsExistingRole(t *testing.T) {
	fixture := database.StartPostgresWithSchema(t)

	insertRoleWithSyncMode(t, fixture, "osmo-stable", roles.SyncModeImport)
	insertRoleMapping(t, fixture, "osmo-stable", "idp-stable")
	insertUser(t, fixture, "frank")
	insertUserRole(t, fixture, "frank", "osmo-stable")

	result, err := roles.SyncUserRoles(context.Background(), fixture.Client,
		"frank", []string{"idp-stable"}, silentLogger())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !containsString(result, "osmo-stable") {
		t.Errorf("expected returned roles to contain pre-existing %q, got: %v",
			"osmo-stable", result)
	}
}

// TestSyncUserRoles_Integration_CanceledContext_UpsertError covers the error
// wrap "upsert user: <err>" returned by SyncUserRoles when upsertUser's
// Pool().Exec call fails. A canceled context fails the Exec immediately.
func TestSyncUserRoles_Integration_CanceledContext_UpsertError(t *testing.T) {
	fixture := database.StartPostgresWithSchema(t)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	result, err := roles.SyncUserRoles(ctx, fixture.Client,
		"user-x", []string{"idp"}, silentLogger())
	if err == nil {
		t.Fatalf("expected error from canceled context, got nil")
	}
	if !strings.Contains(err.Error(), "upsert user") {
		t.Errorf("expected error wrapped with %q, got: %v", "upsert user", err)
	}
	if result != nil {
		t.Errorf("expected nil result on error, got: %v", result)
	}
}

// TestSyncUserRoles_Integration_SyncQueryError covers the error wrap
// "sync user roles: <err>" returned by SyncUserRoles when the
// syncAndReturnRoles query fails. Dropping the roles table after the user
// upsert succeeds makes the sync query reference a missing table; upsertUser
// (which only touches users) still succeeds, so the second error path runs.
func TestSyncUserRoles_Integration_SyncQueryError(t *testing.T) {
	fixture := database.StartPostgresWithSchema(t)

	// CASCADE also drops user_roles and role_external_mappings (both FK into
	// roles), so syncAndReturnRoles' query references missing tables.
	fixture.ExecSQL(t, `DROP TABLE roles CASCADE`)

	result, err := roles.SyncUserRoles(context.Background(), fixture.Client,
		"user-y", []string{"idp"}, silentLogger())
	if err == nil {
		t.Fatalf("expected error after dropping roles table, got nil")
	}
	if !strings.Contains(err.Error(), "sync user roles") {
		t.Errorf("expected error wrapped with %q, got: %v",
			"sync user roles", err)
	}
	if result != nil {
		t.Errorf("expected nil result on error, got: %v", result)
	}
}
