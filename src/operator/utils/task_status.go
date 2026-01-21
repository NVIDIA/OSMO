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
	"fmt"

	corev1 "k8s.io/api/core/v1"
)

// Task status strings
const (
	StatusScheduling         = "SCHEDULING"
	StatusInitializing       = "INITIALIZING"
	StatusRunning            = "RUNNING"
	StatusCompleted          = "COMPLETED"
	StatusFailed             = "FAILED"
	StatusFailedPreempted    = "FAILED_PREEMPTED"
	StatusFailedEvicted      = "FAILED_EVICTED"
	StatusFailedStartError   = "FAILED_START_ERROR"
	StatusFailedBackendError = "FAILED_BACKEND_ERROR"
	StatusFailedImagePull    = "FAILED_IMAGE_PULL"
	StatusUnknown            = "UNKNOWN"
)

// Exit codes
const (
	ExitCodeNotSet             int32 = -1   // No exit code available
	ExitCodeFailedPreempted    int32 = 3006 // StatusFailedPreempted
	ExitCodeFailedEvicted      int32 = 3004 // StatusFailedEvicted
	ExitCodeFailedStartError   int32 = 3003 // StatusFailedStartError
	ExitCodeFailedBackendError int32 = 3001 // StatusFailedBackendError
	ExitCodeFailedUnknown      int32 = 4000 // Unknown failure
)

// TaskStatusResult contains the comprehensive status information
type TaskStatusResult struct {
	Status   string
	Message  string
	ExitCode int32
}

// getPodConditionFailure checks pod conditions for failures (preemption, disruption, etc.)
// Returns the TaskStatusResult if a failure condition is found, nil otherwise.
func getPodConditionFailure(pod *corev1.Pod) *TaskStatusResult {
	for _, cond := range pod.Status.Conditions {
		if cond.Status == corev1.ConditionTrue {
			if cond.Reason == "PreemptionByScheduler" {
				return &TaskStatusResult{
					Status: StatusFailedPreempted,
					Message: fmt.Sprintf("Pod was preempted at %s. ",
						cond.LastTransitionTime.String()),
					ExitCode: ExitCodeFailedPreempted,
				}
			}
			if cond.Type == "DisruptionTarget" {
				return &TaskStatusResult{
					Status:   StatusFailedBackendError,
					Message:  fmt.Sprintf("Pod disrupted: %s. ", cond.Message),
					ExitCode: ExitCodeFailedBackendError,
				}
			}
		}
	}
	return nil
}

// getPodReasonFailure checks pod reason for specific failures
// Returns the TaskStatusResult if a failure reason is found, nil otherwise.
func getPodReasonFailure(pod *corev1.Pod) *TaskStatusResult {
	switch pod.Status.Reason {
	case "Evicted":
		return &TaskStatusResult{
			Status:   StatusFailedEvicted,
			Message:  fmt.Sprintf("Pod was evicted: %s. ", pod.Status.Message),
			ExitCode: ExitCodeFailedEvicted,
		}
	case "StartError":
		return &TaskStatusResult{
			Status:   StatusFailedStartError,
			Message:  fmt.Sprintf("Pod failed to start: %s. ", pod.Status.Message),
			ExitCode: ExitCodeFailedStartError,
		}
	case "UnexpectedAdmissionError":
		// e.g. GPU drops
		return &TaskStatusResult{
			Status:   StatusFailedBackendError,
			Message:  fmt.Sprintf("Pod admission error: %s. ", pod.Status.Message),
			ExitCode: ExitCodeFailedBackendError,
		}
	default:
		return nil
	}
}

// isCtrlContainerTerminated checks if osmo-ctrl container is terminated
func isCtrlContainerTerminated(pod *corev1.Pod) bool {
	for _, container := range pod.Status.ContainerStatuses {
		if container.Name == "osmo-ctrl" {
			return container.State.Terminated != nil
		}
	}
	return true
}

// CalculateTaskStatus calculates the comprehensive task status from pod
func CalculateTaskStatus(pod *corev1.Pod) TaskStatusResult {
	// Check specific failure reasons
	if result := getPodReasonFailure(pod); result != nil {
		return *result
	}

	// Check condition failures
	if result := getPodConditionFailure(pod); result != nil {
		return *result
	}

	// Check container failures
	ca := NewContainerStatus(pod)

	if ca.HasError() {
		message := ca.GetErrorMessage()
		if pod.Status.Message != "" {
			message = fmt.Sprintf("Pod %s error message: %s. \n%s",
				pod.Name, pod.Status.Message, message)
		}
		status, exitCode := ca.SpecificFailureOverride(pod)

		// If it is a general failure, ignore it if osmo-ctrl is not terminated
		if status == StatusFailed && !isCtrlContainerTerminated(pod) {
			// osmo-ctrl is still running, continue to check normal pod status
		} else {
			return TaskStatusResult{
				Status:   status,
				Message:  message,
				ExitCode: exitCode,
			}
		}
	} else if pod.Status.Phase == corev1.PodFailed {
		// Pod failed with no error codes
		message := ""
		if pod.Status.Message != "" {
			message = fmt.Sprintf("Pod %s error message: %s. ", pod.Name, pod.Status.Message)
		}
		return TaskStatusResult{
			Status:   StatusFailed,
			Message:  message,
			ExitCode: ExitCodeFailedUnknown,
		}
	}

	// Other statuses based on pod phase
	statusMap := map[corev1.PodPhase]string{
		corev1.PodPending:   StatusScheduling,
		corev1.PodRunning:   StatusRunning,
		corev1.PodSucceeded: StatusCompleted,
		corev1.PodUnknown:   StatusUnknown,
	}
	status, ok := statusMap[pod.Status.Phase]
	if !ok {
		status = StatusUnknown
	}

	// Check for initializing status
	for _, initStatus := range pod.Status.InitContainerStatuses {
		if initStatus.State.Waiting != nil {
			reason := initStatus.State.Waiting.Reason
			if reason == "ContainerCreating" || reason == "PodInitializing" {
				status = StatusInitializing
				break
			}
		}
	}

	exitCode := ExitCodeNotSet
	if status == StatusCompleted {
		exitCode = 0
	}

	return TaskStatusResult{
		Status:   status,
		Message:  pod.Status.Message,
		ExitCode: exitCode,
	}
}
