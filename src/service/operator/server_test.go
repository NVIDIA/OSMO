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

package operator

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"k8s.io/apimachinery/pkg/runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"

	taskgroupv1alpha1 "go.corp.nvidia.com/osmo/apis/taskgroup/v1alpha1"
)

func TestCreateOTGAlreadyExistsIsSuccess(t *testing.T) {
	ctx := context.Background()
	existing := &taskgroupv1alpha1.OSMOTaskGroup{}
	existing.Name = "otg-a"
	existing.Namespace = "default"
	server := NewServer(newFakeClient(t, existing))

	response, err := server.CreateOTG(ctx, &CreateOTGRequest{
		Namespace: "default",
		Name:      "otg-a",
		OtgYaml:   validOTGYAML(),
	})
	if err != nil {
		t.Fatalf("CreateOTG() error = %v", err)
	}
	if response.Created {
		t.Fatal("Created = true, want false for idempotent already exists")
	}
}

func TestCreateAndDeleteOTG(t *testing.T) {
	ctx := context.Background()
	kubernetesClient := newFakeClient(t)
	server := NewServer(kubernetesClient)

	response, err := server.CreateOTG(ctx, &CreateOTGRequest{
		Namespace: "default",
		Name:      "otg-a",
		OtgYaml:   validOTGYAML(),
	})
	if err != nil {
		t.Fatalf("CreateOTG() error = %v", err)
	}
	if !response.Created {
		t.Fatal("Created = false, want true")
	}

	deleteResponse, err := server.DeleteOTG(ctx, &DeleteOTGRequest{
		Namespace: "default",
		Name:      "otg-a",
	})
	if err != nil {
		t.Fatalf("DeleteOTG() error = %v", err)
	}
	if !deleteResponse.Deleted {
		t.Fatal("Deleted = false, want true")
	}
}

func TestGetOTGStatus(t *testing.T) {
	ctx := context.Background()
	existing := &taskgroupv1alpha1.OSMOTaskGroup{}
	existing.Name = "otg-a"
	existing.Namespace = "default"
	existing.Status.Phase = taskgroupv1alpha1.PhaseRunning
	server := NewServer(newFakeClient(t, existing))

	response, err := server.GetOTGStatus(ctx, &GetOTGStatusRequest{
		Namespace: "default",
		Name:      "otg-a",
	})
	if err != nil {
		t.Fatalf("GetOTGStatus() error = %v", err)
	}
	if response.Phase != string(taskgroupv1alpha1.PhaseRunning) {
		t.Fatalf("Phase = %q, want Running", response.Phase)
	}
	if !strings.Contains(response.StatusJson, `"phase":"Running"`) {
		t.Fatalf("StatusJson = %s, want phase", response.StatusJson)
	}
}

func TestHTTPCreateOTG(t *testing.T) {
	server := NewServer(newFakeClient(t))
	request := httptest.NewRequest(
		http.MethodPost,
		"/v1/otg/create",
		strings.NewReader(`{"namespace":"default","name":"otg-a","otg_yaml":`+
			`"apiVersion: workflow.osmo.nvidia.com/v1alpha1\nkind: OSMOTaskGroup\nspec:\n  runtimeType: kai\n  runtimeConfig:\n    resources: []\n"}`),
	)
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()

	NewHTTPHandler(server).ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.Code)
	}
}

func validOTGYAML() string {
	return `
apiVersion: workflow.osmo.nvidia.com/v1alpha1
kind: OSMOTaskGroup
spec:
  runtimeType: kai
  runtimeConfig:
    resources: []
`
}

func newFakeClient(t *testing.T, objects ...client.Object) client.Client {
	t.Helper()
	scheme := runtime.NewScheme()
	if err := taskgroupv1alpha1.AddToScheme(scheme); err != nil {
		t.Fatalf("AddToScheme() error = %v", err)
	}
	return fake.NewClientBuilder().WithScheme(scheme).WithObjects(objects...).Build()
}
