// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

package taskgroupstatusreceiver

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	pb "go.corp.nvidia.com/osmo/proto/operator"
	"google.golang.org/grpc/metadata"
)

func TestReportOTGStatusForwardsTaskUpdates(t *testing.T) {
	t.Setenv(statusTokenEnv, "status-token")
	var payload reportPayload
	httpServer := httptest.NewServer(http.HandlerFunc(func(
		response http.ResponseWriter,
		request *http.Request,
	) {
		if request.URL.Path != "/api/internal/taskgroup/status" {
			t.Fatalf("path = %q, want /api/internal/taskgroup/status", request.URL.Path)
		}
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatalf("Decode() error = %v", err)
		}
		response.WriteHeader(http.StatusOK)
	}))
	defer httpServer.Close()

	server := NewServer(httpServer.URL+"/api/internal/taskgroup/status", httpServer.Client())
	_, err := server.ReportOTGStatus(authenticatedContext(), &pb.ReportOTGStatusRequest{
		Namespace:    "default",
		Name:         "otg-a",
		WorkflowUuid: "workflow-uuid",
		GroupUuid:    "group-uuid",
		Phase:        "Running",
		TaskStatusUpdates: []*pb.TaskStatusUpdate{
			{
				WorkflowUuid: "workflow-uuid",
				TaskUuid:     "task-uuid",
				RetryId:      2,
				Container:    "user",
				Node:         "node-a",
				PodIp:        "10.0.0.1",
				Status:       "RUNNING",
				ExitCode:     -1,
			},
		},
	})
	if err != nil {
		t.Fatalf("ReportOTGStatus() error = %v", err)
	}
	if len(payload.TaskStatusUpdates) != 1 {
		t.Fatalf("task updates = %d, want 1", len(payload.TaskStatusUpdates))
	}
	if got := payload.TaskStatusUpdates[0].TaskUUID; got != "task-uuid" {
		t.Fatalf("task uuid = %q, want task-uuid", got)
	}
}

func TestReportOTGStatusSendsConfiguredToken(t *testing.T) {
	t.Setenv(statusTokenEnv, "status-token")
	gotToken := ""
	httpServer := httptest.NewServer(http.HandlerFunc(func(
		response http.ResponseWriter,
		request *http.Request,
	) {
		gotToken = request.Header.Get("x-osmo-taskgroup-status-token")
		response.WriteHeader(http.StatusOK)
	}))
	defer httpServer.Close()

	server := NewServer(httpServer.URL, httpServer.Client())
	_, err := server.ReportOTGStatus(authenticatedContext(), &pb.ReportOTGStatusRequest{})
	if err != nil {
		t.Fatalf("ReportOTGStatus() error = %v", err)
	}
	if gotToken != "status-token" {
		t.Fatalf("status token = %q, want status-token", gotToken)
	}
}

func TestReportOTGStatusSuppressesDuplicateReports(t *testing.T) {
	t.Setenv(statusTokenEnv, "status-token")
	requests := 0
	httpServer := httptest.NewServer(http.HandlerFunc(func(
		response http.ResponseWriter,
		request *http.Request,
	) {
		requests++
		response.WriteHeader(http.StatusOK)
	}))
	defer httpServer.Close()

	server := NewServer(httpServer.URL, httpServer.Client())
	report := &pb.ReportOTGStatusRequest{
		Namespace: "default",
		Name:      "otg-a",
		Phase:     "Running",
	}
	for i := 0; i < 2; i++ {
		if _, err := server.ReportOTGStatus(authenticatedContext(), report); err != nil {
			t.Fatalf("ReportOTGStatus() error = %v", err)
		}
	}
	if requests != 1 {
		t.Fatalf("API requests = %d, want 1", requests)
	}
}

func TestReportOTGStatusSuppressesReportsWithOnlyStatusJSONChanges(t *testing.T) {
	t.Setenv(statusTokenEnv, "status-token")
	requests := 0
	httpServer := httptest.NewServer(http.HandlerFunc(func(
		response http.ResponseWriter,
		request *http.Request,
	) {
		requests++
		response.WriteHeader(http.StatusOK)
	}))
	defer httpServer.Close()

	server := NewServer(httpServer.URL, httpServer.Client())
	for _, statusJSON := range []string{
		`{"conditions":[{"lastTransitionTime":"2026-05-14T00:00:00Z"}]}`,
		`{"conditions":[{"lastTransitionTime":"2026-05-14T00:01:00Z"}]}`,
	} {
		_, err := server.ReportOTGStatus(authenticatedContext(), &pb.ReportOTGStatusRequest{
			Namespace:  "default",
			Name:       "otg-a",
			Phase:      "Running",
			StatusJson: statusJSON,
		})
		if err != nil {
			t.Fatalf("ReportOTGStatus() error = %v", err)
		}
	}
	if requests != 1 {
		t.Fatalf("API requests = %d, want 1", requests)
	}
}

func TestReportOTGStatusDoesNotSuppressFailedReports(t *testing.T) {
	t.Setenv(statusTokenEnv, "status-token")
	requests := 0
	httpServer := httptest.NewServer(http.HandlerFunc(func(
		response http.ResponseWriter,
		request *http.Request,
	) {
		requests++
		http.Error(response, "failed", http.StatusBadGateway)
	}))
	defer httpServer.Close()

	server := NewServer(httpServer.URL, httpServer.Client())
	report := &pb.ReportOTGStatusRequest{Namespace: "default", Name: "otg-a"}
	for i := 0; i < 2; i++ {
		_, err := server.ReportOTGStatus(authenticatedContext(), report)
		if err == nil {
			t.Fatal("ReportOTGStatus() error = nil, want error")
		}
	}
	if requests != 2 {
		t.Fatalf("API requests = %d, want 2", requests)
	}
}

func TestReportOTGStatusRejectsMissingToken(t *testing.T) {
	t.Setenv(statusTokenEnv, "status-token")
	server := NewServer("http://example.invalid", nil)
	_, err := server.ReportOTGStatus(context.Background(), &pb.ReportOTGStatusRequest{})
	if err == nil {
		t.Fatal("ReportOTGStatus() error = nil, want error")
	}
}

func TestReportOTGStatusReturnsAPIError(t *testing.T) {
	t.Setenv(statusTokenEnv, "status-token")
	httpServer := httptest.NewServer(http.HandlerFunc(func(
		response http.ResponseWriter,
		request *http.Request,
	) {
		http.Error(response, "rejected", http.StatusBadGateway)
	}))
	defer httpServer.Close()

	server := NewServer(httpServer.URL, httpServer.Client())
	_, err := server.ReportOTGStatus(authenticatedContext(), &pb.ReportOTGStatusRequest{})
	if err == nil {
		t.Fatal("ReportOTGStatus() error = nil, want error")
	}
}

func authenticatedContext() context.Context {
	return metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"x-osmo-taskgroup-status-token",
		"status-token",
	))
}
