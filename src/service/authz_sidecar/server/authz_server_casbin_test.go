/*
SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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
	"testing"
)

func TestActionMatchFunc(t *testing.T) {
	tests := []struct {
		name          string
		requestAction string
		policyAction  string
		wantMatch     bool
	}{
		{
			name:          "exact match",
			requestAction: "workflow:Create",
			policyAction:  "workflow:Create",
			wantMatch:     true,
		},
		{
			name:          "full wildcard *:*",
			requestAction: "workflow:Create",
			policyAction:  "*:*",
			wantMatch:     true,
		},
		{
			name:          "full wildcard *",
			requestAction: "workflow:Create",
			policyAction:  "*",
			wantMatch:     true,
		},
		{
			name:          "resource wildcard workflow:*",
			requestAction: "workflow:Create",
			policyAction:  "workflow:*",
			wantMatch:     true,
		},
		{
			name:          "resource wildcard workflow:* matches Read",
			requestAction: "workflow:Read",
			policyAction:  "workflow:*",
			wantMatch:     true,
		},
		{
			name:          "resource wildcard workflow:* matches Delete",
			requestAction: "workflow:Delete",
			policyAction:  "workflow:*",
			wantMatch:     true,
		},
		{
			name:          "resource wildcard bucket:* does not match workflow",
			requestAction: "workflow:Create",
			policyAction:  "bucket:*",
			wantMatch:     false,
		},
		{
			name:          "action wildcard *:Read",
			requestAction: "workflow:Read",
			policyAction:  "*:Read",
			wantMatch:     true,
		},
		{
			name:          "action wildcard *:Read matches bucket:Read",
			requestAction: "bucket:Read",
			policyAction:  "*:Read",
			wantMatch:     true,
		},
		{
			name:          "action wildcard *:Read does not match Create",
			requestAction: "workflow:Create",
			policyAction:  "*:Read",
			wantMatch:     false,
		},
		{
			name:          "no match different resource",
			requestAction: "workflow:Create",
			policyAction:  "bucket:Create",
			wantMatch:     false,
		},
		{
			name:          "no match different action",
			requestAction: "workflow:Create",
			policyAction:  "workflow:Delete",
			wantMatch:     false,
		},
		{
			name:          "task actions",
			requestAction: "task:Read",
			policyAction:  "task:*",
			wantMatch:     true,
		},
		{
			name:          "internal actions",
			requestAction: "internal:Operator",
			policyAction:  "internal:*",
			wantMatch:     true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := actionMatchFunc(tt.requestAction, tt.policyAction)
			if err != nil {
				t.Fatalf("actionMatchFunc() error = %v", err)
			}
			got, ok := result.(bool)
			if !ok {
				t.Fatalf("actionMatchFunc() returned non-bool: %T", result)
			}
			if got != tt.wantMatch {
				t.Errorf("actionMatchFunc(%q, %q) = %v, want %v",
					tt.requestAction, tt.policyAction, got, tt.wantMatch)
			}
		})
	}
}

func TestResourceMatchFunc(t *testing.T) {
	tests := []struct {
		name            string
		requestResource string
		policyResource  string
		wantMatch       bool
	}{
		{
			name:            "exact match",
			requestResource: "workflow/abc123",
			policyResource:  "workflow/abc123",
			wantMatch:       true,
		},
		{
			name:            "full wildcard",
			requestResource: "workflow/abc123",
			policyResource:  "*",
			wantMatch:       true,
		},
		{
			name:            "prefix wildcard workflow/*",
			requestResource: "workflow/abc123",
			policyResource:  "workflow/*",
			wantMatch:       true,
		},
		{
			name:            "prefix wildcard matches any ID",
			requestResource: "workflow/xyz789",
			policyResource:  "workflow/*",
			wantMatch:       true,
		},
		{
			name:            "prefix wildcard bucket/* matches bucket resources",
			requestResource: "bucket/my-bucket",
			policyResource:  "bucket/*",
			wantMatch:       true,
		},
		{
			name:            "prefix wildcard does not match different type",
			requestResource: "workflow/abc123",
			policyResource:  "bucket/*",
			wantMatch:       false,
		},
		{
			name:            "nested path pool/default/*",
			requestResource: "pool/default/workflow123",
			policyResource:  "pool/default/*",
			wantMatch:       true,
		},
		{
			name:            "nested path different pool",
			requestResource: "pool/production/workflow123",
			policyResource:  "pool/default/*",
			wantMatch:       false,
		},
		{
			name:            "no match different resource",
			requestResource: "workflow/abc123",
			policyResource:  "task/abc123",
			wantMatch:       false,
		},
		{
			name:            "wildcard matches base path",
			requestResource: "workflow",
			policyResource:  "workflow/*",
			wantMatch:       true,
		},
		{
			name:            "task resources",
			requestResource: "task/task-456",
			policyResource:  "task/*",
			wantMatch:       true,
		},
		{
			name:            "backend resources",
			requestResource: "backend/agent-1",
			policyResource:  "backend/*",
			wantMatch:       true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := resourceMatchFunc(tt.requestResource, tt.policyResource)
			if err != nil {
				t.Fatalf("resourceMatchFunc() error = %v", err)
			}
			got, ok := result.(bool)
			if !ok {
				t.Fatalf("resourceMatchFunc() returned non-bool: %T", result)
			}
			if got != tt.wantMatch {
				t.Errorf("resourceMatchFunc(%q, %q) = %v, want %v",
					tt.requestResource, tt.policyResource, got, tt.wantMatch)
			}
		})
	}
}

func TestResolvePathToAction(t *testing.T) {
	tests := []struct {
		name         string
		path         string
		method       string
		wantAction   string
		wantResource string
	}{
		// Pool-scoped resources (workflow, task) - pool cannot be determined from path
		{
			name:         "GET workflow list",
			path:         "/api/workflow",
			method:       "GET",
			wantAction:   ActionWorkflowRead,
			wantResource: "pool/*",
		},
		{
			name:         "GET workflow by ID",
			path:         "/api/workflow/abc123",
			method:       "GET",
			wantAction:   ActionWorkflowRead,
			wantResource: "pool/*",
		},
		{
			name:         "POST create workflow",
			path:         "/api/workflow",
			method:       "POST",
			wantAction:   ActionWorkflowCreate,
			wantResource: "pool/*",
		},
		{
			name:         "PUT update workflow",
			path:         "/api/workflow/abc123",
			method:       "PUT",
			wantAction:   ActionWorkflowUpdate,
			wantResource: "pool/*",
		},
		{
			name:         "PATCH update workflow",
			path:         "/api/workflow/abc123",
			method:       "PATCH",
			wantAction:   ActionWorkflowUpdate,
			wantResource: "pool/*",
		},
		{
			name:         "DELETE workflow",
			path:         "/api/workflow/abc123",
			method:       "DELETE",
			wantAction:   ActionWorkflowDelete,
			wantResource: "pool/*",
		},
		{
			name:         "POST cancel workflow",
			path:         "/api/workflow/abc123/cancel",
			method:       "POST",
			wantAction:   ActionWorkflowCancel,
			wantResource: "pool/*",
		},
		{
			name:         "GET task list",
			path:         "/api/task",
			method:       "GET",
			wantAction:   ActionWorkflowRead,
			wantResource: "pool/*",
		},
		{
			name:         "GET task by ID",
			path:         "/api/task/task-456",
			method:       "GET",
			wantAction:   ActionWorkflowRead,
			wantResource: "pool/*",
		},
		{
			name:         "path with query string",
			path:         "/api/workflow?status=running",
			method:       "GET",
			wantAction:   ActionWorkflowRead,
			wantResource: "pool/*",
		},
		{
			name:         "path with trailing slash",
			path:         "/api/workflow/",
			method:       "GET",
			wantAction:   ActionWorkflowRead,
			wantResource: "pool/*",
		},
		// Self-scoped resources (bucket, config)
		{
			name:         "GET bucket list",
			path:         "/api/bucket",
			method:       "GET",
			wantAction:   ActionBucketRead,
			wantResource: "bucket/*",
		},
		{
			name:         "GET bucket by name",
			path:         "/api/bucket/my-bucket",
			method:       "GET",
			wantAction:   ActionBucketRead,
			wantResource: "bucket/my-bucket",
		},
		{
			name:         "GET config list",
			path:         "/api/configs",
			method:       "GET",
			wantAction:   ActionConfigRead,
			wantResource: "config/*",
		},
		{
			name:         "GET config by ID",
			path:         "/api/configs/my-config",
			method:       "GET",
			wantAction:   ActionConfigRead,
			wantResource: "config/my-config",
		},
		// User-scoped resources (profile)
		{
			name:         "GET profile",
			path:         "/api/profile/user123",
			method:       "GET",
			wantAction:   ActionProfileRead,
			wantResource: "user/user123",
		},
		// Global/public resources
		{
			name:         "auth login endpoint",
			path:         "/api/auth/login",
			method:       "GET",
			wantAction:   ActionAuthLogin,
			wantResource: "*",
		},
		{
			name:         "health endpoint",
			path:         "/health",
			method:       "GET",
			wantAction:   ActionSystemHealth,
			wantResource: "*",
		},
		{
			name:         "version endpoint",
			path:         "/api/version",
			method:       "GET",
			wantAction:   ActionSystemVersion,
			wantResource: "*",
		},
		{
			name:         "credentials list",
			path:         "/api/credentials",
			method:       "GET",
			wantAction:   ActionCredentialsRead,
			wantResource: "*",
		},
		{
			name:         "credentials create",
			path:         "/api/credentials",
			method:       "POST",
			wantAction:   ActionCredentialsCreate,
			wantResource: "*",
		},
		{
			name:         "user list",
			path:         "/api/users",
			method:       "GET",
			wantAction:   ActionUserList,
			wantResource: "*",
		},
		{
			name:         "app list",
			path:         "/api/app",
			method:       "GET",
			wantAction:   ActionAppRead,
			wantResource: "*",
		},
		// Internal resources - scoped to backend
		{
			name:         "internal operator",
			path:         "/api/agent/listener/status",
			method:       "GET",
			wantAction:   ActionInternalOperator,
			wantResource: "backend/listener",
		},
		{
			name:         "internal logger",
			path:         "/api/logger/workflow/abc123",
			method:       "POST",
			wantAction:   ActionInternalLogger,
			wantResource: "backend/workflow",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotAction, gotResource := ResolvePathToAction(tt.path, tt.method)
			if gotAction != tt.wantAction {
				t.Errorf("ResolvePathToAction(%q, %q) action = %q, want %q",
					tt.path, tt.method, gotAction, tt.wantAction)
			}
			if gotResource != tt.wantResource {
				t.Errorf("ResolvePathToAction(%q, %q) resource = %q, want %q",
					tt.path, tt.method, gotResource, tt.wantResource)
			}
		})
	}
}

func TestUnknownPathReturnsEmptyAction(t *testing.T) {
	// Test that unknown paths return empty action (which triggers deny)
	tests := []struct {
		name   string
		path   string
		method string
	}{
		{
			name:   "unknown resource",
			path:   "/api/unknown",
			method: "GET",
		},
		{
			name:   "unknown nested path",
			path:   "/api/unknown/abc123",
			method: "GET",
		},
		{
			name:   "completely unknown path",
			path:   "/something/random",
			method: "POST",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			action, _ := ResolvePathToAction(tt.path, tt.method)
			if action != "" {
				t.Errorf("ResolvePathToAction(%q, %q) = %q, want empty string for unknown path",
					tt.path, tt.method, action)
			}
		})
	}
}

func TestIsValidAction(t *testing.T) {
	tests := []struct {
		name      string
		action    string
		wantValid bool
	}{
		{
			name:      "exact action",
			action:    ActionWorkflowCreate,
			wantValid: true,
		},
		{
			name:      "full wildcard *:*",
			action:    "*:*",
			wantValid: true,
		},
		{
			name:      "full wildcard *",
			action:    "*",
			wantValid: true,
		},
		{
			name:      "resource wildcard workflow:*",
			action:    "workflow:*",
			wantValid: true,
		},
		{
			name:      "action wildcard *:Read",
			action:    "*:Read",
			wantValid: true,
		},
		{
			name:      "invalid action",
			action:    "invalid:Action",
			wantValid: false,
		},
		{
			name:      "invalid resource wildcard",
			action:    "nonexistent:*",
			wantValid: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := IsValidAction(tt.action)
			if got != tt.wantValid {
				t.Errorf("IsValidAction(%q) = %v, want %v",
					tt.action, got, tt.wantValid)
			}
		})
	}
}

func TestMatchPath(t *testing.T) {
	tests := []struct {
		name        string
		requestPath string
		pattern     string
		wantMatch   bool
	}{
		{
			name:        "exact match",
			requestPath: "/api/workflow",
			pattern:     "/api/workflow",
			wantMatch:   true,
		},
		{
			name:        "wildcard suffix match",
			requestPath: "/api/workflow/abc123",
			pattern:     "/api/workflow/*",
			wantMatch:   true,
		},
		{
			name:        "wildcard suffix match nested",
			requestPath: "/api/workflow/abc123/spec",
			pattern:     "/api/workflow/*",
			wantMatch:   true,
		},
		{
			name:        "wildcard middle match",
			requestPath: "/api/workflow/abc123/cancel",
			pattern:     "/api/workflow/*/cancel",
			wantMatch:   true,
		},
		{
			name:        "wildcard no match different path",
			requestPath: "/api/bucket/abc123",
			pattern:     "/api/workflow/*",
			wantMatch:   false,
		},
		{
			name:        "exact no match",
			requestPath: "/api/workflow/abc123",
			pattern:     "/api/workflow",
			wantMatch:   false,
		},
		{
			name:        "multiple wildcards",
			requestPath: "/api/router/session/abc/client/connect",
			pattern:     "/api/router/*/*/client/*",
			wantMatch:   true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := matchPath(tt.requestPath, tt.pattern)
			if got != tt.wantMatch {
				t.Errorf("matchPath(%q, %q) = %v, want %v",
					tt.requestPath, tt.pattern, got, tt.wantMatch)
			}
		})
	}
}

func TestActionMatchFuncInvalidTypes(t *testing.T) {
	tests := []struct {
		name      string
		arg1      interface{}
		arg2      interface{}
		wantMatch bool
	}{
		{
			name:      "first arg not string",
			arg1:      123,
			arg2:      "workflow:Create",
			wantMatch: false,
		},
		{
			name:      "second arg not string",
			arg1:      "workflow:Create",
			arg2:      456,
			wantMatch: false,
		},
		{
			name:      "both args not string",
			arg1:      nil,
			arg2:      nil,
			wantMatch: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := actionMatchFunc(tt.arg1, tt.arg2)
			if err != nil {
				t.Fatalf("actionMatchFunc() error = %v", err)
			}
			got, ok := result.(bool)
			if !ok {
				t.Fatalf("actionMatchFunc() returned non-bool: %T", result)
			}
			if got != tt.wantMatch {
				t.Errorf("actionMatchFunc(%v, %v) = %v, want %v",
					tt.arg1, tt.arg2, got, tt.wantMatch)
			}
		})
	}
}

func TestResourceMatchFuncInvalidTypes(t *testing.T) {
	tests := []struct {
		name      string
		arg1      interface{}
		arg2      interface{}
		wantMatch bool
	}{
		{
			name:      "first arg not string",
			arg1:      123,
			arg2:      "workflow/*",
			wantMatch: false,
		},
		{
			name:      "second arg not string",
			arg1:      "workflow/abc123",
			arg2:      456,
			wantMatch: false,
		},
		{
			name:      "both args not string",
			arg1:      nil,
			arg2:      nil,
			wantMatch: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := resourceMatchFunc(tt.arg1, tt.arg2)
			if err != nil {
				t.Fatalf("resourceMatchFunc() error = %v", err)
			}
			got, ok := result.(bool)
			if !ok {
				t.Fatalf("resourceMatchFunc() returned non-bool: %T", result)
			}
			if got != tt.wantMatch {
				t.Errorf("resourceMatchFunc(%v, %v) = %v, want %v",
					tt.arg1, tt.arg2, got, tt.wantMatch)
			}
		})
	}
}

func TestBuildRequestContext(t *testing.T) {
	// This test verifies the RequestContext struct can be properly initialized
	ctx := RequestContext{
		Method:   "GET",
		Path:     "/api/workflow/abc123",
		Headers:  map[string]string{"x-osmo-user": "alice", "x-osmo-roles": "osmo-user,osmo-admin"},
		Params:   map[string]string{"id": "abc123"},
		Query:    map[string]string{"details": "true"},
		Body:     map[string]any{"name": "test-workflow"},
		UserID:   "alice",
		UserName: "alice",
		Roles:    []string{"osmo-user", "osmo-admin"},
	}

	if ctx.Method != "GET" {
		t.Errorf("RequestContext.Method = %q, want %q", ctx.Method, "GET")
	}
	if ctx.Path != "/api/workflow/abc123" {
		t.Errorf("RequestContext.Path = %q, want %q", ctx.Path, "/api/workflow/abc123")
	}
	if ctx.UserID != "alice" {
		t.Errorf("RequestContext.UserID = %q, want %q", ctx.UserID, "alice")
	}
	if len(ctx.Roles) != 2 {
		t.Errorf("RequestContext.Roles length = %d, want %d", len(ctx.Roles), 2)
	}
}

// TestRolePatternScenarios tests common role-based access patterns
// Uses scope-based resources as defined in the Resource-Action Model
func TestRolePatternScenarios(t *testing.T) {
	tests := []struct {
		name          string
		requestAction string
		requestRes    string
		policyAction  string
		policyRes     string
		wantMatch     bool
	}{
		{
			name:          "osmo-admin: full access pattern",
			requestAction: "workflow:Create",
			requestRes:    "pool/*",
			policyAction:  "*:*",
			policyRes:     "*",
			wantMatch:     true,
		},
		{
			name:          "osmo-user: workflow access with pool scope",
			requestAction: "workflow:Read",
			requestRes:    "pool/*",
			policyAction:  "workflow:*",
			policyRes:     "*",
			wantMatch:     true,
		},
		{
			name:          "osmo-viewer: read-only access",
			requestAction: "workflow:Read",
			requestRes:    "pool/*",
			policyAction:  "workflow:Read",
			policyRes:     "*",
			wantMatch:     true,
		},
		{
			name:          "osmo-viewer: cannot create",
			requestAction: "workflow:Create",
			requestRes:    "pool/*",
			policyAction:  "workflow:Read",
			policyRes:     "*",
			wantMatch:     false,
		},
		{
			name:          "osmo-backend: internal operator access",
			requestAction: "internal:Operator",
			requestRes:    "backend/agent-1",
			policyAction:  "internal:Operator",
			policyRes:     "backend/*",
			wantMatch:     true,
		},
		{
			name:          "osmo-default: health check access",
			requestAction: "system:Health",
			requestRes:    "*",
			policyAction:  "system:Health",
			policyRes:     "*",
			wantMatch:     true,
		},
		{
			name:          "osmo-default: cannot access workflows",
			requestAction: "workflow:Read",
			requestRes:    "pool/*",
			policyAction:  "system:Health",
			policyRes:     "*",
			wantMatch:     false,
		},
		{
			name:          "bucket access with self-scope",
			requestAction: "bucket:Read",
			requestRes:    "bucket/my-bucket",
			policyAction:  "bucket:*",
			policyRes:     "bucket/*",
			wantMatch:     true,
		},
		{
			name:          "profile access with user scope",
			requestAction: "profile:Read",
			requestRes:    "user/alice",
			policyAction:  "profile:Read",
			policyRes:     "user/*",
			wantMatch:     true,
		},
		{
			name:          "credentials global access",
			requestAction: "credentials:Read",
			requestRes:    "*",
			policyAction:  "credentials:*",
			policyRes:     "*",
			wantMatch:     true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Check action match
			actionResult, err := actionMatchFunc(tt.requestAction, tt.policyAction)
			if err != nil {
				t.Fatalf("actionMatchFunc() error = %v", err)
			}
			actionMatch := actionResult.(bool)

			// Check resource match
			resResult, err := resourceMatchFunc(tt.requestRes, tt.policyRes)
			if err != nil {
				t.Fatalf("resourceMatchFunc() error = %v", err)
			}
			resMatch := resResult.(bool)

			// Both must match for policy to apply
			got := actionMatch && resMatch
			if got != tt.wantMatch {
				t.Errorf("action=%q res=%q against policy action=%q res=%q: got %v, want %v",
					tt.requestAction, tt.requestRes, tt.policyAction, tt.policyRes, got, tt.wantMatch)
			}
		})
	}
}
