/*
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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

package utils_go

import (
	"testing"
)

func TestJoinStrings(t *testing.T) {
	tests := []struct {
		name     string
		input    []string
		sep      string
		expected string
	}{
		{
			name:     "single string",
			input:    []string{"test"},
			sep:      ",",
			expected: `"test"`,
		},
		{
			name:     "multiple strings",
			input:    []string{"osmo-user", "osmo-default"},
			sep:      ",",
			expected: `"osmo-user","osmo-default"`,
		},
		{
			name:     "three strings",
			input:    []string{"role1", "role2", "role3"},
			sep:      ",",
			expected: `"role1","role2","role3"`,
		},
		{
			name:     "empty slice",
			input:    []string{},
			sep:      ",",
			expected: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := joinStrings(tt.input, tt.sep)
			if got != tt.expected {
				t.Errorf("joinStrings() = %q, want %q", got, tt.expected)
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

// Note: Full PostgreSQL integration tests require a running database
// and are better suited for integration test environments.
// These unit tests verify the structure and helper functions.

