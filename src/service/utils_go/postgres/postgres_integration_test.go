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
	"context"
	"flag"
	"log/slog"
	"os"
	"testing"
	"time"
)

var (
	postgresHost     string
	postgresPort     int
	postgresDB       string
	postgresUser     string
	postgresPassword string
)

func init() {
	flag.StringVar(&postgresHost, "postgres-host", "localhost", "PostgreSQL host")
	flag.IntVar(&postgresPort, "postgres-port", 5432, "PostgreSQL port")
	flag.StringVar(&postgresDB, "postgres-db", "osmo_db", "PostgreSQL database name")
	flag.StringVar(&postgresUser, "postgres-user", "postgres", "PostgreSQL user")
	flag.StringVar(&postgresPassword, "postgres-password", "osmo", "PostgreSQL password")
}

// TestPostgresIntegration_GetRoles tests fetching roles from a real PostgreSQL instance
// This test requires a running PostgreSQL instance with the osmo schema
func TestPostgresIntegration_GetRoles(t *testing.T) {
	flag.Parse()

	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))

	// Create postgres client
	config := PostgresConfig{
		Host:            postgresHost,
		Port:            postgresPort,
		Database:        postgresDB,
		User:            postgresUser,
		Password:        postgresPassword,
		MaxOpenConns:    5,
		MaxIdleConns:    2,
		ConnMaxLifetime: 5 * time.Minute,
		SSLMode:         "disable",
	}

	client, err := NewPostgresClient(config, logger)
	if err != nil {
		t.Fatalf("Failed to create postgres client: %v\n"+
			"Make sure PostgreSQL is running with:\n"+
			"  docker run --rm -d --name postgres -p 5432:5432 \\\n"+
			"    -e POSTGRES_PASSWORD=osmo -e POSTGRES_DB=osmo_db postgres:15.1",
			err)
	}
	defer client.Close()

	// Verify connection
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := client.Ping(ctx); err != nil {
		t.Fatalf("Failed to ping database: %v", err)
	}

	t.Log("✓ Successfully connected to PostgreSQL")

	// Test fetching known roles
	testCases := []struct {
		name          string
		roleNames     []string
		expectMinimum int
		validateRole  func(*testing.T, *Role)
	}{
		{
			name:          "fetch osmo-default role",
			roleNames:     []string{"osmo-default"},
			expectMinimum: 1,
			validateRole: func(t *testing.T, role *Role) {
				if role.Name != "osmo-default" {
					t.Errorf("Expected role name 'osmo-default', got '%s'", role.Name)
				}
				if len(role.Policies) == 0 {
					t.Error("Expected at least one policy for osmo-default role")
				}
				// Validate policy structure
				for i, policy := range role.Policies {
					if len(policy.Actions) == 0 {
						t.Errorf("Policy %d has no actions", i)
					}
					for j, action := range policy.Actions {
						if action.Path == "" {
							t.Errorf("Policy %d, Action %d has empty path", i, j)
						}
						if action.Method == "" {
							t.Errorf("Policy %d, Action %d has empty method", i, j)
						}
						t.Logf("  Policy %d, Action %d: %s %s %s",
							i, j, action.Base, action.Method, action.Path)
					}
				}
			},
		},
		{
			name:          "fetch osmo-user role",
			roleNames:     []string{"osmo-user"},
			expectMinimum: 1,
			validateRole: func(t *testing.T, role *Role) {
				if role.Name != "osmo-user" {
					t.Errorf("Expected role name 'osmo-user', got '%s'", role.Name)
				}
				if len(role.Policies) == 0 {
					t.Error("Expected at least one policy for osmo-user role")
				}
			},
		},
		{
			name:          "fetch multiple roles",
			roleNames:     []string{"osmo-default", "osmo-user"},
			expectMinimum: 2,
			validateRole: func(t *testing.T, role *Role) {
				if role.Name != "osmo-default" && role.Name != "osmo-user" {
					t.Errorf("Unexpected role name: %s", role.Name)
				}
			},
		},
		{
			name:          "fetch non-existent role",
			roleNames:     []string{"non-existent-role-12345"},
			expectMinimum: 0,
			validateRole:  nil,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()

			roles, err := client.GetRoles(ctx, tc.roleNames)
			if err != nil {
				t.Fatalf("GetRoles() failed: %v", err)
			}

			if len(roles) < tc.expectMinimum {
				t.Errorf("Expected at least %d roles, got %d", tc.expectMinimum, len(roles))
			}

			t.Logf("Fetched %d role(s)", len(roles))

			for _, role := range roles {
				t.Logf("Role: %s (immutable=%v, policies=%d)",
					role.Name, role.Immutable, len(role.Policies))

				if tc.validateRole != nil {
					tc.validateRole(t, role)
				}
			}
		})
	}
}

// TestPostgresIntegration_PolicyParsing tests that policies are correctly parsed from JSON
func TestPostgresIntegration_PolicyParsing(t *testing.T) {
	flag.Parse()

	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelDebug,
	}))

	// Create postgres client
	config := PostgresConfig{
		Host:            postgresHost,
		Port:            postgresPort,
		Database:        postgresDB,
		User:            postgresUser,
		Password:        postgresPassword,
		MaxOpenConns:    5,
		MaxIdleConns:    2,
		ConnMaxLifetime: 5 * time.Minute,
		SSLMode:         "disable",
	}

	client, err := NewPostgresClient(config, logger)
	if err != nil {
		t.Fatalf("Failed to create postgres client: %v", err)
	}
	defer client.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Fetch osmo-default role which should have well-defined policies
	roles, err := client.GetRoles(ctx, []string{"osmo-default"})
	if err != nil {
		t.Fatalf("GetRoles() failed: %v", err)
	}

	if len(roles) == 0 {
		t.Skip("osmo-default role not found in database - skipping policy parsing test")
	}

	role := roles[0]
	t.Logf("Testing policy parsing for role: %s", role.Name)
	t.Logf("Role description: %s", role.Description)
	t.Logf("Number of policies: %d", len(role.Policies))

	if len(role.Policies) == 0 {
		t.Error("Expected at least one policy, got zero")
	}

	// Validate policy structure
	for i, policy := range role.Policies {
		t.Logf("\nPolicy %d:", i)
		t.Logf("  Number of actions: %d", len(policy.Actions))

		if len(policy.Actions) == 0 {
			t.Errorf("Policy %d has no actions", i)
			continue
		}

		for j, action := range policy.Actions {
			t.Logf("  Action %d:", j)
			t.Logf("    Base: %s", action.Base)
			t.Logf("    Method: %s", action.Method)
			t.Logf("    Path: %s", action.Path)

			// Validate action fields are populated
			if action.Base == "" && action.Path != "" {
				t.Logf("    Note: Base is empty (this might be expected)")
			}
			if action.Method == "" {
				t.Errorf("Action %d of policy %d has empty method", j, i)
			}
			if action.Path == "" {
				t.Errorf("Action %d of policy %d has empty path", j, i)
			}

			// Validate method is valid
			validMethods := map[string]bool{
				"*": true, "GET": true, "POST": true, "PUT": true,
				"DELETE": true, "PATCH": true, "HEAD": true, "OPTIONS": true,
			}
			if !validMethods[action.Method] && action.Method != "*" {
				t.Logf("    Warning: Method '%s' is not a standard HTTP method", action.Method)
			}

			// Validate path starts with / or is a pattern
			if action.Path != "*" && !startsWithSlashOrPattern(action.Path) {
				t.Logf("    Warning: Path '%s' doesn't start with '/' or '!'", action.Path)
			}
		}
	}

	t.Logf("\n✓ Successfully validated policy structure for role: %s", role.Name)
}

// TestPostgresIntegration_EmptyRoleNames tests handling of edge cases
func TestPostgresIntegration_EmptyRoleNames(t *testing.T) {
	flag.Parse()

	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelError,
	}))

	config := PostgresConfig{
		Host:            postgresHost,
		Port:            postgresPort,
		Database:        postgresDB,
		User:            postgresUser,
		Password:        postgresPassword,
		MaxOpenConns:    5,
		MaxIdleConns:    2,
		ConnMaxLifetime: 5 * time.Minute,
		SSLMode:         "disable",
	}

	client, err := NewPostgresClient(config, logger)
	if err != nil {
		t.Fatalf("Failed to create postgres client: %v", err)
	}
	defer client.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Test with empty role names
	roles, err := client.GetRoles(ctx, []string{})
	if err != nil {
		t.Errorf("GetRoles() with empty slice should not error, got: %v", err)
	}
	if len(roles) != 0 {
		t.Errorf("Expected 0 roles for empty input, got %d", len(roles))
	}

	t.Log("✓ Empty role names handled correctly")
}

// Helper function to check if a path starts with / or a pattern character
func startsWithSlashOrPattern(path string) bool {
	if len(path) == 0 {
		return false
	}
	return path[0] == '/' || path[0] == '!' || path[0] == '*'
}
