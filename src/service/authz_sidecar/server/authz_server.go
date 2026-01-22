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
	"context"
	"log/slog"
	"strings"

	envoy_api_v3_core "github.com/envoyproxy/go-control-plane/envoy/config/core/v3"
	envoy_service_auth_v3 "github.com/envoyproxy/go-control-plane/envoy/service/auth/v3"
	envoy_type_v3 "github.com/envoyproxy/go-control-plane/envoy/type/v3"
	"google.golang.org/genproto/googleapis/rpc/status"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"

	"go.corp.nvidia.com/osmo/utils/roles"
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
	Close()
	Ping(ctx context.Context) error
}

// RoleFetcher is a function type for fetching roles from the database.
// This allows the authz server to be decoupled from the roles package,
// enabling easier testing with mock implementations.
type RoleFetcher func(ctx context.Context, roleNames []string) ([]*roles.Role, error)

// AuthzServer implements Envoy External Authorization service
type AuthzServer struct {
	envoy_service_auth_v3.UnimplementedAuthorizationServer
	pgClient    PostgresClientInterface
	roleFetcher RoleFetcher
	roleCache   *roles.RoleCache
	logger      *slog.Logger
}

// NewAuthzServer creates a new authorization server
func NewAuthzServer(pgClient PostgresClientInterface, roleFetcher RoleFetcher, roleCache *roles.RoleCache, logger *slog.Logger) *AuthzServer {
	return &AuthzServer{
		pgClient:    pgClient,
		roleFetcher: roleFetcher,
		roleCache:   roleCache,
		logger:      logger,
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
	fetchedRoles, found := s.roleCache.Get(roleNames)
	if !found {
		// Query PostgreSQL
		var err error
		fetchedRoles, err = s.roleFetcher(ctx, roleNames)
		if err != nil {
			return false, err
		}

		// Update cache
		s.roleCache.Set(roleNames, fetchedRoles)
	}

	// Use the unified policy access check from the roles package
	// This handles both semantic actions and legacy path-based actions
	result := roles.CheckRolesAccess(fetchedRoles, path, method)

	// Log the result based on action type
	s.logAccessResult(result, path, method)

	return result.Allowed, nil
}

// logAccessResult logs the result of an access check with appropriate details
func (s *AuthzServer) logAccessResult(result roles.AccessResult, path, method string) {
	switch result.ActionType {
	case roles.ActionTypeSemantic:
		if result.Allowed {
			s.logger.Debug("access granted by semantic action",
				slog.String("role", result.RoleName),
				slog.String("action", result.MatchedAction),
				slog.String("resource", result.MatchedResource),
				slog.String("path", path),
				slog.String("method", method),
			)
		}
	case roles.ActionTypeLegacy:
		if result.IsDeny {
			s.logger.Debug("access denied by legacy pattern",
				slog.String("role", result.RoleName),
				slog.String("deny_pattern", result.MatchedAction),
				slog.String("path", path),
			)
		} else if result.Allowed {
			s.logger.Debug("access granted by legacy pattern",
				slog.String("role", result.RoleName),
				slog.String("allow_pattern", result.MatchedAction),
				slog.String("path", path),
				slog.String("method", method),
			)
		}
	case roles.ActionTypeNone:
		// No match, nothing to log at debug level
	}
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
