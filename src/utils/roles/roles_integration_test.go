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
	"fmt"
	"io"
	"log/slog"
	"sort"
	"strings"
	"testing"

	"go.corp.nvidia.com/osmo/tests/common/database"
	"go.corp.nvidia.com/osmo/utils/roles"
)

// silentLogger returns a slog.Logger that discards all output, keeping test
// output focused on the failures themselves.
func silentLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// insertRole writes a single role row directly into the roles table.
// policiesJSON values are raw JSON object strings (no surrounding quotes)
// that will each become an element of the row's JSONB[] array column.
func insertRole(t *testing.T, fixture *database.PostgresFixture,
	name, description string, immutable bool, policiesJSON []string) {
	t.Helper()

	// Build a parameterized "ARRAY[$4::jsonb, $5::jsonb, ...]::jsonb[]"
	// fragment so each policy is passed as a typed parameter rather than
	// embedded into the SQL text.
	placeholders := make([]string, len(policiesJSON))
	args := []any{name, description, immutable}
	for i, policy := range policiesJSON {
		placeholders[i] = fmt.Sprintf("$%d::jsonb", i+4)
		args = append(args, policy)
	}

	arrayExpr := "ARRAY[]::jsonb[]"
	if len(placeholders) > 0 {
		arrayExpr = "ARRAY[" + strings.Join(placeholders, ",") + "]::jsonb[]"
	}

	query := "INSERT INTO roles (name, description, immutable, policies) " +
		"VALUES ($1, $2, $3, " + arrayExpr + ")"

	if _, err := fixture.Pool.Exec(context.Background(), query, args...); err != nil {
		t.Fatalf("failed to insert role %q: %v", name, err)
	}
}

// TestGetRoles_Integration_LoadsRoleAndPolicies covers the success path of
// GetRoles end-to-end: query, scan, policies-array unmarshal, individual
// policy unmarshal, default-effect promotion, and Resources nil→empty
// initialization.
func TestGetRoles_Integration_LoadsRoleAndPolicies(t *testing.T) {
	fixture := database.StartPostgresWithSchema(t)

	// Two policies so we exercise the inner per-policy loop more than once.
	// First policy uses an explicit Deny effect and a resource list; second
	// policy omits both (so the loader must default Effect to Allow and
	// initialize Resources to an empty slice).
	insertRole(t, fixture, "osmo-test", "test role", true, []string{
		`{"effect":"Deny","actions":["workflow:Delete"],"resources":["workflow/prod-*"]}`,
		`{"actions":["workflow:Read"]}`,
	})

	loaded, err := roles.GetRoles(context.Background(), fixture.Client,
		[]string{"osmo-test"}, silentLogger())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(loaded) != 1 {
		t.Fatalf("len(loaded) = %d, want 1", len(loaded))
	}

	role := loaded[0]
	if role.Name != "osmo-test" {
		t.Errorf("Name = %q, want %q", role.Name, "osmo-test")
	}
	if role.Description != "test role" {
		t.Errorf("Description = %q, want %q", role.Description, "test role")
	}
	if !role.Immutable {
		t.Errorf("Immutable = false, want true")
	}

	if len(role.Policies) != 2 {
		t.Fatalf("len(Policies) = %d, want 2", len(role.Policies))
	}

	// First policy: explicit Deny, explicit resources list.
	policy0 := role.Policies[0]
	if policy0.Effect != roles.EffectDeny {
		t.Errorf("Policies[0].Effect = %q, want %q", policy0.Effect, roles.EffectDeny)
	}
	if len(policy0.Resources) != 1 || policy0.Resources[0] != "workflow/prod-*" {
		t.Errorf("Policies[0].Resources = %v, want [workflow/prod-*]", policy0.Resources)
	}
	if len(policy0.Actions) != 1 || policy0.Actions[0].Action != "workflow:Delete" {
		t.Errorf("Policies[0].Actions = %v, want [workflow:Delete]", policy0.Actions)
	}

	// Second policy: missing effect → defaulted to Allow; missing resources →
	// initialized to non-nil empty slice (the explicit []string{} branch).
	policy1 := role.Policies[1]
	if policy1.Effect != roles.EffectAllow {
		t.Errorf("Policies[1].Effect = %q, want %q (default Allow)",
			policy1.Effect, roles.EffectAllow)
	}
	if policy1.Resources == nil {
		t.Errorf("Policies[1].Resources is nil; GetRoles should initialize it to []string{}")
	}
	if len(policy1.Resources) != 0 {
		t.Errorf("len(Policies[1].Resources) = %d, want 0", len(policy1.Resources))
	}
}

// TestGetRoles_Integration_OrdersByName covers the ORDER BY name clause and
// confirms multiple roles round-trip in deterministic order.
func TestGetRoles_Integration_OrdersByName(t *testing.T) {
	fixture := database.StartPostgresWithSchema(t)

	insertRole(t, fixture, "z-role", "", false,
		[]string{`{"actions":["workflow:Read"]}`})
	insertRole(t, fixture, "a-role", "", false,
		[]string{`{"actions":["workflow:Read"]}`})
	insertRole(t, fixture, "m-role", "", false,
		[]string{`{"actions":["workflow:Read"]}`})

	loaded, err := roles.GetRoles(context.Background(), fixture.Client,
		[]string{"z-role", "a-role", "m-role"}, silentLogger())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(loaded) != 3 {
		t.Fatalf("len(loaded) = %d, want 3", len(loaded))
	}

	want := []string{"a-role", "m-role", "z-role"}
	for i, r := range loaded {
		if r.Name != want[i] {
			t.Errorf("loaded[%d].Name = %q, want %q", i, r.Name, want[i])
		}
	}
}

// TestGetRoles_Integration_NoMatchingRoles covers the path where the query
// runs successfully but returns zero rows: no scans happen, the result slice
// is nil but the function returns no error.
func TestGetRoles_Integration_NoMatchingRoles(t *testing.T) {
	fixture := database.StartPostgresWithSchema(t)

	loaded, err := roles.GetRoles(context.Background(), fixture.Client,
		[]string{"does-not-exist"}, silentLogger())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(loaded) != 0 {
		t.Errorf("len(loaded) = %d, want 0", len(loaded))
	}
}

// TestGetRoles_Integration_PolicyUnmarshalError covers the inner-loop error
// path where a policy element in the JSONB[] array has a value the
// RolePolicy struct can't decode (here, "actions" is a number rather than
// an array of actions, which fails the RoleActions custom UnmarshalJSON).
func TestGetRoles_Integration_PolicyUnmarshalError(t *testing.T) {
	fixture := database.StartPostgresWithSchema(t)

	// Insert a row whose first policy is malformed: actions must be a JSON
	// array but here it is a number, so RoleActions.UnmarshalJSON returns an
	// error which propagates out of GetRoles.
	insertRole(t, fixture, "broken-role", "", false,
		[]string{`{"actions":42}`})

	_, err := roles.GetRoles(context.Background(), fixture.Client,
		[]string{"broken-role"}, silentLogger())
	if err == nil {
		t.Fatalf("expected error for malformed policy actions, got nil")
	}
}

// TestGetAllRoleNames_Integration_ReturnsSortedNames covers GetAllRoleNames
// end-to-end including the ORDER BY name clause and the row scan loop.
func TestGetAllRoleNames_Integration_ReturnsSortedNames(t *testing.T) {
	fixture := database.StartPostgresWithSchema(t)

	insertRole(t, fixture, "beta", "", false,
		[]string{`{"actions":["workflow:Read"]}`})
	insertRole(t, fixture, "alpha", "", false,
		[]string{`{"actions":["workflow:Read"]}`})
	insertRole(t, fixture, "gamma", "", false,
		[]string{`{"actions":["workflow:Read"]}`})

	names, err := roles.GetAllRoleNames(context.Background(), fixture.Client)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	want := []string{"alpha", "beta", "gamma"}
	if len(names) != len(want) {
		t.Fatalf("len(names) = %d, want %d", len(names), len(want))
	}
	if !sort.StringsAreSorted(names) {
		t.Errorf("names = %v, want sorted", names)
	}
	for i, n := range names {
		if n != want[i] {
			t.Errorf("names[%d] = %q, want %q", i, n, want[i])
		}
	}
}

// TestGetAllRoleNames_Integration_EmptyTable covers the path where no rows
// are returned: the function should return a nil slice and no error.
func TestGetAllRoleNames_Integration_EmptyTable(t *testing.T) {
	fixture := database.StartPostgresWithSchema(t)

	names, err := roles.GetAllRoleNames(context.Background(), fixture.Client)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(names) != 0 {
		t.Errorf("len(names) = %d, want 0", len(names))
	}
}

// TestGetPoolForWorkflow_Integration_ReturnsPool covers the success path of
// GetPoolForWorkflow: a row exists and the pool string is returned.
func TestGetPoolForWorkflow_Integration_ReturnsPool(t *testing.T) {
	fixture := database.StartPostgresWithSchema(t)

	fixture.ExecSQL(t,
		`INSERT INTO workflows (workflow_id, pool) VALUES ($1, $2)`,
		"wf-123", "pool-prod")

	pool, err := roles.GetPoolForWorkflow(
		context.Background(), fixture.Client, "wf-123")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if pool != "pool-prod" {
		t.Errorf("pool = %q, want %q", pool, "pool-prod")
	}
}

// TestGetPoolForWorkflow_Integration_NotFound covers the error path: when
// no row matches, QueryRow.Scan returns sql.ErrNoRows wrapped by the
// caller, and pool is the empty string.
func TestGetPoolForWorkflow_Integration_NotFound(t *testing.T) {
	fixture := database.StartPostgresWithSchema(t)

	pool, err := roles.GetPoolForWorkflow(
		context.Background(), fixture.Client, "missing-wf")
	if err == nil {
		t.Fatalf("expected error for missing workflow, got nil")
	}
	if pool != "" {
		t.Errorf("pool = %q on error, want empty string", pool)
	}
}

// TestUpdateRolePolicies_Integration_PersistsPolicies covers UpdateRolePolicies
// end-to-end: marshal each policy to JSON, write them as a JSONB[], then
// verify by reading the row back through GetRoles.
func TestUpdateRolePolicies_Integration_PersistsPolicies(t *testing.T) {
	fixture := database.StartPostgresWithSchema(t)

	// Seed a role with one policy; we'll overwrite its policies below.
	insertRole(t, fixture, "mutable-role", "", false,
		[]string{`{"actions":["workflow:Read"]}`})

	updated := &roles.Role{
		Name: "mutable-role",
		Policies: []roles.RolePolicy{
			{
				Effect:    roles.EffectAllow,
				Actions:   roles.RoleActions{{Action: "dataset:Read"}},
				Resources: []string{"bucket/public"},
			},
			{
				Effect:    roles.EffectDeny,
				Actions:   roles.RoleActions{{Action: "workflow:Delete"}},
				Resources: []string{"workflow/prod-*"},
			},
		},
	}

	if err := roles.UpdateRolePolicies(context.Background(), fixture.Client,
		updated, silentLogger()); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Read it back to make sure the bytes survived a round-trip through
	// PostgreSQL's JSONB[] storage and the loader's policy parser.
	loaded, err := roles.GetRoles(context.Background(), fixture.Client,
		[]string{"mutable-role"}, silentLogger())
	if err != nil {
		t.Fatalf("GetRoles after UpdateRolePolicies failed: %v", err)
	}
	if len(loaded) != 1 {
		t.Fatalf("len(loaded) = %d, want 1", len(loaded))
	}

	got := loaded[0]
	if len(got.Policies) != 2 {
		t.Fatalf("len(Policies) = %d, want 2", len(got.Policies))
	}

	if got.Policies[0].Effect != roles.EffectAllow {
		t.Errorf("Policies[0].Effect = %q, want %q",
			got.Policies[0].Effect, roles.EffectAllow)
	}
	if len(got.Policies[0].Actions) != 1 ||
		got.Policies[0].Actions[0].Action != "dataset:Read" {
		t.Errorf("Policies[0].Actions = %v, want [dataset:Read]",
			got.Policies[0].Actions)
	}
	if len(got.Policies[0].Resources) != 1 ||
		got.Policies[0].Resources[0] != "bucket/public" {
		t.Errorf("Policies[0].Resources = %v, want [bucket/public]",
			got.Policies[0].Resources)
	}

	if got.Policies[1].Effect != roles.EffectDeny {
		t.Errorf("Policies[1].Effect = %q, want %q",
			got.Policies[1].Effect, roles.EffectDeny)
	}
	if len(got.Policies[1].Actions) != 1 ||
		got.Policies[1].Actions[0].Action != "workflow:Delete" {
		t.Errorf("Policies[1].Actions = %v, want [workflow:Delete]",
			got.Policies[1].Actions)
	}
}

// TestUpdateRolePolicies_Integration_EmptyPoliciesList covers the empty-slice
// path: the policies array is overwritten with an empty JSONB[] and the
// stored row reflects that change.
func TestUpdateRolePolicies_Integration_EmptyPoliciesList(t *testing.T) {
	fixture := database.StartPostgresWithSchema(t)

	insertRole(t, fixture, "to-empty", "", false,
		[]string{`{"actions":["workflow:Read"]}`})

	emptied := &roles.Role{
		Name:     "to-empty",
		Policies: []roles.RolePolicy{},
	}
	if err := roles.UpdateRolePolicies(context.Background(), fixture.Client,
		emptied, silentLogger()); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	loaded, err := roles.GetRoles(context.Background(), fixture.Client,
		[]string{"to-empty"}, silentLogger())
	if err != nil {
		t.Fatalf("GetRoles failed: %v", err)
	}
	if len(loaded) != 1 {
		t.Fatalf("len(loaded) = %d, want 1", len(loaded))
	}
	if len(loaded[0].Policies) != 0 {
		t.Errorf("len(Policies) = %d, want 0", len(loaded[0].Policies))
	}
}

// TestUpdateRolePolicies_Integration_NoMatchingRow covers the case where the
// UPDATE matches zero rows. pgx's Exec does not surface this as an error
// (RowsAffected == 0 is not an error condition), so the function returns
// nil — verify that, and also verify no row was created.
func TestUpdateRolePolicies_Integration_NoMatchingRow(t *testing.T) {
	fixture := database.StartPostgresWithSchema(t)

	missing := &roles.Role{
		Name: "ghost-role",
		Policies: []roles.RolePolicy{
			{Actions: roles.RoleActions{{Action: "workflow:Read"}}},
		},
	}
	if err := roles.UpdateRolePolicies(context.Background(), fixture.Client,
		missing, silentLogger()); err != nil {
		t.Fatalf("unexpected error for missing row: %v", err)
	}

	loaded, err := roles.GetRoles(context.Background(), fixture.Client,
		[]string{"ghost-role"}, silentLogger())
	if err != nil {
		t.Fatalf("GetRoles failed: %v", err)
	}
	if len(loaded) != 0 {
		t.Errorf("UPDATE on missing row should not have created one; loaded = %d", len(loaded))
	}
}
