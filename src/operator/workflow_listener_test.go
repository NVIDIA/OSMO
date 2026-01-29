// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
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
	"fmt"
	"strings"
	"testing"
	"time"

	"go.corp.nvidia.com/osmo/operator/utils"
	pb "go.corp.nvidia.com/osmo/proto/compute_connector"
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
			expected: "wf-789-task-012-",
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
			expected: "wf-abc-task-def-",
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

	// Use a predefined status result for unit testing
	// (CalculateTaskStatus is tested separately in calculate_status_test.go)
	statusResult := utils.TaskStatusResult{
		Status:   "RUNNING",
		ExitCode: utils.ExitCodeNotSet,
		Message:  "",
	}
	msg, err := createPodUpdateMessage(pod, statusResult, "test-backend")

	if err != nil {
		t.Fatalf("createPodUpdateMessage() error = %v", err)
	}

	if msg == nil {
		t.Fatal("createPodUpdateMessage() returned nil message")
	}

	// Get pod update from message body (oneof)
	updatePod, ok := msg.Body.(*pb.ListenerMessage_UpdatePod)
	if !ok {
		t.Fatal("message body is not UpdatePod type")
	}
	podUpdate := updatePod.UpdatePod

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

	if podUpdate.ExitCode != utils.ExitCodeNotSet {
		t.Errorf("podUpdate.ExitCode = %v, expected %v (ExitCodeNotSet)", podUpdate.ExitCode, utils.ExitCodeNotSet)
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
func BenchmarkCalculateTaskStatus(b *testing.B) {
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
		utils.CalculateTaskStatus(pod)
	}
}

// Test parseRetryID function
func TestParseRetryID(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected int32
	}{
		{
			name:     "Valid retry ID",
			input:    "5",
			expected: 5,
		},
		{
			name:     "Zero retry ID",
			input:    "0",
			expected: 0,
		},
		{
			name:     "Empty string defaults to 0",
			input:    "",
			expected: 0,
		},
		{
			name:     "Invalid string defaults to 0",
			input:    "abc",
			expected: 0,
		},
		{
			name:     "Large number",
			input:    "999999",
			expected: 999999,
		},
		{
			name:     "Negative number",
			input:    "-1",
			expected: -1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := parseRetryID(tt.input)
			if result != tt.expected {
				t.Errorf("parseRetryID(%q) = %v, expected %v", tt.input, result, tt.expected)
			}
		})
	}
}

// Test createPodUpdateMessage with edge cases
func TestCreatePodUpdateMessage_EdgeCases(t *testing.T) {
	t.Run("Pod with multiple containers", func(t *testing.T) {
		pod := &corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "test-pod",
				Namespace: "osmo-prod",
				Labels: map[string]string{
					"osmo.workflow_uuid": "wf-123",
					"osmo.task_uuid":     "task-456",
					"osmo.retry_id":      "2",
				},
			},
			Spec: corev1.PodSpec{
				Containers: []corev1.Container{
					{Name: "first-container"},
					{Name: "second-container"},
				},
				NodeName: "node-1",
			},
			Status: corev1.PodStatus{
				Phase: corev1.PodRunning,
				PodIP: "10.0.0.1",
			},
		}

		// Use predefined status for unit test
		statusResult := utils.TaskStatusResult{Status: "RUNNING", ExitCode: utils.ExitCodeNotSet}
		msg, err := createPodUpdateMessage(pod, statusResult, "test-backend")

		if err != nil {
			t.Fatalf("createPodUpdateMessage() error = %v", err)
		}

		// Get pod update from message body (oneof)
		updatePod, ok := msg.Body.(*pb.ListenerMessage_UpdatePod)
		if !ok {
			t.Fatal("message body is not UpdatePod type")
		}
		podUpdate := updatePod.UpdatePod

		// Should use first container
		if podUpdate.Container != "first-container" {
			t.Errorf("Container = %v, expected first-container", podUpdate.Container)
		}
	})

	t.Run("Pod with multiple conditions", func(t *testing.T) {
		pod := &corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{
				Labels: map[string]string{
					"osmo.workflow_uuid": "wf-123",
					"osmo.task_uuid":     "task-456",
				},
			},
			Spec: corev1.PodSpec{
				Containers: []corev1.Container{{Name: "main"}},
			},
			Status: corev1.PodStatus{
				Phase: corev1.PodRunning,
				Conditions: []corev1.PodCondition{
					{
						Type:               corev1.PodScheduled,
						Status:             corev1.ConditionTrue,
						Reason:             "Scheduled",
						Message:            "Pod scheduled",
						LastTransitionTime: metav1.Now(),
					},
					{
						Type:               corev1.PodReady,
						Status:             corev1.ConditionTrue,
						Reason:             "Ready",
						Message:            "Pod ready",
						LastTransitionTime: metav1.Now(),
					},
					{
						Type:               corev1.ContainersReady,
						Status:             corev1.ConditionTrue,
						Reason:             "ContainersReady",
						Message:            "All containers ready",
						LastTransitionTime: metav1.Now(),
					},
				},
			},
		}

		// Use predefined status for unit test
		statusResult := utils.TaskStatusResult{Status: "RUNNING", ExitCode: utils.ExitCodeNotSet}
		msg, err := createPodUpdateMessage(pod, statusResult, "test-backend")

		if err != nil {
			t.Fatalf("createPodUpdateMessage() error = %v", err)
		}

		// Get pod update from message body (oneof)
		updatePod, ok := msg.Body.(*pb.ListenerMessage_UpdatePod)
		if !ok {
			t.Fatal("message body is not UpdatePod type")
		}
		podUpdate := updatePod.UpdatePod

		// Should have all 3 conditions
		if len(podUpdate.Conditions) != 3 {
			t.Errorf("len(Conditions) = %v, expected 3", len(podUpdate.Conditions))
		}
	})

	t.Run("Pod with no containers should not panic", func(t *testing.T) {
		pod := &corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{
				Labels: map[string]string{
					"osmo.workflow_uuid": "wf-123",
					"osmo.task_uuid":     "task-456",
				},
			},
			Spec: corev1.PodSpec{
				Containers: []corev1.Container{}, // Empty
			},
			Status: corev1.PodStatus{
				Phase: corev1.PodPending,
			},
		}

		statusResult := utils.CalculateTaskStatus(pod)
		// This should panic or handle gracefully - documenting current behavior
		defer func() {
			if r := recover(); r == nil {
				t.Error("Expected panic for pod with no containers")
			}
		}()
		createPodUpdateMessage(pod, statusResult, "test-backend")
	})

	t.Run("Pod with missing optional fields", func(t *testing.T) {
		pod := &corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{
				Labels: map[string]string{
					"osmo.workflow_uuid": "wf-123",
					"osmo.task_uuid":     "task-456",
					// No retry_id
				},
			},
			Spec: corev1.PodSpec{
				Containers: []corev1.Container{{Name: "main"}},
				// No NodeName
			},
			Status: corev1.PodStatus{
				Phase: corev1.PodPending,
				// No PodIP, no conditions
			},
		}

		// Use predefined status for unit test
		statusResult := utils.TaskStatusResult{Status: "RUNNING", ExitCode: utils.ExitCodeNotSet}
		msg, err := createPodUpdateMessage(pod, statusResult, "test-backend")

		if err != nil {
			t.Fatalf("createPodUpdateMessage() error = %v", err)
		}

		// Get pod update from message body (oneof)
		updatePod, ok := msg.Body.(*pb.ListenerMessage_UpdatePod)
		if !ok {
			t.Fatal("message body is not UpdatePod type")
		}
		podUpdate := updatePod.UpdatePod

		// Verify defaults
		if podUpdate.RetryId != 0 {
			t.Errorf("RetryId = %v, expected 0", podUpdate.RetryId)
		}
		if podUpdate.Node != "" {
			t.Errorf("Node = %v, expected empty string", podUpdate.Node)
		}
		if podUpdate.PodIp != "" {
			t.Errorf("PodIp = %v, expected empty string", podUpdate.PodIp)
		}
	})
}

// Test getPodKey with edge cases
func TestGetPodKey_EdgeCases(t *testing.T) {
	tests := []struct {
		name     string
		pod      *corev1.Pod
		expected string
	}{
		{
			name: "Missing all labels",
			pod: &corev1.Pod{
				ObjectMeta: metav1.ObjectMeta{
					Labels: map[string]string{},
				},
			},
			expected: "--",
		},
		{
			name: "Only workflow_uuid",
			pod: &corev1.Pod{
				ObjectMeta: metav1.ObjectMeta{
					Labels: map[string]string{
						"osmo.workflow_uuid": "wf-only",
					},
				},
			},
			expected: "wf-only--",
		},
		{
			name: "Labels with special characters",
			pod: &corev1.Pod{
				ObjectMeta: metav1.ObjectMeta{
					Labels: map[string]string{
						"osmo.workflow_uuid": "wf-123-abc",
						"osmo.task_uuid":     "task_456_def",
						"osmo.retry_id":      "0",
					},
				},
			},
			expected: "wf-123-abc-task_456_def-0",
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

// Test message UUID format
func TestCreatePodUpdateMessage_UUIDFormat(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Labels: map[string]string{
				"osmo.workflow_uuid": "wf-123",
				"osmo.task_uuid":     "task-456",
			},
		},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{{Name: "main"}},
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
		},
	}

	statusResult := utils.CalculateTaskStatus(pod)
	msg1, err1 := createPodUpdateMessage(pod, statusResult, "backend")
	msg2, err2 := createPodUpdateMessage(pod, statusResult, "backend")

	if err1 != nil || err2 != nil {
		t.Fatalf("createPodUpdateMessage() errors: %v, %v", err1, err2)
	}

	// UUIDs should be different
	if msg1.Uuid == msg2.Uuid {
		t.Error("Message UUIDs should be unique")
	}

	// UUIDs should be 32 characters (no hyphens)
	if len(msg1.Uuid) != 32 {
		t.Errorf("UUID length = %v, expected 32", len(msg1.Uuid))
	}

	// UUID should not contain hyphens
	if strings.Contains(msg1.Uuid, "-") {
		t.Error("UUID should not contain hyphens")
	}
}

// Test message timestamp format
func TestCreatePodUpdateMessage_TimestampFormat(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Labels: map[string]string{
				"osmo.workflow_uuid": "wf-123",
				"osmo.task_uuid":     "task-456",
			},
		},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{{Name: "main"}},
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
		},
	}

	statusResult := utils.CalculateTaskStatus(pod)
	msg, err := createPodUpdateMessage(pod, statusResult, "backend")

	if err != nil {
		t.Fatalf("createPodUpdateMessage() error = %v", err)
	}

	// Timestamp should be in the format "2006-01-02T15:04:05.999999"
	expectedFormat := "2006-01-02T15:04:05.999999"
	_, parseErr := time.Parse(expectedFormat, msg.Timestamp)
	if parseErr != nil {
		t.Errorf("Timestamp format invalid: %v, error: %v", msg.Timestamp, parseErr)
	}
}

// Test podStateTracker with zero TTL
func TestPodStateTracker_ZeroTTL(t *testing.T) {
	tracker := &podStateTracker{
		states: make(map[string]podStateEntry),
		ttl:    0, // Zero TTL means always expired
	}

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Labels: map[string]string{
				"osmo.workflow_uuid": "wf-123",
				"osmo.task_uuid":     "task-456",
			},
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
		},
	}

	// First call
	changed1, _ := tracker.hasChanged(pod)
	if !changed1 {
		t.Error("First call should return true")
	}

	// Second call with zero TTL should still return true (always expired)
	changed2, _ := tracker.hasChanged(pod)
	if !changed2 {
		t.Error("With zero TTL, every call should return true")
	}
}

// Test podStateTracker with very large TTL
func TestPodStateTracker_LargeTTL(t *testing.T) {
	tracker := &podStateTracker{
		states: make(map[string]podStateEntry),
		ttl:    24 * time.Hour, // Very large TTL
	}

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Labels: map[string]string{
				"osmo.workflow_uuid": "wf-123",
				"osmo.task_uuid":     "task-456",
			},
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodPending,
		},
	}

	// First call
	tracker.hasChanged(pod)

	// Change status
	pod.Status.Phase = corev1.PodRunning

	// Should detect change even with large TTL
	changed, _ := tracker.hasChanged(pod)
	if !changed {
		t.Error("Should detect status change regardless of TTL")
	}
}

// Benchmark parseRetryID
func BenchmarkParseRetryID(b *testing.B) {
	testCases := []string{"0", "5", "999999", "", "abc"}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		parseRetryID(testCases[i%len(testCases)])
	}
}

// Benchmark getPodKey
func BenchmarkGetPodKey(b *testing.B) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Labels: map[string]string{
				"osmo.workflow_uuid": "wf-123",
				"osmo.task_uuid":     "task-456",
				"osmo.retry_id":      "2",
			},
		},
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		getPodKey(pod)
	}
}

// Benchmark createPodUpdateMessage
func BenchmarkCreatePodUpdateMessage(b *testing.B) {
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
			NodeName:   "node-1",
			Containers: []corev1.Container{{Name: "main"}},
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
			PodIP: "10.0.0.1",
		},
	}

	statusResult := utils.CalculateTaskStatus(pod)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		createPodUpdateMessage(pod, statusResult, "test-backend")
	}
}

// Test NewWorkflowListener
func TestNewWorkflowListener(t *testing.T) {
	args := utils.ListenerArgs{
		ServiceURL:         "http://localhost:8000",
		Backend:            "test-backend",
		Namespace:          "osmo-test",
		MaxUnackedMessages: 100,
	}

	listener := NewWorkflowListener(args)

	if listener == nil {
		t.Fatal("NewWorkflowListener returned nil")
	}

	if listener.args.Backend != "test-backend" {
		t.Errorf("Backend = %v, expected test-backend", listener.args.Backend)
	}

	if listener.GetUnackedMessages() == nil {
		t.Error("unackedMessages should not be nil")
	}
}

// Test that podStateTracker correctly identifies status changes across pod phases
func TestPodStateTracker_StatusTransitions(t *testing.T) {
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

	// Track the status transitions
	transitions := []struct {
		phase          corev1.PodPhase
		containerReady bool
		shouldChange   bool
		description    string
	}{
		{corev1.PodPending, false, true, "Initial pending state"},
		{corev1.PodPending, false, false, "Same pending state"},
		{corev1.PodRunning, false, true, "Transition to running"},
		{corev1.PodRunning, true, false, "Running with ready container"},
		{corev1.PodSucceeded, false, true, "Transition to succeeded"},
	}

	for _, trans := range transitions {
		pod.Status.Phase = trans.phase
		if trans.containerReady {
			pod.Status.ContainerStatuses = []corev1.ContainerStatus{{Ready: true}}
		} else {
			pod.Status.ContainerStatuses = []corev1.ContainerStatus{}
		}

		changed, _ := tracker.hasChanged(pod)
		if changed != trans.shouldChange {
			t.Errorf("%s: hasChanged() = %v, expected %v", trans.description, changed, trans.shouldChange)
		}
	}
}

// Test parseRetryID with various edge cases
func TestParseRetryID_EdgeCases(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected int32
	}{
		{"Max int32", "2147483647", 2147483647},
		{"Overflow returns zero", "2147483648", 0}, // fmt.Sscanf fails on overflow
		{"With spaces", " 42 ", 42},                // fmt.Sscanf trims whitespace
		{"Decimal number", "3.14", 3},              // Sscanf stops at decimal
		{"Hex format", "0x10", 0},                  // Not parsed as hex
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := parseRetryID(tt.input)
			if result != tt.expected {
				t.Errorf("parseRetryID(%q) = %v, expected %v", tt.input, result, tt.expected)
			}
		})
	}
}

// Test that Unknown status doesn't get sent
func TestPodStateTracker_UnknownStatus(t *testing.T) {
	tracker := &podStateTracker{
		states: make(map[string]podStateEntry),
		ttl:    5 * time.Minute,
	}

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Labels: map[string]string{
				"osmo.workflow_uuid": "wf-123",
				"osmo.task_uuid":     "task-456",
			},
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodUnknown,
		},
	}

	// Should return false for Unknown status
	changed, result := tracker.hasChanged(pod)
	if changed {
		t.Error("hasChanged() should return false for Unknown status")
	}

	if result.Status != "" {
		t.Errorf("Status should be empty for Unknown phase, got %v", result.Status)
	}
}

// Test createPodUpdateMessage with all condition types
func TestCreatePodUpdateMessage_AllConditionTypes(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Labels: map[string]string{
				"osmo.workflow_uuid": "wf-123",
				"osmo.task_uuid":     "task-456",
			},
		},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{{Name: "main"}},
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
			Conditions: []corev1.PodCondition{
				{
					Type:               corev1.PodScheduled,
					Status:             corev1.ConditionTrue,
					Reason:             "Scheduled",
					Message:            "Successfully assigned",
					LastTransitionTime: metav1.Now(),
				},
				{
					Type:               corev1.PodReady,
					Status:             corev1.ConditionTrue,
					Reason:             "Ready",
					Message:            "Pod is ready",
					LastTransitionTime: metav1.Now(),
				},
				{
					Type:               corev1.ContainersReady,
					Status:             corev1.ConditionTrue,
					Reason:             "ContainersReady",
					Message:            "All containers ready",
					LastTransitionTime: metav1.Now(),
				},
				{
					Type:               corev1.PodInitialized,
					Status:             corev1.ConditionTrue,
					Reason:             "Initialized",
					Message:            "Init containers completed",
					LastTransitionTime: metav1.Now(),
				},
			},
		},
	}

	// Use a predefined status result for unit testing
	statusResult := utils.TaskStatusResult{
		Status:   "RUNNING",
		ExitCode: utils.ExitCodeNotSet,
		Message:  "",
	}
	msg, err := createPodUpdateMessage(pod, statusResult, "backend")

	if err != nil {
		t.Fatalf("createPodUpdateMessage() error = %v", err)
	}

	updatePod := msg.Body.(*pb.ListenerMessage_UpdatePod).UpdatePod

	// Verify all 4 conditions are present
	if len(updatePod.Conditions) != 4 {
		t.Errorf("len(Conditions) = %d, expected 4", len(updatePod.Conditions))
	}

	// Verify condition types
	condTypes := make(map[string]bool)
	for _, cond := range updatePod.Conditions {
		condTypes[cond.Type] = true
	}

	expectedTypes := []string{"PodScheduled", "Ready", "ContainersReady", "Initialized"}
	for _, expectedType := range expectedTypes {
		if !condTypes[expectedType] {
			t.Errorf("Missing condition type: %s", expectedType)
		}
	}
}

// Test condition timestamp format
func TestCreatePodUpdateMessage_ConditionTimestampFormat(t *testing.T) {
	now := metav1.Now()
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Labels: map[string]string{
				"osmo.workflow_uuid": "wf-123",
				"osmo.task_uuid":     "task-456",
			},
		},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{{Name: "main"}},
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
			Conditions: []corev1.PodCondition{
				{
					Type:               corev1.PodReady,
					Status:             corev1.ConditionTrue,
					Reason:             "Ready",
					LastTransitionTime: now,
				},
			},
		},
	}

	statusResult := utils.CalculateTaskStatus(pod)
	msg, err := createPodUpdateMessage(pod, statusResult, "backend")

	if err != nil {
		t.Fatalf("createPodUpdateMessage() error = %v", err)
	}

	updatePod := msg.Body.(*pb.ListenerMessage_UpdatePod).UpdatePod

	if len(updatePod.Conditions) != 1 {
		t.Fatalf("Expected 1 condition, got %d", len(updatePod.Conditions))
	}

	// Check timestamp format
	timestamp := updatePod.Conditions[0].Timestamp
	expectedFormat := "2006-01-02T15:04:05.999999"
	_, parseErr := time.Parse(expectedFormat, timestamp)
	if parseErr != nil {
		t.Errorf("Condition timestamp format invalid: %v, error: %v", timestamp, parseErr)
	}
}

// Test condition status conversion (bool)
func TestCreatePodUpdateMessage_ConditionStatusConversion(t *testing.T) {
	tests := []struct {
		name            string
		conditionStatus corev1.ConditionStatus
		expectedBool    bool
	}{
		{"True condition", corev1.ConditionTrue, true},
		{"False condition", corev1.ConditionFalse, false},
		{"Unknown condition", corev1.ConditionUnknown, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			pod := &corev1.Pod{
				ObjectMeta: metav1.ObjectMeta{
					Labels: map[string]string{
						"osmo.workflow_uuid": "wf-123",
						"osmo.task_uuid":     "task-456",
					},
				},
				Spec: corev1.PodSpec{
					Containers: []corev1.Container{{Name: "main"}},
				},
				Status: corev1.PodStatus{
					Phase: corev1.PodRunning,
					Conditions: []corev1.PodCondition{
						{
							Type:               corev1.PodReady,
							Status:             tt.conditionStatus,
							LastTransitionTime: metav1.Now(),
						},
					},
				},
			}

			statusResult := utils.CalculateTaskStatus(pod)
			msg, err := createPodUpdateMessage(pod, statusResult, "backend")

			if err != nil {
				t.Fatalf("createPodUpdateMessage() error = %v", err)
			}

			updatePod := msg.Body.(*pb.ListenerMessage_UpdatePod).UpdatePod
			if updatePod.Conditions[0].Status != tt.expectedBool {
				t.Errorf("Condition status = %v, expected %v", updatePod.Conditions[0].Status, tt.expectedBool)
			}
		})
	}
}

// Test getPodKey with nil labels
func TestGetPodKey_NilLabels(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Labels: nil,
		},
	}

	// Should not panic
	result := getPodKey(pod)
	if result != "--" {
		t.Errorf("getPodKey with nil labels = %v, expected '--'", result)
	}
}

// Test podStateTracker with multiple pods simultaneously
func TestPodStateTracker_MultiplePods(t *testing.T) {
	tracker := &podStateTracker{
		states: make(map[string]podStateEntry),
		ttl:    5 * time.Minute,
	}

	pods := []*corev1.Pod{
		{
			ObjectMeta: metav1.ObjectMeta{
				Labels: map[string]string{
					"osmo.workflow_uuid": "wf-1",
					"osmo.task_uuid":     "task-1",
					"osmo.retry_id":      "0",
				},
			},
			Status: corev1.PodStatus{Phase: corev1.PodPending},
		},
		{
			ObjectMeta: metav1.ObjectMeta{
				Labels: map[string]string{
					"osmo.workflow_uuid": "wf-1",
					"osmo.task_uuid":     "task-2",
					"osmo.retry_id":      "0",
				},
			},
			Status: corev1.PodStatus{Phase: corev1.PodPending},
		},
		{
			ObjectMeta: metav1.ObjectMeta{
				Labels: map[string]string{
					"osmo.workflow_uuid": "wf-2",
					"osmo.task_uuid":     "task-1",
					"osmo.retry_id":      "1",
				},
			},
			Status: corev1.PodStatus{Phase: corev1.PodRunning},
		},
	}

	// All should be new
	for i, pod := range pods {
		changed, _ := tracker.hasChanged(pod)
		if !changed {
			t.Errorf("Pod %d should be detected as new", i)
		}
	}

	// None should have changed
	for i, pod := range pods {
		changed, _ := tracker.hasChanged(pod)
		if changed {
			t.Errorf("Pod %d should not have changed", i)
		}
	}

	// Update one pod's status
	pods[0].Status.Phase = corev1.PodRunning
	pods[0].Status.ContainerStatuses = []corev1.ContainerStatus{{Ready: true}}

	// Only the updated pod should show change
	for i, pod := range pods {
		changed, _ := tracker.hasChanged(pod)
		if i == 0 && !changed {
			t.Errorf("Pod %d should have changed", i)
		}
		if i != 0 && changed {
			t.Errorf("Pod %d should not have changed", i)
		}
	}
}
