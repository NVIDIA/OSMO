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

// Package roles provides types and utilities for role-based access control.
package roles

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"go.corp.nvidia.com/osmo/utils/postgres"
)

// RoleAction represents a single role action.
// It supports both legacy path-based actions and new semantic actions.
//
// Legacy format (path-based):
//
//	{"base": "http", "path": "/api/workflow/*", "method": "*"}
//
// New format (semantic action):
//
//	{"action": "workflow:Create"}
//
// The Action field takes precedence when set. If Action is empty,
// the legacy Base/Path/Method fields are used.
type RoleAction struct {
	// Action is the new semantic action string (e.g., "workflow:Create", "pool:List").
	// When set, this takes precedence over the legacy path-based fields.
	Action string `json:"action,omitempty"`

	// Legacy path-based fields (for backwards compatibility)
	Base   string `json:"base,omitempty"`
	Path   string `json:"path,omitempty"`
	Method string `json:"method,omitempty"`
}

// IsSemanticAction returns true if this RoleAction uses the new semantic action format.
func (ra *RoleAction) IsSemanticAction() bool {
	return ra.Action != ""
}

// IsLegacyAction returns true if this RoleAction uses the legacy path-based format.
func (ra *RoleAction) IsLegacyAction() bool {
	return ra.Action == "" && (ra.Base != "" || ra.Path != "" || ra.Method != "")
}

// RolePolicy represents a role policy with multiple actions.
// Policies can optionally specify resources to scope the actions.
type RolePolicy struct {
	// Actions is the list of actions this policy allows or denies.
	Actions []RoleAction `json:"actions"`

	// Resources is the list of resource patterns this policy applies to.
	// Examples: ["*"], ["workflow/*"], ["pool/production"], ["bucket/data-generation"]
	// If empty, the policy applies to all resources ("*").
	Resources []string `json:"resources,omitempty"`
}

// Role represents a complete role with policies
type Role struct {
	Name        string       `json:"name"`
	Description string       `json:"description"`
	Policies    []RolePolicy `json:"policies"`
	Immutable   bool         `json:"immutable"`
}

// GetRoles retrieves roles by their names from the database
func GetRoles(ctx context.Context, client *postgres.PostgresClient, roleNames []string,
	logger *slog.Logger) ([]*Role, error) {
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

	logger.Debug("querying roles",
		slog.String("query", query),
		slog.Any("roles", roleNames),
	)

	rows, err := client.Pool().Query(ctx, query, roleNames)
	if err != nil {
		logger.Error("failed to query roles",
			slog.String("error", err.Error()),
			slog.Any("role_names", roleNames),
		)
		return nil, fmt.Errorf("failed to query roles: %w", err)
	}
	defer rows.Close()

	var result []*Role
	for rows.Next() {
		var role Role
		var policiesStr string // Scan as string first to handle PostgreSQL's JSONB representation

		err := rows.Scan(&role.Name, &role.Description, &policiesStr, &role.Immutable)
		if err != nil {
			logger.Error("failed to scan role",
				slog.String("error", err.Error()),
			)
			return nil, fmt.Errorf("failed to scan role: %w", err)
		}

		policiesJSON := []byte(policiesStr)

		// Parse policies JSON array (converted from JSONB[] via array_to_json)
		var policiesArray []json.RawMessage
		err = json.Unmarshal(policiesJSON, &policiesArray)
		if err != nil {
			logger.Error("failed to unmarshal policies array",
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
				logger.Error("failed to unmarshal policy",
					slog.String("error", err.Error()),
					slog.String("role", role.Name),
					slog.String("policy_raw", string(policyRaw)),
				)
				return nil, fmt.Errorf("failed to unmarshal policy for role %s: %w", role.Name, err)
			}
			// Ensure Resources is never nil (always an empty list if not specified)
			if policy.Resources == nil {
				policy.Resources = []string{}
			}
			role.Policies = append(role.Policies, policy)
		}

		result = append(result, &role)

		logger.Debug("loaded role",
			slog.String("name", role.Name),
			slog.Int("policies", len(role.Policies)),
		)
	}

	if err := rows.Err(); err != nil {
		logger.Error("error iterating rows",
			slog.String("error", err.Error()),
		)
		return nil, fmt.Errorf("error iterating rows: %w", err)
	}

	logger.Info("roles loaded successfully",
		slog.Int("count", len(result)),
		slog.Any("requested", roleNames),
	)

	return result, nil
}

// GetAllRoleNames retrieves all role names from the database
func GetAllRoleNames(ctx context.Context, client *postgres.PostgresClient) ([]string, error) {
	query := `SELECT name FROM roles ORDER BY name`

	rows, err := client.Pool().Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to query role names: %w", err)
	}
	defer rows.Close()

	var roleNames []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, fmt.Errorf("failed to scan role name: %w", err)
		}
		roleNames = append(roleNames, name)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating role names: %w", err)
	}

	return roleNames, nil
}

// GetPoolForWorkflow returns the pool name for a given workflow ID
// by querying the workflows table. Returns empty string and error if not found.
func GetPoolForWorkflow(
	ctx context.Context, client *postgres.PostgresClient, workflowID string,
) (string, error) {
	query := `SELECT pool FROM workflows WHERE workflow_id = $1`

	var pool string
	err := client.Pool().QueryRow(ctx, query, workflowID).Scan(&pool)
	if err != nil {
		return "", fmt.Errorf("failed to get pool for workflow %s: %w", workflowID, err)
	}

	return pool, nil
}

// UpdateRolePolicies updates the policies for a role in the database.
// This converts the policies to JSONB[] format expected by PostgreSQL.
func UpdateRolePolicies(
	ctx context.Context, client *postgres.PostgresClient, role *Role, logger *slog.Logger,
) error {
	// Convert each policy to JSON
	policiesJSON := make([][]byte, len(role.Policies))
	for i, policy := range role.Policies {
		policyBytes, err := json.Marshal(policy)
		if err != nil {
			return fmt.Errorf("failed to marshal policy for role %s: %w", role.Name, err)
		}
		policiesJSON[i] = policyBytes
	}

	// Update the role's policies in the database
	// PostgreSQL expects JSONB[] which we construct from individual JSON values
	query := `UPDATE roles SET policies = $1::jsonb[] WHERE name = $2`

	_, err := client.Pool().Exec(ctx, query, policiesJSON, role.Name)
	if err != nil {
		logger.Error("failed to update role policies",
			slog.String("role", role.Name),
			slog.String("error", err.Error()),
		)
		return fmt.Errorf("failed to update role %s: %w", role.Name, err)
	}

	logger.Debug("updated role policies",
		slog.String("role", role.Name),
		slog.Int("policies", len(role.Policies)),
	)

	return nil
}
