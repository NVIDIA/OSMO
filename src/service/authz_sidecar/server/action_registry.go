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
	"strings"
)

// Action constants for compile-time safety
const (
	// Workflow actions
	ActionWorkflowCreate      = "workflow:Create"
	ActionWorkflowRead        = "workflow:Read"
	ActionWorkflowUpdate      = "workflow:Update"
	ActionWorkflowDelete      = "workflow:Delete"
	ActionWorkflowCancel      = "workflow:Cancel"
	ActionWorkflowExec        = "workflow:Exec"
	ActionWorkflowPortForward = "workflow:PortForward"
	ActionWorkflowRsync       = "workflow:Rsync"

	// Bucket actions
	ActionBucketRead   = "bucket:Read"
	ActionBucketWrite  = "bucket:Write"
	ActionBucketDelete = "bucket:Delete"

	// Pool actions
	ActionPoolRead   = "pool:Read"
	ActionPoolDelete = "pool:Delete"

	// Credentials actions
	ActionCredentialsCreate = "credentials:Create"
	ActionCredentialsRead   = "credentials:Read"
	ActionCredentialsUpdate = "credentials:Update"
	ActionCredentialsDelete = "credentials:Delete"

	// Profile actions
	ActionProfileRead   = "profile:Read"
	ActionProfileUpdate = "profile:Update"

	// User actions
	ActionUserList = "user:List"

	// App actions
	ActionAppCreate = "app:Create"
	ActionAppRead   = "app:Read"
	ActionAppUpdate = "app:Update"
	ActionAppDelete = "app:Delete"

	// Resources actions
	ActionResourcesRead = "resources:Read"

	// Config actions
	ActionConfigRead   = "config:Read"
	ActionConfigUpdate = "config:Update"

	// Auth actions
	ActionAuthLogin        = "auth:Login"
	ActionAuthRefresh      = "auth:Refresh"
	ActionAuthToken        = "auth:Token"
	ActionAuthServiceToken = "auth:ServiceToken"

	// Router actions
	ActionRouterClient = "router:Client"

	// System actions (public)
	ActionSystemHealth  = "system:Health"
	ActionSystemVersion = "system:Version"

	// Internal actions (restricted)
	ActionInternalOperator = "internal:Operator"
	ActionInternalLogger   = "internal:Logger"
	ActionInternalRouter   = "internal:Router"
)

// EndpointPattern defines an API endpoint pattern
type EndpointPattern struct {
	Path    string
	Methods []string
}

// ActionRegistry maps resource:action pairs to API endpoint patterns
// This is the authoritative mapping of actions to API paths
var ActionRegistry = map[string][]EndpointPattern{
	// ==================== WORKFLOW ====================
	ActionWorkflowCreate: {
		{Path: "/api/workflow", Methods: []string{"POST"}},
	},
	ActionWorkflowRead: {
		{Path: "/api/workflow", Methods: []string{"GET"}},
		{Path: "/api/workflow/*", Methods: []string{"GET"}},
		{Path: "/api/workflow/spec", Methods: []string{"GET"}},
		{Path: "/api/task", Methods: []string{"GET"}},
		{Path: "/api/task/*", Methods: []string{"GET"}},
		{Path: "/api/tag", Methods: []string{"GET"}},
	},
	ActionWorkflowUpdate: {
		{Path: "/api/workflow/*", Methods: []string{"PUT", "PATCH"}},
	},
	ActionWorkflowDelete: {
		{Path: "/api/workflow/*", Methods: []string{"DELETE"}},
	},
	ActionWorkflowCancel: {
		{Path: "/api/workflow/*/cancel", Methods: []string{"POST"}},
	},
	ActionWorkflowExec: {
		{Path: "/api/workflow/*/exec", Methods: []string{"POST", "WEBSOCKET"}},
	},
	ActionWorkflowPortForward: {
		{Path: "/api/workflow/*/portforward/*", Methods: []string{"*"}},
	},
	ActionWorkflowRsync: {
		{Path: "/api/workflow/*/rsync", Methods: []string{"POST"}},
	},

	// ==================== BUCKET ====================
	ActionBucketRead: {
		{Path: "/api/bucket", Methods: []string{"GET"}},
		{Path: "/api/bucket/*", Methods: []string{"GET"}},
	},
	ActionBucketWrite: {
		{Path: "/api/bucket/*", Methods: []string{"POST", "PUT"}},
	},
	ActionBucketDelete: {
		{Path: "/api/bucket/*", Methods: []string{"DELETE"}},
	},

	// ==================== POOL ====================
	ActionPoolRead: {
		{Path: "/api/pool", Methods: []string{"GET"}},
		{Path: "/api/pool/*", Methods: []string{"GET"}},
	},
	ActionPoolDelete: {
		{Path: "/api/pool/*", Methods: []string{"DELETE"}},
	},

	// ==================== CREDENTIALS ====================
	ActionCredentialsCreate: {
		{Path: "/api/credentials", Methods: []string{"POST"}},
	},
	ActionCredentialsRead: {
		{Path: "/api/credentials", Methods: []string{"GET"}},
		{Path: "/api/credentials/*", Methods: []string{"GET"}},
	},
	ActionCredentialsUpdate: {
		{Path: "/api/credentials/*", Methods: []string{"PUT", "PATCH"}},
	},
	ActionCredentialsDelete: {
		{Path: "/api/credentials/*", Methods: []string{"DELETE"}},
	},

	// ==================== PROFILE ====================
	ActionProfileRead: {
		{Path: "/api/profile", Methods: []string{"GET"}},
		{Path: "/api/profile/*", Methods: []string{"GET"}},
	},
	ActionProfileUpdate: {
		{Path: "/api/profile/*", Methods: []string{"PUT", "PATCH"}},
	},

	// ==================== USER ====================
	ActionUserList: {
		{Path: "/api/users", Methods: []string{"GET"}},
	},

	// ==================== APP ====================
	ActionAppCreate: {
		{Path: "/api/app", Methods: []string{"POST"}},
	},
	ActionAppRead: {
		{Path: "/api/app", Methods: []string{"GET"}},
		{Path: "/api/app/*", Methods: []string{"GET"}},
	},
	ActionAppUpdate: {
		{Path: "/api/app/*", Methods: []string{"PUT", "PATCH"}},
	},
	ActionAppDelete: {
		{Path: "/api/app/*", Methods: []string{"DELETE"}},
	},

	// ==================== RESOURCES ====================
	ActionResourcesRead: {
		{Path: "/api/resources", Methods: []string{"GET"}},
		{Path: "/api/resources/*", Methods: []string{"GET"}},
	},

	// ==================== CONFIG ====================
	ActionConfigRead: {
		{Path: "/api/configs", Methods: []string{"GET"}},
		{Path: "/api/configs/*", Methods: []string{"GET"}},
	},
	ActionConfigUpdate: {
		{Path: "/api/configs/*", Methods: []string{"PUT", "PATCH"}},
	},

	// ==================== AUTH ====================
	ActionAuthLogin: {
		{Path: "/api/auth/login", Methods: []string{"GET"}},
		{Path: "/api/auth/keys", Methods: []string{"GET"}},
	},
	ActionAuthRefresh: {
		{Path: "/api/auth/refresh_token", Methods: []string{"*"}},
		{Path: "/api/auth/jwt/refresh_token", Methods: []string{"*"}},
		{Path: "/api/auth/jwt/access_token", Methods: []string{"*"}},
	},
	ActionAuthToken: {
		{Path: "/api/auth/access_token", Methods: []string{"*"}},
		{Path: "/api/auth/access_token/user", Methods: []string{"*"}},
		{Path: "/api/auth/access_token/user/*", Methods: []string{"*"}},
	},
	ActionAuthServiceToken: {
		{Path: "/api/auth/access_token/service", Methods: []string{"*"}},
		{Path: "/api/auth/access_token/service/*", Methods: []string{"*"}},
	},

	// ==================== ROUTER ====================
	ActionRouterClient: {
		{Path: "/api/router/webserver/*", Methods: []string{"*"}},
		{Path: "/api/router/webserver_enabled", Methods: []string{"*"}},
		{Path: "/api/router/*/*/client/*", Methods: []string{"*"}},
	},

	// ==================== SYSTEM (PUBLIC) ====================
	ActionSystemHealth: {
		{Path: "/health", Methods: []string{"*"}},
	},
	ActionSystemVersion: {
		{Path: "/api/version", Methods: []string{"*"}},
		{Path: "/api/router/version", Methods: []string{"*"}},
		{Path: "/client/version", Methods: []string{"*"}},
	},

	// ==================== INTERNAL (RESTRICTED) ====================
	ActionInternalOperator: {
		{Path: "/api/agent/listener/*", Methods: []string{"*"}},
		{Path: "/api/agent/worker/*", Methods: []string{"*"}},
	},
	ActionInternalLogger: {
		{Path: "/api/logger/workflow/*", Methods: []string{"*"}},
	},
	ActionInternalRouter: {
		{Path: "/api/router/*/*/backend/*", Methods: []string{"*"}},
	},
}

// ResolvePathToAction converts an API path and method to a semantic action
// Returns the action and resource, or empty strings if no match found
func ResolvePathToAction(path, method string) (action string, resource string) {
	// Normalize path - remove trailing slash and query string
	normalizedPath := strings.TrimSuffix(path, "/")
	if idx := strings.Index(normalizedPath, "?"); idx != -1 {
		normalizedPath = normalizedPath[:idx]
	}

	method = strings.ToUpper(method)

	// Try to find a matching action in the registry
	// We iterate through actions in a specific order to handle more specific patterns first
	for actionName, patterns := range ActionRegistry {
		for _, pattern := range patterns {
			if matchPath(normalizedPath, pattern.Path) && matchMethod(method, pattern.Methods) {
				resource = extractResourceFromPath(normalizedPath, actionName)
				return actionName, resource
			}
		}
	}

	// Fallback: no action found in registry
	return "", ""
}

// matchPath checks if a request path matches a pattern
// Supports wildcards: /api/workflow/* matches /api/workflow/abc123
func matchPath(requestPath, pattern string) bool {
	// Exact match
	if pattern == requestPath {
		return true
	}

	// Handle wildcard patterns
	if !strings.Contains(pattern, "*") {
		return false
	}

	patternParts := strings.Split(pattern, "/")
	requestParts := strings.Split(requestPath, "/")

	// Pattern ending with /* can match paths with more segments
	if strings.HasSuffix(pattern, "/*") {
		// Remove the trailing /* and check prefix
		prefixPattern := strings.TrimSuffix(pattern, "/*")
		prefixParts := strings.Split(prefixPattern, "/")

		if len(requestParts) < len(prefixParts) {
			return false
		}

		// Check all prefix parts match
		for i, part := range prefixParts {
			if part != "*" && part != requestParts[i] {
				return false
			}
		}
		return true
	}

	// For patterns with * in the middle, parts must match in count
	if len(patternParts) != len(requestParts) {
		return false
	}

	for i, patternPart := range patternParts {
		if patternPart != "*" && patternPart != requestParts[i] {
			return false
		}
	}

	return true
}

// matchMethod checks if a request method matches allowed methods
func matchMethod(requestMethod string, allowedMethods []string) bool {
	for _, m := range allowedMethods {
		if m == "*" || strings.EqualFold(m, requestMethod) {
			return true
		}
	}
	return false
}

// extractResourceFromPath extracts the scoped resource identifier from the path
// based on the Resource-Action Model's scope definitions:
//   - Global/public resources (pool, credentials, user, app, system, auth, router, resources) return "*"
//   - Self-scoped resources (bucket, config) return "{scope}/{id}"
//   - User-scoped resources (profile) return "user/{id}"
//   - Pool-scoped resources (workflow, task) return "pool/*" (pool cannot be determined from path)
//   - Internal resources return "backend/{id}"
func extractResourceFromPath(path, action string) string {
	parts := strings.Split(strings.TrimPrefix(path, "/"), "/")

	// Extract resource type from action (e.g., "workflow:Create" -> "workflow")
	actionParts := strings.Split(action, ":")
	if len(actionParts) < 1 {
		return "*"
	}
	resourceType := actionParts[0]

	// Determine scope based on resource type (from Resource-Action Model)
	switch resourceType {
	// Global/public resources - no specific scope
	case "system", "auth", "user", "pool", "credentials", "app", "resources", "router":
		return "*"

	// Self-scoped resources - the resource ID IS the scope
	case "bucket":
		return extractScopedResourceID("bucket", parts, []string{"bucket"})
	case "config":
		return extractScopedResourceID("config", parts, []string{"configs"})

	// User-scoped resources - profile is scoped to user
	case "profile":
		return extractScopedResourceID("user", parts, []string{"profile"})

	// Pool-scoped resources - workflow/task are scoped to pool
	// Pool cannot be determined from path alone
	case "workflow":
		return "pool/*"

	// Internal resources - scoped to backend/workflow
	case "internal":
		if len(parts) >= 3 {
			return "backend/" + parts[2]
		}
		return "backend/*"

	default:
		return "*"
	}
}

// extractScopedResourceID extracts the resource ID from path parts and formats as "{scope}/{id}"
func extractScopedResourceID(scope string, parts []string, pathSegments []string) string {
	for i, part := range parts {
		for _, segment := range pathSegments {
			if part == segment {
				if i+1 < len(parts) && parts[i+1] != "" {
					return scope + "/" + parts[i+1]
				}
				return scope + "/*"
			}
		}
	}
	return scope + "/*"
}

// GetAllActions returns all registered action names
func GetAllActions() []string {
	actions := make([]string, 0, len(ActionRegistry))
	for action := range ActionRegistry {
		actions = append(actions, action)
	}
	return actions
}

// IsValidAction checks if an action is registered in the registry
func IsValidAction(action string) bool {
	// Check for wildcard patterns
	if action == "*:*" || action == "*" {
		return true
	}

	// Check exact match
	if _, exists := ActionRegistry[action]; exists {
		return true
	}

	// Check resource wildcard (e.g., "workflow:*")
	if strings.HasSuffix(action, ":*") {
		prefix := strings.TrimSuffix(action, ":*")
		for registeredAction := range ActionRegistry {
			if strings.HasPrefix(registeredAction, prefix+":") {
				return true
			}
		}
	}

	// Check action wildcard (e.g., "*:Read")
	if strings.HasPrefix(action, "*:") {
		suffix := strings.TrimPrefix(action, "*:")
		for registeredAction := range ActionRegistry {
			if strings.HasSuffix(registeredAction, ":"+suffix) {
				return true
			}
		}
	}

	return false
}
