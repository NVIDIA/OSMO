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
	"log/slog"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// Config holds authentication configuration for interceptors.
type Config struct {
	// Enabled enables authentication processing.
	// When false, requests pass through without auth checks.
	// This maps to Python's check: service_config.service_auth.login_info.device_endpoint
	Enabled bool

	// Required requires valid authentication for all requests.
	// When true and auth info is missing, requests are rejected.
	// When false, unauthenticated requests are allowed (for gradual rollout).
	Required bool

	// DevMode skips all authentication checks.
	// This maps to Python's: if method == 'dev': return None
	// WARNING: Never enable in production.
	DevMode bool

	// RoleChecker provides role-based access control via database lookup.
	// If nil, role-based authorization is skipped (only authentication is performed).
	// When set and Enabled is true, role checks are always performed.
	RoleChecker *RoleChecker
}

// NewUnaryInterceptor creates a unary server interceptor for authentication.
//
// This implements the same logic as Python's check_user_access and AccessControlMiddleware:
//  1. Skip auth if DevMode is true (Python: method == 'dev')
//  2. Skip auth if Enabled is false (Python: not service_config.service_auth...)
//  3. Extract auth info from gRPC metadata (Python: request_headers)
//  4. Reject if Required is true and no user is present
//  5. Perform role-based access check (Python: role_entry.has_access(path, request_method))
//  6. Add auth info to context for handlers
func NewUnaryInterceptor(config Config, logger *slog.Logger) grpc.UnaryServerInterceptor {
	return func(
		ctx context.Context,
		req any,
		info *grpc.UnaryServerInfo,
		handler grpc.UnaryHandler,
	) (any, error) {
		// Skip auth in dev mode (Python: if method == 'dev': return None)
		if config.DevMode {
			return handler(ctx, req)
		}

		// Skip if auth is disabled (Python: if not service_config.service_auth.login_info.device_endpoint: return None)
		if !config.Enabled {
			return handler(ctx, req)
		}

		// Extract auth info from metadata (Python: request_headers.get(login.OSMO_USER_ROLES))
		authInfo := ExtractInfo(ctx)

		// Require user if auth is required
		if config.Required && (authInfo == nil || authInfo.User == "") {
			logger.WarnContext(ctx, "unauthenticated request rejected",
				slog.String("method", info.FullMethod),
			)
			return nil, status.Error(codes.Unauthenticated, "authentication required")
		}

		// Role-based access control (if RoleChecker is configured)
		// Python: roles_list = Role.list_from_db(postgres, user_roles)
		//         for role_entry in roles_list: allowed = role_entry.has_access(path, request_method)
		if config.RoleChecker != nil {
			// Get roles from authInfo, or use empty slice (RoleChecker will add osmo-default)
			// Python: roles_header = request_headers.get(login.OSMO_USER_ROLES) or ''
			//         user_roles = roles_header.split(',') + ['osmo-default']
			var roles []string
			if authInfo != nil {
				roles = authInfo.Roles
			}

			allowed, err := config.RoleChecker.CheckAccess(ctx, roles, info.FullMethod, "GRPC")
			if err != nil {
				logger.ErrorContext(ctx, "role check failed",
					slog.String("method", info.FullMethod),
					slog.String("error", err.Error()),
				)
				return nil, status.Error(codes.Internal, "authorization check failed")
			}
			if !allowed {
				user := ""
				if authInfo != nil {
					user = authInfo.User
				}
				logger.WarnContext(ctx, "access denied by role check",
					slog.String("method", info.FullMethod),
					slog.String("user", user),
					slog.Any("roles", roles),
				)
				// Python: return fastapi.responses.JSONResponse(status_code=403, ...)
				return nil, status.Error(codes.PermissionDenied, "insufficient permissions")
			}
		}

		// Add auth info to context for handlers
		if authInfo != nil {
			ctx = ContextWithInfo(ctx, authInfo)

			// Log authenticated request (debug level)
			logger.DebugContext(ctx, "authenticated request",
				slog.String("method", info.FullMethod),
				slog.String("user", authInfo.User),
				slog.Any("roles", authInfo.Roles),
			)
		}

		return handler(ctx, req)
	}
}

// NewStreamInterceptor creates a stream server interceptor for authentication.
//
// The interceptor follows the same logic as the unary interceptor but wraps
// the server stream to provide a modified context with auth info.
func NewStreamInterceptor(config Config, logger *slog.Logger) grpc.StreamServerInterceptor {
	return func(
		srv any,
		ss grpc.ServerStream,
		info *grpc.StreamServerInfo,
		handler grpc.StreamHandler,
	) error {
		ctx := ss.Context()

		// Skip auth in dev mode (Python: if method == 'dev': return None)
		if config.DevMode {
			return handler(srv, ss)
		}

		// Skip if auth is disabled (Python: if not service_config.service_auth.login_info.device_endpoint: return None)
		if !config.Enabled {
			return handler(srv, ss)
		}

		// Extract auth info from metadata
		authInfo := ExtractInfo(ctx)

		// Require user if auth is required
		if config.Required && (authInfo == nil || authInfo.User == "") {
			logger.WarnContext(ctx, "unauthenticated stream rejected",
				slog.String("method", info.FullMethod),
			)
			return status.Error(codes.Unauthenticated, "authentication required")
		}

		// Role-based access control (if RoleChecker is configured)
		if config.RoleChecker != nil {
			var roles []string
			if authInfo != nil {
				roles = authInfo.Roles
			}

			allowed, err := config.RoleChecker.CheckAccess(ctx, roles, info.FullMethod, "GRPC")
			if err != nil {
				logger.ErrorContext(ctx, "role check failed",
					slog.String("method", info.FullMethod),
					slog.String("error", err.Error()),
				)
				return status.Error(codes.Internal, "authorization check failed")
			}
			if !allowed {
				user := ""
				if authInfo != nil {
					user = authInfo.User
				}
				logger.WarnContext(ctx, "access denied by role check",
					slog.String("method", info.FullMethod),
					slog.String("user", user),
					slog.Any("roles", roles),
				)
				return status.Error(codes.PermissionDenied, "insufficient permissions")
			}
		}

		// Wrap stream with auth context if we have auth info
		if authInfo != nil {
			// Log authenticated stream (debug level)
			logger.DebugContext(ctx, "authenticated stream",
				slog.String("method", info.FullMethod),
				slog.String("user", authInfo.User),
				slog.Any("roles", authInfo.Roles),
			)

			wrappedStream := &authServerStream{
				ServerStream: ss,
				ctx:          ContextWithInfo(ctx, authInfo),
			}
			return handler(srv, wrappedStream)
		}

		return handler(srv, ss)
	}
}

// authServerStream wraps grpc.ServerStream to provide a modified context.
type authServerStream struct {
	grpc.ServerStream
	ctx context.Context
}

// Context returns the wrapped context with auth info.
func (s *authServerStream) Context() context.Context {
	return s.ctx
}
