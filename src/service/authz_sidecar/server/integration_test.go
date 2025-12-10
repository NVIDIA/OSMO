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
	"os"
	"testing"
	"time"

	envoy_service_auth_v3 "github.com/envoyproxy/go-control-plane/envoy/service/auth/v3"
	"google.golang.org/grpc/codes"

	"go.corp.nvidia.com/osmo/service/utils_go"
)

// MockPostgresClient implements a mock PostgreSQL client for testing
type MockPostgresClient struct {
	roles map[string]*utils_go.Role
}

func NewMockPostgresClient() *MockPostgresClient {
	return &MockPostgresClient{
		roles: make(map[string]*utils_go.Role),
	}
}

func (m *MockPostgresClient) GetRoles(ctx context.Context, roleNames []string) ([]*utils_go.Role, error) {
	var result []*utils_go.Role
	for _, name := range roleNames {
		if role, exists := m.roles[name]; exists {
			result = append(result, role)
		}
	}
	return result, nil
}

func (m *MockPostgresClient) AddRole(role *utils_go.Role) {
	m.roles[role.Name] = role
}

func (m *MockPostgresClient) Close() error {
	return nil
}

func (m *MockPostgresClient) Ping(ctx context.Context) error {
	return nil
}

func TestAuthzServerIntegration(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelError}))

	// Create mock postgres client with test roles
	mockPG := NewMockPostgresClient()

	// Add osmo-default role
	mockPG.AddRole(&utils_go.Role{
		Name:        "osmo-default",
		Description: "Default role",
		Policies: []utils_go.RolePolicy{
			{
				Actions: []utils_go.RoleAction{
					{Base: "http", Path: "/api/version", Method: "*"},
					{Base: "http", Path: "/health", Method: "*"},
					{Base: "http", Path: "/api/auth/login", Method: "Get"},
				},
			},
		},
	})

	// Add osmo-user role
	mockPG.AddRole(&utils_go.Role{
		Name:        "osmo-user",
		Description: "User role",
		Policies: []utils_go.RolePolicy{
			{
				Actions: []utils_go.RoleAction{
					{Base: "http", Path: "/api/workflow", Method: "*"},
					{Base: "http", Path: "/api/workflow/*", Method: "*"},
					{Base: "http", Path: "/api/task", Method: "*"},
					{Base: "http", Path: "/api/task/*", Method: "*"},
				},
			},
		},
	})

	// Add osmo-admin role
	mockPG.AddRole(&utils_go.Role{
		Name:        "osmo-admin",
		Description: "Admin role",
		Policies: []utils_go.RolePolicy{
			{
				Actions: []utils_go.RoleAction{
					{Base: "http", Path: "*", Method: "*"},
					{Base: "http", Path: "!/api/agent/*", Method: "*"},
				},
			},
		},
	})

	// Create cache
	cacheConfig := RoleCacheConfig{
		Enabled: true,
		TTL:     5 * time.Minute,
		MaxSize: 100,
	}
	roleCache := NewRoleCache(cacheConfig, logger)

	// Create authz server
	// We need to type assert to interface that has both methods
	server := &AuthzServer{
		pgClient:  mockPG,
		roleCache: roleCache,
		logger:    logger,
	}

	tests := []struct {
		name           string
		path           string
		method         string
		user           string
		roles          string
		expectedStatus codes.Code
	}{
		{
			name:           "default role can access version",
			path:           "/api/version",
			method:         "GET",
			user:           "anonymous",
			roles:          "", // Will get osmo-default added automatically
			expectedStatus: codes.OK,
		},
		{
			name:           "default role can access health",
			path:           "/health",
			method:         "GET",
			user:           "anonymous",
			roles:          "",
			expectedStatus: codes.OK,
		},
		{
			name:           "default role cannot access workflow",
			path:           "/api/workflow",
			method:         "GET",
			user:           "anonymous",
			roles:          "",
			expectedStatus: codes.PermissionDenied,
		},
		{
			name:           "user role can access workflow",
			path:           "/api/workflow",
			method:         "GET",
			user:           "testuser",
			roles:          "osmo-user",
			expectedStatus: codes.OK,
		},
		{
			name:           "user role can access workflow with ID",
			path:           "/api/workflow/abc123",
			method:         "POST",
			user:           "testuser",
			roles:          "osmo-user",
			expectedStatus: codes.OK,
		},
		{
			name:           "user role can access task",
			path:           "/api/task/456",
			method:         "GET",
			user:           "testuser",
			roles:          "osmo-user",
			expectedStatus: codes.OK,
		},
		{
			name:           "admin role can access workflow",
			path:           "/api/workflow",
			method:         "GET",
			user:           "admin",
			roles:          "osmo-admin",
			expectedStatus: codes.OK,
		},
		{
			name:           "admin role cannot access agent endpoint",
			path:           "/api/agent/listener/status",
			method:         "GET",
			user:           "admin",
			roles:          "osmo-admin",
			expectedStatus: codes.PermissionDenied,
		},
		{
			name:           "multiple roles osmo-user and osmo-default",
			path:           "/api/workflow",
			method:         "GET",
			user:           "testuser",
			roles:          "osmo-user,osmo-default",
			expectedStatus: codes.OK,
		},
		{
			name:           "user without proper role denied",
			path:           "/api/workflow",
			method:         "GET",
			user:           "limited",
			roles:          "osmo-default",
			expectedStatus: codes.PermissionDenied,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Create check request
			req := &envoy_service_auth_v3.CheckRequest{
				Attributes: &envoy_service_auth_v3.AttributeContext{
					Request: &envoy_service_auth_v3.AttributeContext_Request{
						Http: &envoy_service_auth_v3.AttributeContext_HttpRequest{
							Path:   tt.path,
							Method: tt.method,
							Headers: map[string]string{
								headerOsmoUser:  tt.user,
								headerOsmoRoles: tt.roles,
							},
						},
					},
				},
			}

			// Call Check
			resp, err := server.Check(context.Background(), req)
			if err != nil {
				t.Fatalf("Check() returned error: %v", err)
			}

			// Verify status code
			gotCode := codes.Code(resp.Status.Code)
			if gotCode != tt.expectedStatus {
				t.Errorf("Check() status = %v, want %v", gotCode, tt.expectedStatus)
			}
		})
	}
}

func TestAuthzServerCaching(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelError}))

	// Create mock postgres client
	mockPG := NewMockPostgresClient()
	mockPG.AddRole(&utils_go.Role{
		Name: "osmo-default",
		Policies: []utils_go.RolePolicy{
			{
				Actions: []utils_go.RoleAction{
					{Base: "http", Path: "/health", Method: "*"},
				},
			},
		},
	})

	// Create cache
	cacheConfig := RoleCacheConfig{
		Enabled: true,
		TTL:     1 * time.Hour,
		MaxSize: 100,
	}
	roleCache := NewRoleCache(cacheConfig, logger)

	// Create authz server
	server := &AuthzServer{
		pgClient:  mockPG,
		roleCache: roleCache,
		logger:    logger,
	}

	// Create request
	req := &envoy_service_auth_v3.CheckRequest{
		Attributes: &envoy_service_auth_v3.AttributeContext{
			Request: &envoy_service_auth_v3.AttributeContext_Request{
				Http: &envoy_service_auth_v3.AttributeContext_HttpRequest{
					Path:   "/health",
					Method: "GET",
					Headers: map[string]string{
						headerOsmoUser:  "testuser",
						headerOsmoRoles: "",
					},
				},
			},
		},
	}

	// First call should miss cache
	initialStats := roleCache.Stats()
	initialMisses := initialStats["misses"].(int64)

	_, err := server.Check(context.Background(), req)
	if err != nil {
		t.Fatalf("Check() returned error: %v", err)
	}

	// Verify cache miss
	statsAfterFirst := roleCache.Stats()
	missesAfterFirst := statsAfterFirst["misses"].(int64)
	if missesAfterFirst != initialMisses+1 {
		t.Errorf("expected cache miss, got misses: %d", missesAfterFirst)
	}

	// Second call should hit cache
	_, err = server.Check(context.Background(), req)
	if err != nil {
		t.Fatalf("Check() returned error: %v", err)
	}

	// Verify cache hit
	statsAfterSecond := roleCache.Stats()
	hitsAfterSecond := statsAfterSecond["hits"].(int64)
	if hitsAfterSecond == 0 {
		t.Error("expected cache hit on second call")
	}
}

func TestAuthzServerMissingAttributes(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelError}))
	server := NewAuthzServer(nil, nil, logger)

	tests := []struct {
		name string
		req  *envoy_service_auth_v3.CheckRequest
	}{
		{
			name: "nil attributes",
			req: &envoy_service_auth_v3.CheckRequest{
				Attributes: nil,
			},
		},
		{
			name: "nil http attributes",
			req: &envoy_service_auth_v3.CheckRequest{
				Attributes: &envoy_service_auth_v3.AttributeContext{
					Request: &envoy_service_auth_v3.AttributeContext_Request{
						Http: nil,
					},
				},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resp, err := server.Check(context.Background(), tt.req)
			if err != nil {
				t.Fatalf("Check() returned error: %v", err)
			}

			// Should return invalid argument status
			gotCode := codes.Code(resp.Status.Code)
			if gotCode != codes.InvalidArgument {
				t.Errorf("Check() status = %v, want %v", gotCode, codes.InvalidArgument)
			}
		})
	}
}

func TestAuthzServerEmptyRoles(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelError}))

	mockPG := NewMockPostgresClient()
	mockPG.AddRole(&utils_go.Role{
		Name: "osmo-default",
		Policies: []utils_go.RolePolicy{
			{
				Actions: []utils_go.RoleAction{
					{Base: "http", Path: "/health", Method: "*"},
				},
			},
		},
	})

	cacheConfig := RoleCacheConfig{
		Enabled: true,
		TTL:     1 * time.Hour,
		MaxSize: 100,
	}
	roleCache := NewRoleCache(cacheConfig, logger)

	server := &AuthzServer{
		pgClient:  mockPG,
		roleCache: roleCache,
		logger:    logger,
	}

	// Request with no roles header - should still get osmo-default
	req := &envoy_service_auth_v3.CheckRequest{
		Attributes: &envoy_service_auth_v3.AttributeContext{
			Request: &envoy_service_auth_v3.AttributeContext_Request{
				Http: &envoy_service_auth_v3.AttributeContext_HttpRequest{
					Path:   "/health",
					Method: "GET",
					Headers: map[string]string{
						headerOsmoUser: "testuser",
						// No roles header
					},
				},
			},
		},
	}

	resp, err := server.Check(context.Background(), req)
	if err != nil {
		t.Fatalf("Check() returned error: %v", err)
	}

	// Should be allowed due to osmo-default role
	gotCode := codes.Code(resp.Status.Code)
	if gotCode != codes.OK {
		t.Errorf("Check() status = %v, want %v", gotCode, codes.OK)
	}
}
