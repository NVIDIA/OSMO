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
	"log/slog"
	"os"
	"testing"

	"go.corp.nvidia.com/osmo/service/utils_go"
)

func TestMatchMethod(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelError}))
	server := NewAuthzServer(nil, nil, logger)

	tests := []struct {
		name      string
		pattern   string
		method    string
		wantMatch bool
	}{
		{
			name:      "wildcard matches all",
			pattern:   "*",
			method:    "GET",
			wantMatch: true,
		},
		{
			name:      "exact match uppercase",
			pattern:   "GET",
			method:    "GET",
			wantMatch: true,
		},
		{
			name:      "exact match lowercase",
			pattern:   "get",
			method:    "get",
			wantMatch: true,
		},
		{
			name:      "case insensitive match",
			pattern:   "Get",
			method:    "GET",
			wantMatch: true,
		},
		{
			name:      "no match different methods",
			pattern:   "POST",
			method:    "GET",
			wantMatch: false,
		},
		{
			name:      "websocket match",
			pattern:   "WEBSOCKET",
			method:    "websocket",
			wantMatch: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := server.matchMethod(tt.pattern, tt.method)
			if got != tt.wantMatch {
				t.Errorf("matchMethod(%q, %q) = %v, want %v", tt.pattern, tt.method, got, tt.wantMatch)
			}
		})
	}
}

func TestMatchPathPattern(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelError}))
	server := NewAuthzServer(nil, nil, logger)

	tests := []struct {
		name      string
		pattern   string
		path      string
		wantMatch bool
	}{
		{
			name:      "exact match",
			pattern:   "/api/workflow",
			path:      "/api/workflow",
			wantMatch: true,
		},
		{
			name:      "wildcard suffix match",
			pattern:   "/api/workflow/*",
			path:      "/api/workflow/123",
			wantMatch: true,
		},
		{
			name:      "wildcard suffix no match",
			pattern:   "/api/workflow/*",
			path:      "/api/task/123",
			wantMatch: false,
		},
		{
			name:      "wildcard all paths",
			pattern:   "*",
			path:      "/any/path/here",
			wantMatch: true,
		},
		{
			name:      "nested wildcard",
			pattern:   "/api/*/task",
			path:      "/api/workflow/task",
			wantMatch: true,
		},
		{
			name:      "no match different path",
			pattern:   "/api/workflow",
			path:      "/api/task",
			wantMatch: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := server.matchPathPattern(tt.pattern, tt.path)
			if got != tt.wantMatch {
				t.Errorf("matchPathPattern(%q, %q) = %v, want %v", tt.pattern, tt.path, got, tt.wantMatch)
			}
		})
	}
}

func TestHasAccess(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelError}))
	server := NewAuthzServer(nil, nil, logger)

	tests := []struct {
		name       string
		role       *utils_go.Role
		path       string
		method     string
		wantAccess bool
	}{
		{
			name: "exact path and method match",
			role: &utils_go.Role{
				Name: "test-role",
				Policies: []utils_go.RolePolicy{
					{
						Actions: []utils_go.RoleAction{
							{Base: "http", Path: "/api/workflow", Method: "Get"},
						},
					},
				},
			},
			path:       "/api/workflow",
			method:     "GET",
			wantAccess: true,
		},
		{
			name: "wildcard path match",
			role: &utils_go.Role{
				Name: "test-role",
				Policies: []utils_go.RolePolicy{
					{
						Actions: []utils_go.RoleAction{
							{Base: "http", Path: "/api/workflow/*", Method: "Get"},
						},
					},
				},
			},
			path:       "/api/workflow/123",
			method:     "GET",
			wantAccess: true,
		},
		{
			name: "wildcard method match",
			role: &utils_go.Role{
				Name: "test-role",
				Policies: []utils_go.RolePolicy{
					{
						Actions: []utils_go.RoleAction{
							{Base: "http", Path: "/api/workflow", Method: "*"},
						},
					},
				},
			},
			path:       "/api/workflow",
			method:     "POST",
			wantAccess: true,
		},
		{
			name: "deny pattern blocks access",
			role: &utils_go.Role{
				Name: "test-role",
				Policies: []utils_go.RolePolicy{
					{
						Actions: []utils_go.RoleAction{
							{Base: "http", Path: "*", Method: "*"},
							{Base: "http", Path: "!/api/admin/*", Method: "*"},
						},
					},
				},
			},
			path:       "/api/admin/users",
			method:     "GET",
			wantAccess: false,
		},
		{
			name: "deny pattern allows other paths",
			role: &utils_go.Role{
				Name: "test-role",
				Policies: []utils_go.RolePolicy{
					{
						Actions: []utils_go.RoleAction{
							{Base: "http", Path: "*", Method: "*"},
							{Base: "http", Path: "!/api/admin/*", Method: "*"},
						},
					},
				},
			},
			path:       "/api/workflow/123",
			method:     "GET",
			wantAccess: true,
		},
		{
			name: "no matching path",
			role: &utils_go.Role{
				Name: "test-role",
				Policies: []utils_go.RolePolicy{
					{
						Actions: []utils_go.RoleAction{
							{Base: "http", Path: "/api/workflow", Method: "Get"},
						},
					},
				},
			},
			path:       "/api/task",
			method:     "GET",
			wantAccess: false,
		},
		{
			name: "no matching method",
			role: &utils_go.Role{
				Name: "test-role",
				Policies: []utils_go.RolePolicy{
					{
						Actions: []utils_go.RoleAction{
							{Base: "http", Path: "/api/workflow", Method: "Get"},
						},
					},
				},
			},
			path:       "/api/workflow",
			method:     "POST",
			wantAccess: false,
		},
		{
			name: "multiple policies first matches",
			role: &utils_go.Role{
				Name: "test-role",
				Policies: []utils_go.RolePolicy{
					{
						Actions: []utils_go.RoleAction{
							{Base: "http", Path: "/api/workflow/*", Method: "Get"},
						},
					},
					{
						Actions: []utils_go.RoleAction{
							{Base: "http", Path: "/api/task/*", Method: "Post"},
						},
					},
				},
			},
			path:       "/api/workflow/123",
			method:     "GET",
			wantAccess: true,
		},
		{
			name: "multiple policies second matches",
			role: &utils_go.Role{
				Name: "test-role",
				Policies: []utils_go.RolePolicy{
					{
						Actions: []utils_go.RoleAction{
							{Base: "http", Path: "/api/workflow/*", Method: "Get"},
						},
					},
					{
						Actions: []utils_go.RoleAction{
							{Base: "http", Path: "/api/task/*", Method: "Post"},
						},
					},
				},
			},
			path:       "/api/task/456",
			method:     "POST",
			wantAccess: true,
		},
		{
			name: "websocket method match",
			role: &utils_go.Role{
				Name: "test-role",
				Policies: []utils_go.RolePolicy{
					{
						Actions: []utils_go.RoleAction{
							{Base: "http", Path: "/api/router/*/*/client/*", Method: "Websocket"},
						},
					},
				},
			},
			path:       "/api/router/session/abc/client/connect",
			method:     "WEBSOCKET",
			wantAccess: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := server.hasAccess(tt.role, tt.path, tt.method)
			if got != tt.wantAccess {
				t.Errorf("hasAccess() = %v, want %v", got, tt.wantAccess)
			}
		})
	}
}

func TestDefaultRoleAccess(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelError}))
	server := NewAuthzServer(nil, nil, logger)

	// Simulate the osmo-default role permissions
	defaultRole := &utils_go.Role{
		Name: "osmo-default",
		Policies: []utils_go.RolePolicy{
			{
				Actions: []utils_go.RoleAction{
					{Base: "http", Path: "/api/version", Method: "*"},
					{Base: "http", Path: "/health", Method: "*"},
					{Base: "http", Path: "/api/auth/login", Method: "Get"},
				},
			},
		},
	}

	tests := []struct {
		name       string
		path       string
		method     string
		wantAccess bool
	}{
		{
			name:       "version endpoint accessible",
			path:       "/api/version",
			method:     "GET",
			wantAccess: true,
		},
		{
			name:       "health endpoint accessible",
			path:       "/health",
			method:     "GET",
			wantAccess: true,
		},
		{
			name:       "login endpoint accessible",
			path:       "/api/auth/login",
			method:     "GET",
			wantAccess: true,
		},
		{
			name:       "workflow endpoint not accessible",
			path:       "/api/workflow",
			method:     "GET",
			wantAccess: false,
		},
		{
			name:       "admin endpoint not accessible",
			path:       "/api/admin/users",
			method:     "GET",
			wantAccess: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := server.hasAccess(defaultRole, tt.path, tt.method)
			if got != tt.wantAccess {
				t.Errorf("hasAccess() = %v, want %v for path %s", got, tt.wantAccess, tt.path)
			}
		})
	}
}

func TestAdminRoleAccess(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelError}))
	server := NewAuthzServer(nil, nil, logger)

	// Simulate the osmo-admin role permissions
	adminRole := &utils_go.Role{
		Name: "osmo-admin",
		Policies: []utils_go.RolePolicy{
			{
				Actions: []utils_go.RoleAction{
					{Base: "http", Path: "*", Method: "*"},
					{Base: "http", Path: "!/api/agent/*", Method: "*"},
					{Base: "http", Path: "!/api/logger/*", Method: "*"},
					{Base: "http", Path: "!/api/router/*/*/backend/*", Method: "*"},
				},
			},
		},
	}

	tests := []struct {
		name       string
		path       string
		method     string
		wantAccess bool
	}{
		{
			name:       "workflow endpoint accessible",
			path:       "/api/workflow/123",
			method:     "GET",
			wantAccess: true,
		},
		{
			name:       "task endpoint accessible",
			path:       "/api/task/456",
			method:     "POST",
			wantAccess: true,
		},
		{
			name:       "agent endpoint blocked",
			path:       "/api/agent/listener/status",
			method:     "GET",
			wantAccess: false,
		},
		{
			name:       "logger endpoint blocked",
			path:       "/api/logger/workflow/logs",
			method:     "GET",
			wantAccess: false,
		},
		{
			name:       "router backend endpoint blocked",
			path:       "/api/router/session/abc/backend/connect",
			method:     "GET",
			wantAccess: false,
		},
		{
			name:       "router client endpoint accessible",
			path:       "/api/router/session/abc/client/connect",
			method:     "GET",
			wantAccess: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := server.hasAccess(adminRole, tt.path, tt.method)
			if got != tt.wantAccess {
				t.Errorf("hasAccess() = %v, want %v for path %s", got, tt.wantAccess, tt.path)
			}
		})
	}
}
