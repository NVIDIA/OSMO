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

package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
)

// RoleAction represents a single role action
type RoleAction struct {
	Base   string `json:"base"`
	Path   string `json:"path"`
	Method string `json:"method"`
}

// RolePolicy represents a role policy with multiple actions
type RolePolicy struct {
	Actions []RoleAction `json:"actions"`
}

// Role represents a complete role with policies
type Role struct {
	Name        string       `json:"name"`
	Description string       `json:"description"`
	Policies    []RolePolicy `json:"policies"`
	Immutable   bool         `json:"immutable"`
}

// GetRoles retrieves roles by their names from the database
func GetRoles(ctx context.Context, client *PostgresClient, roleNames []string) ([]*Role, error) {
	if len(roleNames) == 0 {
		return []*Role{}, nil
	}

	// Build query with ANY clause for array matching
	// Convert JSONB[] to JSON array for easier parsing in Go
	// pgx natively handles []string as PostgreSQL array
	query := `SELECT name, description, array_to_json(policies)::text as policies, immutable
              FROM roles
              WHERE name = ANY($1)
              ORDER BY name`

	client.logger.Debug("querying roles",
		slog.String("query", query),
		slog.Any("roles", roleNames),
	)

	rows, err := client.pool.Query(ctx, query, roleNames)
	if err != nil {
		client.logger.Error("failed to query roles",
			slog.String("error", err.Error()),
			slog.Any("role_names", roleNames),
		)
		return nil, fmt.Errorf("failed to query roles: %w", err)
	}
	defer rows.Close()

	var roles []*Role
	for rows.Next() {
		var role Role
		var policiesStr string // Scan as string first to handle PostgreSQL's JSONB representation

		err := rows.Scan(&role.Name, &role.Description, &policiesStr, &role.Immutable)
		if err != nil {
			client.logger.Error("failed to scan role",
				slog.String("error", err.Error()),
			)
			return nil, fmt.Errorf("failed to scan role: %w", err)
		}

		policiesJSON := []byte(policiesStr)

		// Parse policies JSON array (converted from JSONB[] via array_to_json)
		var policiesArray []json.RawMessage
		err = json.Unmarshal(policiesJSON, &policiesArray)
		if err != nil {
			client.logger.Error("failed to unmarshal policies array",
				slog.String("error", err.Error()),
				slog.String("role", role.Name),
				slog.String("raw_json", string(policiesJSON)),
			)
			return nil, fmt.Errorf("failed to unmarshal policies for role %s: %w", role.Name, err)
		}

		// Parse each policy
		role.Policies = make([]RolePolicy, 0, len(policiesArray))
		for _, policyRaw := range policiesArray {
			var policy RolePolicy
			err = json.Unmarshal(policyRaw, &policy)
			if err != nil {
				client.logger.Error("failed to unmarshal policy",
					slog.String("error", err.Error()),
					slog.String("role", role.Name),
					slog.String("policy_raw", string(policyRaw)),
				)
				return nil, fmt.Errorf("failed to unmarshal policy for role %s: %w", role.Name, err)
			}
			role.Policies = append(role.Policies, policy)
		}

		roles = append(roles, &role)

		client.logger.Debug("loaded role",
			slog.String("name", role.Name),
			slog.Int("policies", len(role.Policies)),
		)
	}

	if err := rows.Err(); err != nil {
		client.logger.Error("error iterating rows",
			slog.String("error", err.Error()),
		)
		return nil, fmt.Errorf("error iterating rows: %w", err)
	}

	client.logger.Info("roles loaded successfully",
		slog.Int("count", len(roles)),
		slog.Any("requested", roleNames),
	)

	return roles, nil
}
