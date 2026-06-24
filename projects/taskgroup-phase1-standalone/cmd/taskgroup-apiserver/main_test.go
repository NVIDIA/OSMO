package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	taskgroupv1alpha1 "example.com/taskgroup-phase1-standalone/api/taskgroup/v1alpha1"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
)

func TestSubmitWorkflowCreatesPhase1Workflow(t *testing.T) {
	kubeClient := fake.NewClientBuilder().WithScheme(runtime.NewScheme()).Build()
	s := &server{client: kubeClient, namespace: "osmo-workflows"}
	body := []byte(`{
		"clusterID": "osmo-prod-backend",
		"namespace": "osmo-phase1a",
		"mode": "active",
		"owner": "codex-test",
		"taskGroups": [{
			"name": "ray-cpu-smoke",
			"runtimeType": "ray",
			"runtimeConfig": {
				"ray": {
					"mode": "job",
					"rayVersion": "2.9.0",
					"head": {"image": "rayproject/ray:2.9.0-py310"},
					"job": {"entrypoint": "python -c 'print(1)'"}
				}
			}
		}]
	}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/workflows", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer token")
	rec := httptest.NewRecorder()

	s.submitWorkflow(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d body = %s", rec.Code, rec.Body.String())
	}
	var response map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	workflow := &unstructured.Unstructured{}
	workflow.SetGroupVersionKind(workflowGVK)
	if err := kubeClient.Get(req.Context(), client.ObjectKey{Namespace: "osmo-workflows", Name: response["name"]}, workflow); err != nil {
		t.Fatalf("get created workflow: %v", err)
	}
	if workflow.GetKind() != "Workflow" {
		t.Fatalf("kind = %q, want Workflow", workflow.GetKind())
	}
	if got := workflow.GetLabels()[taskgroupv1alpha1.ControllerOwnerLabel]; got != taskgroupv1alpha1.ControllerOwnerPhase1A {
		t.Fatalf("controller owner label = %q, want %q", got, taskgroupv1alpha1.ControllerOwnerPhase1A)
	}
	clusterID, _, _ := unstructured.NestedString(workflow.Object, "spec", "clusterID")
	if clusterID != "osmo-prod-backend" {
		t.Fatalf("spec.clusterID = %q", clusterID)
	}
	namespace, _, _ := unstructured.NestedString(workflow.Object, "spec", "namespace")
	if namespace != "osmo-phase1a" {
		t.Fatalf("spec.namespace = %q", namespace)
	}
	_, found, _ := unstructured.NestedSlice(workflow.Object, "spec", "taskGroups")
	if !found {
		t.Fatalf("spec.taskGroups not set: %#v", workflow.Object["spec"])
	}
	_, found, _ = unstructured.NestedSlice(workflow.Object, "spec", "groups")
	if found {
		t.Fatalf("legacy spec.groups should not be set: %#v", workflow.Object["spec"])
	}
}

func TestReqSpecRejectsLegacyGroups(t *testing.T) {
	_, err := reqSpec(&submitWorkflowRequest{
		ClusterID: "osmo-prod-backend",
		Namespace: "osmo-phase1a",
	})
	if err == nil {
		t.Fatal("expected taskGroups validation error")
	}
}

func TestSubmitLegacyWorkflowCreatesOSMOContainerGroupWorkflow(t *testing.T) {
	kubeClient := fake.NewClientBuilder().WithScheme(runtime.NewScheme()).Build()
	s := &server{client: kubeClient, namespace: "osmo-workflows"}
	body := []byte(`workflow:
  name: hello-osmo
  resources:
    default:
      cpu: 1
      memory: 1Gi
      storage: 1Gi
  tasks:
  - name: hello
    image: ubuntu:24.04
    command: ["echo"]
    args: ["Hello from OSMO!"]
`)
	req := httptest.NewRequest(http.MethodPost, "/v1/workflows", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer token")
	rec := httptest.NewRecorder()

	s.submitWorkflow(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d body = %s", rec.Code, rec.Body.String())
	}
	var response map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	workflow := &unstructured.Unstructured{}
	workflow.SetGroupVersionKind(workflowGVK)
	if err := kubeClient.Get(req.Context(), client.ObjectKey{Namespace: "osmo-workflows", Name: response["name"]}, workflow); err != nil {
		t.Fatalf("get created workflow: %v", err)
	}
	if got := workflow.GetLabels()[taskgroupv1alpha1.ControllerOwnerLabel]; got != taskgroupv1alpha1.ControllerOwnerPhase1A {
		t.Fatalf("controller owner label = %q, want %q", got, taskgroupv1alpha1.ControllerOwnerPhase1A)
	}
	clusterID, _, _ := unstructured.NestedString(workflow.Object, "spec", "clusterID")
	if clusterID != "osmo-backend" {
		t.Fatalf("spec.clusterID = %q", clusterID)
	}
	namespace, _, _ := unstructured.NestedString(workflow.Object, "spec", "namespace")
	if namespace != "osmo-phase1a" {
		t.Fatalf("spec.namespace = %q", namespace)
	}
	workflowName, _, _ := unstructured.NestedString(workflow.Object, "spec", "workflowName")
	if workflowName != "hello-osmo" {
		t.Fatalf("spec.workflowName = %q", workflowName)
	}
	groups, found, _ := unstructured.NestedSlice(workflow.Object, "spec", "taskGroups")
	if !found || len(groups) != 1 {
		t.Fatalf("spec.taskGroups = %#v", groups)
	}
	group := groups[0].(map[string]any)
	if got := group["runtimeType"]; got != taskgroupv1alpha1.RuntimeTypeOSMOContainerGroup {
		t.Fatalf("runtimeType = %q", got)
	}
	renderedObjects, found, _ := unstructured.NestedSlice(group, "runtimeConfig", taskgroupv1alpha1.RuntimeTypeOSMOContainerGroup, "renderedObjects")
	if !found || len(renderedObjects) != 1 {
		t.Fatalf("renderedObjects = %#v", renderedObjects)
	}
	pod := renderedObjects[0].(map[string]any)
	name, _, _ := unstructured.NestedString(pod, "metadata", "name")
	if !strings.HasPrefix(name, "hello-osmo-hello-") {
		t.Fatalf("pod name = %q, want hello-osmo-hello-*", name)
	}
	if len(name) <= len("hello-osmo-hello-") {
		t.Fatalf("pod name = %q, missing unique suffix", name)
	}
}

func TestReqSpecRejectsUnsupportedLegacyWorkflowFields(t *testing.T) {
	_, err := reqSpec(&submitWorkflowRequest{
		Workflow: map[string]any{
			"name": "serial-workflow",
			"tasks": []any{
				map[string]any{
					"name":  "task1",
					"image": "ubuntu:24.04",
					"files": []any{map[string]any{"path": "/tmp/run.sh"}},
				},
			},
		},
	})
	if err == nil || !strings.Contains(err.Error(), "unsupported field") {
		t.Fatalf("err = %v, want unsupported field error", err)
	}
}

func TestSubmitWorkflowDoesNotAllowOwnerLabelOverride(t *testing.T) {
	kubeClient := fake.NewClientBuilder().WithScheme(runtime.NewScheme()).Build()
	s := &server{client: kubeClient, namespace: "osmo-workflows"}
	body := []byte(`{
		"metadata": {"labels": {"workflow.osmo.nvidia.com/owner": "spoofed"}},
		"clusterID": "osmo-prod-backend",
		"namespace": "osmo-phase1a",
		"owner": "real-owner",
		"taskGroups": [{
			"name": "ray-cpu-smoke",
			"runtimeType": "ray",
			"runtimeConfig": {"ray": {"mode": "job", "rayVersion": "2.9.0", "head": {"image": "rayproject/ray:2.9.0-py310"}, "job": {"entrypoint": "python -c 'print(1)'"}}}
		}]
	}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/workflows", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer token")
	rec := httptest.NewRecorder()

	s.submitWorkflow(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d body = %s", rec.Code, rec.Body.String())
	}
	var response map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	workflow := &unstructured.Unstructured{}
	workflow.SetGroupVersionKind(workflowGVK)
	if err := kubeClient.Get(req.Context(), client.ObjectKey{Namespace: "osmo-workflows", Name: response["name"]}, workflow); err != nil {
		t.Fatalf("get created workflow: %v", err)
	}
	if got := workflow.GetLabels()[ownerLabel]; got != "real-owner" {
		t.Fatalf("owner label = %q, want real-owner", got)
	}
}
