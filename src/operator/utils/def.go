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

// // Constants for exit code offsets
// const (
// 	ExitCodeOffsetInit      = 255
// 	ExitCodeOffsetPreflight = 1000
// 	ExitCodeOffsetCtrl      = 2000
// )

// Task status strings
const (
	StatusScheduling      = "SCHEDULING"
	StatusInitializing    = "INITIALIZING"
	StatusRunning         = "RUNNING"
	StatusCompleted       = "COMPLETED"
	StatusFailed          = "FAILED"
	StatusFailedPreempted = "FAILED_PREEMPTED"
	// StatusFailedEvicted      = "FAILED_EVICTED"
	// StatusFailedStartError = "FAILED_START_ERROR"
	// StatusFailedBackendError = "FAILED_BACKEND_ERROR"
	// StatusFailedImagePull    = "FAILED_IMAGE_PULL"
)

// Exit codes
const (
	ExitCodeNotSet = -1 // No exit code available
	// ExitCodeCompleted          = 0
	// ExitCodeFailedBackendError = 3001 // StatusFailedBackendError
	// ExitCodeFailedServerError  = 3002
	// ExitCodeFailedStartError   = 3003 // StatusFailedStartError
	// ExitCodeFailedEvicted      = 3004 // StatusFailedEvicted
	// ExitCodeFailedStartTimeout = 3005
	ExitCodeFailedPreempted = 3006 // StatusFailedPreempted
	// ExitCodeFailedUnknown      = 4000 // StatusFailed (default)
)

// Map of waiting reasons to exit codes
var WaitingReasonToExitCode = map[string]int32{
	"ImagePullBackOff":           301,
	"ErrImagePull":               302,
	"ContainerCreateConfigError": 303,
	"CrashLoopBackOff":           304,
}
