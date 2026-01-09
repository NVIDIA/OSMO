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
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/casbin/casbin/v2"
	"github.com/casbin/casbin/v2/model"
	envoy_api_v3_core "github.com/envoyproxy/go-control-plane/envoy/config/core/v3"
	envoy_service_auth_v3 "github.com/envoyproxy/go-control-plane/envoy/service/auth/v3"
	envoy_type_v3 "github.com/envoyproxy/go-control-plane/envoy/type/v3"
	"github.com/jackc/pgx/v5/pgxpool"
	pgxadapter "github.com/pckhoi/casbin-pgx-adapter/v2"
	"google.golang.org/genproto/googleapis/rpc/status"
	"google.golang.org/grpc/codes"
)

// casbinModelConf defines the RBAC model with deny support
// See PROJ-148-casbin-implementation.md for details
const casbinModelConf = `
[request_definition]
r = sub, act, obj

[policy_definition]
p = sub, act, obj, eft

[role_definition]
g = _, _

[policy_effect]
e = some(where (p.eft == allow)) && !some(where (p.eft == deny))

[matchers]
m = g(r.sub, p.sub) && actionMatch(r.act, p.act) && resourceMatch(r.obj, p.obj)
`

// CasbinAuthzServer implements Envoy External Authorization using Casbin
type CasbinAuthzServer struct {
	envoy_service_auth_v3.UnimplementedAuthorizationServer
	enforcer *casbin.Enforcer
	pool     *pgxpool.Pool
	logger   *slog.Logger
	mu       sync.RWMutex
}

// CasbinConfig holds configuration for the Casbin authz server
type CasbinConfig struct {
	PolicyReloadInterval time.Duration
	// PostgreSQL connection string for Casbin adapter
	// Format: "host=localhost port=5432 user=postgres password=secret dbname=osmo sslmode=disable"
	ConnectionString string
}

// NewCasbinAuthzServer creates a new Casbin-based authorization server
func NewCasbinAuthzServer(ctx context.Context, pool *pgxpool.Pool, config CasbinConfig, logger *slog.Logger) (*CasbinAuthzServer, error) {
	// Create pgx adapter for policy storage using connection string
	// The pckhoi/casbin-pgx-adapter uses pgx/v4 and requires a connection string
	adapter, err := pgxadapter.NewAdapter(config.ConnectionString)
	if err != nil {
		return nil, fmt.Errorf("failed to create casbin adapter: %w", err)
	}

	// Load model from string
	m, err := model.NewModelFromString(casbinModelConf)
	if err != nil {
		return nil, fmt.Errorf("failed to create casbin model: %w", err)
	}

	// Create enforcer
	enforcer, err := casbin.NewEnforcer(m, adapter)
	if err != nil {
		return nil, fmt.Errorf("failed to create casbin enforcer: %w", err)
	}

	// Register custom matcher functions
	enforcer.AddFunction("actionMatch", actionMatchFunc)
	enforcer.AddFunction("resourceMatch", resourceMatchFunc)

	// Load policies from Casbin storage (casbin_rule table)
	if err := enforcer.LoadPolicy(); err != nil {
		return nil, fmt.Errorf("failed to load policies: %w", err)
	}

	// Load policies from postgres roles table if Casbin storage is empty
	if err := loadPoliciesFromPostgres(ctx, pool, enforcer, logger); err != nil {
		return nil, fmt.Errorf("failed to load policies from postgres: %w", err)
	}

	server := &CasbinAuthzServer{
		enforcer: enforcer,
		pool:     pool,
		logger:   logger,
	}

	// Start background policy reload if configured
	if config.PolicyReloadInterval > 0 {
		go server.policyReloadLoop(config.PolicyReloadInterval)
	}

	logger.Info("casbin authz server initialized",
		slog.Duration("reload_interval", config.PolicyReloadInterval),
	)

	return server, nil
}

// Check implements the Envoy External Authorization Check RPC
func (s *CasbinAuthzServer) Check(ctx context.Context, req *envoy_service_auth_v3.CheckRequest) (*envoy_service_auth_v3.CheckResponse, error) {
	// Extract request attributes
	attrs := req.GetAttributes()
	if attrs == nil {
		s.logger.Error("missing attributes in check request")
		return s.denyResponse(codes.InvalidArgument, "missing request attributes"), nil
	}

	httpAttrs := attrs.GetRequest().GetHttp()
	if httpAttrs == nil {
		s.logger.Error("missing HTTP attributes in check request")
		return s.denyResponse(codes.InvalidArgument, "missing HTTP attributes"), nil
	}

	// Extract path, method, and headers
	path := httpAttrs.GetPath()
	method := httpAttrs.GetMethod()
	headers := httpAttrs.GetHeaders()

	s.logger.Debug("casbin authorization check request",
		slog.String("path", path),
		slog.String("method", method),
	)

	// Extract user and roles from headers
	user := headers[headerOsmoUser]
	rolesHeader := headers[headerOsmoRoles]

	// Parse roles (comma-separated)
	var roles []string
	if rolesHeader != "" {
		roles = strings.Split(rolesHeader, ",")
		for i := range roles {
			roles[i] = strings.TrimSpace(roles[i])
		}
	}

	// Add default role
	roles = append(roles, defaultRole)

	s.logger.Debug("extracted authorization info",
		slog.String("user", user),
		slog.Any("roles", roles),
	)

	// Resolve path and method to action using ActionRegistry
	action, resource := ResolvePathToAction(path, method)
	if action == "" {
		// No action found in registry - deny access
		s.logger.Warn("no action found in registry for path",
			slog.String("user", user),
			slog.String("path", path),
			slog.String("method", method),
			slog.Any("roles", roles),
		)
		return s.denyResponse(codes.PermissionDenied, "access denied: unknown endpoint"), nil
	}

	// Check access using Casbin
	allowed, err := s.checkAccess(roles, action, resource)
	if err != nil {
		s.logger.Error("error checking casbin access",
			slog.String("error", err.Error()),
			slog.String("path", path),
			slog.String("method", method),
			slog.Any("roles", roles),
		)
		return s.denyResponse(codes.Internal, "internal error checking access"), nil
	}

	if !allowed {
		s.logger.Debug("casbin access denied",
			slog.String("user", user),
			slog.String("path", path),
			slog.String("method", method),
			slog.String("action", action),
			slog.String("resource", resource),
			slog.Any("roles", roles),
		)
		return s.denyResponse(codes.PermissionDenied, "access denied"), nil
	}

	s.logger.Debug("casbin access allowed",
		slog.String("user", user),
		slog.String("path", path),
		slog.String("method", method),
		slog.String("action", action),
		slog.String("resource", resource),
	)

	return s.allowResponse(), nil
}

// checkAccess verifies if any of the given roles have access
func (s *CasbinAuthzServer) checkAccess(roles []string, action, resource string) (bool, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, role := range roles {
		allowed, err := s.enforcer.Enforce(role, action, resource)
		if err != nil {
			return false, fmt.Errorf("casbin enforce error: %w", err)
		}
		if allowed {
			s.logger.Debug("access granted by role",
				slog.String("role", role),
				slog.String("action", action),
				slog.String("resource", resource),
			)
			return true, nil
		}
	}

	return false, nil
}

// ReloadPolicy reloads policies from the database
func (s *CasbinAuthzServer) ReloadPolicy() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if err := s.enforcer.LoadPolicy(); err != nil {
		return fmt.Errorf("failed to reload policies: %w", err)
	}

	s.logger.Info("casbin policies reloaded")
	return nil
}

// policyReloadLoop periodically reloads policies from the database
func (s *CasbinAuthzServer) policyReloadLoop(interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for range ticker.C {
		if err := s.ReloadPolicy(); err != nil {
			s.logger.Error("failed to reload policies",
				slog.String("error", err.Error()),
			)
		}
	}
}

// actionMatchFunc handles wildcard matching for actions
// Supports: "workflow:*", "*:Read", "*:*", exact matches
func actionMatchFunc(args ...interface{}) (interface{}, error) {
	requestAction, ok := args[0].(string)
	if !ok {
		return false, nil
	}
	policyAction, ok := args[1].(string)
	if !ok {
		return false, nil
	}

	// Exact match or full wildcard
	if policyAction == "*:*" || policyAction == "*" || policyAction == requestAction {
		return true, nil
	}

	// Resource wildcard: "workflow:*" matches "workflow:Create"
	if strings.HasSuffix(policyAction, ":*") {
		prefix := strings.TrimSuffix(policyAction, ":*")
		if strings.HasPrefix(requestAction, prefix+":") {
			return true, nil
		}
	}

	// Action wildcard: "*:Read" matches "workflow:Read"
	if strings.HasPrefix(policyAction, "*:") {
		suffix := strings.TrimPrefix(policyAction, "*:")
		if strings.HasSuffix(requestAction, ":"+suffix) {
			return true, nil
		}
	}

	return false, nil
}

// resourceMatchFunc handles wildcard matching for resources
// Supports: "workflow/*", "pool/default/*", "*", exact matches
func resourceMatchFunc(args ...interface{}) (interface{}, error) {
	requestResource, ok := args[0].(string)
	if !ok {
		return false, nil
	}
	policyResource, ok := args[1].(string)
	if !ok {
		return false, nil
	}

	// Full wildcard or exact match
	if policyResource == "*" || policyResource == requestResource {
		return true, nil
	}

	// Prefix wildcard: "workflow/*" matches "workflow/abc123"
	if strings.HasSuffix(policyResource, "/*") {
		prefix := strings.TrimSuffix(policyResource, "/*")
		if strings.HasPrefix(requestResource, prefix+"/") || requestResource == prefix {
			return true, nil
		}
	}

	return false, nil
}

// RequestContext contains request information for extended condition evaluation
type RequestContext struct {
	Method   string            `json:"method"`
	Path     string            `json:"path"`
	Headers  map[string]string `json:"headers"`
	Params   map[string]string `json:"params"`
	Query    map[string]string `json:"query"`
	Body     map[string]any    `json:"body"`
	UserID   string            `json:"user_id"`
	UserName string            `json:"user_name"`
	Roles    []string          `json:"roles"`
}

// buildRequestContext creates a RequestContext from the check request
func buildRequestContext(req *envoy_service_auth_v3.CheckRequest) RequestContext {
	httpAttrs := req.GetAttributes().GetRequest().GetHttp()
	headers := httpAttrs.GetHeaders()

	ctx := RequestContext{
		Method:   httpAttrs.GetMethod(),
		Path:     httpAttrs.GetPath(),
		Headers:  headers,
		UserID:   headers[headerOsmoUser],
		UserName: headers[headerOsmoUser],
	}

	// Parse roles
	if rolesHeader := headers[headerOsmoRoles]; rolesHeader != "" {
		ctx.Roles = strings.Split(rolesHeader, ",")
		for i := range ctx.Roles {
			ctx.Roles[i] = strings.TrimSpace(ctx.Roles[i])
		}
	}

	// Parse body if present
	if body := httpAttrs.GetBody(); body != "" {
		_ = json.Unmarshal([]byte(body), &ctx.Body)
	}

	return ctx
}

// allowResponse creates a successful authorization response
func (s *CasbinAuthzServer) allowResponse() *envoy_service_auth_v3.CheckResponse {
	return &envoy_service_auth_v3.CheckResponse{
		Status: &status.Status{
			Code: int32(codes.OK),
		},
		HttpResponse: &envoy_service_auth_v3.CheckResponse_OkResponse{
			OkResponse: &envoy_service_auth_v3.OkHttpResponse{},
		},
	}
}

// denyResponse creates a denial authorization response
func (s *CasbinAuthzServer) denyResponse(code codes.Code, message string) *envoy_service_auth_v3.CheckResponse {
	return &envoy_service_auth_v3.CheckResponse{
		Status: &status.Status{
			Code:    int32(code),
			Message: message,
		},
		HttpResponse: &envoy_service_auth_v3.CheckResponse_DeniedResponse{
			DeniedResponse: &envoy_service_auth_v3.DeniedHttpResponse{
				Status: &envoy_type_v3.HttpStatus{
					Code: envoy_type_v3.StatusCode_Forbidden,
				},
				Body: message,
				Headers: []*envoy_api_v3_core.HeaderValueOption{
					{
						Header: &envoy_api_v3_core.HeaderValue{
							Key:   "content-type",
							Value: "text/plain",
						},
					},
				},
			},
		},
	}
}

// loadPoliciesFromPostgres loads policies from the postgres roles table
// and converts path-based policies to Casbin action-based policies
func loadPoliciesFromPostgres(ctx context.Context, pool *pgxpool.Pool, enforcer *casbin.Enforcer, logger *slog.Logger) error {
	// Check if policies already exist in Casbin storage
	policies, err := enforcer.GetPolicy()
	if err != nil {
		return fmt.Errorf("failed to get policies: %w", err)
	}
	if len(policies) > 0 {
		logger.Info("casbin policies already loaded from storage", slog.Int("count", len(policies)))
		return nil
	}

	logger.Info("loading policies from postgres roles table")

	// Query all roles from postgres
	query := `SELECT name, array_to_json(policies)::text as policies FROM roles`
	rows, err := pool.Query(ctx, query)
	if err != nil {
		return fmt.Errorf("failed to query roles: %w", err)
	}
	defer rows.Close()

	policyCount := 0

	for rows.Next() {
		var roleName string
		var policiesStr string

		if err := rows.Scan(&roleName, &policiesStr); err != nil {
			return fmt.Errorf("failed to scan role: %w", err)
		}

		// Parse policies JSON
		var policiesArray []json.RawMessage
		if err := json.Unmarshal([]byte(policiesStr), &policiesArray); err != nil {
			logger.Warn("failed to parse policies for role",
				slog.String("role", roleName),
				slog.String("error", err.Error()),
			)
			continue
		}

		// Process each policy
		for _, policyRaw := range policiesArray {
			var policy struct {
				Actions []struct {
					Path   string `json:"path"`
					Method string `json:"method"`
				} `json:"actions"`
			}

			if err := json.Unmarshal(policyRaw, &policy); err != nil {
				logger.Warn("failed to parse policy",
					slog.String("role", roleName),
					slog.String("error", err.Error()),
				)
				continue
			}

			// Convert each path/method action to Casbin policies
			for _, action := range policy.Actions {
				casbinPolicies := convertPathToCasbinPolicies(roleName, action.Path, action.Method, logger)
				for _, p := range casbinPolicies {
					if _, err := enforcer.AddPolicy(p); err != nil {
						logger.Debug("policy may already exist",
							slog.String("role", roleName),
							slog.Any("policy", p),
						)
					} else {
						policyCount++
					}
				}
			}
		}
	}

	if err := rows.Err(); err != nil {
		return fmt.Errorf("error iterating roles: %w", err)
	}

	// Save policies to Casbin storage for future reloads
	if policyCount > 0 {
		if err := enforcer.SavePolicy(); err != nil {
			return fmt.Errorf("failed to save policies: %w", err)
		}
	}

	logger.Info("policies loaded from postgres roles",
		slog.Int("policy_count", policyCount),
	)

	return nil
}

// convertPathToCasbinPolicies converts a path/method pattern to Casbin policies
// by matching against the ActionRegistry
func convertPathToCasbinPolicies(roleName, pathPattern, method string, logger *slog.Logger) [][]string {
	var policies [][]string

	// Handle deny patterns (paths starting with !)
	effect := "allow"
	if strings.HasPrefix(pathPattern, "!") {
		effect = "deny"
		pathPattern = pathPattern[1:]
	}

	// Handle wildcard path patterns - find all matching actions
	if pathPattern == "*" || pathPattern == "/*" {
		// Full wildcard - allow all actions
		policies = append(policies, []string{roleName, "*:*", "*", effect})
		return policies
	}

	// Try to match this path pattern against ActionRegistry entries
	matchedActions := findMatchingActions(pathPattern, method)

	if len(matchedActions) > 0 {
		for _, actionName := range matchedActions {
			// Extract resource scope from action
			resource := getResourceScopeForAction(actionName)
			policy := []string{roleName, actionName, resource, effect}
			logger.Debug("adding casbin policy",
				slog.String("role", roleName),
				slog.String("action", actionName),
				slog.String("resource", resource),
				slog.String("effect", effect),
				slog.Any("policy", policy),
			)
			policies = append(policies, policy)
		}
	} else {
		// No direct match - try to infer action from path pattern
		inferredAction := inferActionFromPath(pathPattern, method)
		if inferredAction != "" {
			resource := getResourceScopeForAction(inferredAction)
			policies = append(policies, []string{roleName, inferredAction, resource, effect})
		} else {
			logger.Debug("no action match for path pattern",
				slog.String("role", roleName),
				slog.String("path", pathPattern),
				slog.String("method", method),
			)
		}
	}

	return policies
}

// findMatchingActions finds all actions in ActionRegistry that match the given path pattern
func findMatchingActions(pathPattern, method string) []string {
	var matchedActions []string
	seenActions := make(map[string]bool)

	for actionName, patterns := range ActionRegistry {
		for _, pattern := range patterns {
			// Check if the path pattern matches this registry entry
			if pathPatternsOverlap(pathPattern, pattern.Path) && methodMatches(method, pattern.Methods) {
				if !seenActions[actionName] {
					matchedActions = append(matchedActions, actionName)
					seenActions[actionName] = true
				}
			}
		}
	}

	return matchedActions
}

// pathPatternsOverlap checks if two path patterns could match the same paths
func pathPatternsOverlap(pattern1, pattern2 string) bool {
	// Exact match
	if pattern1 == pattern2 {
		return true
	}

	// If either is a full wildcard
	if pattern1 == "*" || pattern1 == "/*" || pattern2 == "*" || pattern2 == "/*" {
		return true
	}

	// Check if one is a prefix of the other with wildcard
	// e.g., "/api/workflow/*" overlaps with "/api/workflow" and "/api/workflow/abc"
	p1HasWildcard := strings.HasSuffix(pattern1, "/*") || strings.HasSuffix(pattern1, "*")
	p2HasWildcard := strings.HasSuffix(pattern2, "/*") || strings.HasSuffix(pattern2, "*")

	if p1HasWildcard {
		prefix1 := strings.TrimSuffix(strings.TrimSuffix(pattern1, "/*"), "*")
		if strings.HasPrefix(pattern2, prefix1) || strings.HasPrefix(prefix1, strings.TrimSuffix(pattern2, "/*")) {
			return true
		}
	}

	if p2HasWildcard {
		prefix2 := strings.TrimSuffix(strings.TrimSuffix(pattern2, "/*"), "*")
		if strings.HasPrefix(pattern1, prefix2) || strings.HasPrefix(prefix2, strings.TrimSuffix(pattern1, "/*")) {
			return true
		}
	}

	return false
}

// methodMatches checks if a method matches the allowed methods
func methodMatches(requestMethod string, allowedMethods []string) bool {
	if requestMethod == "*" {
		return true
	}
	for _, m := range allowedMethods {
		if m == "*" || strings.EqualFold(m, requestMethod) {
			return true
		}
	}
	return false
}

// inferActionFromPath tries to infer the action from a path pattern
func inferActionFromPath(pathPattern, method string) string {
	// Extract resource type from path (e.g., /api/workflow/* -> workflow)
	parts := strings.Split(strings.Trim(pathPattern, "/"), "/")
	if len(parts) < 2 || parts[0] != "api" {
		return ""
	}

	resourceType := parts[1]

	// Map common HTTP methods to action verbs
	var actionVerb string
	switch strings.ToUpper(method) {
	case "GET":
		actionVerb = "Read"
	case "POST":
		actionVerb = "Create"
	case "PUT", "PATCH":
		actionVerb = "Update"
	case "DELETE":
		actionVerb = "Delete"
	case "*":
		actionVerb = "*"
	default:
		actionVerb = "Read"
	}

	return resourceType + ":" + actionVerb
}

// getResourceScopeForAction returns the appropriate resource scope for an action
func getResourceScopeForAction(action string) string {
	parts := strings.Split(action, ":")
	if len(parts) < 1 {
		return "*"
	}

	resourceType := parts[0]

	// Based on Resource-Action Model scope definitions
	switch resourceType {
	case "workflow":
		return "pool/*"
	case "bucket":
		return "bucket/*"
	case "config":
		return "config/*"
	case "profile":
		return "user/*"
	case "internal":
		return "backend/*"
	default:
		return "*"
	}
}
