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

package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"testing"
	"time"

	envoy_service_auth_v3 "github.com/envoyproxy/go-control-plane/envoy/service/auth/v3"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/health/grpc_health_v1"
)

var (
	authzAddr string
)

func init() {
	flag.StringVar(&authzAddr, "authz-addr", "localhost:50052",
		"Address of the authz_sidecar gRPC service")
}

// TestMain allows us to run the test as a standalone program with `bazel run`
func TestMain(m *testing.M) {
	flag.Parse()

	// If flag wasn't set, ensure we have the default
	if authzAddr == "" {
		authzAddr = "localhost:50052"
	}

	os.Exit(m.Run())
}

// TestAuthzSidecarHealth verifies the health check endpoint is working
func TestAuthzSidecarHealth(t *testing.T) {
	// Connect to the authz_sidecar service
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	conn, err := grpc.DialContext(ctx, authzAddr,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithBlock(),
	)
	if err != nil {
		t.Fatalf("Failed to connect to authz_sidecar at %s: %v\n"+
			"Make sure the service is running with: "+
			"bazel run //src/service/authz_sidecar:authz_sidecar_bin_x86_64",
			authzAddr, err)
	}
	defer conn.Close()

	// Create health check client
	healthClient := grpc_health_v1.NewHealthClient(conn)

	// Check health
	healthReq := &grpc_health_v1.HealthCheckRequest{
		Service: "",
	}

	healthResp, err := healthClient.Check(ctx, healthReq)
	if err != nil {
		t.Fatalf("Health check failed: %v", err)
	}

	if healthResp.Status != grpc_health_v1.HealthCheckResponse_SERVING {
		t.Fatalf("Service not serving: status=%v", healthResp.Status)
	}

	fmt.Printf("✓ Health check passed: service is SERVING\n")
}

// TestAuthzSidecarBasicRole verifies basic role-based authorization
func TestAuthzSidecarBasicRole(t *testing.T) {
	// Connect to the authz_sidecar service
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	conn, err := grpc.DialContext(ctx, authzAddr,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithBlock(),
	)
	if err != nil {
		t.Fatalf("Failed to connect to authz_sidecar at %s: %v", authzAddr, err)
	}
	defer conn.Close()

	// Create authorization client
	authzClient := envoy_service_auth_v3.NewAuthorizationClient(conn)

	// Test cases
	tests := []struct {
		name          string
		path          string
		method        string
		user          string
		roles         string
		expectAllowed bool
		description   string
	}{
		{
			name:          "default role can access version endpoint",
			path:          "/api/version",
			method:        "GET",
			user:          "test-user",
			roles:         "",
			expectAllowed: true,
			description: "All users get osmo-default role which should allow access to " +
				"/api/version",
		},
		{
			name:          "default role cannot access workflow endpoint",
			path:          "/api/workflow",
			method:        "GET",
			user:          "test-user",
			roles:         "",
			expectAllowed: false,
			description:   "osmo-default role should NOT allow access to /api/workflow",
		},
		{
			name:          "user role can access workflow endpoint",
			path:          "/api/workflow",
			method:        "GET",
			user:          "test-user",
			roles:         "osmo-user",
			expectAllowed: true,
			description:   "osmo-user role should allow access to /api/workflow",
		},
		{
			name:          "user role can access workflow with ID",
			path:          "/api/workflow/abc-123",
			method:        "POST",
			user:          "test-user",
			roles:         "osmo-user",
			expectAllowed: true,
			description:   "osmo-user role should allow access to /api/workflow/* paths",
		},
	}

	passCount := 0
	failCount := 0

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Create authorization check request
			req := &envoy_service_auth_v3.CheckRequest{
				Attributes: &envoy_service_auth_v3.AttributeContext{
					Request: &envoy_service_auth_v3.AttributeContext_Request{
						Http: &envoy_service_auth_v3.AttributeContext_HttpRequest{
							Path:   tt.path,
							Method: tt.method,
							Headers: map[string]string{
								"x-osmo-user":  tt.user,
								"x-osmo-roles": tt.roles,
							},
						},
					},
				},
			}

			// Make the check request
			resp, err := authzClient.Check(ctx, req)
			if err != nil {
				t.Fatalf("Authorization check failed: %v", err)
			}

			// Check if the result matches expectation
			isAllowed := resp.Status.Code == 0 // codes.OK = 0

			if isAllowed != tt.expectAllowed {
				t.Errorf("Authorization mismatch:\n"+
					"  Path: %s\n"+
					"  Method: %s\n"+
					"  Roles: %s\n"+
					"  Expected: %v\n"+
					"  Got: %v\n"+
					"  Description: %s",
					tt.path, tt.method, tt.roles,
					tt.expectAllowed, isAllowed,
					tt.description)
				failCount++
			} else {
				passCount++
				allowStr := "DENIED"
				if isAllowed {
					allowStr = "ALLOWED"
				}
				fmt.Printf("✓ %s: %s %s (roles: %s) - %s\n",
					tt.name, tt.method, tt.path, tt.roles, allowStr)
			}
		})
	}

	fmt.Printf("\n")
	fmt.Printf("╔══════════════════════════════════════════════════════════════╗\n")
	fmt.Printf("║              Authorization Test Summary                      ║\n")
	fmt.Printf("╠══════════════════════════════════════════════════════════════╣\n")
	fmt.Printf("║  Total Tests: %2d                                             ║\n",
		passCount+failCount)
	fmt.Printf("║  Passed:      %2d                                             ║\n", passCount)
	fmt.Printf("║  Failed:      %2d                                             ║\n", failCount)
	fmt.Printf("╚══════════════════════════════════════════════════════════════╝\n")

	if failCount > 0 {
		t.Fatalf("%d test(s) failed", failCount)
	}
}
