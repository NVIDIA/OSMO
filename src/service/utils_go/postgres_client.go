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
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	_ "github.com/lib/pq"
)

// PostgresConfig holds PostgreSQL connection configuration
type PostgresConfig struct {
	Host            string
	Port            int
	Database        string
	User            string
	Password        string
	MaxOpenConns    int
	MaxIdleConns    int
	ConnMaxLifetime time.Duration
	SSLMode         string
}

// PostgresClient handles PostgreSQL database operations
type PostgresClient struct {
	db     *sql.DB
	logger *slog.Logger
}

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

// NewPostgresClient creates a new PostgreSQL client with connection pooling
func NewPostgresClient(config PostgresConfig, logger *slog.Logger) (*PostgresClient, error) {
	// Build connection string
	connStr := fmt.Sprintf(
		"host=%s port=%d user=%s password=%s dbname=%s sslmode=%s",
		config.Host,
		config.Port,
		config.User,
		config.Password,
		config.Database,
		config.SSLMode,
	)

	// Open database connection
	db, err := sql.Open("postgres", connStr)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	// Configure connection pool
	db.SetMaxOpenConns(config.MaxOpenConns)
	db.SetMaxIdleConns(config.MaxIdleConns)
	db.SetConnMaxLifetime(config.ConnMaxLifetime)

	// Ping to verify connection
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	logger.Info("postgres client connected successfully")

	return &PostgresClient{
		db:     db,
		logger: logger,
	}, nil
}

// GetRoles retrieves roles by their names from the database
func (c *PostgresClient) GetRoles(ctx context.Context, roleNames []string) ([]*Role, error) {
	if len(roleNames) == 0 {
		return []*Role{}, nil
	}

	// Build query with ANY clause for array matching
	query := `SELECT name, description, policies, immutable
              FROM roles
              WHERE name = ANY($1)
              ORDER BY name`

	// Convert roleNames to PostgreSQL array format
	roleArray := fmt.Sprintf("{%s}", joinStrings(roleNames, ","))

	c.logger.Debug("querying roles",
		slog.String("query", query),
		slog.Any("roles", roleNames),
	)

	rows, err := c.db.QueryContext(ctx, query, roleArray)
	if err != nil {
		c.logger.Error("failed to query roles",
			slog.String("error", err.Error()),
			slog.Any("role_names", roleNames),
		)
		return nil, fmt.Errorf("failed to query roles: %w", err)
	}
	defer rows.Close()

	var roles []*Role
	for rows.Next() {
		var role Role
		var policiesJSON []byte

		err := rows.Scan(&role.Name, &role.Description, &policiesJSON, &role.Immutable)
		if err != nil {
			c.logger.Error("failed to scan role",
				slog.String("error", err.Error()),
			)
			return nil, fmt.Errorf("failed to scan role: %w", err)
		}

		// Parse policies JSON array
		// PostgreSQL returns JSONB[] as a text representation
		var policiesArray []json.RawMessage
		err = json.Unmarshal(policiesJSON, &policiesArray)
		if err != nil {
			c.logger.Error("failed to unmarshal policies array",
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
				c.logger.Error("failed to unmarshal policy",
					slog.String("error", err.Error()),
					slog.String("role", role.Name),
				)
				return nil, fmt.Errorf("failed to unmarshal policy for role %s: %w", role.Name, err)
			}
			role.Policies = append(role.Policies, policy)
		}

		roles = append(roles, &role)

		c.logger.Debug("loaded role",
			slog.String("name", role.Name),
			slog.Int("policies", len(role.Policies)),
		)
	}

	if err := rows.Err(); err != nil {
		c.logger.Error("error iterating rows",
			slog.String("error", err.Error()),
		)
		return nil, fmt.Errorf("error iterating rows: %w", err)
	}

	c.logger.Info("roles loaded successfully",
		slog.Int("count", len(roles)),
		slog.Any("requested", roleNames),
	)

	return roles, nil
}

// Close closes the database connection
func (c *PostgresClient) Close() error {
	c.logger.Info("closing postgres client")
	return c.db.Close()
}

// Ping verifies the database connection is still alive
func (c *PostgresClient) Ping(ctx context.Context) error {
	return c.db.PingContext(ctx)
}

// joinStrings joins strings with a separator for PostgreSQL array
func joinStrings(strs []string, sep string) string {
	if len(strs) == 0 {
		return ""
	}
	result := `"` + strs[0] + `"`
	for i := 1; i < len(strs); i++ {
		result += sep + `"` + strs[i] + `"`
	}
	return result
}

