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

package postgres

import (
	"testing"
	"time"
)

func TestPostgresConfig(t *testing.T) {
	// Test creating a config struct
	config := PostgresConfig{
		Host:            "localhost",
		Port:            5432,
		Database:        "test_db",
		User:            "test_user",
		Password:        "test_pass",
		MaxConns:        10,
		MinConns:        2,
		MaxConnLifetime: 5 * time.Minute,
		SSLMode:         "disable",
	}

	if config.Host != "localhost" {
		t.Errorf("config.Host = %q, want %q", config.Host, "localhost")
	}
	if config.Port != 5432 {
		t.Errorf("config.Port = %d, want %d", config.Port, 5432)
	}
	if config.MaxConns != 10 {
		t.Errorf("config.MaxConns = %d, want %d", config.MaxConns, 10)
	}
	if config.MinConns != 2 {
		t.Errorf("config.MinConns = %d, want %d", config.MinConns, 2)
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

// Note: Full PostgreSQL integration tests require a running database
// and are better suited for integration test environments.
// These unit tests verify the structure and helper functions.
