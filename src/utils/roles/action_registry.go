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
	"context"
	"sort"
	"strings"
	"sync"

	"go.corp.nvidia.com/osmo/utils/postgres"
)

// ResourceType represents the type of resource in the authorization model
type ResourceType string

// Resource type string values (untyped for use in const concatenation)
const (
	resourceTypeSystem      = "system"
	resourceTypeAuth        = "auth"
	resourceTypeUser        = "user"
	resourceTypePool        = "pool"
	resourceTypeCredentials = "credentials"
	resourceTypeApp         = "app"
	resourceTypeResources   = "resources"
	resourceTypeRouter      = "router"
	resourceTypeDataset     = "dataset"
	resourceTypeConfig      = "config"
	resourceTypeProfile     = "profile"
	resourceTypeWorkflow    = "workflow"
	resourceTypeInternal    = "internal"
)

// Resource type constants for compile-time safety
const (
	ResourceTypeSystem      ResourceType = resourceTypeSystem
	ResourceTypeAuth        ResourceType = resourceTypeAuth
	ResourceTypeUser        ResourceType = resourceTypeUser
	ResourceTypePool        ResourceType = resourceTypePool
	ResourceTypeCredentials ResourceType = resourceTypeCredentials
	ResourceTypeApp         ResourceType = resourceTypeApp
	ResourceTypeResources   ResourceType = resourceTypeResources
	ResourceTypeRouter      ResourceType = resourceTypeRouter
	ResourceTypeDataset     ResourceType = resourceTypeDataset
	ResourceTypeConfig      ResourceType = resourceTypeConfig
	ResourceTypeProfile     ResourceType = resourceTypeProfile
	ResourceTypeWorkflow    ResourceType = resourceTypeWorkflow
	ResourceTypeInternal    ResourceType = resourceTypeInternal
)

// Action constants for compile-time safety
const (
	// Workflow actions
	ActionWorkflowCreate      = resourceTypeWorkflow + ":Create"
	ActionWorkflowList        = resourceTypeWorkflow + ":List"
	ActionWorkflowRead        = resourceTypeWorkflow + ":Read"
	ActionWorkflowUpdate      = resourceTypeWorkflow + ":Update"
	ActionWorkflowDelete      = resourceTypeWorkflow + ":Delete"
	ActionWorkflowCancel      = resourceTypeWorkflow + ":Cancel"
	ActionWorkflowExec        = resourceTypeWorkflow + ":Exec"
	ActionWorkflowPortForward = resourceTypeWorkflow + ":PortForward"
	ActionWorkflowRsync       = resourceTypeWorkflow + ":Rsync"

	// Dataset actions
	ActionDatasetList   = resourceTypeDataset + ":List"
	ActionDatasetRead   = resourceTypeDataset + ":Read"
	ActionDatasetWrite  = resourceTypeDataset + ":Write"
	ActionDatasetDelete = resourceTypeDataset + ":Delete"

	// Credentials actions
	ActionCredentialsCreate = resourceTypeCredentials + ":Create"
	ActionCredentialsRead   = resourceTypeCredentials + ":Read"
	ActionCredentialsUpdate = resourceTypeCredentials + ":Update"
	ActionCredentialsDelete = resourceTypeCredentials + ":Delete"

	// Pool actions
	ActionPoolList = resourceTypePool + ":List"

	// Profile actions
	ActionProfileRead   = resourceTypeProfile + ":Read"
	ActionProfileUpdate = resourceTypeProfile + ":Update"

	// User actions
	ActionUserList = resourceTypeUser + ":List"

	// App actions
	ActionAppCreate = resourceTypeApp + ":Create"
	ActionAppRead   = resourceTypeApp + ":Read"
	ActionAppUpdate = resourceTypeApp + ":Update"
	ActionAppDelete = resourceTypeApp + ":Delete"

	// Resources actions
	ActionResourcesRead = resourceTypeResources + ":Read"

	// Config actions
	ActionConfigRead   = resourceTypeConfig + ":Read"
	ActionConfigUpdate = resourceTypeConfig + ":Update"

	// Auth actions
	ActionAuthLogin   = resourceTypeAuth + ":Login"
	ActionAuthRefresh = resourceTypeAuth + ":Refresh"
	ActionAuthToken   = resourceTypeAuth + ":Token"

	// System actions (public)
	ActionSystemHealth  = resourceTypeSystem + ":Health"
	ActionSystemVersion = resourceTypeSystem + ":Version"

	// Internal actions (restricted)
	ActionInternalOperator = resourceTypeInternal + ":Operator"
	ActionInternalLogger   = resourceTypeInternal + ":Logger"
	ActionInternalRouter   = resourceTypeInternal + ":Router"
)

// EndpointPattern defines an API endpoint pattern
type EndpointPattern struct {
	Path    string
	Methods []string
}

// compiledPattern is a pre-processed pattern for fast matching
type compiledPattern struct {
	action       string   // The action this pattern maps to
	rawPath      string   // Original path pattern
	parts        []string // Pre-split path parts
	methods      []string // Allowed methods
	isExact      bool     // True if no wildcards
	hasTrailWild bool     // True if ends with /*
	wildcardPos  int      // Position of first wildcard (-1 if none)
	specificity  int      // Higher = more specific (for sorting)
}

// patternIndex provides O(1) lookup by method and fast prefix matching
type patternIndex struct {
	// Patterns grouped by HTTP method (includes "*" for wildcard methods)
	byMethod map[string][]*compiledPattern

	// Exact path matches for O(1) lookup: path -> method -> pattern
	exactMatches map[string]map[string]*compiledPattern

	// Patterns by first path segment for prefix filtering
	byPrefix map[string][]*compiledPattern

	// All patterns (sorted by specificity, most specific first)
	allPatterns []*compiledPattern
}

var (
	// Global pattern index, initialized once
	patternIdx  *patternIndex
	patternOnce sync.Once
)

// ActionRegistry maps resource:action pairs to API endpoint patterns
// This is the authoritative mapping of actions to API paths
var ActionRegistry = map[string][]EndpointPattern{
	// ==================== WORKFLOW ====================
	ActionWorkflowCreate: {
		{Path: "/api/pool/*/workflow", Methods: []string{"POST"}},
	},
	ActionWorkflowList: {
		{Path: "/api/workflow", Methods: []string{"GET"}},
		{Path: "/api/task", Methods: []string{"GET"}},
		{Path: "/api/tag", Methods: []string{"GET"}},
	},
	ActionWorkflowRead: {
		{Path: "/api/workflow/*", Methods: []string{"GET"}},
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
		{Path: "/api/router/exec/*/client/*", Methods: []string{"*"}},
	},
	ActionWorkflowPortForward: {
		{Path: "/api/workflow/*/portforward/*", Methods: []string{"*"}},
		{Path: "/api/workflow/*/webserver/*", Methods: []string{"*"}},
		{Path: "/api/router/portforward/*/client/*", Methods: []string{"*"}},
		{Path: "/api/router/webserver/*", Methods: []string{"GET"}},
	},
	ActionWorkflowRsync: {
		{Path: "/api/workflow/*/rsync", Methods: []string{"POST"}},
		{Path: "/api/router/rsync/*/client/*", Methods: []string{"*"}},
	},

	// ==================== POOL ====================
	ActionPoolList: {
		{Path: "/api/pool", Methods: []string{"GET"}},
		{Path: "/api/pool_quota", Methods: []string{"GET"}},
	},
	// ==================== DATASET ====================
	ActionDatasetList: {
		{Path: "/api/bucket", Methods: []string{"GET"}},
	},
	ActionDatasetRead: {
		{Path: "/api/bucket/*", Methods: []string{"GET"}},
	},
	ActionDatasetWrite: {
		{Path: "/api/bucket/*", Methods: []string{"POST", "PUT"}},
	},
	ActionDatasetDelete: {
		{Path: "/api/bucket/*", Methods: []string{"DELETE"}},
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
		{Path: "/api/profile/settings", Methods: []string{"GET"}},
	},
	ActionProfileUpdate: {
		{Path: "/api/profile/settings", Methods: []string{"POST"}},
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
		{Path: "/api/auth/jwt/refresh_token", Methods: []string{"*"}},
		{Path: "/api/auth/jwt/access_token", Methods: []string{"*"}},
	},
	ActionAuthToken: {
		{Path: "/api/auth/access_token", Methods: []string{"*"}},
		{Path: "/api/auth/access_token/*", Methods: []string{"*"}},
		{Path: "/api/auth/user/*/access_token", Methods: []string{"*"}},
		{Path: "/api/auth/user/*/access_token/*", Methods: []string{"*"}},
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
		{Path: "/api/logger/workflow/*/osmo_ctrl/*", Methods: []string{"*"}},
	},
	ActionInternalRouter: {
		{Path: "/api/router/*/*/backend/*", Methods: []string{"*"}},
	},
}

// initPatternIndex builds the optimized pattern index from ActionRegistry
func initPatternIndex() *patternIndex {
	idx := &patternIndex{
		byMethod:     make(map[string][]*compiledPattern),
		exactMatches: make(map[string]map[string]*compiledPattern),
		byPrefix:     make(map[string][]*compiledPattern),
		allPatterns:  make([]*compiledPattern, 0),
	}

	// Compile all patterns
	for action, patterns := range ActionRegistry {
		for _, ep := range patterns {
			cp := compilePattern(action, ep)
			idx.allPatterns = append(idx.allPatterns, cp)

			// Index by method
			for _, m := range cp.methods {
				method := strings.ToUpper(m)
				idx.byMethod[method] = append(idx.byMethod[method], cp)
			}

			// Index exact matches for O(1) lookup
			if cp.isExact {
				if idx.exactMatches[cp.rawPath] == nil {
					idx.exactMatches[cp.rawPath] = make(map[string]*compiledPattern)
				}
				for _, m := range cp.methods {
					method := strings.ToUpper(m)
					idx.exactMatches[cp.rawPath][method] = cp
				}
			}

			// Index by first path segment
			prefix := getPathPrefix(cp.parts)
			idx.byPrefix[prefix] = append(idx.byPrefix[prefix], cp)
		}
	}

	// Sort all pattern lists by specificity (most specific first)
	sortBySpecificity(idx.allPatterns)
	for method := range idx.byMethod {
		sortBySpecificity(idx.byMethod[method])
	}
	for prefix := range idx.byPrefix {
		sortBySpecificity(idx.byPrefix[prefix])
	}

	return idx
}

// compilePattern pre-processes a pattern for fast matching
func compilePattern(action string, ep EndpointPattern) *compiledPattern {
	parts := strings.Split(ep.Path, "/")

	// Calculate specificity and find first wildcard
	specificity := 0
	wildcardPos := -1
	for i, part := range parts {
		if part == "*" {
			if wildcardPos == -1 {
				wildcardPos = i
			}
		} else if part != "" {
			specificity += 10 - i // Earlier non-wildcard parts are more specific
		}
	}

	// Exact match bonus
	isExact := wildcardPos == -1
	if isExact {
		specificity += 100
	}

	// Trailing wildcard check
	hasTrailWild := strings.HasSuffix(ep.Path, "/*")

	return &compiledPattern{
		action:       action,
		rawPath:      ep.Path,
		parts:        parts,
		methods:      ep.Methods,
		isExact:      isExact,
		hasTrailWild: hasTrailWild,
		wildcardPos:  wildcardPos,
		specificity:  specificity,
	}
}

// getPathPrefix returns the first non-empty path segment
func getPathPrefix(parts []string) string {
	for _, part := range parts {
		if part != "" && part != "*" {
			return part
		}
	}
	return ""
}

// sortBySpecificity sorts patterns with most specific first
func sortBySpecificity(patterns []*compiledPattern) {
	sort.Slice(patterns, func(i, j int) bool {
		// Higher specificity first
		if patterns[i].specificity != patterns[j].specificity {
			return patterns[i].specificity > patterns[j].specificity
		}
		// Tie-breaker: fewer wildcards first
		return patterns[i].wildcardPos > patterns[j].wildcardPos
	})
}

// getPatternIndex returns the singleton pattern index
func getPatternIndex() *patternIndex {
	patternOnce.Do(func() {
		patternIdx = initPatternIndex()
	})
	return patternIdx
}

// ResolvePathToAction converts an API path and method to a semantic action
// Returns the action and resource, or empty strings if no match found
// Optimized with pre-compiled patterns and indexed lookups
// ctx and pgClient are optional - if pgClient is nil, pool-scoped resources return "pool/*"
func ResolvePathToAction(
	ctx context.Context, path, method string, pgClient *postgres.PostgresClient,
) (action string, resource string) {
	// Normalize path - remove trailing slash and query string
	normalizedPath := strings.TrimSuffix(path, "/")
	if idx := strings.Index(normalizedPath, "?"); idx != -1 {
		normalizedPath = normalizedPath[:idx]
	}

	method = strings.ToUpper(method)
	pidx := getPatternIndex()

	// Step 1: Try exact match first (O(1) lookup)
	if methodMap, exists := pidx.exactMatches[normalizedPath]; exists {
		if cp, found := methodMap[method]; found {
			return cp.action, extractResourceFromPath(ctx, normalizedPath, cp.action, pgClient)
		}
		// Try wildcard method
		if cp, found := methodMap["*"]; found {
			return cp.action, extractResourceFromPath(ctx, normalizedPath, cp.action, pgClient)
		}
	}

	// Step 2: Get candidate patterns by method
	candidates := pidx.byMethod[method]
	wildcardCandidates := pidx.byMethod["*"]

	// Step 3: Also filter by path prefix for faster matching
	pathParts := strings.Split(normalizedPath, "/")
	prefix := getPathPrefix(pathParts)

	// Combine method-specific and wildcard-method patterns
	var patternsToCheck []*compiledPattern
	if prefix != "" {
		// Use prefix-filtered patterns
		prefixPatterns := pidx.byPrefix[prefix]
		for _, cp := range prefixPatterns {
			if methodMatchesPattern(method, cp.methods) {
				patternsToCheck = append(patternsToCheck, cp)
			}
		}
	}

	// If no prefix match, fall back to method-indexed patterns
	if len(patternsToCheck) == 0 {
		patternsToCheck = append(patternsToCheck, candidates...)
		patternsToCheck = append(patternsToCheck, wildcardCandidates...)
	}

	// Step 4: Check patterns (already sorted by specificity)
	for _, cp := range patternsToCheck {
		if matchPathCompiled(pathParts, cp) {
			return cp.action, extractResourceFromPath(ctx, normalizedPath, cp.action, pgClient)
		}
	}

	// Fallback: no action found
	return "", ""
}

// matchPathCompiled checks if path parts match a compiled pattern
// Uses pre-split parts for efficiency
func matchPathCompiled(requestParts []string, cp *compiledPattern) bool {
	patternParts := cp.parts

	// Handle trailing wildcard patterns (e.g., /api/workflow/*)
	if cp.hasTrailWild {
		// Pattern: /api/workflow/* should match /api/workflow/abc and /api/workflow/abc/def
		// but NOT /api/workflow (the wildcard must match at least one segment)
		prefixLen := len(patternParts) - 1 // Exclude the trailing *
		if len(requestParts) <= prefixLen {
			return false
		}

		for i := 0; i < prefixLen; i++ {
			if patternParts[i] != "*" && patternParts[i] != requestParts[i] {
				return false
			}
		}
		return true
	}

	// For non-trailing-wildcard patterns, lengths must match
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

// methodMatchesPattern checks if a method matches the pattern's allowed methods
func methodMatchesPattern(method string, allowedMethods []string) bool {
	for _, m := range allowedMethods {
		if m == "*" || strings.EqualFold(m, method) {
			return true
		}
	}
	return false
}

// MatchPath checks if a request path matches a pattern (legacy function for compatibility)
func MatchPath(requestPath, pattern string) bool {
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
	// but NOT paths that end at the prefix (wildcard must match at least one segment)
	if strings.HasSuffix(pattern, "/*") {
		prefixPattern := strings.TrimSuffix(pattern, "/*")
		prefixParts := strings.Split(prefixPattern, "/")

		if len(requestParts) <= len(prefixParts) {
			return false
		}

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

// MatchMethod checks if a request method matches allowed methods (legacy function)
func MatchMethod(requestMethod string, allowedMethods []string) bool {
	for _, m := range allowedMethods {
		if m == "*" || strings.EqualFold(m, requestMethod) {
			return true
		}
	}
	return false
}

// extractResourceFromPath extracts the scoped resource identifier from the path
// based on the Resource-Action Model's scope definitions:
//   - Global/public resources return "" (empty) - no resource check needed
//   - Self-scoped resources (bucket, config) return "{scope}/{id}"
//   - User-scoped resources (profile, auth token) return "user/{id}"
//   - Pool-scoped resources (workflow, task) return "pool/{pool_name}" via DB lookup
//   - Internal resources return "backend/{id}"
//
// Returns empty string when no resource scope check is required.
// ctx and pgClient are used for pool-scoped resources to look up the pool from workflow_id
func extractResourceFromPath(
	ctx context.Context, path, action string, pgClient *postgres.PostgresClient,
) string {
	parts := strings.Split(strings.TrimPrefix(path, "/"), "/")

	// Extract resource type from action (e.g., "workflow:Create" -> "workflow")
	actionParts := strings.Split(action, ":")
	if len(actionParts) < 2 {
		return ""
	}
	resourceType := ResourceType(actionParts[0])
	actionName := actionParts[1]

	// Determine resource identifier based on resource type
	// Global/public resources don't require resource checks - access is action-based only
	switch resourceType {
	case ResourceTypeDataset:
		// Dataset-scoped resources - the resource ID IS the scope (scope prefix stays "bucket")
		if actionName == "List" {
			return ""
		}
		return "bucket/" + extractScopedResourceID(parts, "bucket")

	case ResourceTypeConfig:
		// Config-scoped resources - the resource ID IS the scope
		// Path uses "configs" (plural) in the URL
		return "config/" + extractScopedResourceID(parts, "configs")

	case ResourceTypeWorkflow:
		// List action doesn't need resource scope check
		if actionName == "List" {
			return ""
		}
		// Pool-scoped resources - workflow/task are scoped to pool
		return extractWorkflowPoolResource(ctx, parts, actionName, pgClient)

	case ResourceTypeInternal:
		// Backend-scoped resources - internal actions
		if actionName == "Operator" {
			return "backend/" + extractScopedResourceID(parts, "agent")
		} else if actionName == "Logger" {
			return "backend/" + extractScopedResourceID(parts, "logger")
		} else if actionName == "Router" {
			return "backend/" + extractScopedResourceID(parts, "router")
		}
		return ""

	case ResourceTypeAuth:
		// User-scoped token paths: /api/auth/user/{user}/access_token[/*]
		if actionName == "Token" {
			for i, part := range parts {
				if part == "auth" && i+1 < len(parts) && parts[i+1] == "user" {
					return "user/" + extractScopedResourceID(parts, "user")
				}
			}
		}
		return ""

	default:
		// Global/public resources - no resource check needed
		return ""
	}
}

// extractWorkflowPoolResource extracts the pool resource for workflow operations
// For Create: pool is in the path as /api/pool/{pool}/workflow
// For other operations: workflow_id is in the path, look up pool from DB
func extractWorkflowPoolResource(
	ctx context.Context, parts []string, actionName string, pgClient *postgres.PostgresClient,
) string {
	// For Create action, pool is in the path: /api/pool/{pool}/workflow
	// Path parts: ["api", "pool", "{pool}", "workflow"]
	if actionName == "Create" {
		for i, part := range parts {
			if part == "pool" && i+1 < len(parts) {
				poolName := parts[i+1]
				if poolName != "" && poolName != "workflow" {
					return string(ResourceTypePool) + "/" + poolName
				}
			}
		}
		// Fallback if pool not found in path
		return string(ResourceTypePool) + "/*"
	}

	// For other operations, workflow_id location depends on path pattern:
	// - /api/workflow/{workflow_id}/* -> after "workflow"
	// - /api/router/exec/{workflow_id}/client/* -> after "exec"
	// - /api/router/portforward/{workflow_id}/client/* -> after "portforward"
	// - /api/router/rsync/{workflow_id}/client/* -> after "rsync"
	// - /api/router/webserver/* -> no pool check needed
	workflowID := ""

	// Check for router paths first
	for i, part := range parts {
		if part == "router" && i+1 < len(parts) {
			nextPart := parts[i+1]
			// /api/router/webserver/* - no pool check needed
			if nextPart == "webserver" {
				return ""
			}
			// /api/router/{exec|portforward|rsync}/{workflow_id}/client/*
			if (nextPart == "exec" || nextPart == "portforward" || nextPart == "rsync") && i+2 < len(parts) {
				workflowID = parts[i+2]
				break
			}
		}
	}

	// If not a router path, check for workflow path: /api/workflow/{workflow_id}/*
	if workflowID == "" {
		for i, part := range parts {
			if part == "workflow" && i+1 < len(parts) {
				workflowID = parts[i+1]
				break
			}
		}
	}

	// If no workflow_id found or no postgres client, return wildcard
	if workflowID == "" || pgClient == nil {
		return string(ResourceTypePool) + "/*"
	}

	// Look up pool from workflow_id
	poolName, err := GetPoolForWorkflow(ctx, pgClient, workflowID)
	if err != nil || poolName == "" {
		return string(ResourceTypePool) + "/*"
	}

	return string(ResourceTypePool) + "/" + poolName
}

// extractScopedResourceID extracts the resource ID from path parts and formats as "{scope}/{id}"
// Returns the next part after a matching segment, or "*" if nothing is found
func extractScopedResourceID(parts []string, previousPart string) string {
	for i, part := range parts {
		if part == previousPart && i+1 < len(parts) && parts[i+1] != "" {
			return parts[i+1]
		}
	}
	return "*"
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

// ============================================================================
// LEGACY TO SEMANTIC CONVERSION HELPERS
// ============================================================================
//
// The following functions support converting legacy path-based actions to
// semantic actions. They are used by ConvertLegacyActionToSemantic and
// ConvertRoleToSemantic to transform legacy role definitions.
//
// NOTE: These functions are NOT used for policy evaluation. Policy evaluation
// only uses semantic actions via CheckPolicyAccess and CheckRolesAccess.
//
// Legacy format example:
//   {"base": "http", "path": "/api/workflow/*", "method": "GET"}
//   {"base": "http", "path": "!/api/admin/*", "method": "*"}  // Deny pattern (ignored)
//
// Deny patterns (paths starting with "!") are IGNORED during conversion.
// New roles should use the semantic action model:
//   {"action": "workflow:Create"}
//
// ============================================================================

// LegacyMatchMethod checks if the method pattern matches the request method.
// Supports wildcard "*" and case-insensitive matching.
// This is used for legacy path-based authorization.
func LegacyMatchMethod(pattern, method string) bool {
	if pattern == "*" {
		return true
	}
	return strings.EqualFold(pattern, method)
}

// substituteWildcardsInPath replaces wildcards in a pattern with corresponding
// parts from the request path. This allows us to resolve legacy patterns to
// semantic actions.
//
// Examples:
//   - pattern="/api/workflow/*", path="/api/workflow/123" -> "/api/workflow/123"
//   - pattern="/api/*/task", path="/api/pool/task" -> "/api/pool/task"
//   - pattern="/api/*", path="/api/anything" -> "/api/anything"
func substituteWildcardsInPath(pattern, path string) string {
	patternParts := strings.Split(pattern, "/")
	pathParts := strings.Split(path, "/")

	result := make([]string, len(patternParts))
	for i, part := range patternParts {
		if part == "*" && i < len(pathParts) {
			result[i] = pathParts[i]
		} else {
			result[i] = part
		}
	}

	// Handle trailing wildcard - if pattern has fewer parts but ends with *
	// and path has more parts, we need to match the trailing segment
	if len(patternParts) > 0 && patternParts[len(patternParts)-1] == "*" {
		if len(pathParts) > len(patternParts)-1 {
			// Use the path part at the same position as the wildcard
			result[len(patternParts)-1] = pathParts[len(patternParts)-1]
		}
	}

	return strings.Join(result, "/")
}

// ============================================================================
// LEGACY TO SEMANTIC CONVERSION
// ============================================================================
//
// The following functions convert legacy path-based actions to semantic actions.
// This allows the authorization system to work entirely with semantic actions
// while maintaining backwards compatibility with existing role definitions.
//
// ============================================================================

// ConvertLegacyActionToSemantic converts a legacy path-based action to semantic actions.
// It analyzes the legacy path pattern and returns all semantic actions that the pattern
// could potentially allow.
//
// Deny patterns (paths starting with "!") are ignored and return nil.
// Wildcard patterns like "*" that match multiple actions return all matching actions.
//
// Returns a slice of semantic action strings that the legacy pattern maps to.
func ConvertLegacyActionToSemantic(action *RoleAction) []string {
	if action.IsSemanticAction() {
		return []string{action.Action}
	}

	// Get the legacy path pattern
	legacyPath := action.Path
	if legacyPath == "" {
		legacyPath = action.Base
	}
	if legacyPath == "" {
		return nil
	}

	// Ignore deny patterns - they are not converted
	if strings.HasPrefix(legacyPath, "!") {
		return nil
	}

	// Get the legacy method
	legacyMethod := action.Method
	if legacyMethod == "" {
		legacyMethod = "*"
	}

	// Handle universal wildcard - maps to all actions
	if legacyPath == "*" && legacyMethod == "*" {
		return []string{"*:*"}
	}

	// Collect all semantic actions that this pattern could match
	var semanticActions []string
	seenActions := make(map[string]struct{})

	// For each action in the registry, check if the legacy pattern could match it
	for semanticAction, endpoints := range ActionRegistry {
		for _, ep := range endpoints {
			// Check if the method matches
			methodMatches := legacyMethod == "*" ||
				containsMethod(ep.Methods, legacyMethod) ||
				containsMethod(ep.Methods, "*")
			if !methodMatches {
				continue
			}

			// Check if the path pattern could match the endpoint
			if pathPatternCouldMatch(legacyPath, ep.Path) {
				if _, seen := seenActions[semanticAction]; !seen {
					seenActions[semanticAction] = struct{}{}
					semanticActions = append(semanticActions, semanticAction)
				}
			}
		}
	}

	return semanticActions
}

// containsMethod checks if a method is in the allowed methods list
func containsMethod(methods []string, method string) bool {
	for _, m := range methods {
		if strings.EqualFold(m, method) {
			return true
		}
	}
	return false
}

// pathPatternCouldMatch checks if a legacy path pattern could match an endpoint pattern.
// This is a loose match - if the legacy pattern is more general than the endpoint,
// it should match.
func pathPatternCouldMatch(legacyPattern, endpointPattern string) bool {
	// Universal wildcard matches everything
	if legacyPattern == "*" {
		return true
	}

	// Exact match
	if legacyPattern == endpointPattern {
		return true
	}

	// Check if legacy pattern with trailing wildcard covers the endpoint
	if strings.HasSuffix(legacyPattern, "/*") {
		prefix := strings.TrimSuffix(legacyPattern, "/*")
		// /api/workflow/* should match /api/workflow, /api/workflow/*, /api/workflow/*/cancel, etc.
		if strings.HasPrefix(endpointPattern, prefix+"/") || endpointPattern == prefix {
			return true
		}
	}

	// Check if endpoint pattern with trailing wildcard is covered by legacy pattern
	if strings.HasSuffix(endpointPattern, "/*") {
		endpointPrefix := strings.TrimSuffix(endpointPattern, "/*")
		// If legacy is /api/workflow/123, it should match endpoint /api/workflow/*
		if strings.HasPrefix(legacyPattern, endpointPrefix+"/") {
			return true
		}
	}

	// Check segment-by-segment matching with wildcards
	legacyParts := strings.Split(legacyPattern, "/")
	endpointParts := strings.Split(endpointPattern, "/")

	// For non-trailing wildcards, parts count should match
	if len(legacyParts) == len(endpointParts) {
		match := true
		for i := range legacyParts {
			if legacyParts[i] != "*" && endpointParts[i] != "*" && legacyParts[i] != endpointParts[i] {
				match = false
				break
			}
		}
		if match {
			return true
		}
	}

	return false
}

// ConvertRoleToSemantic converts all legacy actions in a role to semantic actions.
// This creates a new Role with only semantic actions.
// Deny patterns are ignored during conversion.
func ConvertRoleToSemantic(role *Role) *Role {
	if role == nil {
		return nil
	}

	newRole := &Role{
		Name:        role.Name,
		Description: role.Description,
		Policies:    make([]RolePolicy, 0),
	}

	for _, policy := range role.Policies {
		var semanticActions []RoleAction
		seenActions := make(map[string]struct{})
		var resources []string

		// Copy existing resources
		if len(policy.Resources) > 0 {
			resources = make([]string, len(policy.Resources))
			copy(resources, policy.Resources)
		} else {
			// Default to wildcard if not specified
			resources = []string{"*"}
		}

		for _, action := range policy.Actions {
			if action.IsSemanticAction() {
				if _, seen := seenActions[action.Action]; !seen {
					seenActions[action.Action] = struct{}{}
					semanticActions = append(semanticActions, action)
				}
			} else {
				// Convert legacy action to semantic
				convertedActions := ConvertLegacyActionToSemantic(&action)
				for _, sa := range convertedActions {
					if _, seen := seenActions[sa]; !seen {
						seenActions[sa] = struct{}{}
						semanticActions = append(semanticActions, RoleAction{Action: sa})
					}
				}
			}
		}

		if len(semanticActions) > 0 {
			effect := policy.Effect
			if effect == "" {
				effect = EffectAllow
			}
			newRole.Policies = append(newRole.Policies, RolePolicy{
				Effect:    effect,
				Actions:   RoleActions(semanticActions),
				Resources: resources,
			})
		}
	}

	return newRole
}

// ConvertRolesToSemantic converts a slice of roles to semantic-only roles.
func ConvertRolesToSemantic(roles []*Role) []*Role {
	result := make([]*Role, len(roles))
	for i, role := range roles {
		result[i] = ConvertRoleToSemantic(role)
	}
	return result
}

// ============================================================================
// UNIFIED POLICY ACCESS CHECK
// ============================================================================
//
// The following types and functions provide a unified interface for checking
// policy access using semantic actions only.
//
// ============================================================================

// ActionType indicates the type of action that was matched
type ActionType string

const (
	// ActionTypeSemantic indicates a semantic action (the standard type after conversion)
	ActionTypeSemantic ActionType = "semantic"
	// ActionTypeNone indicates no action matched
	ActionTypeNone ActionType = "none"
)

// AccessResult represents the result of a policy access check
type AccessResult struct {
	// Allowed indicates whether access is granted
	Allowed bool
	// Denied indicates an explicit Deny policy matched (takes precedence over Allow)
	Denied bool
	// Matched indicates whether any action pattern matched
	Matched bool
	// MatchedAction is the semantic action string that matched
	MatchedAction string
	// MatchedResource is the resource that was matched
	MatchedResource string
	// ActionType indicates the type of match (semantic or none)
	ActionType ActionType
	// RoleName is the name of the role that matched
	RoleName string
}

// CheckSemanticAction checks if a semantic action grants access for the given path and method.
// It resolves the path to a semantic action and checks if the policy action matches.
//
// Supports wildcards in action patterns:
//   - "*" or "*:*" matches all actions
//   - "workflow:*" matches all workflow actions
//   - "*:Read" matches all Read actions across resources
//
// ctx and pgClient are optional - used for pool-scoped resource lookups
func CheckSemanticAction(
	ctx context.Context,
	policyAction *RoleAction,
	policyResources []string,
	path, method string,
	pgClient *postgres.PostgresClient,
) AccessResult {
	resolvedAction, resolvedResource := ResolvePathToAction(ctx, path, method, pgClient)
	matched, result := checkResolvedAction(policyAction.Action, policyResources, resolvedAction, resolvedResource)
	if !matched {
		return AccessResult{Allowed: false, Matched: false, ActionType: ActionTypeNone}
	}
	return result
}

// checkResolvedAction checks if a policy action string matches a pre-resolved
// action and resource pair. Returns (true, result) on match, (false, _) otherwise.
func checkResolvedAction(
	policyActionStr string,
	policyResources []string,
	resolvedAction, resolvedResource string,
) (bool, AccessResult) {
	// Universal wildcard — admin roles that should have access to all endpoints,
	// even ones not registered in the action registry.
	if policyActionStr == "*:*" || policyActionStr == "*" {
		resourceAllowed := len(policyResources) == 0
		for _, pr := range policyResources {
			if pr == "*" {
				resourceAllowed = true
				break
			}
		}
		if resourceAllowed {
			matchedAction := resolvedAction
			if matchedAction == "" {
				matchedAction = policyActionStr
			}
			return true, AccessResult{
				Allowed:         true,
				Matched:         true,
				MatchedAction:   matchedAction,
				MatchedResource: resolvedResource,
				ActionType:      ActionTypeSemantic,
			}
		}
	}

	if resolvedAction == "" {
		return false, AccessResult{}
	}

	if !matchSemanticAction(policyActionStr, resolvedAction) {
		return false, AccessResult{}
	}

	// Check if the resource matches (if resources are specified)
	if len(policyResources) > 0 {
		resourceMatched := false
		for _, policyResource := range policyResources {
			if matchResource(policyResource, resolvedResource) {
				resourceMatched = true
				break
			}
		}
		if !resourceMatched {
			return false, AccessResult{}
		}
	}

	return true, AccessResult{
		Allowed:         true,
		Matched:         true,
		MatchedAction:   resolvedAction,
		MatchedResource: resolvedResource,
		ActionType:      ActionTypeSemantic,
	}
}

// matchSemanticAction checks if a policy action pattern matches a resolved action.
// Supports wildcards:
//   - "*" or "*:*" matches everything
//   - "workflow:*" matches all workflow actions
//   - "*:Read" matches all Read actions
func matchSemanticAction(pattern, action string) bool {
	// Exact match
	if pattern == action {
		return true
	}

	// Universal wildcards
	if pattern == "*" || pattern == "*:*" {
		return true
	}

	// Resource wildcard (e.g., "workflow:*")
	if strings.HasSuffix(pattern, ":*") {
		prefix := strings.TrimSuffix(pattern, ":*")
		return strings.HasPrefix(action, prefix+":")
	}

	// Action wildcard (e.g., "*:Read")
	if strings.HasPrefix(pattern, "*:") {
		suffix := strings.TrimPrefix(pattern, "*:")
		return strings.HasSuffix(action, ":"+suffix)
	}

	return false
}

// matchResource checks if a policy resource pattern matches a resolved resource.
// Supports wildcards:
//   - "*" matches everything
//   - "pool/*" matches all resources in pool scope
//   - "bucket/my-bucket" matches exact resource
func matchResource(pattern, resource string) bool {
	// Empty resource means no scope check is needed - always matches
	if resource == "" {
		return true
	}

	// Exact match
	if pattern == resource {
		return true
	}

	// Universal wildcard
	if pattern == "*" {
		return true
	}

	// Prefix wildcard (e.g., "pool/*")
	if strings.HasSuffix(pattern, "/*") {
		prefix := strings.TrimSuffix(pattern, "/*")
		return strings.HasPrefix(resource, prefix+"/") || resource == prefix+"/*"
	}

	// Resource itself is a wildcard pattern (e.g., "pool/*" resource matches "pool/*" pattern)
	if strings.HasSuffix(resource, "/*") {
		resourcePrefix := strings.TrimSuffix(resource, "/*")
		if strings.HasSuffix(pattern, "/*") {
			patternPrefix := strings.TrimSuffix(pattern, "/*")
			return resourcePrefix == patternPrefix
		}
		// pattern "pool/prod" should match resource "pool/*"
		return strings.HasPrefix(pattern, resourcePrefix+"/")
	}

	return false
}

// CheckPolicyAccess checks if a role has access to the given path and method.
// This function only handles semantic actions. Legacy actions should be converted
// to semantic actions using ConvertRoleToSemantic before calling this function.
//
// Deny takes precedence: if any policy with effect Deny matches, access is denied
// even if another policy with effect Allow matches.
//
// ctx and pgClient are optional - used for pool-scoped resource lookups
func CheckPolicyAccess(
	ctx context.Context, role *Role, path, method string, pgClient *postgres.PostgresClient,
) AccessResult {
	resolvedAction, resolvedResource := ResolvePathToAction(ctx, path, method, pgClient)
	return checkPolicyResolved(role, resolvedAction, resolvedResource)
}

// checkPolicyResolved checks if a role's policies match a pre-resolved action
// and resource pair. This avoids redundant ResolvePathToAction calls when
// checking multiple roles against the same request.
//
// Single pass: Deny takes precedence, so return immediately on a Deny match.
// Track the first Allow match and return it at the end if no Deny was found.
func checkPolicyResolved(role *Role, resolvedAction, resolvedResource string) AccessResult {
	var allowResult AccessResult
	hasAllow := false
	for _, policy := range role.Policies {
		isDeny := policy.Effect == EffectDeny
		isAllow := policy.Effect == EffectAllow || policy.Effect == ""
		if !isDeny && !isAllow {
			continue
		}
		if isAllow && hasAllow {
			continue
		}
		for _, action := range policy.Actions {
			if action.Action == "" {
				continue
			}
			matched, result := checkResolvedAction(action.Action, policy.Resources, resolvedAction, resolvedResource)
			if !matched {
				continue
			}
			result.RoleName = role.Name
			if isDeny {
				result.Allowed = false
				result.Denied = true
				return result
			}
			if !hasAllow {
				allowResult = result
				hasAllow = true
			}
			break
		}
	}
	if hasAllow {
		return allowResult
	}

	return AccessResult{
		Allowed:    false,
		Matched:    false,
		ActionType: ActionTypeNone,
		RoleName:   role.Name,
	}
}

// CheckRolesAccess checks if any of the given roles grants access to the path and method.
// Deny takes precedence: if any role has a matching Deny policy, access is denied.
// Otherwise returns the first AccessResult that grants access.
//
// The path and method are resolved to a semantic action once, then checked
// against all roles without redundant resolution.
//
// ctx and pgClient are optional - used for pool-scoped resource lookups
func CheckRolesAccess(
	ctx context.Context, roles []*Role, path, method string, pgClient *postgres.PostgresClient,
) AccessResult {
	resolvedAction, resolvedResource := ResolvePathToAction(ctx, path, method, pgClient)

	var firstAllow *AccessResult
	for _, role := range roles {
		result := checkPolicyResolved(role, resolvedAction, resolvedResource)
		if result.Denied {
			return result
		}
		if result.Allowed && firstAllow == nil {
			firstAllow = &result
		}
	}
	if firstAllow != nil {
		return *firstAllow
	}
	return AccessResult{
		Allowed:    false,
		Matched:    false,
		ActionType: ActionTypeNone,
	}
}

// CheckActionOnResource checks if a role allows a specific action on a specific
// resource. Unlike CheckPolicyAccess which resolves path+method to an action,
// this operates directly on a known action and resource pair.
//
// Within a role, Deny takes precedence over Allow. A policy with empty resources
// does not match non-empty resource targets (unscoped policies don't grant
// scoped resource access).
func CheckActionOnResource(role *Role, action string, resource string) AccessResult {
	// Single pass: Deny takes precedence, so return immediately on a Deny match.
	// Track the first Allow match and return it at the end if no Deny was found.
	var allowed bool
	for _, policy := range role.Policies {
		isDeny := policy.Effect == EffectDeny
		isAllow := policy.Effect == EffectAllow || policy.Effect == ""
		if !isDeny && !isAllow {
			continue
		}
		if !policyMatchesActionOnResource(policy, action, resource) {
			continue
		}
		if isDeny {
			return AccessResult{
				Allowed:         false,
				Denied:          true,
				Matched:         true,
				MatchedAction:   action,
				MatchedResource: resource,
				ActionType:      ActionTypeSemantic,
				RoleName:        role.Name,
			}
		}
		allowed = true
	}
	if allowed {
		return AccessResult{
			Allowed:         true,
			Matched:         true,
			MatchedAction:   action,
			MatchedResource: resource,
			ActionType:      ActionTypeSemantic,
			RoleName:        role.Name,
		}
	}

	return AccessResult{
		Allowed:    false,
		Matched:    false,
		ActionType: ActionTypeNone,
		RoleName:   role.Name,
	}
}

// policyMatchesActionOnResource returns true if any semantic action in the
// policy matches the target action and any resource pattern matches the target
// resource. A policy with no resources does not match non-empty resources.
func policyMatchesActionOnResource(policy RolePolicy, action string, resource string) bool {
	actionMatches := false
	for _, policyAction := range policy.Actions {
		if !policyAction.IsSemanticAction() {
			continue
		}
		if matchSemanticAction(policyAction.Action, action) {
			actionMatches = true
			break
		}
	}
	if !actionMatches {
		return false
	}

	if len(policy.Resources) == 0 {
		return resource == ""
	}
	for _, pattern := range policy.Resources {
		if matchResource(pattern, resource) {
			return true
		}
	}
	return false
}
