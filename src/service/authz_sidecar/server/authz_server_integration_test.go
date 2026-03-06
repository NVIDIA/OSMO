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
	headers := map[string]string{
		"x-osmo-user": user,
	}
	if roleNames != "" {
		headers["x-osmo-roles"] = roleNames
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

}
