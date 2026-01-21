/*
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

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

package utils

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// Test case structure matching the JSON file
type TestCaseInput struct {
	Phase                 string                `json:"phase"`
	PodName               string                `json:"pod_name"`
	Reason                *string               `json:"reason"`
	Message               *string               `json:"message"`
	Conditions            []TestCondition       `json:"conditions"`
	ContainerStatuses     []TestContainerStatus `json:"container_statuses"`
	InitContainerStatuses []TestContainerStatus `json:"init_container_statuses"`
}

type TestCondition struct {
	Type               string `json:"type"`
	Status             string `json:"status"`
	Reason             string `json:"reason"`
	Message            string `json:"message"`
	LastTransitionTime string `json:"last_transition_time"`
}

type TestContainerStatus struct {
	Name  string             `json:"name"`
	State TestContainerState `json:"state"`
}

type TestContainerState struct {
	Running    *struct{}                     `json:"running"`
	Waiting    *TestContainerStateWaiting    `json:"waiting"`
	Terminated *TestContainerStateTerminated `json:"terminated"`
}

type TestContainerStateWaiting struct {
	Reason  string `json:"reason"`
	Message string `json:"message"`
}

type TestContainerStateTerminated struct {
	Reason   string  `json:"reason"`
	ExitCode int32   `json:"exit_code"`
	Message  *string `json:"message"`
}

type TestCaseExpected struct {
	Status          string   `json:"status"`
	MessageContains []string `json:"message_contains"`
	ExitCode        *int32   `json:"exit_code"`
	Note            string   `json:"note"`
}

type TestCase struct {
	Name        string           `json:"name"`
	Description string           `json:"description"`
	Input       TestCaseInput    `json:"input"`
	Expected    TestCaseExpected `json:"expected"`
}

type TestSuite struct {
	Version     string     `json:"version"`
	Description string     `json:"description"`
	TestCases   []TestCase `json:"test_cases"`
}

// Helper to parse time offset strings like "now", "now-5m", "now-15m"
func parseTimeOffset(timeStr string) metav1.Time {
	if timeStr == "" || timeStr == "now" {
		return metav1.Now()
	}

	// Parse "now-Xm" format
	if strings.HasPrefix(timeStr, "now-") && strings.HasSuffix(timeStr, "m") {
		minutesStr := strings.TrimPrefix(timeStr, "now-")
		minutesStr = strings.TrimSuffix(minutesStr, "m")
		var minutes int
		if _, err := fmt.Sscanf(minutesStr, "%d", &minutes); err == nil {
			return metav1.NewTime(time.Now().Add(-time.Duration(minutes) * time.Minute))
		}
	}

	return metav1.Now()
}

// Convert test case input to k8s Pod object
func testInputToPod(input TestCaseInput) *corev1.Pod {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name: input.PodName,
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodPhase(input.Phase),
		},
	}

	if input.Reason != nil {
		pod.Status.Reason = *input.Reason
	}

	if input.Message != nil {
		pod.Status.Message = *input.Message
	}

	// Convert conditions
	for _, cond := range input.Conditions {
		k8sCond := corev1.PodCondition{
			Type:               corev1.PodConditionType(cond.Type),
			Status:             corev1.ConditionStatus(cond.Status),
			Reason:             cond.Reason,
			Message:            cond.Message,
			LastTransitionTime: parseTimeOffset(cond.LastTransitionTime),
		}
		pod.Status.Conditions = append(pod.Status.Conditions, k8sCond)
	}

	// Convert container statuses
	for _, cs := range input.ContainerStatuses {
		k8sCS := corev1.ContainerStatus{
			Name: cs.Name,
		}

		if cs.State.Running != nil {
			k8sCS.State.Running = &corev1.ContainerStateRunning{}
		}

		if cs.State.Waiting != nil {
			k8sCS.State.Waiting = &corev1.ContainerStateWaiting{
				Reason:  cs.State.Waiting.Reason,
				Message: cs.State.Waiting.Message,
			}
		}

		if cs.State.Terminated != nil {
			msg := ""
			if cs.State.Terminated.Message != nil {
				msg = *cs.State.Terminated.Message
			}
			k8sCS.State.Terminated = &corev1.ContainerStateTerminated{
				Reason:   cs.State.Terminated.Reason,
				ExitCode: cs.State.Terminated.ExitCode,
				Message:  msg,
			}
		}

		pod.Status.ContainerStatuses = append(pod.Status.ContainerStatuses, k8sCS)
	}

	// Convert init container statuses
	for _, cs := range input.InitContainerStatuses {
		k8sCS := corev1.ContainerStatus{
			Name: cs.Name,
		}

		if cs.State.Running != nil {
			k8sCS.State.Running = &corev1.ContainerStateRunning{}
		}

		if cs.State.Waiting != nil {
			k8sCS.State.Waiting = &corev1.ContainerStateWaiting{
				Reason:  cs.State.Waiting.Reason,
				Message: cs.State.Waiting.Message,
			}
		}

		if cs.State.Terminated != nil {
			msg := ""
			if cs.State.Terminated.Message != nil {
				msg = *cs.State.Terminated.Message
			}
			k8sCS.State.Terminated = &corev1.ContainerStateTerminated{
				Reason:   cs.State.Terminated.Reason,
				ExitCode: cs.State.Terminated.ExitCode,
				Message:  msg,
			}
		}

		pod.Status.InitContainerStatuses = append(pod.Status.InitContainerStatuses, k8sCS)
	}

	return pod
}

func TestCalculateTaskStatusFromJSON(t *testing.T) {
	// Find the JSON test file
	testFile := filepath.Join("..", "tests", "test_calculate_pod_status_cases.json")

	// Read the JSON file
	data, err := os.ReadFile(testFile)
	if err != nil {
		t.Fatalf("Failed to read test file %s: %v", testFile, err)
	}

	// Parse the JSON
	var suite TestSuite
	if err := json.Unmarshal(data, &suite); err != nil {
		t.Fatalf("Failed to parse test file: %v", err)
	}

	t.Logf("Running %d test cases from %s (version %s)", len(suite.TestCases), testFile, suite.Version)

	// Run each test case
	for _, tc := range suite.TestCases {
		t.Run(tc.Name, func(t *testing.T) {
			// Convert test input to k8s Pod
			pod := testInputToPod(tc.Input)

			// Call the function under test
			result := CalculateTaskStatus(pod)

		// Always log actual output for visibility
		actualExitCodeStr := fmt.Sprintf("%d", result.ExitCode)
		if result.ExitCode == ExitCodeNotSet {
			actualExitCodeStr = "-1 (null)"
		}
		expectedExitCodeStr := "null"
		if tc.Expected.ExitCode != nil {
			expectedExitCodeStr = fmt.Sprintf("%d", *tc.Expected.ExitCode)
		}
		t.Logf("Go Output:  Status=%q, ExitCode=%s, Message=%q", result.Status, actualExitCodeStr, result.Message)
		t.Logf("Expected:   Status=%q, ExitCode=%s", tc.Expected.Status, expectedExitCodeStr)

		// Verify status
		if result.Status != tc.Expected.Status {
			t.Errorf("MISMATCH: Status - Got %q, Expected %q", result.Status, tc.Expected.Status)
		}

		// Verify exit code
		if tc.Expected.ExitCode != nil {
			// Expected has a specific exit code
			expectedCode := *tc.Expected.ExitCode
			if result.ExitCode != expectedCode {
				t.Errorf("MISMATCH: ExitCode - Got %d, Expected %d", result.ExitCode, expectedCode)
			}
		} else {
			// Expected is null, so Go should return ExitCodeNotSet (-1)
			if result.ExitCode != ExitCodeNotSet {
				t.Errorf("MISMATCH: ExitCode - Got %d, Expected null (ExitCodeNotSet=-1)", result.ExitCode)
			}
		}

			// Verify message contains expected strings
			if len(tc.Expected.MessageContains) > 0 {
				for _, expected := range tc.Expected.MessageContains {
					if !strings.Contains(strings.ToLower(result.Message), strings.ToLower(expected)) {
						t.Errorf("MISMATCH: Message should contain %q, got: %q", expected, result.Message)
					}
				}
			}

			// Log note if present (for documentation purposes)
			if tc.Expected.Note != "" {
				t.Logf("Note: %s", tc.Expected.Note)
			}
		})
	}
}

// Additional unit tests for internal helper functions
func TestGetPodConditionFailure(t *testing.T) {
	tests := []struct {
		name         string
		pod          *corev1.Pod
		expectNil    bool
		expectStatus string
	}{
		{
			name: "PreemptionByScheduler",
			pod: &corev1.Pod{
				Status: corev1.PodStatus{
					Conditions: []corev1.PodCondition{
						{
							Type:               corev1.PodScheduled,
							Status:             corev1.ConditionTrue,
							Reason:             "PreemptionByScheduler",
							LastTransitionTime: metav1.Now(),
						},
					},
				},
			},
			expectNil:    false,
			expectStatus: StatusFailedPreempted,
		},
		{
			name: "DisruptionTarget",
			pod: &corev1.Pod{
				Status: corev1.PodStatus{
					Conditions: []corev1.PodCondition{
						{
							Type:    "DisruptionTarget",
							Status:  corev1.ConditionTrue,
							Message: "Node is being drained",
						},
					},
				},
			},
			expectNil:    false,
			expectStatus: StatusFailedBackendError,
		},
		{
			name: "No failure conditions",
			pod: &corev1.Pod{
				Status: corev1.PodStatus{
					Conditions: []corev1.PodCondition{
						{
							Type:   corev1.PodReady,
							Status: corev1.ConditionTrue,
						},
					},
				},
			},
			expectNil: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := getPodConditionFailure(tt.pod)
			if tt.expectNil {
				if result != nil {
					t.Errorf("Expected nil, got %v", result)
				}
			} else {
				if result == nil {
					t.Fatal("Expected non-nil result")
				}
				if result.Status != tt.expectStatus {
					t.Errorf("Status = %v, expected %v", result.Status, tt.expectStatus)
				}
			}
		})
	}
}

func TestGetPodReasonFailure(t *testing.T) {
	tests := []struct {
		name         string
		pod          *corev1.Pod
		expectNil    bool
		expectStatus string
	}{
		{
			name: "Evicted",
			pod: &corev1.Pod{
				Status: corev1.PodStatus{
					Reason:  "Evicted",
					Message: "Pod was evicted due to node pressure",
				},
			},
			expectNil:    false,
			expectStatus: StatusFailedEvicted,
		},
		{
			name: "StartError",
			pod: &corev1.Pod{
				Status: corev1.PodStatus{
					Reason:  "StartError",
					Message: "Failed to start container",
				},
			},
			expectNil:    false,
			expectStatus: StatusFailedStartError,
		},
		{
			name: "UnexpectedAdmissionError",
			pod: &corev1.Pod{
				Status: corev1.PodStatus{
					Reason:  "UnexpectedAdmissionError",
					Message: "GPU dropped",
				},
			},
			expectNil:    false,
			expectStatus: StatusFailedBackendError,
		},
		{
			name: "No failure reason",
			pod: &corev1.Pod{
				Status: corev1.PodStatus{
					Reason: "",
				},
			},
			expectNil: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := getPodReasonFailure(tt.pod)
			if tt.expectNil {
				if result != nil {
					t.Errorf("Expected nil, got %v", result)
				}
			} else {
				if result == nil {
					t.Fatal("Expected non-nil result")
				}
				if result.Status != tt.expectStatus {
					t.Errorf("Status = %v, expected %v", result.Status, tt.expectStatus)
				}
			}
		})
	}
}

// Benchmark tests
func BenchmarkCalculateTaskStatus_Simple(b *testing.B) {
	pod := &corev1.Pod{
		Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
		},
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		CalculateTaskStatus(pod)
	}
}

func BenchmarkCalculateTaskStatus_Complex(b *testing.B) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name: "test-pod",
		},
		Status: corev1.PodStatus{
			Phase:   corev1.PodFailed,
			Message: "Some error occurred",
			Conditions: []corev1.PodCondition{
				{
					Type:   corev1.PodReady,
					Status: corev1.ConditionFalse,
					Reason: "ContainersNotReady",
				},
				{
					Type:   corev1.PodScheduled,
					Status: corev1.ConditionTrue,
				},
			},
			InitContainerStatuses: []corev1.ContainerStatus{
				{
					Name: "osmo-init",
					State: corev1.ContainerState{
						Terminated: &corev1.ContainerStateTerminated{
							ExitCode: 0,
							Reason:   "Completed",
						},
					},
				},
			},
			ContainerStatuses: []corev1.ContainerStatus{
				{
					Name: "main",
					State: corev1.ContainerState{
						Terminated: &corev1.ContainerStateTerminated{
							ExitCode: 1,
							Reason:   "Error",
							Message:  "Container failed",
						},
					},
				},
			},
		},
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		CalculateTaskStatus(pod)
	}
}
