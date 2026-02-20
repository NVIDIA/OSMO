//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at

//http://www.apache.org/licenses/LICENSE-2.0

//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.

//SPDX-License-Identifier: Apache-2.0

/**
 * Kubernetes Event Domain Types
 *
 * References:
 * - Pod lifecycle & conditions:  https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/
 * - Pod disruption conditions:   https://kubernetes.io/docs/concepts/workloads/pods/disruptions/#pod-disruption-conditions
 * - Pod condition types (source): https://github.com/kubernetes/api/blob/master/core/v1/types.go
 * - Kubelet event reasons (source): https://github.com/kubernetes/kubernetes/blob/master/pkg/kubelet/events/event.go
 */

// ============================================================================
// Pod Phase (Canonical K8s)
// ============================================================================

/**
 * Pod phase is a high-level summary of where the Pod is in its lifecycle.
 * Maps to k8s.io/api/core/v1.PodPhase
 */
export type PodPhase =
  | "Pending" // Pod accepted, containers not ready (scheduling + image pull)
  | "Running" // Pod bound to node, at least one container running
  | "Succeeded" // All containers terminated successfully, won't restart
  | "Failed" // All containers terminated, at least one failed
  | "Unknown"; // Pod state cannot be obtained (node communication error)

// ============================================================================
// Event Severity & Lifecycle (UI-Specific)
// ============================================================================

/**
 * Event severity derived from K8s event type + reason.
 * UI-specific classification for filtering and display.
 */
export type EventSeverity = "info" | "warn" | "error";

/**
 * Lifecycle stage derived from K8s event reason.
 * UI-specific grouping for timeline visualization.
 */
export type LifecycleStage =
  | "scheduling" // Scheduled, FailedScheduling
  | "initialization" // Init containers running
  | "image" // Pulling, Pulled, ErrImagePull, ImagePullBackOff
  | "container" // Created, Started, Ready, Killing
  | "runtime" // Running state, probes
  | "failure" // Failed, BackOff, CrashLoopBackOff, OOMKilled, Evicted
  | "completion"; // Completed, Succeeded

// ============================================================================
// Event Types
// ============================================================================

/**
 * Event source identifies the component that generated the event.
 * Maps to k8s.io/api/core/v1.EventSource
 */
export interface EventSource {
  component: string; // e.g., "kubelet", "scheduler", "controller-manager"
  host?: string; // Node hostname where event originated
}

/**
 * Involved object reference.
 * Maps to k8s.io/api/core/v1.ObjectReference
 */
export interface InvolvedObjectReference {
  kind: "Pod" | "Workflow" | "Task"; // Resource kind
  name: string; // Resource name
  namespace?: string;
  uid?: string; // Resource UID
}

/**
 * Kubernetes event parsed from the plain text backend response.
 * Based on k8s.io/api/core/v1.Event
 */
export interface K8sEvent {
  // Identity
  id: string; // Generated: `${timestamp}-${counter}`

  // Timing
  timestamp: Date; // Primary event timestamp

  // Classification (from plain text parsing)
  entity: string; // Parsed from [entity] (e.g., "worker_27" or "worker_27 retry-2")
  taskName: string; // Task name without retry suffix (e.g., "worker_27")
  retryId: number; // Retry attempt number (0 for initial, >0 for retries)
  type: "Normal" | "Warning"; // Event type (inferred from reason)
  reason: string; // Short CamelCase reason (e.g., "Pulled", "Created")
  message: string; // Human-readable description

  // Kubernetes Canonical Fields
  source: EventSource; // Component that reported the event
  involvedObject: InvolvedObjectReference; // Object this event is about

  // UI-Specific Derived Fields
  severity: EventSeverity; // info/warn/error (for filtering)
  stage: LifecycleStage; // Lifecycle stage (for grouping)

  // Optional Enhanced Fields (extracted from message when available)
  containerName?: string; // Container name if event is container-specific
  exitCode?: number; // Exit code if terminated event
  signal?: number; // Signal if killed by signal
}

// ============================================================================
// Event Reason Categories (Canonical K8s)
// ============================================================================

/**
 * Comprehensive set of Kubernetes event reasons.
 * Reference: https://kubernetes.io/docs/reference/kubernetes-api/cluster-resources/event-v1/
 */
export const K8S_EVENT_REASONS = {
  // Pod Scheduling
  SCHEDULED: "Scheduled",
  FAILED_SCHEDULING: "FailedScheduling",
  PREEMPTING: "Preempting",
  UNSCHEDULABLE: "Unschedulable",
  SCHEDULER_ERROR: "SchedulerError",

  // Pod Conditions (condition.type used as event reason when condition.reason is absent)
  POD_SCHEDULED: "PodScheduled",
  INITIALIZED: "Initialized",
  DISRUPTION_TARGET: "DisruptionTarget",

  // Image Operations
  PULLING: "Pulling",
  PULLED: "Pulled",
  ERR_IMAGE_PULL: "ErrImagePull",
  IMAGE_PULL_BACK_OFF: "ImagePullBackOff",
  ERR_IMAGE_NEVER_PULL: "ErrImageNeverPull",
  INVALID_IMAGE_NAME: "InvalidImageName",
  INSPECT_FAILED: "InspectFailed",

  // Pod Sandbox & Container Creation
  FAILED_CREATE_POD_SANDBOX: "FailedCreatePodSandBox",
  FAILED_POD_SANDBOX_STATUS: "FailedPodSandBoxStatus",
  FAILED_CREATE_POD_CONTAINER: "FailedCreatePodContainer",
  SANDBOX_CHANGED: "SandboxChanged",

  // Container Lifecycle
  CREATED: "Created",
  STARTED: "Started",
  KILLING: "Killing",
  PREEMPTING_CONTAINER: "Preempting",
  EXCEEDED_GRACE_PERIOD: "ExceededGracePeriod",

  // Container Readiness
  READY: "Ready",
  NOT_READY: "NotReady",
  POD_READY_TO_START_CONTAINERS: "PodReadyToStartContainers",
  CONTAINERS_READY: "ContainersReady",

  // Container Failures
  FAILED: "Failed",
  BACK_OFF: "BackOff",
  CRASH_LOOP_BACK_OFF: "CrashLoopBackOff",
  OOM_KILLED: "OOMKilled",
  CONTAINER_DIED: "ContainerDied",
  ERROR: "Error",

  // Lifecycle Hooks
  FAILED_POST_START_HOOK: "FailedPostStartHook",
  FAILED_PRE_STOP_HOOK: "FailedPreStopHook",

  // Pod Eviction
  EVICTED: "Evicted",
  FAILED_EVICTION: "FailedEviction",

  // Resource Pressure
  NODE_NOT_READY: "NodeNotReady",
  NODE_MEMORY_PRESSURE: "NodeMemoryPressure",
  NODE_DISK_PRESSURE: "NodeDiskPressure",
  NODE_PID_PRESSURE: "NodePIDPressure",
  NETWORK_NOT_READY: "NetworkNotReady",

  // Probe Failures
  UNHEALTHY: "Unhealthy",
  PROBE_WARNING: "ProbeWarning",

  // Runtime
  FAILED_KILL_POD: "FailedKillPod",
  FAILED_SYNC: "FailedSync",

  // Volume Operations
  FAILED_MOUNT: "FailedMount",
  FAILED_ATTACH_VOLUME: "FailedAttachVolume",
  FAILED_MAP_VOLUME: "FailedMapVolume",
  FAILED_MOUNT_ON_FILESYSTEM_MISMATCH: "FailedMountOnFilesystemMismatch",
  VOLUME_RESIZE_FAILED: "VolumeResizeFailed",
  WARNING_VOLUME_RESIZE: "WarningVolumeResize",

  // In-Place Pod Resize (K8s 1.27+)
  RESIZE_STARTED: "ResizeStarted",
  RESIZE_COMPLETED: "ResizeCompleted",
  RESIZE_DEFERRED: "ResizeDeferred",
  RESIZE_INFEASIBLE: "ResizeInfeasible",
  RESIZE_ERROR: "ResizeError",

  // Completion
  COMPLETED: "Completed",
  SUCCEEDED: "Succeeded",
} as const;

export type K8sEventReason = (typeof K8S_EVENT_REASONS)[keyof typeof K8S_EVENT_REASONS];
