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

package taskgroup

import (
	"context"
	"encoding/json"
	"testing"

	corev1 "k8s.io/api/core/v1"
	schedulingv1 "k8s.io/api/scheduling/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"

	taskgroupv1alpha1 "go.corp.nvidia.com/osmo/apis/taskgroup/v1alpha1"
)

func TestKAIReconcilerCreatesPodsAndPodGroups(t *testing.T) {
	ctx := context.Background()
	kubernetesClient := newFakeClient(t)
	reconciler := NewKAIReconciler(kubernetesClient)
	otg := testOTG(taskgroupv1alpha1.ModeActive)

	if err := reconciler.ReconcileRuntime(ctx, otg); err != nil {
		t.Fatalf("ReconcileRuntime() error = %v", err)
	}

	pod := &corev1.Pod{}
	if err := kubernetesClient.Get(ctx, client.ObjectKey{
		Namespace: "default",
		Name:      "pod-a",
	}, pod); err != nil {
		t.Fatalf("Get(Pod) error = %v", err)
	}
	if got := pod.Labels[taskgroupv1alpha1.LabelGroupUUID]; got != "group-uuid" {
		t.Fatalf("group label = %q, want group-uuid", got)
	}
	if got := pod.Labels["kai.scheduler/queue"]; got != "queue-a" {
		t.Fatalf("kai queue label = %q, want queue-a", got)
	}
	if got := pod.Annotations["pod-group-name"]; got != "group-uuid" {
		t.Fatalf("pod-group-name annotation = %q, want group-uuid", got)
	}

	podGroup := &unstructured.Unstructured{}
	podGroup.SetAPIVersion("scheduling.run.ai/v2alpha2")
	podGroup.SetKind("PodGroup")
	if err := kubernetesClient.Get(ctx, client.ObjectKey{
		Namespace: "default",
		Name:      "group-uuid",
	}, podGroup); err != nil {
		t.Fatalf("Get(PodGroup) error = %v", err)
	}
	secret := &corev1.Secret{}
	if err := kubernetesClient.Get(ctx, client.ObjectKey{
		Namespace: "default",
		Name:      "secret-a",
	}, secret); err != nil {
		t.Fatalf("Get(Secret) error = %v", err)
	}
	if len(secret.OwnerReferences) != 1 {
		t.Fatalf("secret owner references = %d, want 1", len(secret.OwnerReferences))
	}
}

func TestKAIReconcilerTreatsAlreadyExistsAsSuccess(t *testing.T) {
	ctx := context.Background()
	existingPod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "pod-a", Namespace: "default"},
	}
	kubernetesClient := newFakeClient(t, existingPod)
	reconciler := NewKAIReconciler(kubernetesClient)

	if err := reconciler.ReconcileRuntime(ctx, testOTG(taskgroupv1alpha1.ModeActive)); err != nil {
		t.Fatalf("ReconcileRuntime() error = %v", err)
	}
}

func TestKAIReconcilerShadowModeDoesNotCreateWorkloads(t *testing.T) {
	ctx := context.Background()
	kubernetesClient := newFakeClient(t)
	reconciler := NewKAIReconciler(kubernetesClient)

	if err := reconciler.ReconcileRuntime(ctx, testOTG(taskgroupv1alpha1.ModeShadow)); err != nil {
		t.Fatalf("ReconcileRuntime() error = %v", err)
	}

	pod := &corev1.Pod{}
	err := kubernetesClient.Get(ctx, client.ObjectKey{Namespace: "default", Name: "pod-a"}, pod)
	if !apierrors.IsNotFound(err) {
		t.Fatalf("Get(Pod) error = %v, want NotFound", err)
	}
}

func TestKAIReconcilerDoesNotNamespaceOrOwnClusterScopedResources(t *testing.T) {
	ctx := context.Background()
	existingPriorityClass := &schedulingv1.PriorityClass{
		ObjectMeta: metav1.ObjectMeta{Name: "priority-a"},
	}
	kubernetesClient := newFakeClient(t, existingPriorityClass)
	reconciler := NewKAIReconciler(kubernetesClient)
	otg := testOTG(taskgroupv1alpha1.ModeActive)
	otg.Spec.RuntimeConfig = runtime.RawExtension{Raw: []byte(`{
		"kai": {
			"resources": [
				{
					"apiVersion": "scheduling.k8s.io/v1",
					"kind": "PriorityClass",
					"metadata": {"name": "priority-a", "namespace": "must-be-cleared"},
					"value": 1000,
					"globalDefault": false
				}
			],
			"resourceOrder": [
				{"apiVersion": "scheduling.k8s.io/v1", "kind": "PriorityClass", "name": "priority-a", "scope": "Cluster", "source": "resource"}
			]
		}
	}`)}

	if err := reconciler.ReconcileRuntime(ctx, otg); err != nil {
		t.Fatalf("ReconcileRuntime() error = %v", err)
	}

	priorityClass := &schedulingv1.PriorityClass{}
	if err := kubernetesClient.Get(ctx, client.ObjectKey{Name: "priority-a"}, priorityClass); err != nil {
		t.Fatalf("Get(PriorityClass) error = %v", err)
	}
	if priorityClass.Namespace != "" {
		t.Fatalf("priority class namespace = %q, want empty", priorityClass.Namespace)
	}
	if len(priorityClass.OwnerReferences) != 0 {
		t.Fatalf("priority class owner references = %d, want 0", len(priorityClass.OwnerReferences))
	}
}

func TestKAIReconcilerRequiresClusterScopedResourcesToExist(t *testing.T) {
	ctx := context.Background()
	reconciler := NewKAIReconciler(newFakeClient(t))
	otg := testOTG(taskgroupv1alpha1.ModeActive)
	otg.Spec.RuntimeConfig = runtime.RawExtension{Raw: []byte(`{
		"kai": {
			"resources": [
				{
					"apiVersion": "scheduling.k8s.io/v1",
					"kind": "PriorityClass",
					"metadata": {"name": "missing-priority"},
					"value": 1000,
					"globalDefault": false
				}
			],
			"resourceOrder": [
				{"apiVersion": "scheduling.k8s.io/v1", "kind": "PriorityClass", "name": "missing-priority", "scope": "Cluster", "source": "resource"}
			]
		}
	}`)}

	if err := reconciler.ReconcileRuntime(ctx, otg); err == nil {
		t.Fatal("ReconcileRuntime() succeeded, want missing cluster resource error")
	}
}

func TestKAIReconcilerRejectsUnsupportedResources(t *testing.T) {
	ctx := context.Background()
	reconciler := NewKAIReconciler(newFakeClient(t))
	otg := testOTG(taskgroupv1alpha1.ModeActive)
	otg.Spec.RuntimeConfig = runtime.RawExtension{Raw: []byte(`{
		"kai": {
			"resources": [
				{
					"apiVersion": "rbac.authorization.k8s.io/v1",
					"kind": "ClusterRole",
					"metadata": {"name": "not-allowed"}
				}
			],
			"resourceOrder": [
				{"apiVersion": "rbac.authorization.k8s.io/v1", "kind": "ClusterRole", "name": "not-allowed", "scope": "Cluster", "source": "resource"}
			]
		}
	}`)}

	if err := reconciler.ReconcileRuntime(ctx, otg); err == nil {
		t.Fatal("ReconcileRuntime() succeeded, want unsupported resource error")
	}
}

func TestKAIStatusMapperAggregatesPodPhases(t *testing.T) {
	ctx := context.Background()
	existingPod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "pod-a",
			Namespace: "default",
			Labels: map[string]string{
				"osmo.workflow_uuid": "workflow-uuid",
				"osmo.task_uuid":     "task-uuid",
				"osmo.retry_id":      "3",
			},
		},
		Spec: corev1.PodSpec{
			NodeName:   "node-a",
			Containers: []corev1.Container{{Name: "user", Image: "busybox"}},
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
			PodIP: "10.0.0.1",
		},
	}
	kubernetesClient := newFakeClient(t, existingPod)
	reconciler := NewKAIReconciler(kubernetesClient)

	status, err := reconciler.MapStatus(ctx, testOTG(taskgroupv1alpha1.ModeActive))
	if err != nil {
		t.Fatalf("MapStatus() error = %v", err)
	}
	if status.Phase != taskgroupv1alpha1.PhaseRunning {
		t.Fatalf("phase = %q, want %q", status.Phase, taskgroupv1alpha1.PhaseRunning)
	}
	if status.PodSummary.Running != 1 {
		t.Fatalf("running pods = %d, want 1", status.PodSummary.Running)
	}
	var runtimeStatus struct {
		TaskStatusUpdates []taskStatusUpdateReport `json:"task_status_updates"`
	}
	if err := json.Unmarshal(status.RuntimeStatus.Raw, &runtimeStatus); err != nil {
		t.Fatalf("Unmarshal(runtimeStatus) error = %v", err)
	}
	if len(runtimeStatus.TaskStatusUpdates) != 1 {
		t.Fatalf("task status updates = %d, want 1", len(runtimeStatus.TaskStatusUpdates))
	}
	if got := runtimeStatus.TaskStatusUpdates[0].Status; got != "RUNNING" {
		t.Fatalf("task status = %q, want RUNNING", got)
	}
}

func TestKAIStatusMapperReportsContainerFailureReasons(t *testing.T) {
	ctx := context.Background()
	existingPod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "pod-a",
			Namespace: "default",
			Labels: map[string]string{
				"osmo.workflow_uuid": "workflow-uuid",
				"osmo.task_uuid":     "task-uuid",
				"osmo.retry_id":      "0",
			},
		},
		Spec: corev1.PodSpec{
			NodeName:   "node-a",
			Containers: []corev1.Container{{Name: "user", Image: "busybox"}},
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodPending,
			ContainerStatuses: []corev1.ContainerStatus{
				{
					Name: "user",
					State: corev1.ContainerState{
						Waiting: &corev1.ContainerStateWaiting{
							Reason:  "ImagePullBackOff",
							Message: "image pull failed",
						},
					},
				},
			},
		},
	}
	kubernetesClient := newFakeClient(t, existingPod)
	reconciler := NewKAIReconciler(kubernetesClient)

	status, err := reconciler.MapStatus(ctx, testOTG(taskgroupv1alpha1.ModeActive))
	if err != nil {
		t.Fatalf("MapStatus() error = %v", err)
	}
	var runtimeStatus struct {
		TaskStatusUpdates []taskStatusUpdateReport `json:"task_status_updates"`
	}
	if err := json.Unmarshal(status.RuntimeStatus.Raw, &runtimeStatus); err != nil {
		t.Fatalf("Unmarshal(runtimeStatus) error = %v", err)
	}
	if got := runtimeStatus.TaskStatusUpdates[0].Status; got != "FAILED_IMAGE_PULL" {
		t.Fatalf("task status = %q, want FAILED_IMAGE_PULL", got)
	}
}

func testOTG(mode string) *taskgroupv1alpha1.OSMOTaskGroup {
	return &taskgroupv1alpha1.OSMOTaskGroup{
		ObjectMeta: metav1.ObjectMeta{
			Name:        "otg-a",
			Namespace:   "default",
			UID:         "otg-uid",
			Annotations: map[string]string{taskgroupv1alpha1.AnnotationMode: mode},
		},
		Spec: taskgroupv1alpha1.OSMOTaskGroupSpec{
			WorkflowID:   "workflow-a",
			WorkflowUUID: "workflow-uuid",
			GroupName:    "group-a",
			GroupUUID:    "group-uuid",
			RuntimeType:  taskgroupv1alpha1.RuntimeTypeKAI,
			RuntimeConfig: runtime.RawExtension{Raw: []byte(`{
				"kai": {
					"resources": [
						{
							"apiVersion": "v1",
							"kind": "Secret",
							"metadata": {"name": "secret-a"},
							"stringData": {"key": "value"}
						}
					],
					"group": {
						"name": "group-uuid",
						"queue": "queue-a",
						"minMember": 1
					},
					"podTemplates": [
						{
							"name": "pod-a",
							"labels": {},
							"annotations": {},
							"spec": {
								"restartPolicy": "Never",
								"schedulerName": "kai-scheduler",
								"containers": [{"name": "user", "image": "busybox"}]
							}
						}
					],
					"resourceOrder": [
						{"apiVersion": "v1", "kind": "Secret", "name": "secret-a", "source": "resource"},
						{"apiVersion": "scheduling.run.ai/v2alpha2", "kind": "PodGroup", "name": "group-uuid", "source": "group"},
						{"apiVersion": "v1", "kind": "Pod", "name": "pod-a", "source": "podTemplate"}
					]
				}
			}`)},
		},
	}
}

func newFakeClient(t *testing.T, objects ...client.Object) client.Client {
	t.Helper()
	scheme := runtime.NewScheme()
	if err := corev1.AddToScheme(scheme); err != nil {
		t.Fatalf("AddToScheme() error = %v", err)
	}
	if err := schedulingv1.AddToScheme(scheme); err != nil {
		t.Fatalf("AddToScheme() error = %v", err)
	}
	if err := taskgroupv1alpha1.AddToScheme(scheme); err != nil {
		t.Fatalf("AddToScheme() error = %v", err)
	}
	return fake.NewClientBuilder().
		WithScheme(scheme).
		WithStatusSubresource(&taskgroupv1alpha1.OSMOTaskGroup{}).
		WithObjects(objects...).
		Build()
}
