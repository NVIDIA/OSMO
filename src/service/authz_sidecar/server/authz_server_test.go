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

package server

import (
	"context"
	"testing"

	"go.corp.nvidia.com/osmo/utils/roles"
)

func TestLegacyMatchMethod(t *testing.T) {
	// Test the legacy method matching from the roles package
	tests := []struct {
		name      string
		pattern   string
		method    string
		wantMatch bool
	}{
		{
			name:      "wildcard matches all",
			pattern:   "*",
			method:    "GET",
			wantMatch: true,
		},
		{
			name:      "exact match uppercase",
			pattern:   "GET",
			method:    "GET",
			wantMatch: true,
		},
		{
			name:      "exact match lowercase",
			pattern:   "get",
			method:    "get",
			wantMatch: true,
		},
		{
			name:      "case insensitive match",
			pattern:   "Get",
			method:    "GET",
			wantMatch: true,
		},
		{
			name:      "no match different methods",
			pattern:   "POST",
			method:    "GET",
			wantMatch: false,
		},
		{
			name:      "websocket match",
			pattern:   "WEBSOCKET",
			method:    "websocket",
			wantMatch: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := roles.LegacyMatchMethod(tt.pattern, tt.method)
			if got != tt.wantMatch {
				t.Errorf("LegacyMatchMethod(%q, %q) = %v, want %v", tt.pattern, tt.method, got, tt.wantMatch)
			}
		})
	}
}

// TestLegacyMatchPathPattern was removed because legacy path matching is now done
// by converting legacy patterns to semantic actions via ResolvePathToAction.
// See CheckLegacyAction which now uses substituteWildcardsInPath and ResolvePathToAction.

func TestCheckPolicyAccess(t *testing.T) {
	// Test the unified policy access check from the roles package
	tests := []struct {
		name       string
		role       *roles.Role
		path       string
		method     string
		wantAccess bool
	}{
		{
			name: "exact path and method match",
			role: &roles.Role{
				Name: "test-role",
				Policies: []roles.RolePolicy{
					{
						Actions: []roles.RoleAction{
							{Base: "http", Path: "/api/workflow", Method: "Get"},
						},
					},
				},
			},
			path:       "/api/workflow",
			method:     "GET",
			wantAccess: true,
		},
		{
			name: "wildcard path match",
			role: &roles.Role{
				Name: "test-role",
				Policies: []roles.RolePolicy{
					{
						Actions: []roles.RoleAction{
							{Base: "http", Path: "/api/workflow/*", Method: "Get"},
						},
					},
				},
			},
			path:       "/api/workflow/123",
			method:     "GET",
			wantAccess: true,
		},
		{
			name: "wildcard method match",
			role: &roles.Role{
				Name: "test-role",
				Policies: []roles.RolePolicy{
					{
						Actions: []roles.RoleAction{
							{Base: "http", Path: "/api/workflow", Method: "*"},
						},
					},
				},
			},
			path:       "/api/workflow",
			method:     "POST",
			wantAccess: true,
		},
		{
			name: "deny pattern is ignored during conversion - access allowed",
			role: &roles.Role{
				Name: "test-role",
				Policies: []roles.RolePolicy{
					{
						Actions: []roles.RoleAction{
							{Action: "*:*"},
						},
						Resources: []string{"*"},
					},
					{
						Actions: []roles.RoleAction{
							// Deny patterns are ignored during legacy->semantic conversion
							{Base: "http", Path: "!/api/pool/*", Method: "*"},
						},
					},
				},
			},
			path:       "/api/pool/test-pool",
			method:     "GET",
			wantAccess: true, // Deny patterns are ignored, so *:* allows access
		},
		{
			name: "semantic action *:* allows all paths",
			role: &roles.Role{
				Name: "test-role",
				Policies: []roles.RolePolicy{
					{
						Actions: []roles.RoleAction{
							{Action: "*:*"},
						},
						Resources: []string{"*"},
					},
				},
			},
			path:       "/api/workflow/123",
			method:     "GET",
			wantAccess: true,
		},
		{
			name: "no matching path - legacy pattern doesn't match request",
			role: &roles.Role{
				Name: "test-role",
				Policies: []roles.RolePolicy{
					{
						Actions: []roles.RoleAction{
							{Base: "http", Path: "/api/workflow", Method: "Get"},
						},
					},
				},
			},
			path:       "/api/pool",
			method:     "GET",
			wantAccess: false, // /api/pool resolves to pool:Read, not workflow:Read
		},
		{
			name: "no matching method",
			role: &roles.Role{
				Name: "test-role",
				Policies: []roles.RolePolicy{
					{
						Actions: []roles.RoleAction{
							{Base: "http", Path: "/api/workflow", Method: "Get"},
						},
					},
				},
			},
			path:       "/api/workflow",
			method:     "POST",
			wantAccess: false,
		},
		{
			name: "multiple policies first matches",
			role: &roles.Role{
				Name: "test-role",
				Policies: []roles.RolePolicy{
					{
						Actions: []roles.RoleAction{
							{Base: "http", Path: "/api/workflow/*", Method: "Get"},
						},
					},
					{
						Actions: []roles.RoleAction{
							{Base: "http", Path: "/api/bucket/*", Method: "Post"},
						},
					},
				},
			},
			path:       "/api/workflow/123",
			method:     "GET",
			wantAccess: true,
		},
		{
			name: "multiple policies second matches",
			role: &roles.Role{
				Name: "test-role",
				Policies: []roles.RolePolicy{
					{
						Actions: []roles.RoleAction{
							{Base: "http", Path: "/api/workflow/*", Method: "Get"},
						},
					},
					{
						Actions: []roles.RoleAction{
							{Base: "http", Path: "/api/bucket/*", Method: "Post"},
						},
					},
				},
			},
			path:       "/api/bucket/my-bucket",
			method:     "POST",
			wantAccess: true,
		},
		{
			name: "websocket method match",
			role: &roles.Role{
				Name: "test-role",
				Policies: []roles.RolePolicy{
					{
						Actions: []roles.RoleAction{
							{Base: "http", Path: "/api/router/*/*/client/*", Method: "Websocket"},
						},
					},
				},
			},
			path:       "/api/router/session/abc/client/connect",
			method:     "WEBSOCKET",
			wantAccess: true,
		},
		// Semantic action tests
		{
			name: "semantic action workflow:Create",
			role: &roles.Role{
				Name: "test-role",
				Policies: []roles.RolePolicy{
					{
						Actions: []roles.RoleAction{
							{Action: "workflow:Create"},
						},
						Resources: []string{"*"},
					},
				},
			},
			path:       "/api/workflow",
			method:     "POST",
			wantAccess: true,
		},
		{
			name: "semantic action workflow:Read",
			role: &roles.Role{
				Name: "test-role",
				Policies: []roles.RolePolicy{
					{
						Actions: []roles.RoleAction{
							{Action: "workflow:Read"},
						},
						Resources: []string{"*"},
					},
				},
			},
			path:       "/api/workflow/abc123",
			method:     "GET",
			wantAccess: true,
		},
		{
			name: "semantic action wildcard workflow:*",
			role: &roles.Role{
				Name: "test-role",
				Policies: []roles.RolePolicy{
					{
						Actions: []roles.RoleAction{
							{Action: "workflow:*"},
						},
						Resources: []string{"*"},
					},
				},
			},
			path:       "/api/workflow",
			method:     "DELETE",
			wantAccess: false, // DELETE on collection not mapped
		},
		{
			name: "semantic action wildcard *:Read",
			role: &roles.Role{
				Name: "test-role",
				Policies: []roles.RolePolicy{
					{
						Actions: []roles.RoleAction{
							{Action: "*:Read"},
						},
						Resources: []string{"*"},
					},
				},
			},
			path:       "/api/pool",
			method:     "GET",
			wantAccess: true,
		},
		{
			name: "semantic action no match wrong action",
			role: &roles.Role{
				Name: "test-role",
				Policies: []roles.RolePolicy{
					{
						Actions: []roles.RoleAction{
							{Action: "bucket:Read"},
						},
						Resources: []string{"*"},
					},
				},
			},
			path:       "/api/workflow",
			method:     "POST",
			wantAccess: false,
		},
		{
			name: "semantic action takes precedence over legacy",
			role: &roles.Role{
				Name: "test-role",
				Policies: []roles.RolePolicy{
					{
						Actions: []roles.RoleAction{
							{Action: "workflow:Create"},
						},
						Resources: []string{"*"},
					},
					{
						Actions: []roles.RoleAction{
							{Base: "http", Path: "!/api/workflow", Method: "*"},
						},
					},
				},
			},
			path:       "/api/workflow",
			method:     "POST",
			wantAccess: true, // Semantic action matched first
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Convert role to semantic format (simulates what authz_server does)
			convertedRole := roles.ConvertRoleToSemantic(tt.role)
			result := roles.CheckPolicyAccess(context.Background(), convertedRole, tt.path, tt.method, nil)
			if result.Allowed != tt.wantAccess {
				t.Errorf("CheckPolicyAccess() = %v, want %v (actionType: %s, matched: %s)",
					result.Allowed, tt.wantAccess, result.ActionType, result.MatchedAction)
			}
		})
	}
}

func TestDefaultRoleAccess(t *testing.T) {
	// Legacy role format - will be converted to semantic
	defaultRole := &roles.Role{
		Name: "osmo-default",
		Policies: []roles.RolePolicy{
			{
				Actions: []roles.RoleAction{
					{Base: "http", Path: "/api/version", Method: "*"},
					{Base: "http", Path: "/health", Method: "*"},
					{Base: "http", Path: "/api/auth/login", Method: "Get"},
				},
			},
		},
	}
	// Convert to semantic
	defaultRole = roles.ConvertRoleToSemantic(defaultRole)

	tests := []struct {
		name       string
		path       string
		method     string
		wantAccess bool
	}{
		{
			name:       "version endpoint accessible",
			path:       "/api/version",
			method:     "GET",
			wantAccess: true,
		},
		{
			name:       "health endpoint accessible",
			path:       "/health",
			method:     "GET",
			wantAccess: true,
		},
		{
			name:       "login endpoint accessible",
			path:       "/api/auth/login",
			method:     "GET",
			wantAccess: true,
		},
		{
			name:       "workflow endpoint not accessible",
			path:       "/api/workflow",
			method:     "GET",
			wantAccess: false,
		},
		{
			name:       "pool endpoint not accessible",
			path:       "/api/pool",
			method:     "GET",
			wantAccess: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := roles.CheckPolicyAccess(context.Background(), defaultRole, tt.path, tt.method, nil)
			if result.Allowed != tt.wantAccess {
				t.Errorf("CheckPolicyAccess() = %v, want %v for path %s", result.Allowed, tt.wantAccess, tt.path)
			}
		})
	}
}

func TestAdminRoleAccess(t *testing.T) {
	// Legacy admin role format - will be converted to semantic
	// Note: deny patterns are ignored during conversion, so admin gets full access
	adminRole := &roles.Role{
		Name: "osmo-admin",
		Policies: []roles.RolePolicy{
			{
				Actions: []roles.RoleAction{
					{Base: "http", Path: "*", Method: "*"},
					// These deny patterns are ignored during conversion
					{Base: "http", Path: "!/api/agent/*", Method: "*"},
					{Base: "http", Path: "!/api/logger/*", Method: "*"},
				},
			},
		},
	}
	// Convert to semantic - deny patterns are ignored
	adminRole = roles.ConvertRoleToSemantic(adminRole)

	tests := []struct {
		name       string
		path       string
		method     string
		wantAccess bool
	}{
		{
			name:       "workflow endpoint accessible",
			path:       "/api/workflow/123",
			method:     "GET",
			wantAccess: true,
		},
		{
			name:       "workflow POST accessible",
			path:       "/api/workflow",
			method:     "POST",
			wantAccess: true,
		},
		{
			name:       "agent endpoint accessible (deny ignored in conversion)",
			path:       "/api/agent/listener/status",
			method:     "GET",
			wantAccess: true, // Deny patterns are ignored during conversion
		},
		{
			name:       "logger endpoint accessible (deny ignored in conversion)",
			path:       "/api/logger/workflow/logs",
			method:     "GET",
			wantAccess: true, // Deny patterns are ignored during conversion
		},
		{
			name:       "router client endpoint accessible",
			path:       "/api/router/session/abc/client/connect",
			method:     "GET",
			wantAccess: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := roles.CheckPolicyAccess(context.Background(), adminRole, tt.path, tt.method, nil)
			if result.Allowed != tt.wantAccess {
				t.Errorf("CheckPolicyAccess() = %v, want %v for path %s", result.Allowed, tt.wantAccess, tt.path)
			}
		})
	}
}

func TestCheckRolesAccess(t *testing.T) {
	// Test checking access across multiple roles
	// Legacy format - will be converted
	defaultRole := roles.ConvertRoleToSemantic(&roles.Role{
		Name: "osmo-default",
		Policies: []roles.RolePolicy{
			{
				Actions: []roles.RoleAction{
					{Base: "http", Path: "/health", Method: "*"},
				},
			},
		},
	})

	// Already semantic format
	userRole := &roles.Role{
		Name: "osmo-user",
		Policies: []roles.RolePolicy{
			{
				Actions: []roles.RoleAction{
					{Action: "workflow:Read"},
					{Action: "workflow:Create"},
				},
				Resources: []string{"*"},
			},
		},
	}

	tests := []struct {
		name       string
		roles      []*roles.Role
		path       string
		method     string
		wantAccess bool
		wantRole   string
	}{
		{
			name:       "default role grants health access",
			roles:      []*roles.Role{defaultRole},
			path:       "/health",
			method:     "GET",
			wantAccess: true,
			wantRole:   "osmo-default",
		},
		{
			name:       "user role grants workflow read via semantic action",
			roles:      []*roles.Role{userRole},
			path:       "/api/workflow/abc123",
			method:     "GET",
			wantAccess: true,
			wantRole:   "osmo-user",
		},
		{
			name:       "user role grants workflow create via semantic action",
			roles:      []*roles.Role{userRole},
			path:       "/api/workflow",
			method:     "POST",
			wantAccess: true,
			wantRole:   "osmo-user",
		},
		{
			name:       "combined roles - first matches",
			roles:      []*roles.Role{defaultRole, userRole},
			path:       "/health",
			method:     "GET",
			wantAccess: true,
			wantRole:   "osmo-default",
		},
		{
			name:       "combined roles - second matches",
			roles:      []*roles.Role{defaultRole, userRole},
			path:       "/api/workflow",
			method:     "POST",
			wantAccess: true,
			wantRole:   "osmo-user",
		},
		{
			name:       "no matching role",
			roles:      []*roles.Role{defaultRole},
			path:       "/api/workflow",
			method:     "POST",
			wantAccess: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := roles.CheckRolesAccess(context.Background(), tt.roles, tt.path, tt.method, nil)
			if result.Allowed != tt.wantAccess {
				t.Errorf("CheckRolesAccess() = %v, want %v", result.Allowed, tt.wantAccess)
			}
			if tt.wantAccess && result.RoleName != tt.wantRole {
				t.Errorf("CheckRolesAccess() role = %q, want %q", result.RoleName, tt.wantRole)
			}
		})
	}
}
