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
	"testing"
)

func TestGetAllActions(t *testing.T) {
	actions := GetAllActions()
	if len(actions) == 0 {
		t.Error("GetAllActions() returned empty slice")
	}

	// Verify all returned actions exist in registry
	for _, action := range actions {
		if _, exists := ActionRegistry[action]; !exists {
			t.Errorf("GetAllActions() returned action %q not in registry", action)
		}
	}

	// Verify count matches registry
	if len(actions) != len(ActionRegistry) {
		t.Errorf("GetAllActions() returned %d actions, want %d", len(actions), len(ActionRegistry))
	}
}

func TestMatchMethodRegistry(t *testing.T) {
	tests := []struct {
		name           string
		requestMethod  string
		allowedMethods []string
		wantMatch      bool
	}{
		{
			name:           "exact match",
			requestMethod:  "GET",
			allowedMethods: []string{"GET"},
			wantMatch:      true,
		},
		{
			name:           "wildcard match",
			requestMethod:  "POST",
			allowedMethods: []string{"*"},
			wantMatch:      true,
		},
		{
			name:           "case insensitive",
			requestMethod:  "get",
			allowedMethods: []string{"GET"},
			wantMatch:      true,
		},
		{
			name:           "multiple methods",
			requestMethod:  "PUT",
			allowedMethods: []string{"PUT", "PATCH"},
			wantMatch:      true,
		},
		{
			name:           "no match",
			requestMethod:  "DELETE",
			allowedMethods: []string{"GET", "POST"},
			wantMatch:      false,
		},
		{
			name:           "websocket",
			requestMethod:  "WEBSOCKET",
			allowedMethods: []string{"POST", "WEBSOCKET"},
			wantMatch:      true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := MatchMethod(tt.requestMethod, tt.allowedMethods)
			if got != tt.wantMatch {
				t.Errorf("MatchMethod(%q, %v) = %v, want %v",
					tt.requestMethod, tt.allowedMethods, got, tt.wantMatch)
			}
		})
	}
}

func TestExtractResourceFromPath(t *testing.T) {
	tests := []struct {
		name         string
		path         string
		action       string
		wantResource string
	}{
		// Pool-scoped resources (workflow, task) - pool cannot be determined from path
		{
			name:         "workflow with ID returns pool scope",
			path:         "/api/workflow/abc123",
			action:       ActionWorkflowRead,
			wantResource: "pool/*",
		},
		{
			name:         "workflow collection returns pool scope",
			path:         "/api/workflow",
			action:       ActionWorkflowRead,
			wantResource: "pool/*",
		},
		{
			name:         "task maps to pool scope",
			path:         "/api/task/task-123",
			action:       ActionWorkflowRead,
			wantResource: "pool/*",
		},
		// Self-scoped resources (dataset, config)
		{
			name:         "dataset with name returns dataset scope",
			path:         "/api/bucket/my-bucket",
			action:       ActionDatasetRead,
			wantResource: "bucket/my-bucket",
		},
		{
			name:         "config with ID returns config scope",
			path:         "/api/configs/my-config",
			action:       ActionConfigRead,
			wantResource: "config/my-config",
		},
		// Profile - no scope needed (user context comes from auth token)
		{
			name:         "profile returns empty (no scope needed)",
			path:         "/api/profile/settings",
			action:       ActionProfileRead,
			wantResource: "",
		},
		// Global/public resources - no resource scope needed (empty string)
		{
			name:         "system action returns empty (no scope needed)",
			path:         "/health",
			action:       ActionSystemHealth,
			wantResource: "",
		},
		{
			name:         "auth action returns empty (no scope needed)",
			path:         "/api/auth/login",
			action:       ActionAuthLogin,
			wantResource: "",
		},
		{
			name:         "auth token returns empty (no scope needed)",
			path:         "/api/auth/access_token",
			action:       ActionAuthToken,
			wantResource: "",
		},
		{
			name:         "auth token with id returns empty (no scope needed)",
			path:         "/api/auth/access_token/tok-123",
			action:       ActionAuthToken,
			wantResource: "",
		},
		{
			name:         "auth user token returns user scope",
			path:         "/api/auth/user/alice/access_token",
			action:       ActionAuthToken,
			wantResource: "user/alice",
		},
		{
			name:         "auth user token with id returns user scope",
			path:         "/api/auth/user/bob/access_token/tok-456",
			action:       ActionAuthToken,
			wantResource: "user/bob",
		},
		{
			name:         "auth token named user returns empty (no scope needed)",
			path:         "/api/auth/access_token/user",
			action:       ActionAuthToken,
			wantResource: "",
		},
		{
			name:         "user list returns empty (no scope needed)",
			path:         "/api/users",
			action:       ActionUserList,
			wantResource: "",
		},
		{
			name:         "credentials returns empty (no scope needed)",
			path:         "/api/credentials/cred-123",
			action:       ActionCredentialsRead,
			wantResource: "",
		},
		{
			name:         "app returns empty (no scope needed)",
			path:         "/api/app/app-123",
			action:       ActionAppRead,
			wantResource: "",
		},
		// Internal resources - scoped to backend
		{
			name:         "internal operator returns backend scope",
			path:         "/api/agent/listener/status",
			action:       ActionInternalOperator,
			wantResource: "backend/listener",
		},
		{
			name:         "internal router returns backend scope",
			path:         "/api/router/session/abc/backend/connect",
			action:       ActionInternalRouter,
			wantResource: "backend/session",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := extractResourceFromPath(context.Background(), tt.path, tt.action, nil)
			if got != tt.wantResource {
				t.Errorf("extractResourceFromPath(%q, %q) = %q, want %q",
					tt.path, tt.action, got, tt.wantResource)
			}
		})
	}
}

func TestDefaultRolesWithRegistry(t *testing.T) {
	// Test common access patterns for default roles using ActionRegistry

	// osmo-admin: should be able to access all except internal
	adminTests := []struct {
		path       string
		method     string
		wantAction string
	}{
		{"/api/pool/test-pool/workflow", "POST", ActionWorkflowCreate},
		{"/api/workflow/abc123", "GET", ActionWorkflowRead},
		{"/api/workflow/abc123", "DELETE", ActionWorkflowDelete},
		{"/api/users", "GET", ActionUserList},
	}

	for _, tt := range adminTests {
		action, _ := ResolvePathToAction(context.Background(), tt.path, tt.method, nil)
		if action != tt.wantAction {
			t.Errorf("Admin path %s %s: got action %q, want %q",
				tt.method, tt.path, action, tt.wantAction)
		}
	}

	// osmo-default: should only have access to system/auth endpoints
	defaultTests := []struct {
		path       string
		method     string
		wantAction string
	}{
		{"/health", "GET", ActionSystemHealth},
		{"/api/version", "GET", ActionSystemVersion},
		{"/api/auth/login", "GET", ActionAuthLogin},
	}

	for _, tt := range defaultTests {
		action, _ := ResolvePathToAction(context.Background(), tt.path, tt.method, nil)
		if action != tt.wantAction {
			t.Errorf("Default path %s %s: got action %q, want %q",
				tt.method, tt.path, action, tt.wantAction)
		}
	}
}

func TestInternalActionsRestricted(t *testing.T) {
	// Test that internal actions are properly identified
	internalTests := []struct {
		path       string
		method     string
		wantAction string
	}{
		{"/api/agent/listener/status", "GET", ActionInternalOperator},
		{"/api/agent/worker/heartbeat", "POST", ActionInternalOperator},
		{"/api/logger/workflow/abc123/osmo_ctrl/logs", "POST", ActionInternalLogger},
		{"/api/router/session/abc/backend/connect", "GET", ActionInternalRouter},
	}

	for _, tt := range internalTests {
		action, _ := ResolvePathToAction(context.Background(), tt.path, tt.method, nil)
		if action != tt.wantAction {
			t.Errorf("Internal path %s %s: got action %q, want %q",
				tt.method, tt.path, action, tt.wantAction)
		}
	}
}

func TestGRPCPathsResolveToActionInternalOperator(t *testing.T) {
	tests := []struct {
		name       string
		path       string
		method     string
		wantAction string
	}{
		{
			name:       "ListenerStream resolves to ActionInternalOperator",
			path:       "/operator.ListenerService/ListenerStream",
			method:     "POST",
			wantAction: ActionInternalOperator,
		},
		{
			name:       "NodeConditionStream resolves to ActionInternalOperator",
			path:       "/operator.ListenerService/NodeConditionStream",
			method:     "POST",
			wantAction: ActionInternalOperator,
		},
		{
			name:       "InitBackend resolves to ActionInternalOperator",
			path:       "/operator.ListenerService/InitBackend",
			method:     "POST",
			wantAction: ActionInternalOperator,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			action, _ := ResolvePathToAction(context.Background(), tt.path, tt.method, nil)
			if action != tt.wantAction {
				t.Errorf("ResolvePathToAction(%q, %q) = %q, want %q",
					tt.path, tt.method, action, tt.wantAction)
			}
		})
	}
}

func TestExtractResourceFromPathGRPC(t *testing.T) {
	tests := []struct {
		name         string
		path         string
		action       string
		wantResource string
	}{
		{
			name:         "gRPC path returns backend wildcard (no agent segment)",
			path:         "/operator.ListenerService/ListenerStream",
			action:       ActionInternalOperator,
			wantResource: "backend/*",
		},
		{
			name:         "gRPC NodeConditionStream returns backend wildcard",
			path:         "/operator.ListenerService/NodeConditionStream",
			action:       ActionInternalOperator,
			wantResource: "backend/*",
		},
		{
			name:         "gRPC InitBackend returns backend wildcard",
			path:         "/operator.ListenerService/InitBackend",
			action:       ActionInternalOperator,
			wantResource: "backend/*",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := extractResourceFromPath(context.Background(), tt.path, tt.action, nil)
			if got != tt.wantResource {
				t.Errorf("extractResourceFromPath(%q, %q) = %q, want %q",
					tt.path, tt.action, got, tt.wantResource)
			}
		})
	}
}

// ============================================================================
// Legacy to Semantic Conversion Tests
// ============================================================================

func TestPathPatternCouldMatch(t *testing.T) {
	tests := []struct {
		name            string
		legacyPattern   string
		endpointPattern string
		wantMatch       bool
	}{
		{
			name:            "universal wildcard matches everything",
			legacyPattern:   "*",
			endpointPattern: "/api/workflow",
			wantMatch:       true,
		},
		{
			name:            "exact match",
			legacyPattern:   "/api/workflow",
			endpointPattern: "/api/workflow",
			wantMatch:       true,
		},
		{
			name:            "trailing wildcard covers endpoint",
			legacyPattern:   "/api/workflow/*",
			endpointPattern: "/api/workflow/abc",
			wantMatch:       true,
		},
		{
			name:            "trailing wildcard covers sub-paths",
			legacyPattern:   "/api/workflow/*",
			endpointPattern: "/api/workflow/*/cancel",
			wantMatch:       true,
		},
		{
			name:            "trailing wildcard covers base",
			legacyPattern:   "/api/workflow/*",
			endpointPattern: "/api/workflow",
			wantMatch:       true,
		},
		{
			name:            "segment wildcard matches",
			legacyPattern:   "/api/*/task",
			endpointPattern: "/api/*/task",
			wantMatch:       true,
		},
		{
			name:            "different path no match",
			legacyPattern:   "/api/workflow",
			endpointPattern: "/api/task",
			wantMatch:       false,
		},
		{
			name:            "different prefix no match",
			legacyPattern:   "/api/workflow/*",
			endpointPattern: "/api/task/*",
			wantMatch:       false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := pathPatternCouldMatch(tt.legacyPattern, tt.endpointPattern)
			if got != tt.wantMatch {
				t.Errorf("pathPatternCouldMatch(%q, %q) = %v, want %v",
					tt.legacyPattern, tt.endpointPattern, got, tt.wantMatch)
			}
		})
	}
}

func TestConvertLegacyActionToSemantic(t *testing.T) {
	tests := []struct {
		name           string
		action         *RoleAction
		wantActions    []string
		wantMinActions int // Minimum number of actions expected (for wildcards)
	}{
		{
			name:        "semantic action passes through",
			action:      &RoleAction{Action: "workflow:Create"},
			wantActions: []string{"workflow:Create"},
		},
		{
			name:        "deny pattern is ignored",
			action:      &RoleAction{Path: "!/api/workflow/*", Method: "*"},
			wantActions: nil,
		},
		{
			name:        "empty action returns nil",
			action:      &RoleAction{},
			wantActions: nil,
		},
		{
			name:           "universal wildcard returns *:*",
			action:         &RoleAction{Path: "*", Method: "*"},
			wantActions:    []string{"*:*"},
			wantMinActions: 1,
		},
		{
			name:        "specific path and method",
			action:      &RoleAction{Path: "/api/pool/*/workflow", Method: "POST"},
			wantActions: []string{ActionWorkflowCreate},
		},
		{
			name:   "specific path with GET",
			action: &RoleAction{Path: "/api/workflow", Method: "GET"},
			// GET on collection /api/workflow is List, not Read
			wantActions: []string{ActionWorkflowList},
		},
		{
			name:           "wildcard path with specific method",
			action:         &RoleAction{Path: "/api/workflow/*", Method: "GET"},
			wantActions:    []string{ActionWorkflowRead},
			wantMinActions: 1,
		},
		{
			name:        "health endpoint",
			action:      &RoleAction{Path: "/health", Method: "*"},
			wantActions: []string{ActionSystemHealth},
		},
		{
			name:        "version endpoint",
			action:      &RoleAction{Path: "/api/version", Method: "*"},
			wantActions: []string{ActionSystemVersion},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ConvertLegacyActionToSemantic(tt.action)

			if tt.wantActions == nil {
				if got != nil {
					t.Errorf("ConvertLegacyActionToSemantic() = %v, want nil", got)
				}
				return
			}

			if tt.wantMinActions > 0 {
				if len(got) < tt.wantMinActions {
					t.Errorf("ConvertLegacyActionToSemantic() returned %d actions, want at least %d",
						len(got), tt.wantMinActions)
				}
			}

			// Check that all expected actions are present
			for _, want := range tt.wantActions {
				found := false
				for _, g := range got {
					if g == want {
						found = true
						break
					}
				}
				if !found {
					t.Errorf("ConvertLegacyActionToSemantic() missing expected action %q, got %v",
						want, got)
				}
			}
		})
	}
}

func TestConvertRoleToSemantic(t *testing.T) {
	tests := []struct {
		name          string
		role          *Role
		wantName      string
		wantPolicies  int
		checkPolicies func(t *testing.T, policies []RolePolicy)
	}{
		{
			name: "nil role returns nil",
			role: nil,
		},
		{
			name: "already semantic role passes through",
			role: &Role{
				Name: "test-role",
				Policies: []RolePolicy{
					{
						Actions:   []RoleAction{{Action: "workflow:Create"}},
						Resources: []string{"*"},
					},
				},
			},
			wantName:     "test-role",
			wantPolicies: 1,
			checkPolicies: func(t *testing.T, policies []RolePolicy) {
				if len(policies[0].Actions) != 1 {
					t.Errorf("Expected 1 action, got %d", len(policies[0].Actions))
				}
				if policies[0].Actions[0].Action != "workflow:Create" {
					t.Errorf("Expected workflow:Create, got %s", policies[0].Actions[0].Action)
				}
			},
		},
		{
			name: "legacy role is converted",
			role: &Role{
				Name: "legacy-role",
				Policies: []RolePolicy{
					{
						Actions: []RoleAction{
							{Path: "/api/pool/*/workflow", Method: "POST"},
						},
					},
				},
			},
			wantName:     "legacy-role",
			wantPolicies: 1,
			checkPolicies: func(t *testing.T, policies []RolePolicy) {
				if len(policies[0].Actions) == 0 {
					t.Error("Expected at least 1 action after conversion")
					return
				}
				// Check all actions are semantic
				for _, action := range policies[0].Actions {
					if !action.IsSemanticAction() {
						t.Errorf("Expected semantic action, got legacy: %+v", action)
					}
				}
				// Check workflow:Create is in the actions
				found := false
				for _, action := range policies[0].Actions {
					if action.Action == ActionWorkflowCreate {
						found = true
						break
					}
				}
				if !found {
					t.Errorf("Expected workflow:Create in converted actions, got %+v", policies[0].Actions)
				}
			},
		},
		{
			name: "deny patterns are ignored",
			role: &Role{
				Name: "role-with-deny",
				Policies: []RolePolicy{
					{
						Actions: []RoleAction{
							{Path: "!/api/admin/*", Method: "*"},
							{Path: "/api/workflow", Method: "GET"},
						},
					},
				},
			},
			wantName:     "role-with-deny",
			wantPolicies: 1,
			checkPolicies: func(t *testing.T, policies []RolePolicy) {
				// Deny should be ignored, only workflow:Read should remain
				for _, action := range policies[0].Actions {
					if !action.IsSemanticAction() {
						t.Errorf("Expected semantic action, got legacy: %+v", action)
					}
				}
			},
		},
		{
			name: "resources default to wildcard",
			role: &Role{
				Name: "no-resources",
				Policies: []RolePolicy{
					{
						Actions: []RoleAction{
							{Path: "/api/pool/*/workflow", Method: "POST"},
						},
						// No Resources specified
					},
				},
			},
			wantName:     "no-resources",
			wantPolicies: 1,
			checkPolicies: func(t *testing.T, policies []RolePolicy) {
				if len(policies[0].Resources) != 1 || policies[0].Resources[0] != "*" {
					t.Errorf("Expected resources [*], got %v", policies[0].Resources)
				}
			},
		},
		{
			name: "existing resources are preserved",
			role: &Role{
				Name: "with-resources",
				Policies: []RolePolicy{
					{
						Actions:   []RoleAction{{Action: "workflow:Create"}},
						Resources: []string{"pool/production"},
					},
				},
			},
			wantName:     "with-resources",
			wantPolicies: 1,
			checkPolicies: func(t *testing.T, policies []RolePolicy) {
				if len(policies[0].Resources) != 1 || policies[0].Resources[0] != "pool/production" {
					t.Errorf("Expected resources [pool/production], got %v", policies[0].Resources)
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ConvertRoleToSemantic(tt.role)

			if tt.role == nil {
				if got != nil {
					t.Errorf("ConvertRoleToSemantic(nil) = %v, want nil", got)
				}
				return
			}

			if got.Name != tt.wantName {
				t.Errorf("Name = %q, want %q", got.Name, tt.wantName)
			}

			if len(got.Policies) != tt.wantPolicies {
				t.Errorf("Policies count = %d, want %d", len(got.Policies), tt.wantPolicies)
			}

			if tt.checkPolicies != nil {
				tt.checkPolicies(t, got.Policies)
			}
		})
	}
}

func TestConvertRolesToSemantic(t *testing.T) {
	roles := []*Role{
		{
			Name: "role1",
			Policies: []RolePolicy{
				{Actions: []RoleAction{{Path: "/api/pool/*/workflow", Method: "POST"}}},
			},
		},
		{
			Name: "role2",
			Policies: []RolePolicy{
				{Actions: []RoleAction{{Action: "pool:Read"}}},
			},
		},
	}

	converted := ConvertRolesToSemantic(roles)

	if len(converted) != 2 {
		t.Fatalf("Expected 2 roles, got %d", len(converted))
	}

	if converted[0].Name != "role1" {
		t.Errorf("Role 0 name = %q, want %q", converted[0].Name, "role1")
	}
	if converted[1].Name != "role2" {
		t.Errorf("Role 1 name = %q, want %q", converted[1].Name, "role2")
	}

	// Check that role1's legacy action was converted
	for _, action := range converted[0].Policies[0].Actions {
		if !action.IsSemanticAction() {
			t.Errorf("Role1: expected semantic action, got %+v", action)
		}
	}

	// Check that role2's semantic action was preserved
	if converted[1].Policies[0].Actions[0].Action != "pool:Read" {
		t.Errorf("Role2: expected pool:Read, got %s", converted[1].Policies[0].Actions[0].Action)
	}
}

func TestContainsMethod(t *testing.T) {
	tests := []struct {
		name    string
		methods []string
		method  string
		want    bool
	}{
		{
			name:    "exact match",
			methods: []string{"GET", "POST"},
			method:  "GET",
			want:    true,
		},
		{
			name:    "case insensitive",
			methods: []string{"GET", "POST"},
			method:  "get",
			want:    true,
		},
		{
			name:    "no match",
			methods: []string{"GET", "POST"},
			method:  "DELETE",
			want:    false,
		},
		{
			name:    "empty methods",
			methods: []string{},
			method:  "GET",
			want:    false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := containsMethod(tt.methods, tt.method)
			if got != tt.want {
				t.Errorf("containsMethod(%v, %q) = %v, want %v",
					tt.methods, tt.method, got, tt.want)
			}
		})
	}
}

// TestWildcardResolvesMatchedAction verifies that *:* policies resolve
// MatchedAction to the actual semantic action, not the wildcard pattern.
func TestWildcardResolvesMatchedAction(t *testing.T) {
	ctx := context.Background()

	wildcardRole := &Role{
		Name: "admin",
		Policies: []RolePolicy{
			{
				Effect:    EffectAllow,
				Actions:   RoleActions{{Action: "*:*"}},
				Resources: []string{"*"},
			},
		},
	}

	tests := []struct {
		name              string
		path              string
		method            string
		wantAction        string
		wantAllowed       bool
		wantActionNotStar bool
	}{
		{
			name:              "profile read resolves to profile:Read",
			path:              "/api/profile/settings",
			method:            "GET",
			wantAction:        ActionProfileRead,
			wantAllowed:       true,
			wantActionNotStar: true,
		},
		{
			name:              "resources read resolves to resources:Read",
			path:              "/api/resources",
			method:            "GET",
			wantAction:        ActionResourcesRead,
			wantAllowed:       true,
			wantActionNotStar: true,
		},
		{
			name:              "workflow list resolves to workflow:List",
			path:              "/api/workflow",
			method:            "GET",
			wantAction:        ActionWorkflowList,
			wantAllowed:       true,
			wantActionNotStar: true,
		},
		{
			name:              "workflow read resolves to workflow:Read",
			path:              "/api/workflow/abc123",
			method:            "GET",
			wantAction:        ActionWorkflowRead,
			wantAllowed:       true,
			wantActionNotStar: true,
		},
		{
			name:              "health resolves to system:Health",
			path:              "/health",
			method:            "GET",
			wantAction:        ActionSystemHealth,
			wantAllowed:       true,
			wantActionNotStar: true,
		},
	}

	for _, tt := range tests {
		t.Run("CheckSemanticAction/"+tt.name, func(t *testing.T) {
			result := CheckSemanticAction(
				ctx, &wildcardRole.Policies[0].Actions[0],
				wildcardRole.Policies[0].Resources, tt.path, tt.method, nil)
			if result.Allowed != tt.wantAllowed {
				t.Errorf("Allowed = %v, want %v", result.Allowed, tt.wantAllowed)
			}
			if result.MatchedAction != tt.wantAction {
				t.Errorf("MatchedAction = %q, want %q", result.MatchedAction, tt.wantAction)
			}
		})

		t.Run("CheckPolicyAccess/"+tt.name, func(t *testing.T) {
			result := CheckPolicyAccess(ctx, wildcardRole, tt.path, tt.method, nil)
			if result.Allowed != tt.wantAllowed {
				t.Errorf("Allowed = %v, want %v", result.Allowed, tt.wantAllowed)
			}
			if result.MatchedAction != tt.wantAction {
				t.Errorf("MatchedAction = %q, want %q", result.MatchedAction, tt.wantAction)
			}
		})

		t.Run("CheckRolesAccess/"+tt.name, func(t *testing.T) {
			result := CheckRolesAccess(ctx, []*Role{wildcardRole}, tt.path, tt.method, nil)
			if result.Allowed != tt.wantAllowed {
				t.Errorf("Allowed = %v, want %v", result.Allowed, tt.wantAllowed)
			}
			if result.MatchedAction != tt.wantAction {
				t.Errorf("MatchedAction = %q, want %q", result.MatchedAction, tt.wantAction)
			}
		})
	}
}

// TestWildcardUnknownPathFallback verifies that *:* on an unregistered path
// still allows access but falls back to *:* as MatchedAction.
func TestWildcardUnknownPathFallback(t *testing.T) {
	ctx := context.Background()

	role := &Role{
		Name: "admin",
		Policies: []RolePolicy{
			{
				Effect:    EffectAllow,
				Actions:   RoleActions{{Action: "*:*"}},
				Resources: []string{"*"},
			},
		},
	}

	result := CheckPolicyAccess(ctx, role, "/some/unknown/path", "GET", nil)
	if !result.Allowed {
		t.Error("wildcard should allow unknown paths")
	}
	if result.MatchedAction != "*:*" {
		t.Errorf("MatchedAction = %q, want %q (fallback for unregistered path)",
			result.MatchedAction, "*:*")
	}
}

// TestPartialWildcardResolvesMatchedAction verifies that partial wildcard
// patterns like workflow:* resolve MatchedAction to the actual action.
func TestPartialWildcardResolvesMatchedAction(t *testing.T) {
	ctx := context.Background()

	tests := []struct {
		name       string
		action     string
		path       string
		method     string
		wantAction string
	}{
		{
			name:       "workflow:* resolves to workflow:Read",
			action:     "workflow:*",
			path:       "/api/workflow/abc123",
			method:     "GET",
			wantAction: ActionWorkflowRead,
		},
		{
			name:       "workflow:* resolves to workflow:List",
			action:     "workflow:*",
			path:       "/api/workflow",
			method:     "GET",
			wantAction: ActionWorkflowList,
		},
		{
			name:       "*:Read resolves to profile:Read",
			action:     "*:Read",
			path:       "/api/profile/settings",
			method:     "GET",
			wantAction: ActionProfileRead,
		},
		{
			name:       "*:Read resolves to resources:Read",
			action:     "*:Read",
			path:       "/api/resources",
			method:     "GET",
			wantAction: ActionResourcesRead,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			role := &Role{
				Name: "test",
				Policies: []RolePolicy{
					{
						Effect:    EffectAllow,
						Actions:   RoleActions{{Action: tt.action}},
						Resources: []string{"*"},
					},
				},
			}
			result := CheckPolicyAccess(ctx, role, tt.path, tt.method, nil)
			if !result.Allowed {
				t.Fatalf("Allowed = false, want true")
			}
			if result.MatchedAction != tt.wantAction {
				t.Errorf("MatchedAction = %q, want %q", result.MatchedAction, tt.wantAction)
			}
		})
	}
}

// TestWildcardWithoutResourcesSkipsPoolMatch verifies that a *:* policy with
// empty resources does NOT skip path resolution (no early return).
func TestWildcardWithoutResourcesSkipsPoolMatch(t *testing.T) {
	ctx := context.Background()

	role := &Role{
		Name: "no-resources",
		Policies: []RolePolicy{
			{
				Effect:  EffectAllow,
				Actions: RoleActions{{Action: "*:*"}},
			},
		},
	}

	result := CheckPolicyAccess(ctx, role, "/api/profile/settings", "GET", nil)
	if !result.Allowed {
		t.Error("wildcard with empty resources should allow unscoped paths")
	}
	if result.MatchedAction != ActionProfileRead {
		t.Errorf("MatchedAction = %q, want %q", result.MatchedAction, ActionProfileRead)
	}
}

// TestCheckPolicyAccessDenyPrecedence verifies that a Deny policy takes precedence over Allow.
func TestCheckPolicyAccessDenyPrecedence(t *testing.T) {
	// Role with Allow workflow:* and Deny workflow:Delete on same resources
	role := &Role{
		Name: "test-role",
		Policies: []RolePolicy{
			{
				Effect:    EffectAllow,
				Actions:   []RoleAction{{Action: "workflow:*"}},
				Resources: []string{"*"},
			},
			{
				Effect:    EffectDeny,
				Actions:   []RoleAction{{Action: "workflow:Delete"}},
				Resources: []string{"*"},
			},
		},
	}
	converted := ConvertRoleToSemantic(role)
	if converted == nil {
		t.Fatal("ConvertRoleToSemantic returned nil")
	}

	ctx := context.Background()

	// DELETE /api/workflow/abc should be denied (Deny policy matches)
	result := CheckPolicyAccess(ctx, converted, "/api/workflow/abc", "DELETE", nil)
	if result.Allowed {
		t.Errorf("CheckPolicyAccess(DELETE /api/workflow/abc): want denied, got allowed")
	}
	if !result.Denied {
		t.Errorf("CheckPolicyAccess(DELETE /api/workflow/abc): want Denied=true, got false")
	}

	// GET /api/workflow/abc should still be allowed
	resultAllow := CheckPolicyAccess(ctx, converted, "/api/workflow/abc", "GET", nil)
	if !resultAllow.Allowed {
		t.Errorf("CheckPolicyAccess(GET /api/workflow/abc): want allowed, got denied")
	}
}
