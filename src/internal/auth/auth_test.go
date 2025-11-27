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
	"os"
	"testing"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

func TestExtractInfo(t *testing.T) {
	tests := []struct {
		name     string
		metadata map[string]string
		wantUser string
		wantLen  int
	}{
		{
			name:     "no metadata",
			metadata: nil,
			wantUser: "",
			wantLen:  0,
		},
		{
			name: "user only",
			metadata: map[string]string{
				MetadataKeyUser: "test@nvidia.com",
			},
			wantUser: "test@nvidia.com",
			wantLen:  0,
		},
		{
			name: "user and roles",
			metadata: map[string]string{
				MetadataKeyUser:  "test@nvidia.com",
				MetadataKeyRoles: "osmo-user,osmo-admin",
			},
			wantUser: "test@nvidia.com",
			wantLen:  2,
		},
		{
			name: "roles with whitespace",
			metadata: map[string]string{
				MetadataKeyUser:  "test@nvidia.com",
				MetadataKeyRoles: " osmo-user , osmo-admin , osmo-viewer ",
			},
			wantUser: "test@nvidia.com",
			wantLen:  3,
		},
		{
			name: "empty roles filtered",
			metadata: map[string]string{
				MetadataKeyUser:  "test@nvidia.com",
				MetadataKeyRoles: "osmo-user,,osmo-admin,",
			},
			wantUser: "test@nvidia.com",
			wantLen:  2,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var ctx context.Context
			if tt.metadata != nil {
				md := metadata.New(tt.metadata)
				ctx = metadata.NewIncomingContext(context.Background(), md)
			} else {
				ctx = context.Background()
			}

			info := ExtractInfo(ctx)

			if tt.metadata == nil {
				if info != nil && info.User != "" {
					t.Errorf("ExtractInfo() = %v, want nil or empty", info)
				}
				return
			}

			if info == nil {
				t.Fatal("ExtractInfo() returned nil")
			}

			if info.User != tt.wantUser {
				t.Errorf("User = %q, want %q", info.User, tt.wantUser)
			}

			if len(info.Roles) != tt.wantLen {
				t.Errorf("len(Roles) = %d, want %d", len(info.Roles), tt.wantLen)
			}
		})
	}
}

func TestInfo_HasRole(t *testing.T) {
	info := &Info{
		User:  "test@nvidia.com",
		Roles: []string{"osmo-user", "osmo-admin"},
	}

	if !info.HasRole("osmo-user") {
		t.Error("HasRole(osmo-user) = false, want true")
	}

	if !info.HasRole("osmo-admin") {
		t.Error("HasRole(osmo-admin) = false, want true")
	}

	if info.HasRole("osmo-viewer") {
		t.Error("HasRole(osmo-viewer) = true, want false")
	}
}

func TestInfo_IsAdmin(t *testing.T) {
	tests := []struct {
		name  string
		roles []string
		want  bool
	}{
		{"admin role present", []string{"osmo-user", "osmo-admin"}, true},
		{"no admin role", []string{"osmo-user", "osmo-viewer"}, false},
		{"empty roles", []string{}, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			info := &Info{Roles: tt.roles}
			if got := info.IsAdmin(); got != tt.want {
				t.Errorf("IsAdmin() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestContextWithInfo(t *testing.T) {
	info := &Info{
		User:  "test@nvidia.com",
		Roles: []string{"osmo-user"},
	}

	ctx := ContextWithInfo(context.Background(), info)
	got, ok := InfoFromContext(ctx)

	if !ok {
		t.Fatal("InfoFromContext() ok = false, want true")
	}

	if got.User != info.User {
		t.Errorf("User = %q, want %q", got.User, info.User)
	}
}

func TestInfoFromContext_NotPresent(t *testing.T) {
	_, ok := InfoFromContext(context.Background())
	if ok {
		t.Error("InfoFromContext() ok = true, want false")
	}
}

// testLogger creates a logger for testing.
func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelDebug,
	}))
}

func TestNewUnaryInterceptor_DevMode(t *testing.T) {
	config := Config{DevMode: true}
	interceptor := NewUnaryInterceptor(config, testLogger())

	called := false
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		called = true
		return "ok", nil
	}

	_, err := interceptor(context.Background(), nil, &grpc.UnaryServerInfo{}, handler)
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
	if !called {
		t.Error("handler was not called")
	}
}

func TestNewUnaryInterceptor_Disabled(t *testing.T) {
	config := Config{Enabled: false}
	interceptor := NewUnaryInterceptor(config, testLogger())

	called := false
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		called = true
		return "ok", nil
	}

	_, err := interceptor(context.Background(), nil, &grpc.UnaryServerInfo{}, handler)
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
	if !called {
		t.Error("handler was not called")
	}
}

func TestNewUnaryInterceptor_RequiredNoUser(t *testing.T) {
	config := Config{Enabled: true, Required: true}
	interceptor := NewUnaryInterceptor(config, testLogger())

	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		t.Error("handler should not be called")
		return nil, nil
	}

	_, err := interceptor(context.Background(), nil, &grpc.UnaryServerInfo{FullMethod: "/test"}, handler)
	if err == nil {
		t.Fatal("expected error")
	}

	if status.Code(err) != codes.Unauthenticated {
		t.Errorf("code = %v, want Unauthenticated", status.Code(err))
	}
}

func TestNewUnaryInterceptor_RequiredWithUser(t *testing.T) {
	config := Config{Enabled: true, Required: true}
	interceptor := NewUnaryInterceptor(config, testLogger())

	md := metadata.New(map[string]string{
		MetadataKeyUser:  "test@nvidia.com",
		MetadataKeyRoles: "osmo-user",
	})
	ctx := metadata.NewIncomingContext(context.Background(), md)

	var capturedInfo *Info
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		capturedInfo, _ = InfoFromContext(ctx)
		return "ok", nil
	}

	_, err := interceptor(ctx, nil, &grpc.UnaryServerInfo{FullMethod: "/test"}, handler)
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}

	if capturedInfo == nil {
		t.Fatal("auth info not in context")
	}
	if capturedInfo.User != "test@nvidia.com" {
		t.Errorf("User = %q, want test@nvidia.com", capturedInfo.User)
	}
}

func TestNewUnaryInterceptor_EnabledNotRequired(t *testing.T) {
	config := Config{Enabled: true, Required: false}
	interceptor := NewUnaryInterceptor(config, testLogger())

	called := false
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		called = true
		return "ok", nil
	}

	// No metadata - should still pass through
	_, err := interceptor(context.Background(), nil, &grpc.UnaryServerInfo{FullMethod: "/test"}, handler)
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
	if !called {
		t.Error("handler was not called")
	}
}

// mockServerStream is a minimal mock for grpc.ServerStream.
type mockServerStream struct {
	grpc.ServerStream
	ctx context.Context
}

func (m *mockServerStream) Context() context.Context {
	return m.ctx
}

func TestNewStreamInterceptor_DevMode(t *testing.T) {
	config := Config{DevMode: true}
	interceptor := NewStreamInterceptor(config, testLogger())

	called := false
	handler := func(srv interface{}, stream grpc.ServerStream) error {
		called = true
		return nil
	}

	stream := &mockServerStream{ctx: context.Background()}
	err := interceptor(nil, stream, &grpc.StreamServerInfo{}, handler)
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
	if !called {
		t.Error("handler was not called")
	}
}

func TestNewStreamInterceptor_RequiredNoUser(t *testing.T) {
	config := Config{Enabled: true, Required: true}
	interceptor := NewStreamInterceptor(config, testLogger())

	handler := func(srv interface{}, stream grpc.ServerStream) error {
		t.Error("handler should not be called")
		return nil
	}

	stream := &mockServerStream{ctx: context.Background()}
	err := interceptor(nil, stream, &grpc.StreamServerInfo{FullMethod: "/test"}, handler)
	if err == nil {
		t.Fatal("expected error")
	}

	if status.Code(err) != codes.Unauthenticated {
		t.Errorf("code = %v, want Unauthenticated", status.Code(err))
	}
}

func TestNewStreamInterceptor_RequiredWithUser(t *testing.T) {
	config := Config{Enabled: true, Required: true}
	interceptor := NewStreamInterceptor(config, testLogger())

	md := metadata.New(map[string]string{
		MetadataKeyUser:  "test@nvidia.com",
		MetadataKeyRoles: "osmo-user,osmo-admin",
	})
	ctx := metadata.NewIncomingContext(context.Background(), md)

	var capturedInfo *Info
	handler := func(srv interface{}, stream grpc.ServerStream) error {
		capturedInfo, _ = InfoFromContext(stream.Context())
		return nil
	}

	stream := &mockServerStream{ctx: ctx}
	err := interceptor(nil, stream, &grpc.StreamServerInfo{FullMethod: "/test"}, handler)
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}

	if capturedInfo == nil {
		t.Fatal("auth info not in context")
	}
	if capturedInfo.User != "test@nvidia.com" {
		t.Errorf("User = %q, want test@nvidia.com", capturedInfo.User)
	}
	if !capturedInfo.IsAdmin() {
		t.Error("IsAdmin() = false, want true")
	}
}
