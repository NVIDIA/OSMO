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
	"log/slog"
	"path/filepath"
	"strings"

	envoy_api_v3_core "github.com/envoyproxy/go-control-plane/envoy/config/core/v3"
	envoy_service_auth_v3 "github.com/envoyproxy/go-control-plane/envoy/service/auth/v3"
	envoy_type_v3 "github.com/envoyproxy/go-control-plane/envoy/type/v3"
	"google.golang.org/genproto/googleapis/rpc/status"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"

	"go.corp.nvidia.com/osmo/service/utils_go"
)

const (
	// Header names
	headerOsmoUser  = "x-osmo-user"
	headerOsmoRoles = "x-osmo-roles"

	// Default role added to all users
	defaultRole = "osmo-default"
)

// PostgresClientInterface defines the interface for PostgreSQL operations
type PostgresClientInterface interface {
	GetRoles(ctx context.Context, roleNames []string) ([]*utils_go.Role, error)
	Close() error
	Ping(ctx context.Context) error
}

// AuthzServer implements Envoy External Authorization service
type AuthzServer struct {
	envoy_service_auth_v3.UnimplementedAuthorizationServer
	pgClient  PostgresClientInterface
	roleCache *RoleCache
	logger    *slog.Logger
}

// NewAuthzServer creates a new authorization server
func NewAuthzServer(pgClient PostgresClientInterface, roleCache *RoleCache, logger *slog.Logger) *AuthzServer {
	return &AuthzServer{
		pgClient:  pgClient,
		roleCache: roleCache,
		logger:    logger,
	}
}

// RegisterAuthzService registers the authorization service with gRPC server
func RegisterAuthzService(grpcServer *grpc.Server, authzServer *AuthzServer) {
	envoy_service_auth_v3.RegisterAuthorizationServer(grpcServer, authzServer)
}

// Check implements the Envoy External Authorization Check RPC
func (s *AuthzServer) Check(ctx context.Context, req *envoy_service_auth_v3.CheckRequest) (*envoy_service_auth_v3.CheckResponse, error) {
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

	s.logger.Debug("authorization check request",
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
		// Trim whitespace from each role
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

	// Check access
	allowed, err := s.checkAccess(ctx, path, method, roles)
	if err != nil {
		s.logger.Error("error checking access",
			slog.String("error", err.Error()),
			slog.String("path", path),
			slog.String("method", method),
			slog.Any("roles", roles),
		)
		return s.denyResponse(codes.Internal, "internal error checking access"), nil
	}

	if !allowed {
		s.logger.Info("access denied",
			slog.String("user", user),
			slog.String("path", path),
			slog.String("method", method),
			slog.Any("roles", roles),
		)
		return s.denyResponse(codes.PermissionDenied, "access denied"), nil
	}

	s.logger.Debug("access allowed",
		slog.String("user", user),
		slog.String("path", path),
		slog.String("method", method),
	)

	return s.allowResponse(), nil
}

// checkAccess verifies if the given roles have access to the path and method
func (s *AuthzServer) checkAccess(ctx context.Context, path, method string, roleNames []string) (bool, error) {
	// Try cache first
	roles, found := s.roleCache.Get(roleNames)
	if !found {
		// Query PostgreSQL
		var err error
		roles, err = s.pgClient.GetRoles(ctx, roleNames)
		if err != nil {
			return false, err
		}

		// Update cache
		s.roleCache.Set(roleNames, roles)
	}

	// Check each role's policies
	for _, role := range roles {
		if s.hasAccess(role, path, method) {
			s.logger.Debug("access granted by role",
				slog.String("role", role.Name),
				slog.String("path", path),
				slog.String("method", method),
			)
			return true, nil
		}
	}

	return false, nil
}

// hasAccess checks if a role has access to the given path and method
// This implements the same logic as Python's Role.has_access()
func (s *AuthzServer) hasAccess(role *utils_go.Role, path, method string) bool {
	allowed := false

	for _, policy := range role.Policies {
		for _, action := range policy.Actions {
			// Check method match
			if !s.matchMethod(action.Method, method) {
				continue
			}

			// Check path match
			if strings.HasPrefix(action.Path, "!") {
				// Deny pattern - if matches, deny access
				denyPath := action.Path[1:]
				if s.matchPathPattern(denyPath, path) {
					allowed = false
					s.logger.Debug("deny pattern matched",
						slog.String("role", role.Name),
						slog.String("deny_pattern", denyPath),
						slog.String("path", path),
					)
					break
				}
			} else {
				// Allow pattern
				if s.matchPathPattern(action.Path, path) {
					allowed = true
					s.logger.Debug("allow pattern matched",
						slog.String("role", role.Name),
						slog.String("allow_pattern", action.Path),
						slog.String("path", path),
					)
				}
			}
		}

		if allowed {
			return true
		}
	}

	return allowed
}

// matchMethod checks if the method pattern matches the request method
// Supports wildcard "*" and case-insensitive matching
func (s *AuthzServer) matchMethod(pattern, method string) bool {
	if pattern == "*" {
		return true
	}
	return strings.EqualFold(pattern, method)
}

// matchPathPattern uses glob pattern matching for path validation
// This mimics Python's fnmatch behavior
func (s *AuthzServer) matchPathPattern(pattern, path string) bool {
	// Special case: single * should match everything (like Python fnmatch)
	if pattern == "*" {
		return true
	}

	// Convert glob pattern to regex-like matching
	// Replace * with .* to match across path separators
	// This mimics Python's fnmatch behavior
	matched, err := filepath.Match(pattern, path)
	if err != nil {
		s.logger.Warn("invalid path pattern",
			slog.String("pattern", pattern),
			slog.String("error", err.Error()),
		)
		return false
	}

	// If filepath.Match fails, try simple string matching with * as wildcard
	if !matched && strings.Contains(pattern, "*") {
		// Convert glob pattern to simple prefix/suffix matching
		if strings.HasSuffix(pattern, "/*") {
			prefix := strings.TrimSuffix(pattern, "/*")
			return strings.HasPrefix(path, prefix+"/") || path == prefix
		}
		if strings.HasPrefix(pattern, "*/") {
			suffix := strings.TrimPrefix(pattern, "*/")
			return strings.HasSuffix(path, "/"+suffix)
		}
		// For patterns like /api/*/task, check if it matches
		parts := strings.Split(pattern, "/")
		pathParts := strings.Split(path, "/")
		if len(parts) != len(pathParts) {
			return false
		}
		for i := range parts {
			if parts[i] != "*" && parts[i] != pathParts[i] {
				return false
			}
		}
		return true
	}

	return matched
}

// allowResponse creates a successful authorization response
func (s *AuthzServer) allowResponse() *envoy_service_auth_v3.CheckResponse {
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
func (s *AuthzServer) denyResponse(code codes.Code, message string) *envoy_service_auth_v3.CheckResponse {
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
