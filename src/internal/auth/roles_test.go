/*
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION. All rights reserved.

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

package auth

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/pashagolub/pgxmock/v4"
)

// Helper to create policy JSON bytes for mock rows
func makePolicyJSON(t *testing.T, actions []RoleAction) []byte {
	t.Helper()
	policy := RolePolicy{Actions: actions}
	b, err := json.Marshal(policy)
	if err != nil {
		t.Fatalf("failed to marshal policy: %v", err)
	}
	return b
}

func TestRoleChecker_CheckAccess_AdminRole(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("failed to create mock: %v", err)
	}
	defer mock.Close()

	// Admin role policy: allows everything except specific paths
	adminPolicy := makePolicyJSON(t, []RoleAction{
		{Base: "http", Path: "*", Method: "*"},
		{Base: "http", Path: "!/api/agent/*", Method: "*"},
	})

	mock.ExpectQuery("SELECT name, policies").
		WithArgs([]string{"osmo-admin", "osmo-default"}).
		WillReturnRows(
			pgxmock.NewRows([]string{"name", "policies"}).
				AddRow("osmo-admin", [][]byte{adminPolicy}),
		)

	rc := NewRoleChecker(mock, nil)
	allowed, err := rc.CheckAccess(context.Background(), []string{"osmo-admin"}, "/api/workflow", "Get")

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !allowed {
		t.Error("expected access to be allowed for admin role")
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

func TestRoleChecker_CheckAccess_AdminExclusion(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("failed to create mock: %v", err)
	}
	defer mock.Close()

	// Admin role with exclusion for /api/agent/*
	adminPolicy := makePolicyJSON(t, []RoleAction{
		{Base: "http", Path: "*", Method: "*"},
		{Base: "http", Path: "!/api/agent/*", Method: "*"},
	})

	mock.ExpectQuery("SELECT name, policies").
		WithArgs([]string{"osmo-admin", "osmo-default"}).
		WillReturnRows(
			pgxmock.NewRows([]string{"name", "policies"}).
				AddRow("osmo-admin", [][]byte{adminPolicy}),
		)

	rc := NewRoleChecker(mock, nil)
	// Access to /api/agent/listener should be denied due to exclusion pattern
	allowed, err := rc.CheckAccess(context.Background(), []string{"osmo-admin"}, "/api/agent/listener", "Get")

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if allowed {
		t.Error("expected access to be denied for excluded path /api/agent/*")
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

func TestRoleChecker_CheckAccess_UserRole(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("failed to create mock: %v", err)
	}
	defer mock.Close()

	// User role policy: allows specific paths
	userPolicy := makePolicyJSON(t, []RoleAction{
		{Base: "http", Path: "/api/workflow", Method: "*"},
		{Base: "http", Path: "/api/workflow/*", Method: "*"},
		{Base: "http", Path: "/api/task", Method: "*"},
		{Base: "http", Path: "/api/task/*", Method: "*"},
	})

	mock.ExpectQuery("SELECT name, policies").
		WithArgs([]string{"osmo-user", "osmo-default"}).
		WillReturnRows(
			pgxmock.NewRows([]string{"name", "policies"}).
				AddRow("osmo-user", [][]byte{userPolicy}),
		)

	rc := NewRoleChecker(mock, nil)
	allowed, err := rc.CheckAccess(context.Background(), []string{"osmo-user"}, "/api/workflow", "Get")

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !allowed {
		t.Error("expected access to be allowed for user role on /api/workflow")
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

func TestRoleChecker_CheckAccess_UserRoleDenied(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("failed to create mock: %v", err)
	}
	defer mock.Close()

	// User role policy: allows specific paths only
	userPolicy := makePolicyJSON(t, []RoleAction{
		{Base: "http", Path: "/api/workflow", Method: "*"},
		{Base: "http", Path: "/api/workflow/*", Method: "*"},
	})

	mock.ExpectQuery("SELECT name, policies").
		WithArgs([]string{"osmo-user", "osmo-default"}).
		WillReturnRows(
			pgxmock.NewRows([]string{"name", "policies"}).
				AddRow("osmo-user", [][]byte{userPolicy}),
		)

	rc := NewRoleChecker(mock, nil)
	// Admin path should be denied for user role
	allowed, err := rc.CheckAccess(context.Background(), []string{"osmo-user"}, "/api/admin/config", "Get")

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if allowed {
		t.Error("expected access to be denied for user role on /api/admin/*")
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

func TestRoleChecker_CheckAccess_DefaultRoleAutoAdded(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("failed to create mock: %v", err)
	}
	defer mock.Close()

	// Default role allows health endpoint
	defaultPolicy := makePolicyJSON(t, []RoleAction{
		{Base: "http", Path: "/health", Method: "*"},
		{Base: "http", Path: "/api/version", Method: "*"},
	})

	// Verify osmo-default is added to the query
	mock.ExpectQuery("SELECT name, policies").
		WithArgs([]string{"some-custom-role", "osmo-default"}).
		WillReturnRows(
			pgxmock.NewRows([]string{"name", "policies"}).
				AddRow("osmo-default", [][]byte{defaultPolicy}),
		)

	rc := NewRoleChecker(mock, nil)
	allowed, err := rc.CheckAccess(context.Background(), []string{"some-custom-role"}, "/health", "Get")

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !allowed {
		t.Error("expected access to be allowed via osmo-default role")
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

func TestRoleChecker_CheckAccess_MethodMatching(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("failed to create mock: %v", err)
	}
	defer mock.Close()

	// Role that only allows GET method
	policy := makePolicyJSON(t, []RoleAction{
		{Base: "http", Path: "/api/readonly/*", Method: "Get"},
	})

	mock.ExpectQuery("SELECT name, policies").
		WithArgs([]string{"readonly-role", "osmo-default"}).
		WillReturnRows(
			pgxmock.NewRows([]string{"name", "policies"}).
				AddRow("readonly-role", [][]byte{policy}),
		)

	rc := NewRoleChecker(mock, nil)
	// POST should be denied
	allowed, err := rc.CheckAccess(context.Background(), []string{"readonly-role"}, "/api/readonly/data", "Post")

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if allowed {
		t.Error("expected access to be denied for POST when only GET is allowed")
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

func TestRoleChecker_CheckAccess_MethodMatchingCaseInsensitive(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("failed to create mock: %v", err)
	}
	defer mock.Close()

	// Role with mixed case method
	policy := makePolicyJSON(t, []RoleAction{
		{Base: "http", Path: "/api/data/*", Method: "Get"},
	})

	mock.ExpectQuery("SELECT name, policies").
		WithArgs([]string{"test-role", "osmo-default"}).
		WillReturnRows(
			pgxmock.NewRows([]string{"name", "policies"}).
				AddRow("test-role", [][]byte{policy}),
		)

	rc := NewRoleChecker(mock, nil)
	// GET should match get (case insensitive)
	allowed, err := rc.CheckAccess(context.Background(), []string{"test-role"}, "/api/data/item", "GET")

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !allowed {
		t.Error("expected case-insensitive method matching")
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

func TestRoleChecker_CheckAccess_NoRolesFound(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("failed to create mock: %v", err)
	}
	defer mock.Close()

	// No roles returned from database
	mock.ExpectQuery("SELECT name, policies").
		WithArgs([]string{"nonexistent-role", "osmo-default"}).
		WillReturnRows(pgxmock.NewRows([]string{"name", "policies"}))

	rc := NewRoleChecker(mock, nil)
	allowed, err := rc.CheckAccess(context.Background(), []string{"nonexistent-role"}, "/api/something", "Get")

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if allowed {
		t.Error("expected access to be denied when no roles are found")
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

func TestRoleChecker_CheckAccess_MultiplePolicies(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("failed to create mock: %v", err)
	}
	defer mock.Close()

	// Role with multiple policies
	policy1 := makePolicyJSON(t, []RoleAction{
		{Base: "http", Path: "/api/read/*", Method: "Get"},
	})
	policy2 := makePolicyJSON(t, []RoleAction{
		{Base: "http", Path: "/api/write/*", Method: "Post"},
	})

	mock.ExpectQuery("SELECT name, policies").
		WithArgs([]string{"multi-policy-role", "osmo-default"}).
		WillReturnRows(
			pgxmock.NewRows([]string{"name", "policies"}).
				AddRow("multi-policy-role", [][]byte{policy1, policy2}),
		)

	rc := NewRoleChecker(mock, nil)
	allowed, err := rc.CheckAccess(context.Background(), []string{"multi-policy-role"}, "/api/write/data", "Post")

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !allowed {
		t.Error("expected access to be allowed via second policy")
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

// Test hasAccess method directly
func TestRole_hasAccess(t *testing.T) {
	tests := []struct {
		name     string
		role     Role
		path     string
		method   string
		expected bool
	}{
		{
			name: "exact path match",
			role: Role{
				Name: "test",
				Policies: []RolePolicy{{
					Actions: []RoleAction{
						{Base: "http", Path: "/api/workflow", Method: "*"},
					},
				}},
			},
			path:     "/api/workflow",
			method:   "Get",
			expected: true,
		},
		{
			name: "wildcard path match",
			role: Role{
				Name: "test",
				Policies: []RolePolicy{{
					Actions: []RoleAction{
						{Base: "http", Path: "/api/workflow/*", Method: "*"},
					},
				}},
			},
			path:     "/api/workflow/123",
			method:   "Get",
			expected: true,
		},
		{
			name: "global wildcard",
			role: Role{
				Name: "test",
				Policies: []RolePolicy{{
					Actions: []RoleAction{
						{Base: "http", Path: "*", Method: "*"},
					},
				}},
			},
			path:     "/any/path/here",
			method:   "Post",
			expected: true,
		},
		{
			name: "exclusion pattern denies access",
			role: Role{
				Name: "test",
				Policies: []RolePolicy{{
					Actions: []RoleAction{
						{Base: "http", Path: "*", Method: "*"},
						{Base: "http", Path: "!/api/admin/*", Method: "*"},
					},
				}},
			},
			path:     "/api/admin/config",
			method:   "Get",
			expected: false,
		},
		{
			name: "exclusion pattern allows non-matching",
			role: Role{
				Name: "test",
				Policies: []RolePolicy{{
					Actions: []RoleAction{
						{Base: "http", Path: "*", Method: "*"},
						{Base: "http", Path: "!/api/admin/*", Method: "*"},
					},
				}},
			},
			path:     "/api/workflow",
			method:   "Get",
			expected: true,
		},
		{
			name: "method mismatch",
			role: Role{
				Name: "test",
				Policies: []RolePolicy{{
					Actions: []RoleAction{
						{Base: "http", Path: "/api/workflow/*", Method: "Get"},
					},
				}},
			},
			path:     "/api/workflow/123",
			method:   "Post",
			expected: false,
		},
		{
			name: "case insensitive method",
			role: Role{
				Name: "test",
				Policies: []RolePolicy{{
					Actions: []RoleAction{
						{Base: "http", Path: "/api/workflow", Method: "get"},
					},
				}},
			},
			path:     "/api/workflow",
			method:   "GET",
			expected: true,
		},
		{
			name: "no matching path",
			role: Role{
				Name: "test",
				Policies: []RolePolicy{{
					Actions: []RoleAction{
						{Base: "http", Path: "/api/workflow/*", Method: "*"},
					},
				}},
			},
			path:     "/api/admin/config",
			method:   "Get",
			expected: false,
		},
		{
			name: "empty policies",
			role: Role{
				Name:     "test",
				Policies: []RolePolicy{},
			},
			path:     "/api/workflow",
			method:   "Get",
			expected: false,
		},
		{
			name: "question mark wildcard",
			role: Role{
				Name: "test",
				Policies: []RolePolicy{{
					Actions: []RoleAction{
						{Base: "http", Path: "/api/v?/workflow", Method: "*"},
					},
				}},
			},
			path:     "/api/v1/workflow",
			method:   "Get",
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := tt.role.hasAccess(tt.path, tt.method)
			if result != tt.expected {
				t.Errorf("hasAccess(%q, %q) = %v, expected %v", tt.path, tt.method, result, tt.expected)
			}
		})
	}
}

// Test glob matching function
func TestMatchGlob(t *testing.T) {
	tests := []struct {
		path     string
		pattern  string
		expected bool
	}{
		{"/api/workflow", "/api/workflow", true},
		{"/api/workflow/123", "/api/workflow/*", true},
		{"/api/workflow", "/api/workflow/*", false},
		{"/api/v1/workflow", "/api/v?/workflow", true},
		{"/api/v12/workflow", "/api/v?/workflow", false},
		{"/anything", "*", true},
		{"/api/admin/config", "/api/admin/*", true},
		{"/api/admin", "/api/admin/*", false},
		{"/api/user/profile", "/api/*/profile", true},
	}

	for _, tt := range tests {
		t.Run(tt.pattern+"_"+tt.path, func(t *testing.T) {
			result := matchGlob(tt.path, tt.pattern)
			if result != tt.expected {
				t.Errorf("matchGlob(%q, %q) = %v, expected %v", tt.path, tt.pattern, result, tt.expected)
			}
		})
	}
}

// Test method matching function
func TestMethodMatches(t *testing.T) {
	tests := []struct {
		actionMethod  string
		requestMethod string
		expected      bool
	}{
		{"*", "Get", true},
		{"*", "POST", true},
		{"Get", "Get", true},
		{"Get", "GET", true},
		{"get", "GET", true},
		{"Get", "Post", false},
		{"Post", "Get", false},
	}

	for _, tt := range tests {
		t.Run(tt.actionMethod+"_"+tt.requestMethod, func(t *testing.T) {
			result := methodMatches(tt.actionMethod, tt.requestMethod)
			if result != tt.expected {
				t.Errorf("methodMatches(%q, %q) = %v, expected %v", tt.actionMethod, tt.requestMethod, result, tt.expected)
			}
		})
	}
}
