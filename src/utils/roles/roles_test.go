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
	"encoding/json"
	"testing"
)

// TestRoleAction_IsSemanticAction tests the IsSemanticAction helper method
func TestRoleAction_IsSemanticAction(t *testing.T) {
	tests := []struct {
		name     string
		action   RoleAction
		expected bool
	}{
		{
			name:     "semantic action with workflow:Create",
			action:   RoleAction{Action: "workflow:Create"},
			expected: true,
		},
		{
			name:     "semantic action with pool:List",
			action:   RoleAction{Action: "pool:List"},
			expected: true,
		},
		{
			name:     "semantic action with wildcard",
			action:   RoleAction{Action: "*:*"},
			expected: true,
		},
		{
			name:     "legacy action with path",
			action:   RoleAction{Base: "http", Path: "/api/workflow/*", Method: "GET"},
			expected: false,
		},
		{
			name:     "empty action",
			action:   RoleAction{},
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := tt.action.IsSemanticAction()
			if result != tt.expected {
				t.Errorf("IsSemanticAction() = %v, want %v", result, tt.expected)
			}
		})
	}
}

// TestRoleAction_IsLegacyAction tests the IsLegacyAction helper method
func TestRoleAction_IsLegacyAction(t *testing.T) {
	tests := []struct {
		name     string
		action   RoleAction
		expected bool
	}{
		{
			name:     "legacy action with all fields",
			action:   RoleAction{Base: "http", Path: "/api/workflow/*", Method: "GET"},
			expected: true,
		},
		{
			name:     "legacy action with base only",
			action:   RoleAction{Base: "http"},
			expected: true,
		},
		{
			name:     "legacy action with path only",
			action:   RoleAction{Path: "/api/test"},
			expected: true,
		},
		{
			name:     "legacy action with method only",
			action:   RoleAction{Method: "POST"},
			expected: true,
		},
		{
			name:     "semantic action",
			action:   RoleAction{Action: "workflow:Create"},
			expected: false,
		},
		{
			name:     "semantic action with legacy fields (semantic takes precedence)",
			action:   RoleAction{Action: "workflow:Create", Base: "http", Path: "/api/test", Method: "GET"},
			expected: false,
		},
		{
			name:     "empty action",
			action:   RoleAction{},
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := tt.action.IsLegacyAction()
			if result != tt.expected {
				t.Errorf("IsLegacyAction() = %v, want %v", result, tt.expected)
			}
		})
	}
}

// TestRoleAction_JSONParsing tests JSON unmarshaling of RoleAction
func TestRoleAction_JSONParsing(t *testing.T) {
	tests := []struct {
		name           string
		jsonInput      string
		expectedAction RoleAction
		expectError    bool
	}{
		{
			name:      "parse legacy action",
			jsonInput: `{"base": "http", "path": "/api/workflow/*", "method": "GET"}`,
			expectedAction: RoleAction{
				Base:   "http",
				Path:   "/api/workflow/*",
				Method: "GET",
			},
		},
		{
			name:      "parse semantic action",
			jsonInput: `{"action": "workflow:Create"}`,
			expectedAction: RoleAction{
				Action: "workflow:Create",
			},
		},
		{
			name:      "parse semantic action with wildcard",
			jsonInput: `{"action": "workflow:*"}`,
			expectedAction: RoleAction{
				Action: "workflow:*",
			},
		},
		{
			name:      "parse full wildcard action",
			jsonInput: `{"action": "*:*"}`,
			expectedAction: RoleAction{
				Action: "*:*",
			},
		},
		{
			name:      "parse mixed format (both semantic and legacy)",
			jsonInput: `{"action": "workflow:Create", "base": "http", "path": "/api/test", "method": "POST"}`,
			expectedAction: RoleAction{
				Action: "workflow:Create",
				Base:   "http",
				Path:   "/api/test",
				Method: "POST",
			},
		},
		{
			name:           "parse empty object",
			jsonInput:      `{}`,
			expectedAction: RoleAction{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var action RoleAction
			err := json.Unmarshal([]byte(tt.jsonInput), &action)

			if tt.expectError {
				if err == nil {
					t.Errorf("expected error but got none")
				}
				return
			}

			if err != nil {
				t.Errorf("unexpected error: %v", err)
				return
			}

			if action.Action != tt.expectedAction.Action {
				t.Errorf("Action = %q, want %q", action.Action, tt.expectedAction.Action)
			}
			if action.Base != tt.expectedAction.Base {
				t.Errorf("Base = %q, want %q", action.Base, tt.expectedAction.Base)
			}
			if action.Path != tt.expectedAction.Path {
				t.Errorf("Path = %q, want %q", action.Path, tt.expectedAction.Path)
			}
			if action.Method != tt.expectedAction.Method {
				t.Errorf("Method = %q, want %q", action.Method, tt.expectedAction.Method)
			}
		})
	}
}

// TestRoleAction_JSONSerialization tests JSON marshaling of RoleAction
func TestRoleAction_JSONSerialization(t *testing.T) {
	tests := []struct {
		name         string
		action       RoleAction
		expectedJSON string
	}{
		{
			name:         "serialize semantic action only",
			action:       RoleAction{Action: "workflow:Create"},
			expectedJSON: `{"action":"workflow:Create"}`,
		},
		{
			name:         "serialize legacy action only",
			action:       RoleAction{Base: "http", Path: "/api/test", Method: "GET"},
			expectedJSON: `{"base":"http","path":"/api/test","method":"GET"}`,
		},
		{
			name:         "serialize empty action",
			action:       RoleAction{},
			expectedJSON: `{}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := json.Marshal(tt.action)
			if err != nil {
				t.Errorf("unexpected error: %v", err)
				return
			}

			if string(result) != tt.expectedJSON {
				t.Errorf("JSON = %s, want %s", string(result), tt.expectedJSON)
			}
		})
	}
}

// TestRolePolicy_JSONParsing tests JSON unmarshaling of RolePolicy
func TestRolePolicy_JSONParsing(t *testing.T) {
	tests := []struct {
		name           string
		jsonInput      string
		expectedPolicy RolePolicy
		expectError    bool
	}{
		{
			name:      "parse policy with legacy actions only",
			jsonInput: `{"actions": [{"base": "http", "path": "/api/workflow/*", "method": "GET"}]}`,
			expectedPolicy: RolePolicy{
				Actions: []RoleAction{
					{Base: "http", Path: "/api/workflow/*", Method: "GET"},
				},
			},
		},
		{
			name:      "parse policy with semantic actions only",
			jsonInput: `{"actions": [{"action": "workflow:Create"}, {"action": "workflow:Read"}]}`,
			expectedPolicy: RolePolicy{
				Actions: []RoleAction{
					{Action: "workflow:Create"},
					{Action: "workflow:Read"},
				},
			},
		},
		{
			name:      "parse policy with mixed actions",
			jsonInput: `{"actions": [{"action": "workflow:Create"}, {"base": "http", "path": "/api/legacy", "method": "POST"}]}`,
			expectedPolicy: RolePolicy{
				Actions: []RoleAction{
					{Action: "workflow:Create"},
					{Base: "http", Path: "/api/legacy", Method: "POST"},
				},
			},
		},
		{
			name:      "parse policy with resources",
			jsonInput: `{"actions": [{"action": "workflow:Create"}], "resources": ["pool/production", "pool/staging"]}`,
			expectedPolicy: RolePolicy{
				Actions: []RoleAction{
					{Action: "workflow:Create"},
				},
				Resources: []string{"pool/production", "pool/staging"},
			},
		},
		{
			name:      "parse policy with wildcard resource",
			jsonInput: `{"actions": [{"action": "workflow:*"}], "resources": ["*"]}`,
			expectedPolicy: RolePolicy{
				Actions: []RoleAction{
					{Action: "workflow:*"},
				},
				Resources: []string{"*"},
			},
		},
		{
			name:      "parse policy with empty resources array",
			jsonInput: `{"actions": [{"action": "workflow:Create"}], "resources": []}`,
			expectedPolicy: RolePolicy{
				Actions: []RoleAction{
					{Action: "workflow:Create"},
				},
				Resources: []string{},
			},
		},
		{
			name:      "parse policy without resources field",
			jsonInput: `{"actions": [{"action": "workflow:Create"}]}`,
			expectedPolicy: RolePolicy{
				Actions: []RoleAction{
					{Action: "workflow:Create"},
				},
				Resources: nil, // Note: This will be nil after direct unmarshal; GetRoles initializes to []string{}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var policy RolePolicy
			err := json.Unmarshal([]byte(tt.jsonInput), &policy)

			if tt.expectError {
				if err == nil {
					t.Errorf("expected error but got none")
				}
				return
			}

			if err != nil {
				t.Errorf("unexpected error: %v", err)
				return
			}

			if len(policy.Actions) != len(tt.expectedPolicy.Actions) {
				t.Errorf("len(Actions) = %d, want %d", len(policy.Actions), len(tt.expectedPolicy.Actions))
				return
			}

			for i, action := range policy.Actions {
				expected := tt.expectedPolicy.Actions[i]
				if action.Action != expected.Action {
					t.Errorf("Actions[%d].Action = %q, want %q", i, action.Action, expected.Action)
				}
				if action.Base != expected.Base {
					t.Errorf("Actions[%d].Base = %q, want %q", i, action.Base, expected.Base)
				}
				if action.Path != expected.Path {
					t.Errorf("Actions[%d].Path = %q, want %q", i, action.Path, expected.Path)
				}
				if action.Method != expected.Method {
					t.Errorf("Actions[%d].Method = %q, want %q", i, action.Method, expected.Method)
				}
			}

			// Check resources
			if tt.expectedPolicy.Resources == nil {
				if policy.Resources != nil {
					t.Errorf("Resources = %v, want nil", policy.Resources)
				}
			} else {
				if len(policy.Resources) != len(tt.expectedPolicy.Resources) {
					t.Errorf("len(Resources) = %d, want %d", len(policy.Resources), len(tt.expectedPolicy.Resources))
					return
				}
				for i, res := range policy.Resources {
					if res != tt.expectedPolicy.Resources[i] {
						t.Errorf("Resources[%d] = %q, want %q", i, res, tt.expectedPolicy.Resources[i])
					}
				}
			}
		})
	}
}

// TestRolePolicy_ResourcesInitialization tests that Resources is properly initialized
// when parsing policies without a resources field (simulating GetRoles behavior)
func TestRolePolicy_ResourcesInitialization(t *testing.T) {
	jsonInput := `{"actions": [{"action": "workflow:Create"}]}`

	var policy RolePolicy
	err := json.Unmarshal([]byte(jsonInput), &policy)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// After unmarshal, Resources is nil
	if policy.Resources != nil {
		t.Errorf("after unmarshal, Resources = %v, want nil", policy.Resources)
	}

	// Simulate GetRoles behavior: initialize to empty slice
	if policy.Resources == nil {
		policy.Resources = []string{}
	}

	// Now Resources should be an empty slice, not nil
	if policy.Resources == nil {
		t.Errorf("after initialization, Resources should not be nil")
	}
	if len(policy.Resources) != 0 {
		t.Errorf("after initialization, len(Resources) = %d, want 0", len(policy.Resources))
	}
}

// TestRolePolicy_JSONSerialization tests JSON marshaling of RolePolicy
func TestRolePolicy_JSONSerialization(t *testing.T) {
	tests := []struct {
		name         string
		policy       RolePolicy
		expectedJSON string
	}{
		{
			name: "serialize policy with semantic actions and resources",
			policy: RolePolicy{
				Actions: []RoleAction{
					{Action: "workflow:Create"},
				},
				Resources: []string{"pool/production"},
			},
			expectedJSON: `{"actions":[{"action":"workflow:Create"}],"resources":["pool/production"]}`,
		},
		{
			name: "serialize policy with semantic actions and no resources (nil)",
			policy: RolePolicy{
				Actions: []RoleAction{
					{Action: "workflow:Create"},
				},
				Resources: nil,
			},
			expectedJSON: `{"actions":[{"action":"workflow:Create"}]}`,
		},
		{
			name: "serialize policy with semantic actions and empty resources",
			policy: RolePolicy{
				Actions: []RoleAction{
					{Action: "workflow:Create"},
				},
				Resources: []string{},
			},
			expectedJSON: `{"actions":[{"action":"workflow:Create"}]}`,
		},
		{
			name: "serialize policy with legacy actions",
			policy: RolePolicy{
				Actions: []RoleAction{
					{Base: "http", Path: "/api/test", Method: "GET"},
				},
				Resources: []string{},
			},
			expectedJSON: `{"actions":[{"base":"http","path":"/api/test","method":"GET"}]}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := json.Marshal(tt.policy)
			if err != nil {
				t.Errorf("unexpected error: %v", err)
				return
			}

			if string(result) != tt.expectedJSON {
				t.Errorf("JSON = %s, want %s", string(result), tt.expectedJSON)
			}
		})
	}
}

// TestRole_FullParsing tests parsing a complete Role structure from JSON
func TestRole_FullParsing(t *testing.T) {
	jsonInput := `{
		"name": "osmo-user",
		"description": "Standard user role",
		"policies": [
			{
				"actions": [
					{"action": "workflow:Create"},
					{"action": "workflow:Read"},
					{"action": "workflow:Update"},
					{"action": "workflow:Delete"}
				],
				"resources": ["*"]
			},
			{
				"actions": [
					{"action": "dataset:Read"},
					{"action": "dataset:List"}
				],
				"resources": ["bucket/public", "bucket/shared"]
			}
		],
		"immutable": false
	}`

	var role Role
	err := json.Unmarshal([]byte(jsonInput), &role)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if role.Name != "osmo-user" {
		t.Errorf("Name = %q, want %q", role.Name, "osmo-user")
	}
	if role.Description != "Standard user role" {
		t.Errorf("Description = %q, want %q", role.Description, "Standard user role")
	}
	if role.Immutable != false {
		t.Errorf("Immutable = %v, want %v", role.Immutable, false)
	}

	if len(role.Policies) != 2 {
		t.Fatalf("len(Policies) = %d, want 2", len(role.Policies))
	}

	// Check first policy
	policy1 := role.Policies[0]
	if len(policy1.Actions) != 4 {
		t.Errorf("len(Policies[0].Actions) = %d, want 4", len(policy1.Actions))
	}
	expectedActions1 := []string{"workflow:Create", "workflow:Read", "workflow:Update", "workflow:Delete"}
	for i, action := range policy1.Actions {
		if action.Action != expectedActions1[i] {
			t.Errorf("Policies[0].Actions[%d].Action = %q, want %q", i, action.Action, expectedActions1[i])
		}
		if !action.IsSemanticAction() {
			t.Errorf("Policies[0].Actions[%d] should be semantic action", i)
		}
	}
	if len(policy1.Resources) != 1 || policy1.Resources[0] != "*" {
		t.Errorf("Policies[0].Resources = %v, want [\"*\"]", policy1.Resources)
	}

	// Check second policy
	policy2 := role.Policies[1]
	if len(policy2.Actions) != 2 {
		t.Errorf("len(Policies[1].Actions) = %d, want 2", len(policy2.Actions))
	}
	expectedActions2 := []string{"dataset:Read", "dataset:List"}
	for i, action := range policy2.Actions {
		if action.Action != expectedActions2[i] {
			t.Errorf("Policies[1].Actions[%d].Action = %q, want %q", i, action.Action, expectedActions2[i])
		}
	}
	expectedResources2 := []string{"bucket/public", "bucket/shared"}
	if len(policy2.Resources) != 2 {
		t.Errorf("len(Policies[1].Resources) = %d, want 2", len(policy2.Resources))
	} else {
		for i, res := range policy2.Resources {
			if res != expectedResources2[i] {
				t.Errorf("Policies[1].Resources[%d] = %q, want %q", i, res, expectedResources2[i])
			}
		}
	}
}

// TestRole_BackwardsCompatibility tests that old role formats still parse correctly
func TestRole_BackwardsCompatibility(t *testing.T) {
	// Old format role with only legacy path-based actions
	jsonInput := `{
		"name": "legacy-role",
		"description": "Legacy role with path-based actions",
		"policies": [
			{
				"actions": [
					{"base": "http", "path": "/api/workflow/*", "method": "*"},
					{"base": "http", "path": "/api/bucket", "method": "GET"}
				]
			}
		],
		"immutable": false
	}`

	var role Role
	err := json.Unmarshal([]byte(jsonInput), &role)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if role.Name != "legacy-role" {
		t.Errorf("Name = %q, want %q", role.Name, "legacy-role")
	}

	if len(role.Policies) != 1 {
		t.Fatalf("len(Policies) = %d, want 1", len(role.Policies))
	}

	policy := role.Policies[0]
	if len(policy.Actions) != 2 {
		t.Fatalf("len(Actions) = %d, want 2", len(policy.Actions))
	}

	// Verify first action is legacy format
	action1 := policy.Actions[0]
	if !action1.IsLegacyAction() {
		t.Errorf("action1 should be legacy action")
	}
	if action1.IsSemanticAction() {
		t.Errorf("action1 should not be semantic action")
	}
	if action1.Base != "http" {
		t.Errorf("action1.Base = %q, want %q", action1.Base, "http")
	}
	if action1.Path != "/api/workflow/*" {
		t.Errorf("action1.Path = %q, want %q", action1.Path, "/api/workflow/*")
	}
	if action1.Method != "*" {
		t.Errorf("action1.Method = %q, want %q", action1.Method, "*")
	}

	// Verify second action is legacy format
	action2 := policy.Actions[1]
	if !action2.IsLegacyAction() {
		t.Errorf("action2 should be legacy action")
	}
	if action2.Base != "http" {
		t.Errorf("action2.Base = %q, want %q", action2.Base, "http")
	}
	if action2.Path != "/api/bucket" {
		t.Errorf("action2.Path = %q, want %q", action2.Path, "/api/bucket")
	}
	if action2.Method != "GET" {
		t.Errorf("action2.Method = %q, want %q", action2.Method, "GET")
	}

	// Resources should be nil (not specified in input)
	if policy.Resources != nil {
		t.Errorf("Resources = %v, want nil", policy.Resources)
	}
}

// TestRole_MixedActionsInPolicy tests a policy with both legacy and semantic actions
func TestRole_MixedActionsInPolicy(t *testing.T) {
	jsonInput := `{
		"name": "mixed-role",
		"description": "Role with mixed action types",
		"policies": [
			{
				"actions": [
					{"action": "workflow:Create"},
					{"base": "http", "path": "/api/legacy/*", "method": "GET"},
					{"action": "dataset:Read"}
				],
				"resources": ["*"]
			}
		],
		"immutable": false
	}`

	var role Role
	err := json.Unmarshal([]byte(jsonInput), &role)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	policy := role.Policies[0]
	if len(policy.Actions) != 3 {
		t.Fatalf("len(Actions) = %d, want 3", len(policy.Actions))
	}

	// First action: semantic
	if !policy.Actions[0].IsSemanticAction() {
		t.Errorf("action[0] should be semantic")
	}
	if policy.Actions[0].Action != "workflow:Create" {
		t.Errorf("action[0].Action = %q, want %q", policy.Actions[0].Action, "workflow:Create")
	}

	// Second action: legacy
	if !policy.Actions[1].IsLegacyAction() {
		t.Errorf("action[1] should be legacy")
	}
	if policy.Actions[1].Path != "/api/legacy/*" {
		t.Errorf("action[1].Path = %q, want %q", policy.Actions[1].Path, "/api/legacy/*")
	}

	// Third action: semantic
	if !policy.Actions[2].IsSemanticAction() {
		t.Errorf("action[2] should be semantic")
	}
	if policy.Actions[2].Action != "dataset:Read" {
		t.Errorf("action[2].Action = %q, want %q", policy.Actions[2].Action, "dataset:Read")
	}
}

// TestSemanticActionFormats tests various semantic action string formats
func TestSemanticActionFormats(t *testing.T) {
	testCases := []string{
		"workflow:Create",
		"workflow:Read",
		"workflow:Update",
		"workflow:Delete",
		"workflow:Cancel",
		"workflow:List",
		"workflow:Execute",
		"workflow:Exec",
		"workflow:PortForward",
		"workflow:Rsync",
		"dataset:Create",
		"dataset:Read",
		"dataset:Delete",
		"dataset:List",
		"pool:Read",
		"internal:Operator",
		"internal:Logger",
		"internal:Router",
		"config:Read",
		"config:Update",
		"system:Health",
		"system:Version",
		"workflow:*",
		"*:Read",
		"*:*",
	}

	for _, actionStr := range testCases {
		t.Run(actionStr, func(t *testing.T) {
			action := RoleAction{Action: actionStr}

			if !action.IsSemanticAction() {
				t.Errorf("action %q should be semantic", actionStr)
			}
			if action.IsLegacyAction() {
				t.Errorf("action %q should not be legacy", actionStr)
			}

			// Test JSON round-trip
			data, err := json.Marshal(action)
			if err != nil {
				t.Fatalf("failed to marshal: %v", err)
			}

			var parsed RoleAction
			err = json.Unmarshal(data, &parsed)
			if err != nil {
				t.Fatalf("failed to unmarshal: %v", err)
			}

			if parsed.Action != actionStr {
				t.Errorf("after round-trip, Action = %q, want %q", parsed.Action, actionStr)
			}
		})
	}
}

// TestResourcePatterns tests various resource pattern formats
func TestResourcePatterns(t *testing.T) {
	resourcePatterns := [][]string{
		{"*"},
		{"workflow/*"},
		{"workflow/abc123"},
		{"pool/default"},
		{"pool/production/*"},
		{"bucket/data-generation"},
		{"backend/gb200-testing"},
		{"config/service"},
		{"pool/production", "pool/staging"},
		{"bucket/public", "bucket/shared", "bucket/private"},
	}

	for _, resources := range resourcePatterns {
		t.Run(resources[0], func(t *testing.T) {
			policy := RolePolicy{
				Actions: []RoleAction{
					{Action: "workflow:Read"},
				},
				Resources: resources,
			}

			// Test JSON round-trip
			data, err := json.Marshal(policy)
			if err != nil {
				t.Fatalf("failed to marshal: %v", err)
			}

			var parsed RolePolicy
			err = json.Unmarshal(data, &parsed)
			if err != nil {
				t.Fatalf("failed to unmarshal: %v", err)
			}

			if len(parsed.Resources) != len(resources) {
				t.Errorf("after round-trip, len(Resources) = %d, want %d", len(parsed.Resources), len(resources))
				return
			}

			for i, res := range parsed.Resources {
				if res != resources[i] {
					t.Errorf("after round-trip, Resources[%d] = %q, want %q", i, res, resources[i])
				}
			}
		})
	}
}

func TestRoleStructures(t *testing.T) {
	// Test creating role structures
	role := Role{
		Name:        "test-role",
		Description: "Test role",
		Policies: []RolePolicy{
			{
				Actions: []RoleAction{
					{
						Base:   "http",
						Path:   "/api/test",
						Method: "GET",
					},
				},
			},
		},
		Immutable: false,
	}

	if role.Name != "test-role" {
		t.Errorf("role.Name = %q, want %q", role.Name, "test-role")
	}
	if role.Description != "Test role" {
		t.Errorf("role.Description = %q, want %q", role.Description, "Test role")
	}
	if role.Immutable != false {
		t.Errorf("role.Immutable = %v, want %v", role.Immutable, false)
	}

	if len(role.Policies) != 1 {
		t.Errorf("len(role.Policies) = %d, want 1", len(role.Policies))
	}

	if len(role.Policies[0].Actions) != 1 {
		t.Errorf("len(role.Policies[0].Actions) = %d, want 1", len(role.Policies[0].Actions))
	}

	action := role.Policies[0].Actions[0]
	if action.Base != "http" {
		t.Errorf("action.Base = %q, want %q", action.Base, "http")
	}
	if action.Path != "/api/test" {
		t.Errorf("action.Path = %q, want %q", action.Path, "/api/test")
	}
	if action.Method != "GET" {
		t.Errorf("action.Method = %q, want %q", action.Method, "GET")
	}
}

func TestRolePolicy_MultipleActions(t *testing.T) {
	policy := RolePolicy{
		Actions: []RoleAction{
			{Base: "http", Path: "/api/v1/*", Method: "GET"},
			{Base: "http", Path: "/api/v1/*", Method: "POST"},
			{Base: "grpc", Path: "/service.Method", Method: "*"},
		},
	}

	if len(policy.Actions) != 3 {
		t.Errorf("len(policy.Actions) = %d, want 3", len(policy.Actions))
	}

	// Verify each action
	expectedActions := []struct {
		base   string
		path   string
		method string
	}{
		{"http", "/api/v1/*", "GET"},
		{"http", "/api/v1/*", "POST"},
		{"grpc", "/service.Method", "*"},
	}

	for i, expected := range expectedActions {
		if policy.Actions[i].Base != expected.base {
			t.Errorf("action[%d].Base = %q, want %q", i, policy.Actions[i].Base, expected.base)
		}
		if policy.Actions[i].Path != expected.path {
			t.Errorf("action[%d].Path = %q, want %q", i, policy.Actions[i].Path, expected.path)
		}
		if policy.Actions[i].Method != expected.method {
			t.Errorf("action[%d].Method = %q, want %q", i, policy.Actions[i].Method, expected.method)
		}
	}
}

