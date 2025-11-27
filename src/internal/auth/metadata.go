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

// Package auth provides gRPC authentication and authorization functionality.
// It extracts authentication information from gRPC metadata headers set by
// Envoy after JWT validation and provides interceptors for enforcing auth.
package auth

import (
	"context"
	"slices"
	"strings"

	"google.golang.org/grpc/metadata"
)

// Metadata keys for authentication headers.
// These headers are set by Envoy after JWT validation.
// Keys must be lowercase for gRPC metadata.
const (
	// MetadataKeyUser contains the user identity extracted from JWT (e.g., email).
	MetadataKeyUser = "x-osmo-user"
	// MetadataKeyRoles contains comma-separated role names from JWT.
	MetadataKeyRoles = "x-osmo-roles"
	// MetadataKeyAuth contains the raw JWT token (for forwarding if needed).
	MetadataKeyAuth = "x-osmo-auth"
)

// Well-known role names.
const (
	// RoleAdmin grants full access to all operations.
	RoleAdmin = "osmo-admin"
	// RoleDefault is automatically added to all authenticated users.
	RoleDefault = "osmo-default"
)

// Info contains extracted authentication information from gRPC metadata.
type Info struct {
	// User is the authenticated user identity (e.g., john.doe@nvidia.com).
	User string
	// Roles are the role names assigned to the user.
	Roles []string
}

// HasRole checks if the user has a specific role.
func (i *Info) HasRole(role string) bool {
	return slices.Contains(i.Roles, role)
}

// IsAdmin checks if the user has admin privileges.
func (i *Info) IsAdmin() bool {
	return i.HasRole(RoleAdmin)
}

// contextKey is a custom type for context keys to avoid collisions.
type contextKey string

const infoKey contextKey = "authInfo"

// InfoFromContext retrieves Info from the context.
// Returns nil and false if no auth info is present.
func InfoFromContext(ctx context.Context) (*Info, bool) {
	info, ok := ctx.Value(infoKey).(*Info)
	return info, ok
}

// ContextWithInfo adds Info to the context.
func ContextWithInfo(ctx context.Context, info *Info) context.Context {
	return context.WithValue(ctx, infoKey, info)
}

// ExtractInfo extracts authentication information from gRPC metadata.
// Returns nil if no metadata is present (auth may be disabled).
// The roles are split from the comma-separated header value.
func ExtractInfo(ctx context.Context) *Info {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return nil
	}

	info := &Info{}

	// Extract user identity
	if users := md.Get(MetadataKeyUser); len(users) > 0 {
		info.User = strings.TrimSpace(users[0])
	}

	// Extract and parse roles (comma-separated)
	if roles := md.Get(MetadataKeyRoles); len(roles) > 0 {
		rawRoles := strings.Split(roles[0], ",")
		info.Roles = make([]string, 0, len(rawRoles))
		for _, role := range rawRoles {
			if trimmed := strings.TrimSpace(role); trimmed != "" {
				info.Roles = append(info.Roles, trimmed)
			}
		}
	}

	return info
}
