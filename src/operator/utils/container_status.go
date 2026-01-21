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
	"maps"
	"slices"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
)

type ContainerName string

const (
	ContainerOsmoInit      ContainerName = "osmo-init"
	ContainerPreflightTest ContainerName = "preflight-test"
	ContainerOsmoCtrl      ContainerName = "osmo-ctrl"
)

// Container exit code offsets
var containerExitCodeOffsets = map[ContainerName]int32{
	ContainerOsmoInit:      255,  // ExitCodeOffsetInit
	ContainerPreflightTest: 1000, // ExitCodeOffsetPreflight
	ContainerOsmoCtrl:      2000, // ExitCodeOffsetCtrl
}

// Waiting error detection
var (
	waitingErrorKeywords        = []string{"Failed", "BackOff", "Err", "ContainerStatusUnknown"}
	waitingErrorDefaultExitCode = int32(999)
	waitingErrorCodes           = map[string]int32{
		"ImagePullBackOff":           301,
		"ErrImagePull":               302,
		"CreateContainerConfigError": 303,
		"CrashLoopBackOff":           304,
		"ContainerStatusUnknown":     305,
	}
)

// ContainerStatus holds container reasons and exit codes
type ContainerStatus struct {
	Reasons   map[string]string // container name -> reason (waiting or terminated)
	ExitCodes map[string]int32  // container name -> exit code
	Messages  map[string]string // container name -> message
}

// NewContainerStatus creates a new ContainerStatus from a pod
func NewContainerStatus(pod *corev1.Pod) *ContainerStatus {
	cs := &ContainerStatus{
		Reasons:   make(map[string]string),
		ExitCodes: make(map[string]int32),
		Messages:  make(map[string]string),
	}

	// Collect ALL containers (init + regular)
	allContainers := append([]corev1.ContainerStatus{}, pod.Status.InitContainerStatuses...)
	allContainers = append(allContainers, pod.Status.ContainerStatuses...)

	for _, container := range allContainers {
		if container.State.Terminated != nil {
			exitCode := getTerminatedErrorExitCode(container.Name, container.State.Terminated)
			if exitCode != ExitCodeNotSet {
				cs.Reasons[container.Name] = container.State.Terminated.Reason
				cs.Messages[container.Name] = container.State.Terminated.Message
				cs.ExitCodes[container.Name] = applyExitCodeOffset(container.Name, exitCode)
			}
		} else if container.State.Waiting != nil {
			reason := container.State.Waiting.Reason
			exitCode := getWaitingErrorExitCode(reason)
			if exitCode != ExitCodeNotSet {
				cs.Reasons[container.Name] = reason
				cs.Messages[container.Name] = container.State.Waiting.Message
				cs.ExitCodes[container.Name] = applyExitCodeOffset(container.Name, exitCode)
			}
		}
	}

	return cs
}

// HasError returns true if there are any container errors
func (cs *ContainerStatus) HasError() bool {
	return len(cs.ExitCodes) > 0
}

// GetMaxExitCode returns the maximum exit code from the container exit codes
// Exit codes are already stored with offsets applied
func (cs *ContainerStatus) GetMaxExitCode() int32 {
	if !cs.HasError() {
		return ExitCodeNotSet
	}
	return slices.Max(slices.Collect(maps.Values(cs.ExitCodes)))
}

// GetErrorMessage builds a comprehensive error message from container failures
// Exit codes are already stored with offsets applied
func (cs *ContainerStatus) GetErrorMessage() string {
	if !cs.HasError() {
		return ""
	}

	var errorMsgParts []string
	for containerName, exitCode := range cs.ExitCodes {
		containerDisplayName := getContainerDisplayName(containerName)
		reason := cs.Reasons[containerName]
		message := cs.Messages[containerName]

		var msgPart string
		if reason != "" {
			msgPart = fmt.Sprintf("\n- Exit code %d due to %s failed with %s",
				exitCode, containerDisplayName, reason)
		} else {
			msgPart = fmt.Sprintf("\n- Exit code %d due to %s failure",
				exitCode, containerDisplayName)
		}
		if message != "" {
			msgPart += fmt.Sprintf(": %s", message)
		}
		msgPart += ". "
		errorMsgParts = append(errorMsgParts, msgPart)
	}

	return "Failure reason:" + strings.Join(errorMsgParts, "")
}

// SpecificFailureOverride checks for specific container failure reasons
// and returns the appropriate status and exit code.
// Returns default otherwise (StatusFailed, maxExitCode).
func (cs *ContainerStatus) SpecificFailureOverride(pod *corev1.Pod) (string, int32) {
	for containerName, reason := range cs.Reasons {
		switch reason {
		case "OOMKilled":
			return StatusFailedEvicted, ExitCodeFailedEvicted
		case "StartError":
			return StatusFailedStartError, ExitCodeFailedStartError
		case "ErrImagePull", "ImagePullBackOff":
			return StatusFailedImagePull, cs.ExitCodes[containerName]
		case "CreateContainerConfigError":
			// If stuck for more than 10 minutes, mark it as failed
			if isPodStuckTimeout(pod, 10*time.Minute) {
				return StatusFailedBackendError, ExitCodeFailedBackendError
			}
			return StatusUnknown, ExitCodeNotSet
		case "ContainerStatusUnknown":
			// ContainerStatusUnknown occurs when a node becomes unreachable
			// and the kubelet stops reporting container status.
			// If stuck for more than 30 minutes, mark it as failed
			if isPodStuckTimeout(pod, 30*time.Minute) {
				return StatusFailedBackendError, ExitCodeFailedBackendError
			}
			return StatusUnknown, ExitCodeNotSet
		}
	}
	return StatusFailed, cs.GetMaxExitCode()
}

// isPodStuckTimeout checks if the pod has been in Ready=False condition
// for longer than the timeout. Returns true if stuck beyond the timeout.
func isPodStuckTimeout(pod *corev1.Pod, timeout time.Duration) bool {
	for _, condition := range pod.Status.Conditions {
		// When a container fails to create, the pod will not be Ready.
		// The lastTransitionTime is the closest timestamp.
		if condition.Type == corev1.PodReady &&
			condition.Status == corev1.ConditionFalse {
			lastTransitionTime := condition.LastTransitionTime.Time
			if !lastTransitionTime.IsZero() {
				timeDiff := time.Since(lastTransitionTime)
				if timeDiff > timeout {
					return true
				}
			}
		}
	}
	return false
}

// getContainerDisplayName formats container name for error messages
func getContainerDisplayName(containerName string) string {
	switch ContainerName(containerName) {
	case ContainerOsmoCtrl:
		return "OSMO Control"
	case ContainerPreflightTest:
		return "OSMO Preflight Test"
	case ContainerOsmoInit:
		return "OSMO Init"
	default:
		return fmt.Sprintf("Task %s", containerName)
	}
}

// applyExitCodeOffset applies container-specific offset to exit code
func applyExitCodeOffset(containerName string, exitCode int32) int32 {
	if offset, ok := containerExitCodeOffsets[ContainerName(containerName)]; ok {
		return offset + exitCode
	}
	return exitCode
}

// getTerminatedErrorExitCode returns the exit code for a terminated container error
// Returns ExitCodeNotSet if the container should be skipped (e.g., Completed)
func getTerminatedErrorExitCode(containerName string, terminated *corev1.ContainerStateTerminated) int32 {
	if terminated == nil || terminated.Reason == "Completed" {
		return ExitCodeNotSet
	}

	exitCode := terminated.ExitCode

	// For osmo-ctrl, parse JSON message for custom exit code
	if ContainerName(containerName) == ContainerOsmoCtrl && terminated.Message != "" {
		var messageJSON map[string]interface{}
		if err := json.Unmarshal([]byte(terminated.Message), &messageJSON); err == nil {
			if code, ok := messageJSON["code"].(float64); ok {
				exitCode = int32(code)
			}
		}
	}

	return exitCode
}

// getWaitingErrorExitCode returns the exit code for a waiting error reason
// Returns ExitCodeNotSet (-1) if the reason is not a waiting error
func getWaitingErrorExitCode(reason string) int32 {
	for _, keyword := range waitingErrorKeywords {
		if strings.Contains(reason, keyword) {
			if code, ok := waitingErrorCodes[reason]; ok {
				return code
			}
			return waitingErrorDefaultExitCode
		}
	}
	return ExitCodeNotSet
}
