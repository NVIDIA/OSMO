/*
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION. All rights reserved.

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

package auth

import (
	"context"
	"encoding/json"
	"log/slog"
	"path/filepath"
	"slices"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// SQL query to fetch roles with their policies.
// Schema is owned by Python services - this is read-only access.
//
// Schema (from Python):
//
//	CREATE TABLE IF NOT EXISTS roles (
//	    name TEXT PRIMARY KEY,
//	    description TEXT,
//	    policies JSONB[],
//	    immutable BOOLEAN
//	);
const getRolesSQL = `
SELECT name, policies
FROM roles
WHERE name = ANY($1)
`

// RoleAction represents a single action within a policy.
// Matches Python: role.RoleAction with base, path, method fields.
type RoleAction struct {
	Base   string `json:"base"`   // e.g., "http"
	Path   string `json:"path"`   // e.g., "/api/workflow/*" or "!/api/admin/*"
	Method string `json:"method"` // e.g., "Get", "Post", "*"
}

// RolePolicy represents a policy containing multiple actions.
// Matches Python: role.RolePolicy with actions field.
type RolePolicy struct {
	Actions []RoleAction `json:"actions"`
}

// Role represents a role fetched from the database.
type Role struct {
	Name     string
	Policies []RolePolicy
}

// DBPool defines the interface for database operations needed by RoleChecker.
// This allows for dependency injection and mocking in tests.
type DBPool interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// Ensure pgxpool.Pool satisfies DBPool interface.
var _ DBPool = (*pgxpool.Pool)(nil)

// RoleChecker handles role-based access control using the database.
type RoleChecker struct {
	pool   DBPool
	logger *slog.Logger
}

// NewRoleChecker creates a new RoleChecker using the PostgreSQL pool.
func NewRoleChecker(pool DBPool, logger *slog.Logger) *RoleChecker {
	if logger == nil {
		logger = slog.Default()
	}
	return &RoleChecker{
		pool:   pool,
		logger: logger,
	}
}

// CheckAccess verifies if the user's roles allow access to the given path and method.
// Returns true if access is allowed, false otherwise.
//
// This matches the Python implementation in postgres.py:check_user_access and Role.has_access.
func (rc *RoleChecker) CheckAccess(ctx context.Context, userRoles []string, path, method string) (bool, error) {
	// Always include default role (matches Python: user_roles = roles_header.split(',') + ['osmo-default'])
	allRoles := userRoles
	if !slices.Contains(allRoles, RoleDefault) {
		allRoles = append(allRoles, RoleDefault)
	}

	// Fetch roles from database
	roles, err := rc.fetchRoles(ctx, allRoles)
	if err != nil {
		return false, err
	}

	// Check if any role grants access (matches Python: for role_entry in roles_list)
	for _, role := range roles {
		if role.hasAccess(path, method) {
			rc.logger.DebugContext(ctx, "access granted",
				slog.String("path", path),
				slog.String("method", method),
				slog.String("role", role.Name),
			)
			return true, nil
		}
	}

	rc.logger.DebugContext(ctx, "access denied",
		slog.String("path", path),
		slog.String("method", method),
		slog.Any("roles", userRoles),
	)
	return false, nil
}

// fetchRoles retrieves roles from the database by name.
func (rc *RoleChecker) fetchRoles(ctx context.Context, roleNames []string) ([]Role, error) {
	rows, err := rc.pool.Query(ctx, getRolesSQL, roleNames)
	if err != nil {
		rc.logger.ErrorContext(ctx, "failed to query roles",
			slog.String("error", err.Error()),
			slog.Any("roles", roleNames),
		)
		return nil, err
	}
	defer rows.Close()

	var roles []Role
	for rows.Next() {
		var name string
		var policiesJSON [][]byte // JSONB[] comes as [][]byte

		if err := rows.Scan(&name, &policiesJSON); err != nil {
			rc.logger.ErrorContext(ctx, "failed to scan role",
				slog.String("error", err.Error()),
			)
			return nil, err
		}

		// Parse policies from JSONB array
		policies := make([]RolePolicy, 0, len(policiesJSON))
		for _, policyBytes := range policiesJSON {
			var policy RolePolicy
			if err := json.Unmarshal(policyBytes, &policy); err != nil {
				rc.logger.ErrorContext(ctx, "failed to parse policy JSON",
					slog.String("error", err.Error()),
					slog.String("role", name),
				)
				return nil, err
			}
			policies = append(policies, policy)
		}

		roles = append(roles, Role{
			Name:     name,
			Policies: policies,
		})
	}

	if err := rows.Err(); err != nil {
		rc.logger.ErrorContext(ctx, "error iterating roles",
			slog.String("error", err.Error()),
		)
		return nil, err
	}

	return roles, nil
}

// hasAccess checks if this role grants access to the given path and method.
// This is a direct port of Python's Role.has_access method from postgres.py.
//
// Python implementation:
//
//	def has_access(self, path: str, method: str) -> bool:
//	    allowed = False
//	    for policy in self.policies:
//	        for action in policy.actions:
//	            if action.method.lower() in ['*', method.lower()]:
//	                if action.path.startswith('!'):
//	                    if fnmatch.fnmatch(path, action.path[1:]):
//	                        allowed = False
//	                        break
//	                else:
//	                    if fnmatch.fnmatch(path, action.path):
//	                        allowed = True
//	        if allowed:
//	            return True
//	    return allowed
func (r *Role) hasAccess(path, method string) bool {
	allowed := false

	for _, policy := range r.Policies {
		for _, action := range policy.Actions {
			// Check if method matches (case-insensitive, or wildcard)
			if !methodMatches(action.Method, method) {
				continue
			}

			// Handle exclusion patterns (paths starting with '!')
			if strings.HasPrefix(action.Path, "!") {
				excludePattern := action.Path[1:] // Remove '!' prefix
				if matchGlob(path, excludePattern) {
					allowed = false
					break // Break out of actions loop on exclusion match
				}
			} else {
				if matchGlob(path, action.Path) {
					allowed = true
				}
			}
		}

		// Return early if allowed after processing a policy
		if allowed {
			return true
		}
	}

	return allowed
}

// methodMatches checks if the action method matches the request method.
// Matches Python: action.method.lower() in ['*', method.lower()]
func methodMatches(actionMethod, requestMethod string) bool {
	if actionMethod == "*" {
		return true
	}
	return strings.EqualFold(actionMethod, requestMethod)
}

// matchGlob performs glob-style pattern matching similar to Python's fnmatch.
// Supports:
//   - '*' matches any sequence of characters (including empty and '/')
//   - '?' matches any single character
//
// Unlike filepath.Match, this treats '*' as matching any character including '/'.
// This matches the behavior of Python's fnmatch module.
func matchGlob(path, pattern string) bool {
	// Special case: single '*' matches everything
	if pattern == "*" {
		return true
	}

	// For patterns ending with '/*', we need special handling
	// because filepath.Match treats '*' as not matching '/'
	if strings.HasSuffix(pattern, "/*") {
		prefix := strings.TrimSuffix(pattern, "/*")
		if !strings.HasPrefix(path, prefix+"/") {
			return false
		}
		// Check that remainder has no more slashes (single level match)
		remainder := strings.TrimPrefix(path, prefix+"/")
		return !strings.Contains(remainder, "/")
	}

	// For other patterns, use filepath.Match
	matched, err := filepath.Match(pattern, path)
	if err != nil {
		// Invalid pattern, treat as no match
		return false
	}
	return matched
}
