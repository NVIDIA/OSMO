/*
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION. All rights reserved.

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
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

// checkPreemptionByScheduler checks if the pod was preempted by the scheduler
func checkPreemptionByScheduler(pod *corev1.Pod) (bool, string) {
	for _, cond := range pod.Status.Conditions {
		if cond.Status == corev1.ConditionTrue && cond.Reason == "PreemptionByScheduler" {
			return true, fmt.Sprintf("Pod was preempted at %s. ", cond.LastTransitionTime.String())
		}
	}
	return false, ""
}

// // PodErrorInfo stores information about pod failures
// type PodErrorInfo struct {
// 	ErrorMessage string
// 	ExitCodes    map[string]int32
// 	ErrorReasons map[string]string
// }

// // GetExitCode returns the maximum exit code after applying offsets
// func (pei *PodErrorInfo) GetExitCode() int32 {
// 	if len(pei.ExitCodes) == 0 {
// 		return ExitCodeNotSet
// 	}

// 	// Apply offsets and get maximum
// 	maxCode := int32(0)
// 	for container, code := range pei.ExitCodes {
// 		adjustedCode := getContainerExitCode(container, code)
// 		if adjustedCode > maxCode {
// 			maxCode = adjustedCode
// 		}
// 	}
// 	return maxCode
// }

// // PodWaitingStatus stores information about waiting pods
// type PodWaitingStatus struct {
// 	WaitingOnError bool
// 	WaitingReason  string
// 	ErrorInfo      PodErrorInfo
// }

// PodStatusResult contains the comprehensive status information
type PodStatusResult struct {
	Status   string
	Message  string
	ExitCode int32
}

// // getContainerExitCode applies exit code offsets based on container name
// func getContainerExitCode(containerName string, exitCode int32) int32 {
// 	switch containerName {
// 	case "osmo-init":
// 		return ExitCodeOffsetInit + exitCode
// 	case "preflight-test":
// 		return ExitCodeOffsetPreflight + exitCode
// 	case "osmo-ctrl":
// 		return ExitCodeOffsetCtrl + exitCode
// 	default:
// 		return exitCode
// 	}
// }

// // errorMsgContainerName returns a human-readable container name for error messages
// func errorMsgContainerName(containerName string) string {
// 	switch containerName {
// 	case "osmo-ctrl":
// 		return "OSMO Control"
// 	case "preflight-test":
// 		return "OSMO Preflight Test"
// 	default:
// 		return fmt.Sprintf("Task %s", containerName)
// 	}
// }

// // getContainerWaitingErrorInfo checks for waiting errors in container statuses
// func getContainerWaitingErrorInfo(pod *corev1.Pod) PodWaitingStatus {
// 	waitingReasons := []string{"Failed", "BackOff", "Err"}

// 	// Check both regular and init containers
// 	allContainers := append([]corev1.ContainerStatus{}, pod.Status.ContainerStatuses...)
// 	allContainers = append(allContainers, pod.Status.InitContainerStatuses...)

// 	for _, cs := range allContainers {
// 		if cs.State.Waiting == nil {
// 			continue
// 		}

// 		reason := cs.State.Waiting.Reason

// 		// Check if reason contains any error indicators
// 		hasError := false
// 		for _, reasonKey := range waitingReasons {
// 			if strings.Contains(reason, reasonKey) {
// 				hasError = true
// 				break
// 			}
// 		}
// 		if !hasError {
// 			continue
// 		}

// 		// Map waiting reason to exit code, default to 999 if not found
// 		exitCode, ok := WaitingReasonToExitCode[reason]
// 		if !ok {
// 			exitCode = 999
// 		}

// 		containerName := errorMsgContainerName(cs.Name)
// 		message := fmt.Sprintf("Failure reason: Exit code %d due to %s failed with %s: %s.",
// 			exitCode, containerName, reason, cs.State.Waiting.Message)
// 		// TODO error code needs to add offset
// 	}
// }

// checkRunningPodContainers checks for terminated containers in running pods
// func checkRunningPodContainers(pod *corev1.Pod) PodErrorInfo {
// 	for _, cs := range pod.Status.ContainerStatuses {
// 		if cs.State.Terminated != nil {
// 			// Check if it's osmo-ctrl or has a reason requiring cleanup
// 			if cs.Name == "osmo-ctrl" || cs.State.Terminated.Reason == "StartError" {
// 				return getContainerFailureMessage(pod)
// 			}
// 		}
// 	}

// 	return PodErrorInfo{ErrorMessage: "", ExitCodes: map[string]int32{}}
// }

// // getContainerFailureMessage extracts failure information from terminated containers
// func getContainerFailureMessage(pod *corev1.Pod) PodErrorInfo {
// 	errorMsg := ""
// 	exitCodes := map[string]int32{}
// 	errorReasons := map[string]string{}

// 	// Check both init and regular containers
// 	allContainers := append([]corev1.ContainerStatus{}, pod.Status.InitContainerStatuses...)
// 	allContainers = append(allContainers, pod.Status.ContainerStatuses...)

// 	for _, cs := range allContainers {
// 		if cs.State.Terminated != nil && cs.State.Terminated.Reason != "Completed" {
// 			containerName := errorMsgContainerName(cs.Name)
// 			exitCode := cs.State.Terminated.ExitCode

// 			// Special handling for osmo-ctrl: extract exit code from JSON message
// 			if cs.Name == "osmo-ctrl" && cs.State.Terminated.Message != "" {
// 				var msgData map[string]interface{}
// 				if err := json.Unmarshal([]byte(cs.State.Terminated.Message), &msgData); err == nil {
// 					if code, ok := msgData["code"].(float64); ok {
// 						exitCode = int32(code)
// 					}
// 				}
// 			}

// 			adjustedExitCode := getContainerExitCode(cs.Name, exitCode)
// 			errorMsg += fmt.Sprintf("\n- Exit code %d due to %s failure. ", adjustedExitCode, containerName)
// 			exitCodes[cs.Name] = exitCode
// 			errorReasons[cs.Name] = cs.State.Terminated.Reason
// 		}
// 	}

// 	errorInfo := PodErrorInfo{
// 		ExitCodes:    exitCodes,
// 		ErrorReasons: errorReasons,
// 	}

// 	if errorMsg != "" {
// 		errorInfo.ErrorMessage = fmt.Sprintf("Failure reason:%s", errorMsg)
// 	}

// 	return errorInfo
// }

// // checkFailurePodConditions checks pod conditions for specific failure types
// func checkFailurePodConditions(pod *corev1.Pod) (bool, string, int32) {
// 	for _, cond := range pod.Status.Conditions {
// 		if cond.Type == "DisruptionTarget" && cond.Status == corev1.ConditionTrue {
// 			return true, StatusFailedBackendError, ExitCodeFailedBackendError
// 		}
// 	}
// 	return false, "", ExitCodeNotSet
// }

// CalculatePodStatus calculates the comprehensive pod status
func CalculatePodStatus(pod *corev1.Pod) PodStatusResult {
	// Check for preemption
	isPreempted, message := checkPreemptionByScheduler(pod)
	if isPreempted {
		return PodStatusResult{
			Status:   StatusFailedPreempted,
			Message:  message,
			ExitCode: ExitCodeFailedPreempted,
		}
	}

	// 	// Get waiting error info
	// 	podWaitingStatus := getContainerWaitingErrorInfo(pod)
	// 	message = podWaitingStatus.ErrorInfo.ErrorMessage

	// Base status mapping from Kubernetes pod phases to task status
	statusMap := map[corev1.PodPhase]string{
		corev1.PodPending:   StatusScheduling,
		corev1.PodRunning:   StatusRunning,
		corev1.PodSucceeded: StatusCompleted,
		corev1.PodFailed:    StatusFailed,
	}

	status := statusMap[pod.Status.Phase] // status can be ""

	// // Check for init container initialization
	// for _, initStatus := range pod.Status.InitContainerStatuses {
	// 	if initStatus.State.Waiting != nil {
	// 		reason := initStatus.State.Waiting.Reason
	// 		if reason == "ContainerCreating" || reason == "PodInitializing" {
	// 			status = StatusInitializing
	// 			break
	// 		}
	// 	}
	// }

	// exitCode := int32(ExitCodeNotSet)

	// // Check running pod containers
	// if status == StatusRunning {
	// 	errorInfo := checkRunningPodContainers(pod)
	// 	if len(errorInfo.ExitCodes) > 0 {
	// 		exitCode = errorInfo.GetExitCode()
	// 		message = errorInfo.ErrorMessage
	// 		status = StatusFailed
	// 	}
	// }

	// 	// Check failed status
	// 	if strings.HasPrefix(status, "FAILED") {
	// 		errorInfo := getContainerFailureMessage(pod)
	// 		message = errorInfo.ErrorMessage
	// 		if pod.Status.Message != "" {
	// 			message = fmt.Sprintf("Pod %s error message: %s\n%s", pod.Name, pod.Status.Message, message)
	// 		}
	// 		exitCode = errorInfo.GetExitCode()
	// 		if exitCode == ExitCodeNotSet {
	// 			exitCode = ExitCodeFailedUnknown
	// 		}

	// 		// Check for OOMKilled
	// 		for _, reason := range errorInfo.ErrorReasons {
	// 			if reason == "OOMKilled" {
	// 				status = StatusFailedEvicted
	// 				exitCode = ExitCodeFailedEvicted
	// 				break
	// 			}
	// 		}
	// 	}

	// 	// Completed status
	// 	if status == StatusCompleted {
	// 		exitCode = ExitCodeCompleted
	// 	}

	// 	// Check for waiting errors
	// 	if podWaitingStatus.WaitingOnError {
	// 		errorInfo := podWaitingStatus.ErrorInfo
	// 		exitCode = errorInfo.GetExitCode()

	// 		switch podWaitingStatus.WaitingReason {
	// 		case "ErrImagePull", "ImagePullBackOff":
	// 			status = StatusFailedImagePull
	// 		case "CreateContainerConfigError":
	// 			status = StatusScheduling
	// 			exitCode = ExitCodeNotSet

	// 			// Check if stuck for more than 10 minutes
	// 			for _, cond := range pod.Status.Conditions {
	// 				if cond.Type == corev1.PodReady && cond.Status == corev1.ConditionFalse {
	// 					timeDiff := time.Since(cond.LastTransitionTime.Time)
	// 					if timeDiff > 10*time.Minute {
	// 						status = StatusFailedBackendError
	// 						exitCode = ExitCodeFailedBackendError
	// 						break
	// 					}
	// 				}
	// 			}
	// 		default:
	// 			status = StatusFailed
	// 		}
	// 	}

	// 	// Check pod status reason
	// 	if pod.Status.Reason == "Evicted" {
	// 		status = StatusFailedEvicted
	// 		exitCode = ExitCodeFailedEvicted
	// 	} else if pod.Status.Reason == "StartError" {
	// 		status = StatusFailedStartError
	// 		exitCode = ExitCodeFailedStartError
	// 	} else if pod.Status.Reason == "UnexpectedAdmissionError" {
	// 		status = StatusFailedBackendError
	// 		exitCode = ExitCodeFailedBackendError
	// 	} else {
	// 		// Check failure conditions
	// 		failureFound, failureStatus, failureExitCode := checkFailurePodConditions(pod)
	// 		if failureFound {
	// 			status = failureStatus
	// 			exitCode = failureExitCode
	// 		}
	// 	}

	return PodStatusResult{
		Status:   status,
		Message:  pod.Status.Message,
		ExitCode: int32(ExitCodeNotSet),
	}
}

// // GetPodMessage extracts a meaningful message from pod status
// func GetPodMessage(pod *corev1.Pod) string {
// 	// Check container statuses for meaningful messages
// 	for _, cs := range pod.Status.ContainerStatuses {
// 		if cs.State.Waiting != nil && cs.State.Waiting.Message != "" {
// 			return cs.State.Waiting.Message
// 		}
// 		if cs.State.Terminated != nil && cs.State.Terminated.Message != "" {
// 			return cs.State.Terminated.Message
// 		}
// 	}

// 	// Check pod conditions
// 	for _, cond := range pod.Status.Conditions {
// 		if cond.Status == corev1.ConditionFalse &&
// 			cond.Message != "" {
// 			return cond.Message
// 		}
// 	}

// 	return pod.Status.Message
// }

// CreateKubernetesClient creates a Kubernetes clientset using
// in-cluster or kubeconfig
func CreateKubernetesClient() (*kubernetes.Clientset, error) {
	// Try in-cluster config first
	config, err := rest.InClusterConfig()
	if err != nil {
		// Fall back to kubeconfig
		loadingRules := clientcmd.NewDefaultClientConfigLoadingRules()
		configOverrides := &clientcmd.ConfigOverrides{}
		kubeConfig := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(
			loadingRules, configOverrides,
		)
		config, err = kubeConfig.ClientConfig()
		if err != nil {
			return nil, fmt.Errorf(
				"failed to load kubernetes config: %w",
				err,
			)
		}
	}

	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		return nil, fmt.Errorf(
			"failed to create kubernetes clientset: %w",
			err,
		)
	}

	return clientset, nil
}
