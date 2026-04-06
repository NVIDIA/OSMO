//go:build integration

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

package server_test

import (
	"context"
	"log/slog"
	"os"
	"testing"
	"time"

	envoy_api_v3_core "github.com/envoyproxy/go-control-plane/envoy/config/core/v3"
	envoy_service_auth_v3 "github.com/envoyproxy/go-control-plane/envoy/service/auth/v3"
	"google.golang.org/grpc/codes"

	"go.corp.nvidia.com/osmo/service/authz_sidecar/server"
	"go.corp.nvidia.com/osmo/tests/common/database"
	"go.corp.nvidia.com/osmo/utils/roles"
)

// testFixture holds the shared container and per-test server instances.
type testFixture struct {
	pg     *database.PostgresFixture
	logger *slog.Logger
}

// newTestFixture starts a single PostgreSQL container for the entire test
// suite, with the shared OSMO schema applied.
func newTestFixture(t *testing.T) *testFixture {
	t.Helper()
	pg := database.StartPostgresWithSchema(t)
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelDebug}))
	return &testFixture{pg: pg, logger: logger}
}

// resetAndSeed resets the database to a clean schema, applies the seed data,
// and returns a fresh AuthzServer with empty caches. Call this at the start
// of each top-level test to get full isolation without restarting the container.
func (f *testFixture) resetAndSeed(t *testing.T) *server.AuthzServer {
	t.Helper()

	f.pg.ResetSchema(t)
	f.pg.ExecSQLFile(t, "testdata/seed.sql")

	roleCache := roles.NewRoleCache(100, 5*time.Minute, f.logger)
	poolNameCache := roles.NewPoolNameCache(5*time.Minute, f.logger)
	return server.NewAuthzServer(f.pg.Client, roleCache, poolNameCache, f.logger)
}

func makeCheckRequest(user, path, method string, roleNames string) *envoy_service_auth_v3.CheckRequest {
	return makeCheckRequestWithHeaders(user, path, method, roleNames, "", "")
}

func makeCheckRequestWithHeaders(user, path, method, roleNames, tokenName, workflowID string) *envoy_service_auth_v3.CheckRequest {
	headers := map[string]string{
		"x-osmo-user": user,
	}
	if roleNames != "" {
		headers["x-osmo-roles"] = roleNames
	}
	if tokenName != "" {
		headers["x-osmo-token-name"] = tokenName
	}
	if workflowID != "" {
		headers["x-osmo-workflow-id"] = workflowID
	}

	return &envoy_service_auth_v3.CheckRequest{
		Attributes: &envoy_service_auth_v3.AttributeContext{
			Request: &envoy_service_auth_v3.AttributeContext_Request{
				Http: &envoy_service_auth_v3.AttributeContext_HttpRequest{
					Path:    path,
					Method:  method,
					Headers: headers,
				},
			},
			Source: &envoy_service_auth_v3.AttributeContext_Peer{
				Address: &envoy_api_v3_core.Address{},
			},
		},
	}
}

func TestIntegration(t *testing.T) {
	fixture := newTestFixture(t)

	t.Run("AdminAccess", func(t *testing.T) {
		authzServer := fixture.resetAndSeed(t)

		tests := []struct {
			name     string
			path     string
			method   string
			wantCode codes.Code
		}{
			{
				name:     "admin can access workflows",
				path:     "/api/workflow/123",
				method:   "GET",
				wantCode: codes.OK,
			},
			{
				name:     "admin can create workflows",
				path:     "/api/pool/production/workflow",
				method:   "POST",
				wantCode: codes.OK,
			},
			{
				name:     "admin can access pools",
				path:     "/api/pool",
				method:   "GET",
				wantCode: codes.OK,
			},
		}

		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				req := makeCheckRequest("admin@example.com", tt.path, tt.method, "osmo-admin")
				resp, err := authzServer.Check(context.Background(), req)
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				gotCode := codes.Code(resp.Status.Code)
				if gotCode != tt.wantCode {
					t.Errorf("Check() status = %v, want %v", gotCode, tt.wantCode)
				}
			})
		}
	})

	t.Run("UserAccess", func(t *testing.T) {
		authzServer := fixture.resetAndSeed(t)

		tests := []struct {
			name     string
			path     string
			method   string
			wantCode codes.Code
		}{
			{
				name:     "user can read workflows",
				path:     "/api/workflow/123",
				method:   "GET",
				wantCode: codes.OK,
			},
			{
				name:     "user can create workflows",
				path:     "/api/pool/staging/workflow",
				method:   "POST",
				wantCode: codes.OK,
			},
			{
				name:     "user can list pools",
				path:     "/api/pool",
				method:   "GET",
				wantCode: codes.OK,
			},
		}

		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				req := makeCheckRequest("user@example.com", tt.path, tt.method, "osmo-user")
				resp, err := authzServer.Check(context.Background(), req)
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				gotCode := codes.Code(resp.Status.Code)
				if gotCode != tt.wantCode {
					t.Errorf("Check() status = %v, want %v", gotCode, tt.wantCode)
				}
			})
		}
	})

	t.Run("UnauthorizedAccess", func(t *testing.T) {
		authzServer := fixture.resetAndSeed(t)

		tests := []struct {
			name     string
			user     string
			roles    string
			path     string
			method   string
			wantCode codes.Code
		}{
			{
				name:     "unknown user with default role cannot access workflows",
				user:     "nobody@example.com",
				roles:    "",
				path:     "/api/workflow",
				method:   "POST",
				wantCode: codes.PermissionDenied,
			},
			{
				name:     "restricted user cannot create workflows on staging",
				user:     "restricted@example.com",
				roles:    "osmo-restricted",
				path:     "/api/pool/staging/workflow",
				method:   "POST",
				wantCode: codes.PermissionDenied,
			},
		}

		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				req := makeCheckRequest(tt.user, tt.path, tt.method, tt.roles)
				resp, err := authzServer.Check(context.Background(), req)
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				gotCode := codes.Code(resp.Status.Code)
				if gotCode != tt.wantCode {
					t.Errorf("Check() status = %v, want %v", gotCode, tt.wantCode)
				}
			})
		}
	})

	// Tests that x-osmo-token-name skips SyncUserRoles, so the request only
	// uses the roles from the header, not the user's DB-assigned roles.
	t.Run("TokenAccessBypassesRoleSync", func(t *testing.T) {
		authzServer := fixture.resetAndSeed(t)

		tests := []struct {
			name      string
			user      string
			roles     string
			tokenName string
			path      string
			method    string
			wantCode  codes.Code
		}{
			{
				name:      "token with restricted role cannot create workflows on staging",
				user:      "user@example.com",
				roles:     "osmo-restricted",
				tokenName: "my-api-token",
				path:      "/api/pool/staging/workflow",
				method:    "POST",
				wantCode:  codes.PermissionDenied,
			},
			{
				name:      "same user WITHOUT token header CAN create workflows via DB roles",
				user:      "user@example.com",
				roles:     "osmo-restricted",
				tokenName: "",
				path:      "/api/pool/staging/workflow",
				method:    "POST",
				wantCode:  codes.OK,
			},
			{
				name:      "token with restricted role cannot list pools",
				user:      "user@example.com",
				roles:     "osmo-restricted",
				tokenName: "my-api-token",
				path:      "/api/pool",
				method:    "GET",
				wantCode:  codes.PermissionDenied,
			},
			{
				name:      "same user WITHOUT token header CAN list pools via DB roles",
				user:      "user@example.com",
				roles:     "osmo-restricted",
				tokenName: "",
				path:      "/api/pool",
				method:    "GET",
				wantCode:  codes.OK,
			},
			{
				name:      "token with restricted role cannot read profile",
				user:      "user@example.com",
				roles:     "osmo-restricted",
				tokenName: "my-api-token",
				path:      "/api/profile/settings",
				method:    "GET",
				wantCode:  codes.PermissionDenied,
			},
			{
				name:      "token with no roles only gets default - cannot create workflows",
				user:      "user@example.com",
				roles:     "",
				tokenName: "my-api-token",
				path:      "/api/pool/staging/workflow",
				method:    "POST",
				wantCode:  codes.PermissionDenied,
			},
			{
				name:      "token with full user role in header CAN create workflows",
				user:      "user@example.com",
				roles:     "osmo-user",
				tokenName: "my-api-token",
				path:      "/api/pool/staging/workflow",
				method:    "POST",
				wantCode:  codes.OK,
			},
			{
				name:      "token with full user role in header CAN list pools",
				user:      "user@example.com",
				roles:     "osmo-user",
				tokenName: "my-api-token",
				path:      "/api/pool",
				method:    "GET",
				wantCode:  codes.OK,
			},
		}

		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				req := makeCheckRequestWithHeaders(tt.user, tt.path, tt.method, tt.roles, tt.tokenName, "")
				resp, err := authzServer.Check(context.Background(), req)
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				gotCode := codes.Code(resp.Status.Code)
				if gotCode != tt.wantCode {
					t.Errorf("Check() status = %v, want %v", gotCode, tt.wantCode)
				}
			})
		}
	})

	// Tests that x-osmo-workflow-id skips SyncUserRoles the same way tokens do.
	t.Run("WorkflowIDBypassesRoleSync", func(t *testing.T) {
		authzServer := fixture.resetAndSeed(t)

		tests := []struct {
			name       string
			user       string
			roles      string
			workflowID string
			path       string
			method     string
			wantCode   codes.Code
		}{
			{
				name:       "workflow request with restricted role cannot create workflows on staging",
				user:       "user@example.com",
				roles:      "osmo-restricted",
				workflowID: "wf-abc-123",
				path:       "/api/pool/staging/workflow",
				method:     "POST",
				wantCode:   codes.PermissionDenied,
			},
			{
				name:       "same user WITHOUT workflow ID CAN create workflows via DB roles",
				user:       "user@example.com",
				roles:      "osmo-restricted",
				workflowID: "",
				path:       "/api/pool/staging/workflow",
				method:     "POST",
				wantCode:   codes.OK,
			},
			{
				name:       "workflow request with restricted role cannot list pools",
				user:       "user@example.com",
				roles:      "osmo-restricted",
				workflowID: "wf-abc-123",
				path:       "/api/pool",
				method:     "GET",
				wantCode:   codes.PermissionDenied,
			},
			{
				name:       "workflow request with no roles only gets default - cannot create workflows",
				user:       "user@example.com",
				roles:      "",
				workflowID: "wf-abc-123",
				path:       "/api/pool/staging/workflow",
				method:     "POST",
				wantCode:   codes.PermissionDenied,
			},
			{
				name:       "workflow request with full user role in header CAN create workflows",
				user:       "user@example.com",
				roles:      "osmo-user",
				workflowID: "wf-abc-123",
				path:       "/api/pool/staging/workflow",
				method:     "POST",
				wantCode:   codes.OK,
			},
		}

		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				req := makeCheckRequestWithHeaders(tt.user, tt.path, tt.method, tt.roles, "", tt.workflowID)
				resp, err := authzServer.Check(context.Background(), req)
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				gotCode := codes.Code(resp.Status.Code)
				if gotCode != tt.wantCode {
					t.Errorf("Check() status = %v, want %v", gotCode, tt.wantCode)
				}
			})
		}
	})

	// Tests app API endpoints, including the user-scoped creation path
	// (/api/app/user/{app_name}) that requires a wildcard pattern in the
	// action registry.
	t.Run("AppAccess", func(t *testing.T) {
		authzServer := fixture.resetAndSeed(t)

		tests := []struct {
			name      string
			user      string
			roles     string
			tokenName string
			path      string
			method    string
			wantCode  codes.Code
		}{
			{
				name:     "user can create app at base path",
				user:     "user@example.com",
				roles:    "osmo-user",
				path:     "/api/app",
				method:   "POST",
				wantCode: codes.OK,
			},
			{
				name:     "user can create app at user-scoped path",
				user:     "user@example.com",
				roles:    "osmo-user",
				path:     "/api/app/user/my-app",
				method:   "POST",
				wantCode: codes.OK,
			},
			{
				name:     "user can create app at user-scoped path with query params",
				user:     "user@example.com",
				roles:    "osmo-user",
				path:     "/api/app/user/integration_test_app?description=This+is+a+test+app",
				method:   "POST",
				wantCode: codes.OK,
			},
			{
				name:     "user can read apps",
				user:     "user@example.com",
				roles:    "osmo-user",
				path:     "/api/app",
				method:   "GET",
				wantCode: codes.OK,
			},
			{
				name:     "user can read specific app",
				user:     "user@example.com",
				roles:    "osmo-user",
				path:     "/api/app/my-app",
				method:   "GET",
				wantCode: codes.OK,
			},
			{
				name:     "user can update app",
				user:     "user@example.com",
				roles:    "osmo-user",
				path:     "/api/app/my-app",
				method:   "PUT",
				wantCode: codes.OK,
			},
			{
				name:     "user can delete app",
				user:     "user@example.com",
				roles:    "osmo-user",
				path:     "/api/app/my-app",
				method:   "DELETE",
				wantCode: codes.OK,
			},
			{
				name:     "restricted role cannot create app",
				user:     "restricted@example.com",
				roles:    "osmo-restricted",
				path:     "/api/app/user/my-app",
				method:   "POST",
				wantCode: codes.PermissionDenied,
			},
			{
				name:     "restricted role cannot read apps",
				user:     "restricted@example.com",
				roles:    "osmo-restricted",
				path:     "/api/app",
				method:   "GET",
				wantCode: codes.PermissionDenied,
			},
			{
				name:      "token with restricted role cannot create app",
				user:      "user@example.com",
				roles:     "osmo-restricted",
				tokenName: "my-api-token",
				path:      "/api/app/user/my-app",
				method:    "POST",
				wantCode:  codes.PermissionDenied,
			},
			{
				name:      "token with restricted role cannot read apps",
				user:      "user@example.com",
				roles:     "osmo-restricted",
				tokenName: "my-api-token",
				path:      "/api/app",
				method:    "GET",
				wantCode:  codes.PermissionDenied,
			},
			{
				name:      "token with user role CAN create app",
				user:      "user@example.com",
				roles:     "osmo-user",
				tokenName: "full-access-token",
				path:      "/api/app/user/my-app",
				method:    "POST",
				wantCode:  codes.OK,
			},
			{
				name:      "token with user role CAN read apps",
				user:      "user@example.com",
				roles:     "osmo-user",
				tokenName: "full-access-token",
				path:      "/api/app",
				method:    "GET",
				wantCode:  codes.OK,
			},
		}

		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				req := makeCheckRequestWithHeaders(tt.user, tt.path, tt.method, tt.roles, tt.tokenName, "")
				resp, err := authzServer.Check(context.Background(), req)
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				gotCode := codes.Code(resp.Status.Code)
				if gotCode != tt.wantCode {
					t.Errorf("Check() status = %v, want %v", gotCode, tt.wantCode)
				}
			})
		}
	})

	// Tests that the default role (osmo-default) is appended to roleNames before
	// SyncUserRoles, so external mappings from osmo-default are evaluated even
	// when the user's request headers don't include osmo-default.
	// Seed data maps: external role "osmo-default" → OSMO role "osmo-user" (sync_mode=import).
	t.Run("DefaultRoleExternalMappingGrantsOsmoUser", func(t *testing.T) {
		authzServer := fixture.resetAndSeed(t)

		tests := []struct {
			name      string
			user      string
			roles     string
			tokenName string
			path      string
			method    string
			wantCode  codes.Code
		}{
			{
				name:     "new user with no header roles can read workflows via default role mapping",
				user:     "newuser@example.com",
				roles:    "",
				path:     "/api/workflow/123",
				method:   "GET",
				wantCode: codes.OK,
			},
			{
				name:     "new user with no header roles can list pools via default role mapping",
				user:     "newuser2@example.com",
				roles:    "",
				path:     "/api/pool",
				method:   "GET",
				wantCode: codes.OK,
			},
			{
				name:     "new user with unrelated role still gets mapped role via default role mapping",
				user:     "newuser3@example.com",
				roles:    "some-other-idp-role",
				path:     "/api/workflow/123",
				method:   "GET",
				wantCode: codes.OK,
			},
			{
				name:     "default role mapping only grants read - cannot create workflows",
				user:     "newuser4@example.com",
				roles:    "",
				path:     "/api/pool/staging/workflow",
				method:   "POST",
				wantCode: codes.PermissionDenied,
			},
			{
				name:      "token request does NOT get default role mapping - sync is skipped",
				user:      "newuser5@example.com",
				roles:     "",
				tokenName: "some-token",
				path:      "/api/workflow/123",
				method:    "GET",
				wantCode:  codes.PermissionDenied,
			},
		}

		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				req := makeCheckRequestWithHeaders(tt.user, tt.path, tt.method, tt.roles, tt.tokenName, "")
				resp, err := authzServer.Check(context.Background(), req)
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				gotCode := codes.Code(resp.Status.Code)
				if gotCode != tt.wantCode {
					t.Errorf("Check() status = %v, want %v", gotCode, tt.wantCode)
				}
			})
		}
	})

	// When both token name and workflow ID are set, role sync is still skipped.
	t.Run("BothTokenAndWorkflowIDBypassRoleSync", func(t *testing.T) {
		authzServer := fixture.resetAndSeed(t)

		tests := []struct {
			name     string
			user     string
			roles    string
			path     string
			method   string
			wantCode codes.Code
		}{
			{
				name:     "both headers set - restricted role cannot create workflows",
				user:     "user@example.com",
				roles:    "osmo-restricted",
				path:     "/api/pool/staging/workflow",
				method:   "POST",
				wantCode: codes.PermissionDenied,
			},
			{
				name:     "both headers set - restricted role cannot list pools",
				user:     "user@example.com",
				roles:    "osmo-restricted",
				path:     "/api/pool",
				method:   "GET",
				wantCode: codes.PermissionDenied,
			},
			{
				name:     "both headers set - full user role still works",
				user:     "user@example.com",
				roles:    "osmo-user",
				path:     "/api/pool/staging/workflow",
				method:   "POST",
				wantCode: codes.OK,
			},
		}

		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				req := makeCheckRequestWithHeaders(tt.user, tt.path, tt.method, tt.roles, "my-api-token", "wf-abc-123")
				resp, err := authzServer.Check(context.Background(), req)
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				gotCode := codes.Code(resp.Status.Code)
				if gotCode != tt.wantCode {
					t.Errorf("Check() status = %v, want %v", gotCode, tt.wantCode)
				}
			})
		}
	})

}
