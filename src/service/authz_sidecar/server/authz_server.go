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
	headerOsmoUser         = "x-osmo-user"
	headerOsmoRoles        = "x-osmo-roles"
	headerOsmoAllowedPools = "x-osmo-allowed-pools"

	// Default role added to all users
	defaultRole = "osmo-default"
)

// AuthzServer implements Envoy External Authorization service
type AuthzServer struct {
	envoy_service_auth_v3.UnimplementedAuthorizationServer
	pgClient      *postgres.PostgresClient
	roleCache     *roles.RoleCache
	poolNameCache *roles.PoolNameCache
	logger        *slog.Logger
}

// NewAuthzServer creates a new authorization server
func NewAuthzServer(
	pgClient *postgres.PostgresClient,
	roleCache *roles.RoleCache,
	poolNameCache *roles.PoolNameCache,
	logger *slog.Logger,
) *AuthzServer {
	return &AuthzServer{
		pgClient:      pgClient,
		roleCache:     roleCache,
		poolNameCache: poolNameCache,
		logger:        logger,
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

	// Extract user and roles from headers
	user := headers[headerOsmoUser]
	rolesHeader := headers[headerOsmoRoles]

	// Parse roles (comma-separated)
	var roleNames []string
	if rolesHeader != "" {
		roleNames = strings.Split(rolesHeader, ",")
		for i := range roleNames {
			roleNames[i] = strings.TrimSpace(roleNames[i])
		}
	}

	// Add default role
	roleNames = append(roleNames, defaultRole)

	s.logger.Debug("authorization check request",
		slog.String("user", user),
		slog.String("path", path),
		slog.String("method", method),
		slog.Any("roles", roleNames),
	)

	// Fetch user roles from cache/DB
	userRoles, err := s.resolveRoles(ctx, roleNames)
	if err != nil {
		s.logger.Error("error resolving roles",
			slog.String("user", user),
			slog.String("error", err.Error()),
			slog.Any("roles", roleNames),
		)
		return s.denyResponse(codes.Internal, "internal error resolving roles"), nil
	}

	// Check access
	result := s.checkAccess(ctx, user, path, method, userRoles)

	if !result.Allowed {
		s.logger.Info("access denied",
			slog.String("user", user),
			slog.String("path", path),
			slog.String("method", method),
			slog.Any("roles", roleNames),
		)
		return s.denyResponse(codes.PermissionDenied, "access denied"), nil
	}

	s.logger.Info("access allowed",
		slog.String("user", user),
		slog.String("path", path),
		slog.String("method", method),
	)

	responseHeaders := map[string]string{}
	switch result.MatchedAction {
	case roles.ActionProfileRead, roles.ActionResourcesRead:
		responseHeaders[headerOsmoAllowedPools] = strings.Join(
			s.computeAllowedPools(ctx, user, userRoles), ",")
	}

	return s.allowResponse(responseHeaders), nil
}

// resolveRoles fetches role objects from cache/DB for the given role names.
func (s *AuthzServer) resolveRoles(ctx context.Context, roleNames []string) ([]*roles.Role, error) {
	cachedRoles, missingNames := s.roleCache.Get(roleNames)

	if len(missingNames) > 0 {
		dbRoles, err := roles.GetRoles(ctx, s.pgClient, missingNames, s.logger)
		if err != nil {
			return nil, fmt.Errorf("failed to fetch roles: %w", err)
		}
		if len(dbRoles) > 0 {
			s.roleCache.Set(dbRoles)
			cachedRoles = append(cachedRoles, dbRoles...)
		}
	}

	return cachedRoles, nil
}

// checkAccess verifies if the given roles have access to the path and method.
func (s *AuthzServer) checkAccess(ctx context.Context, user, path, method string, userRoles []*roles.Role) roles.AccessResult {
	result := roles.CheckRolesAccess(ctx, userRoles, path, method, s.pgClient)
	s.logAccessResult(result, user, path, method)
	return result
}

// computeAllowedPools evaluates role policies to determine which pools the
// user can access, respecting deny rules. Uses the pool name cache to avoid
// hitting the database on every request.
func (s *AuthzServer) computeAllowedPools(ctx context.Context, user string, userRoles []*roles.Role) []string {
	allPoolNames, ok := s.poolNameCache.Get()
	if !ok {
		var err error
		allPoolNames, err = roles.GetAllPoolNames(ctx, s.pgClient)
		if err != nil {
			s.logger.Error("failed to get pool names for allowed pools computation",
				slog.String("user", user),
				slog.String("error", err.Error()))
			return []string{}
		}
		s.poolNameCache.Set(allPoolNames)
	}
	return roles.GetAllowedPools(userRoles, allPoolNames)
}

// logAccessResult logs the result of an access check with appropriate details
func (s *AuthzServer) logAccessResult(result roles.AccessResult, user, path, method string) {
	if result.ActionType == roles.ActionTypeSemantic && result.Allowed {
		s.logger.Debug("access granted by semantic action",
			slog.String("user", user),
			slog.String("role", result.RoleName),
			slog.String("action", result.MatchedAction),
			slog.String("resource", result.MatchedResource),
			slog.String("path", path),
			slog.String("method", method),
		)
	}
}

// allowResponse creates a successful authorization response with optional
// headers injected into the upstream request.
func (s *AuthzServer) allowResponse(headers map[string]string) *envoy_service_auth_v3.CheckResponse {
	var headerOpts []*envoy_api_v3_core.HeaderValueOption
	for key, value := range headers {
		headerOpts = append(headerOpts, &envoy_api_v3_core.HeaderValueOption{
			Header: &envoy_api_v3_core.HeaderValue{
				Key:   key,
				Value: value,
			},
		})
	}

	return &envoy_service_auth_v3.CheckResponse{
		Status: &status.Status{
			Code: int32(codes.OK),
		},
		HttpResponse: &envoy_service_auth_v3.CheckResponse_OkResponse{
			OkResponse: &envoy_service_auth_v3.OkHttpResponse{
				Headers: headerOpts,
			},
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
