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

	// Load policies from database
	if err := enforcer.LoadPolicy(); err != nil {
		return nil, fmt.Errorf("failed to load policies: %w", err)
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

	// Resolve path and method to action
	action := resolveAction(path, method)
	resource := resolveResource(path)

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
		s.logger.Info("casbin access denied",
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

// resolveAction converts HTTP method and path to a semantic action
func resolveAction(path, method string) string {
	// Normalize path for matching
	normalizedPath := strings.TrimSuffix(path, "/")
	if idx := strings.Index(normalizedPath, "?"); idx != -1 {
		normalizedPath = normalizedPath[:idx]
	}

	// Extract resource type from path (e.g., /api/workflow -> workflow)
	parts := strings.Split(strings.TrimPrefix(normalizedPath, "/"), "/")
	if len(parts) < 2 {
		return "unknown:Unknown"
	}

	resourceType := parts[1] // e.g., "workflow", "bucket", "task"

	// Map HTTP method to action verb
	var actionVerb string
	switch strings.ToUpper(method) {
	case "GET":
		if len(parts) > 2 {
			actionVerb = "Read"
		} else {
			actionVerb = "List"
		}
	case "POST":
		actionVerb = "Create"
	case "PUT", "PATCH":
		actionVerb = "Update"
	case "DELETE":
		actionVerb = "Delete"
	default:
		actionVerb = "Unknown"
	}

	return fmt.Sprintf("%s:%s", resourceType, actionVerb)
}

// resolveResource extracts the resource identifier from the path
func resolveResource(path string) string {
	// Normalize path
	normalizedPath := strings.TrimSuffix(path, "/")
	if idx := strings.Index(normalizedPath, "?"); idx != -1 {
		normalizedPath = normalizedPath[:idx]
	}

	// Extract resource type and ID (e.g., /api/workflow/abc123 -> workflow/abc123)
	parts := strings.Split(strings.TrimPrefix(normalizedPath, "/"), "/")
	if len(parts) < 2 {
		return "*"
	}

	resourceType := parts[1]
	if len(parts) > 2 {
		return fmt.Sprintf("%s/%s", resourceType, parts[2])
	}

	return fmt.Sprintf("%s/*", resourceType)
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
