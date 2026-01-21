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

package server

import (
	"sort"
	"strings"
	"sync"
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
	resourceTypeBucket      = "bucket"
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
	ResourceTypeBucket      ResourceType = resourceTypeBucket
	ResourceTypeConfig      ResourceType = resourceTypeConfig
	ResourceTypeProfile     ResourceType = resourceTypeProfile
	ResourceTypeWorkflow    ResourceType = resourceTypeWorkflow
	ResourceTypeInternal    ResourceType = resourceTypeInternal
)

// Action constants for compile-time safety
const (
	// Workflow actions
	ActionWorkflowCreate      = resourceTypeWorkflow + ":Create"
	ActionWorkflowRead        = resourceTypeWorkflow + ":Read"
	ActionWorkflowUpdate      = resourceTypeWorkflow + ":Update"
	ActionWorkflowDelete      = resourceTypeWorkflow + ":Delete"
	ActionWorkflowCancel      = resourceTypeWorkflow + ":Cancel"
	ActionWorkflowExec        = resourceTypeWorkflow + ":Exec"
	ActionWorkflowPortForward = resourceTypeWorkflow + ":PortForward"
	ActionWorkflowRsync       = resourceTypeWorkflow + ":Rsync"

	// Bucket actions
	ActionBucketRead   = resourceTypeBucket + ":Read"
	ActionBucketWrite  = resourceTypeBucket + ":Write"
	ActionBucketDelete = resourceTypeBucket + ":Delete"

	// Pool actions
	ActionPoolRead   = resourceTypePool + ":Read"
	ActionPoolDelete = resourceTypePool + ":Delete"

	// Credentials actions
	ActionCredentialsCreate = resourceTypeCredentials + ":Create"
	ActionCredentialsRead   = resourceTypeCredentials + ":Read"
	ActionCredentialsUpdate = resourceTypeCredentials + ":Update"
	ActionCredentialsDelete = resourceTypeCredentials + ":Delete"

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
	ActionAuthLogin        = resourceTypeAuth + ":Login"
	ActionAuthRefresh      = resourceTypeAuth + ":Refresh"
	ActionAuthToken        = resourceTypeAuth + ":Token"
	ActionAuthServiceToken = resourceTypeAuth + ":ServiceToken"

	// Router actions
	ActionRouterClient = resourceTypeRouter + ":Client"

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
func ResolvePathToAction(path, method string) (action string, resource string) {
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
			return cp.action, extractResourceFromPath(normalizedPath, cp.action)
		}
		// Try wildcard method
		if cp, found := methodMap["*"]; found {
			return cp.action, extractResourceFromPath(normalizedPath, cp.action)
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
			return cp.action, extractResourceFromPath(normalizedPath, cp.action)
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
		prefixLen := len(patternParts) - 1 // Exclude the trailing *
		if len(requestParts) < prefixLen {
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

// matchPath checks if a request path matches a pattern (legacy function for compatibility)
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
		prefixPattern := strings.TrimSuffix(pattern, "/*")
		prefixParts := strings.Split(prefixPattern, "/")

		if len(requestParts) < len(prefixParts) {
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

// matchMethod checks if a request method matches allowed methods (legacy function)
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
	switch ResourceType(resourceType) {
	// Global/public resources - no specific scope
	case ResourceTypeSystem, ResourceTypeAuth, ResourceTypeUser, ResourceTypePool,
		ResourceTypeCredentials, ResourceTypeApp, ResourceTypeResources, ResourceTypeRouter:
		return "*"

	// Self-scoped resources - the resource ID IS the scope
	case ResourceTypeBucket:
		return extractScopedResourceID(string(ResourceTypeBucket), parts, []string{"bucket"})
	case ResourceTypeConfig:
		return extractScopedResourceID(string(ResourceTypeConfig), parts, []string{"configs"})

	// User-scoped resources - profile is scoped to user
	case ResourceTypeProfile:
		return extractScopedResourceID(string(ResourceTypeUser), parts, []string{"profile"})

	// Pool-scoped resources - workflow/task are scoped to pool
	// Pool cannot be determined from path alone
	case ResourceTypeWorkflow:
		return "pool/*"

	// Internal resources - scoped to backend/workflow
	case ResourceTypeInternal:
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
