// SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION. All rights reserved.
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

package main

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"go.corp.nvidia.com/osmo/operator/utils"
	pb "go.corp.nvidia.com/osmo/proto/operator"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// Test getPodKey function
func TestGetPodKey(t *testing.T) {
	tests := []struct {
		name     string
		pod      *corev1.Pod
		expected string
	}{
		{
			name: "Pod with all labels",
			pod: &corev1.Pod{
				ObjectMeta: metav1.ObjectMeta{
					Labels: map[string]string{
						"osmo.workflow_uuid": "wf-123",
						"osmo.task_uuid":     "task-456",
						"osmo.retry_id":      "2",
					},
				},
			},
			expected: "wf-123-task-456-2",
		},
		{
			name: "Pod without retry_id",
			pod: &corev1.Pod{
				ObjectMeta: metav1.ObjectMeta{
					Labels: map[string]string{
						"osmo.workflow_uuid": "wf-789",
						"osmo.task_uuid":     "task-012",
					},
				},
			},
			expected: "wf-789-task-012-0",
		},
		{
			name: "Pod with empty retry_id",
			pod: &corev1.Pod{
				ObjectMeta: metav1.ObjectMeta{
					Labels: map[string]string{
						"osmo.workflow_uuid": "wf-abc",
						"osmo.task_uuid":     "task-def",
						"osmo.retry_id":      "",
					},
				},
			},
			expected: "wf-abc-task-def-0",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := getPodKey(tt.pod)
			if result != tt.expected {
				t.Errorf("getPodKey() = %v, expected %v", result, tt.expected)
			}
		})
	}
}

// Test calculatePodStatus function
func TestCalculatePodStatus(t *testing.T) {
	tests := []struct {
		name     string
		pod      *corev1.Pod
		expected string
	}{
		{
			name: "Pending pod",
			pod: &corev1.Pod{
				Status: corev1.PodStatus{
					Phase: corev1.PodPending,
					Conditions: []corev1.PodCondition{
						{
							Type:   corev1.PodScheduled,
							Status: corev1.ConditionTrue,
						},
					},
				},
			},
			expected: "SCHEDULING", // Updated to match Python comprehensive logic
		},
		{
			name: "Scheduling pod",
			pod: &corev1.Pod{
				Status: corev1.PodStatus{
					Phase: corev1.PodPending,
					Conditions: []corev1.PodCondition{
						{
							Type:   corev1.PodScheduled,
							Status: corev1.ConditionFalse,
						},
					},
				},
			},
			expected: "SCHEDULING", // Updated to match Python comprehensive logic
		},
		{
			name: "Running pod - all ready",
			pod: &corev1.Pod{
				Status: corev1.PodStatus{
					Phase: corev1.PodRunning,
					ContainerStatuses: []corev1.ContainerStatus{
						{Ready: true},
						{Ready: true},
					},
				},
			},
			expected: "RUNNING", // Updated to match Python comprehensive logic
		},
		{
			name: "Starting pod - not all ready",
			pod: &corev1.Pod{
				Status: corev1.PodStatus{
					Phase: corev1.PodRunning,
					ContainerStatuses: []corev1.ContainerStatus{
						{Ready: true},
						{Ready: false},
					},
				},
			},
			expected: "RUNNING", // Updated: comprehensive logic doesn't distinguish based on readiness alone
		},
		{
			name: "Succeeded pod",
			pod: &corev1.Pod{
				Status: corev1.PodStatus{
					Phase: corev1.PodSucceeded,
				},
			},
			expected: "COMPLETED", // Updated to match Python comprehensive logic
		},
		{
			name: "Failed pod",
			pod: &corev1.Pod{
				Status: corev1.PodStatus{
					Phase: corev1.PodFailed,
				},
			},
			expected: "FAILED", // Updated to match Python comprehensive logic
		},
		{
			name: "Unknown pod",
			pod: &corev1.Pod{
				Status: corev1.PodStatus{
					Phase: corev1.PodUnknown,
				},
			},
			expected: "Unknown", // Stays as phase string for unknown status
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := utils.CalculatePodStatus(tt.pod).Status
			if result != tt.expected {
				t.Errorf("CalculatePodStatus() = %v, expected %v", result, tt.expected)
			}
		})
	}
}

// Test getPodMessage function - COMMENTED OUT: getPodMessage is now internal to utils.CalculatePodStatus
// The message extraction logic is tested as part of the comprehensive status calculation
/* func TestGetPodMessage(t *testing.T) {
	tests := []struct {
		name     string
		pod      *corev1.Pod
		expected string
	}{
		{
			name: "Message from waiting container",
			pod: &corev1.Pod{
				Status: corev1.PodStatus{
					ContainerStatuses: []corev1.ContainerStatus{
						{
							State: corev1.ContainerState{
								Waiting: &corev1.ContainerStateWaiting{
									Message: "ImagePullBackOff",
								},
							},
						},
					},
				},
			},
			expected: "ImagePullBackOff",
		},
		{
			name: "Message from terminated container",
			pod: &corev1.Pod{
				Status: corev1.PodStatus{
					ContainerStatuses: []corev1.ContainerStatus{
						{
							State: corev1.ContainerState{
								Terminated: &corev1.ContainerStateTerminated{
									Message: "Container crashed",
								},
							},
						},
					},
				},
			},
			expected: "Container crashed",
		},
		{
			name: "Message from pod condition",
			pod: &corev1.Pod{
				Status: corev1.PodStatus{
					Conditions: []corev1.PodCondition{
						{
							Status:  corev1.ConditionFalse,
							Message: "Insufficient CPU",
						},
					},
				},
			},
			expected: "Insufficient CPU",
		},
		{
			name: "Message from pod status",
			pod: &corev1.Pod{
				Status: corev1.PodStatus{
					Message: "Pod evicted",
				},
			},
			expected: "Pod evicted",
		},
		{
			name: "No message",
			pod: &corev1.Pod{
				Status: corev1.PodStatus{},
			},
			expected: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := getPodMessage(tt.pod)
			if result != tt.expected {
				t.Errorf("getPodMessage() = %v, expected %v", result, tt.expected)
			}
		})
	}
} */

// Test createPodUpdateMessage function
func TestCreatePodUpdateMessage(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "test-pod",
			Namespace: "osmo-prod",
			Labels: map[string]string{
				"osmo.workflow_uuid": "wf-123",
				"osmo.task_uuid":     "task-456",
				"osmo.retry_id":      "1",
			},
		},
		Spec: corev1.PodSpec{
			NodeName: "node-1",
			Containers: []corev1.Container{
				{Name: "main-container"},
			},
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
			PodIP: "10.0.0.1",
			ContainerStatuses: []corev1.ContainerStatus{
				{
					Ready: true,
					State: corev1.ContainerState{
						Terminated: &corev1.ContainerStateTerminated{
							ExitCode: 0,
						},
					},
				},
			},
			Conditions: []corev1.PodCondition{
				{
					Type:               corev1.PodReady,
					Status:             corev1.ConditionTrue,
					Reason:             "PodReady",
					Message:            "Pod is ready",
					LastTransitionTime: metav1.Now(),
				},
			},
		},
	}

	// Calculate status result
	statusResult := utils.CalculatePodStatus(pod)
	msg, err := createPodUpdateMessage(pod, statusResult, "test-backend")

	if err != nil {
		t.Fatalf("createPodUpdateMessage() error = %v", err)
	}

	if msg == nil {
		t.Fatal("createPodUpdateMessage() returned nil message")
	}

	// Parse pod update from message body
	var podUpdate pb.UpdatePodBody
	if err := json.Unmarshal([]byte(msg.Body), &podUpdate); err != nil {
		t.Fatalf("failed to unmarshal pod update: %v", err)
	}

	// Check podUpdate fields
	if podUpdate.WorkflowUuid != "wf-123" {
		t.Errorf("podUpdate.WorkflowUuid = %v, expected wf-123", podUpdate.WorkflowUuid)
	}

	if podUpdate.TaskUuid != "task-456" {
		t.Errorf("podUpdate.TaskUuid = %v, expected task-456", podUpdate.TaskUuid)
	}

	if podUpdate.RetryId != 1 {
		t.Errorf("podUpdate.RetryId = %v, expected 1", podUpdate.RetryId)
	}

	if podUpdate.Container != "main-container" {
		t.Errorf("podUpdate.Container = %v, expected main-container", podUpdate.Container)
	}

	if podUpdate.Node != "node-1" {
		t.Errorf("podUpdate.Node = %v, expected node-1", podUpdate.Node)
	}

	if podUpdate.PodIp != "10.0.0.1" {
		t.Errorf("podUpdate.PodIp = %v, expected 10.0.0.1", podUpdate.PodIp)
	}

	if podUpdate.Status != "RUNNING" {
		t.Errorf("podUpdate.Status = %v, expected RUNNING", podUpdate.Status)
	}

	if podUpdate.ExitCode != 0 {
		t.Errorf("podUpdate.ExitCode = %v, expected 0", podUpdate.ExitCode)
	}

	if podUpdate.Backend != "test-backend" {
		t.Errorf("podUpdate.Backend = %v, expected test-backend", podUpdate.Backend)
	}

	// Check conditions
	if len(podUpdate.Conditions) != 1 {
		t.Errorf("len(podUpdate.Conditions) = %v, expected 1", len(podUpdate.Conditions))
	}
}

// Test podStateTracker.hasChanged
func TestPodStateTracker_HasChanged(t *testing.T) {
	tracker := &podStateTracker{
		states: make(map[string]podStateEntry),
		ttl:    5 * time.Minute,
	}

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Labels: map[string]string{
				"osmo.workflow_uuid": "wf-123",
				"osmo.task_uuid":     "task-456",
				"osmo.retry_id":      "1",
			},
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodPending,
		},
	}

	// First call should return true (new pod)
	changed, _ := tracker.hasChanged(pod)
	if !changed {
		t.Error("First call to hasChanged() should return true for new pod")
	}

	// Second call with same status should return false
	changed, _ = tracker.hasChanged(pod)
	if changed {
		t.Error("Second call to hasChanged() should return false for unchanged pod")
	}

	// Change pod status
	pod.Status.Phase = corev1.PodRunning
	pod.Status.ContainerStatuses = []corev1.ContainerStatus{{Ready: true}}

	// Should return true after status change
	changed, _ = tracker.hasChanged(pod)
	if !changed {
		t.Error("hasChanged() should return true after status change")
	}

	// Test TTL expiration
	tracker2 := &podStateTracker{
		states: make(map[string]podStateEntry),
		ttl:    1 * time.Millisecond,
	}

	pod2 := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Labels: map[string]string{
				"osmo.workflow_uuid": "wf-789",
				"osmo.task_uuid":     "task-012",
			},
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
			ContainerStatuses: []corev1.ContainerStatus{
				{Ready: true},
			},
		},
	}

	tracker2.hasChanged(pod2)
	time.Sleep(2 * time.Millisecond)

	// Should return true after TTL expiration
	changed2, _ := tracker2.hasChanged(pod2)
	if !changed2 {
		t.Error("hasChanged() should return true after TTL expiration")
	}
}

// Test podStateTracker.remove
func TestPodStateTracker_Remove(t *testing.T) {
	tracker := &podStateTracker{
		states: make(map[string]podStateEntry),
		ttl:    5 * time.Minute,
	}

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Labels: map[string]string{
				"osmo.workflow_uuid": "wf-123",
				"osmo.task_uuid":     "task-456",
				"osmo.retry_id":      "1",
			},
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodPending,
		},
	}

	// Add pod to tracker
	tracker.hasChanged(pod)

	// Verify it's in the tracker
	key := getPodKey(pod)
	if _, exists := tracker.states[key]; !exists {
		t.Error("Pod should be in tracker after hasChanged()")
	}

	// Remove pod
	tracker.remove(pod)

	// Verify it's removed
	if _, exists := tracker.states[key]; exists {
		t.Error("Pod should be removed from tracker after remove()")
	}
}

// Test podStateTracker with concurrent access (stress test for race conditions)
func TestPodStateTracker_Concurrent(t *testing.T) {
	tracker := &podStateTracker{
		states: make(map[string]podStateEntry),
		ttl:    5 * time.Minute,
	}

	// Number of concurrent goroutines
	numGoroutines := 50
	// Number of operations per goroutine
	numOps := 100

	// Create a done channel to signal completion
	done := make(chan bool)

	// Start multiple goroutines that concurrently access the tracker
	for i := 0; i < numGoroutines; i++ {
		go func(id int) {
			for j := 0; j < numOps; j++ {
				pod := &corev1.Pod{
					ObjectMeta: metav1.ObjectMeta{
						Labels: map[string]string{
							"osmo.workflow_uuid": "wf-123",
							"osmo.task_uuid":     "task-456",
							"osmo.retry_id":      fmt.Sprintf("%d", id),
						},
					},
					Status: corev1.PodStatus{
						Phase: corev1.PodRunning,
						ContainerStatuses: []corev1.ContainerStatus{
							{Ready: j%2 == 0},
						},
					},
				}

				// Mix of operations
				switch j % 3 {
				case 0:
					tracker.hasChanged(pod)
				case 1:
					pod.Status.Phase = corev1.PodSucceeded
					tracker.hasChanged(pod)
				case 2:
					tracker.remove(pod)
				}
			}
			done <- true
		}(i)
	}

	// Wait for all goroutines to complete
	for i := 0; i < numGoroutines; i++ {
		<-done
	}

	// Verify tracker is still functional after concurrent access
	testPod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Labels: map[string]string{
				"osmo.workflow_uuid": "wf-test",
				"osmo.task_uuid":     "task-test",
				"osmo.retry_id":      "0",
			},
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodPending,
		},
	}

	changed, _ := tracker.hasChanged(testPod)
	if !changed {
		t.Error("Tracker should detect new pod after concurrent stress test")
	}
}

// Benchmark podStateTracker.hasChanged
func BenchmarkPodStateTracker_HasChanged(b *testing.B) {
	tracker := &podStateTracker{
		states: make(map[string]podStateEntry),
		ttl:    5 * time.Minute,
	}

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Labels: map[string]string{
				"osmo.workflow_uuid": "wf-123",
				"osmo.task_uuid":     "task-456",
				"osmo.retry_id":      "1",
			},
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
			ContainerStatuses: []corev1.ContainerStatus{
				{Ready: true},
			},
		},
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		tracker.hasChanged(pod)
	}
}

// Benchmark calculatePodStatus
func BenchmarkCalculatePodStatus(b *testing.B) {
	pod := &corev1.Pod{
		Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
			ContainerStatuses: []corev1.ContainerStatus{
				{Ready: true},
				{Ready: true},
			},
		},
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		utils.CalculatePodStatus(pod)
	}
}
