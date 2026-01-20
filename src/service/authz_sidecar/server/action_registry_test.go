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
	"testing"
)

func TestActionRegistryComplete(t *testing.T) {
	// Test that all expected actions are registered
	expectedActions := []string{
		ActionWorkflowCreate,
		ActionWorkflowRead,
		ActionWorkflowUpdate,
		ActionWorkflowDelete,
		ActionWorkflowCancel,
		ActionWorkflowExec,
		ActionWorkflowPortForward,
		ActionWorkflowRsync,
		ActionBucketRead,
		ActionBucketWrite,
		ActionBucketDelete,
		ActionPoolRead,
		ActionPoolDelete,
		ActionCredentialsCreate,
		ActionCredentialsRead,
		ActionCredentialsUpdate,
		ActionCredentialsDelete,
		ActionProfileRead,
		ActionProfileUpdate,
		ActionUserList,
		ActionAppCreate,
		ActionAppRead,
		ActionAppUpdate,
		ActionAppDelete,
		ActionResourcesRead,
		ActionConfigRead,
		ActionConfigUpdate,
		ActionAuthLogin,
		ActionAuthRefresh,
		ActionAuthToken,
		ActionAuthServiceToken,
		ActionRouterClient,
		ActionSystemHealth,
		ActionSystemVersion,
		ActionInternalOperator,
		ActionInternalLogger,
		ActionInternalRouter,
	}

	for _, action := range expectedActions {
		if _, exists := ActionRegistry[action]; !exists {
			t.Errorf("Expected action %q not found in ActionRegistry", action)
		}
	}
}

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
			got := matchMethod(tt.requestMethod, tt.allowedMethods)
			if got != tt.wantMatch {
				t.Errorf("matchMethod(%q, %v) = %v, want %v",
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
		// Self-scoped resources (bucket, config)
		{
			name:         "bucket with name returns bucket scope",
			path:         "/api/bucket/my-bucket",
			action:       ActionBucketRead,
			wantResource: "bucket/my-bucket",
		},
		{
			name:         "config with ID returns config scope",
			path:         "/api/configs/my-config",
			action:       ActionConfigRead,
			wantResource: "config/my-config",
		},
		// User-scoped resources (profile)
		{
			name:         "profile returns user scope",
			path:         "/api/profile/user123",
			action:       ActionProfileRead,
			wantResource: "user/user123",
		},
		// Global/public resources
		{
			name:         "system action returns global",
			path:         "/health",
			action:       ActionSystemHealth,
			wantResource: "*",
		},
		{
			name:         "auth action returns global",
			path:         "/api/auth/login",
			action:       ActionAuthLogin,
			wantResource: "*",
		},
		{
			name:         "user list returns global",
			path:         "/api/users",
			action:       ActionUserList,
			wantResource: "*",
		},
		{
			name:         "credentials returns global",
			path:         "/api/credentials/cred-123",
			action:       ActionCredentialsRead,
			wantResource: "*",
		},
		{
			name:         "app returns global",
			path:         "/api/app/app-123",
			action:       ActionAppRead,
			wantResource: "*",
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
			got := extractResourceFromPath(tt.path, tt.action)
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
		{"/api/workflow", "POST", ActionWorkflowCreate},
		{"/api/workflow/abc123", "GET", ActionWorkflowRead},
		{"/api/workflow/abc123", "DELETE", ActionWorkflowDelete},
		{"/api/users", "GET", ActionUserList},
	}

	for _, tt := range adminTests {
		action, _ := ResolvePathToAction(tt.path, tt.method)
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
		action, _ := ResolvePathToAction(tt.path, tt.method)
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
		{"/api/logger/workflow/abc123", "POST", ActionInternalLogger},
		{"/api/router/session/abc/backend/connect", "GET", ActionInternalRouter},
	}

	for _, tt := range internalTests {
		action, _ := ResolvePathToAction(tt.path, tt.method)
		if action != tt.wantAction {
			t.Errorf("Internal path %s %s: got action %q, want %q",
				tt.method, tt.path, action, tt.wantAction)
		}
	}
}
