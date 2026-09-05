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

	envoy_api_v3_core "github.com/envoyproxy/go-control-plane/envoy/config/core/v3"
	envoy_service_auth_v3 "github.com/envoyproxy/go-control-plane/envoy/service/auth/v3"
	"google.golang.org/grpc/codes"

	"go.corp.nvidia.com/osmo/service/authz_sidecar/server"
	"go.corp.nvidia.com/osmo/tests/common/database"
	"go.corp.nvidia.com/osmo/utils/roles"
)

func runtimeAuthorityRequest(user, workflowID, roleNames string) *envoy_service_auth_v3.CheckRequest {
	return &envoy_service_auth_v3.CheckRequest{
		Attributes: &envoy_service_auth_v3.AttributeContext{
			Request: &envoy_service_auth_v3.AttributeContext_Request{
				Http: &envoy_service_auth_v3.AttributeContext_HttpRequest{
					Path:   "/api/workflow/" + workflowID,
					Method: "GET",
					Headers: map[string]string{
						"x-osmo-user":  user,
						"x-osmo-roles": roleNames,
					},
				},
			},
			Source: &envoy_service_auth_v3.AttributeContext_Peer{
				Address: &envoy_api_v3_core.Address{},
			},
		},
	}
}

func requireAuthzCode(
	t *testing.T, authzServer *server.AuthzServer,
	request *envoy_service_auth_v3.CheckRequest, expected codes.Code,
) {
	t.Helper()
	response, err := authzServer.Check(context.Background(), request)
	if err != nil {
		t.Fatalf("Check() returned an error: %v", err)
	}
	if actual := codes.Code(response.Status.Code); actual != expected {
		t.Fatalf("Check() status = %v, want %v", actual, expected)
	}
}

func TestRuntimeStateCannotOverrideConfigMapAuthority(t *testing.T) {
	postgresFixture := database.StartPostgresWithSchema(t)
	postgresFixture.ResetSchema(t)
	postgresFixture.ExecSQLFile(t, "testdata/seed.sql")

	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))
	fileStore := roles.NewFileRoleStore("testdata/config.yaml", logger)
	if err := fileStore.Load(); err != nil {
		t.Fatalf("load ConfigMap authority: %v", err)
	}
	authzServer := server.NewFileBackedAuthzServer(
		fileStore, postgresFixture.Client, logger)

	t.Run("external mapping uses runtime workflow pool", func(t *testing.T) {
		requireAuthzCode(t, authzServer,
			runtimeAuthorityRequest("external@example.com", "team-a-workflow", "team-a-group"),
			codes.OK)
		requireAuthzCode(t, authzServer,
			runtimeAuthorityRequest("external@example.com", "team-b-workflow", "team-a-group"),
			codes.PermissionDenied)
	})

	t.Run("manual assignment is retained", func(t *testing.T) {
		requireAuthzCode(t, authzServer,
			runtimeAuthorityRequest("manual@example.com", "team-a-workflow", ""),
			codes.OK)
	})

	t.Run("historical idp sync assignment is inert", func(t *testing.T) {
		requireAuthzCode(t, authzServer,
			runtimeAuthorityRequest("idp-sync@example.com", "team-a-workflow", ""),
			codes.PermissionDenied)
	})

	t.Run("database-only role and mapping are inert", func(t *testing.T) {
		requireAuthzCode(t, authzServer,
			runtimeAuthorityRequest("db-only@example.com", "team-a-workflow", "db-admin-group"),
			codes.PermissionDenied)
	})
}
