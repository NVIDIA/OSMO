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
	"fmt"
	"log/slog"
	"strings"

	envoy_api_v3_core "github.com/envoyproxy/go-control-plane/envoy/config/core/v3"
	envoy_service_auth_v3 "github.com/envoyproxy/go-control-plane/envoy/service/auth/v3"
	envoy_type_v3 "github.com/envoyproxy/go-control-plane/envoy/type/v3"
	"google.golang.org/genproto/googleapis/rpc/status"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"

	"go.corp.nvidia.com/osmo/utils/postgres"
	"go.corp.nvidia.com/osmo/utils/roles"
)

const (
	// Header names
	headerOsmoUser  = "x-osmo-user"
	headerOsmoRoles = "x-osmo-roles"

	// Default role added to all users
	defaultRole = "osmo-default"
)

// AuthzServer implements Envoy External Authorization service
type AuthzServer struct {
	envoy_service_auth_v3.UnimplementedAuthorizationServer
	pgClient  *postgres.PostgresClient
	roleCache *roles.RoleCache
	logger    *slog.Logger
}

// NewAuthzServer creates a new authorization server
func NewAuthzServer(pgClient *postgres.PostgresClient, roleCache *roles.RoleCache, logger *slog.Logger) *AuthzServer {
	return &AuthzServer{
		pgClient:  pgClient,
		roleCache: roleCache,
		logger:    logger,
	}
}

// MigrateRoles converts all legacy roles to semantic format and updates the database.
// This should be called at startup to ensure all roles are in semantic format.
func (s *AuthzServer) MigrateRoles(ctx context.Context) error {
	// Get all role names from the database
	allRoleNames, err := roles.GetAllRoleNames(ctx, s.pgClient)
	if err != nil {
		return fmt.Errorf("failed to get all role names: %w", err)
	}

	if len(allRoleNames) == 0 {
		s.logger.Warn("no roles found in database")
		return nil
	}

	// Fetch all roles from database
	allRoles, err := roles.GetRoles(ctx, s.pgClient, allRoleNames, s.logger)
	if err != nil {
		return fmt.Errorf("failed to get roles: %w", err)
	}

	// Convert all roles to semantic format
	convertedRoles := roles.ConvertRolesToSemantic(allRoles)

	// Update each role in the database with converted policies
	for _, role := range convertedRoles {
		if err := roles.UpdateRolePolicies(ctx, s.pgClient, role, s.logger); err != nil {
			return fmt.Errorf("failed to update role %s: %w", role.Name, err)
		}
	}

	s.logger.Info("migrated roles to semantic format",
		slog.Int("total_roles", len(convertedRoles)),
	)

	return nil
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
	cachedRoles, missingNames := s.roleCache.Get(roleNames)

	// Fetch missing roles from database
	if len(missingNames) > 0 {
		dbRoles, err := roles.GetRoles(ctx, s.pgClient, missingNames, s.logger)
		if err != nil {
			return false, fmt.Errorf("failed to fetch roles: %w", err)
		}

		// Add fetched roles to cache
		if len(dbRoles) > 0 {
			s.roleCache.Set(dbRoles)
			cachedRoles = append(cachedRoles, dbRoles...)
		}
	}

	// Use the unified policy access check from the roles package
	result := roles.CheckRolesAccess(ctx, cachedRoles, path, method, s.pgClient)

	// Log the result based on action type
	s.logAccessResult(result, path, method)

	return result.Allowed, nil
}

// logAccessResult logs the result of an access check with appropriate details
func (s *AuthzServer) logAccessResult(result roles.AccessResult, path, method string) {
	if result.ActionType == roles.ActionTypeSemantic && result.Allowed {
		s.logger.Debug("access granted by semantic action",
			slog.String("role", result.RoleName),
			slog.String("action", result.MatchedAction),
			slog.String("resource", result.MatchedResource),
			slog.String("path", path),
			slog.String("method", method),
		)
	}
	// ActionTypeNone means no match, nothing to log at debug level
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
