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
 * Kubernetes Event Classification and Utilities
 * Based on canonical K8s event reasons and pod lifecycle semantics.
 */

import type { EventSeverity, LifecycleStage } from "@/lib/api/adapter/events/events-types";
import { K8S_EVENT_REASONS } from "@/lib/api/adapter/events/events-types";

// ============================================================================
// Timeline Color Type
// ============================================================================

/**
 * Timeline colors for visual status indication:
 * - green: Success/healthy (Scheduled, Ready, Started, Completed)
 * - blue: In-progress (Pulling, Creating containers)
 * - amber: Non-terminal failures (ImagePullBackOff, CrashLoopBackOff, FailedScheduling)
 * - red: Terminal failures (OOMKilled, Failed, Evicted)
 */
export type TimelineColor = "green" | "blue" | "amber" | "red";

// ============================================================================
// Event Reason Classification
// ============================================================================

/**
 * Mapping of K8s event reasons to lifecycle stage + severity.
 */
const EVENT_REASON_MAP: Record<string, { stage: LifecycleStage; severity: EventSeverity }> = {
  // Pod Scheduling
  [K8S_EVENT_REASONS.SCHEDULED]: { stage: "scheduling", severity: "info" },
  [K8S_EVENT_REASONS.FAILED_SCHEDULING]: { stage: "scheduling", severity: "error" },
  [K8S_EVENT_REASONS.PREEMPTING]: { stage: "scheduling", severity: "warn" },

  // Image Operations
  [K8S_EVENT_REASONS.PULLING]: { stage: "image", severity: "info" },
  [K8S_EVENT_REASONS.PULLED]: { stage: "image", severity: "info" },
  [K8S_EVENT_REASONS.ERR_IMAGE_PULL]: { stage: "image", severity: "error" },
  [K8S_EVENT_REASONS.IMAGE_PULL_BACK_OFF]: { stage: "image", severity: "error" },
  [K8S_EVENT_REASONS.ERR_IMAGE_NEVER_PULL]: { stage: "image", severity: "error" },
  [K8S_EVENT_REASONS.INVALID_IMAGE_NAME]: { stage: "image", severity: "error" },

  // Container Lifecycle
  [K8S_EVENT_REASONS.CREATED]: { stage: "container", severity: "info" },
  [K8S_EVENT_REASONS.STARTED]: { stage: "container", severity: "info" },
  [K8S_EVENT_REASONS.KILLING]: { stage: "container", severity: "warn" },

  // Container Readiness
  [K8S_EVENT_REASONS.READY]: { stage: "container", severity: "info" },
  [K8S_EVENT_REASONS.NOT_READY]: { stage: "container", severity: "warn" },
  [K8S_EVENT_REASONS.POD_READY_TO_START_CONTAINERS]: { stage: "container", severity: "info" },
  [K8S_EVENT_REASONS.CONTAINERS_READY]: { stage: "container", severity: "info" },

  // Container Failures
  [K8S_EVENT_REASONS.FAILED]: { stage: "failure", severity: "error" },
  [K8S_EVENT_REASONS.BACK_OFF]: { stage: "failure", severity: "error" },
  [K8S_EVENT_REASONS.CRASH_LOOP_BACK_OFF]: { stage: "failure", severity: "error" },
  [K8S_EVENT_REASONS.OOM_KILLED]: { stage: "failure", severity: "error" },
  [K8S_EVENT_REASONS.CONTAINER_DIED]: { stage: "failure", severity: "error" },
  [K8S_EVENT_REASONS.ERROR]: { stage: "failure", severity: "error" },

  // Pod Eviction
  [K8S_EVENT_REASONS.EVICTED]: { stage: "failure", severity: "error" },
  [K8S_EVENT_REASONS.FAILED_EVICTION]: { stage: "failure", severity: "error" },

  // Resource Pressure
  [K8S_EVENT_REASONS.NODE_NOT_READY]: { stage: "runtime", severity: "error" },
  [K8S_EVENT_REASONS.NODE_MEMORY_PRESSURE]: { stage: "runtime", severity: "warn" },
  [K8S_EVENT_REASONS.NODE_DISK_PRESSURE]: { stage: "runtime", severity: "warn" },
  [K8S_EVENT_REASONS.NODE_PID_PRESSURE]: { stage: "runtime", severity: "warn" },

  // Probe Failures
  [K8S_EVENT_REASONS.UNHEALTHY]: { stage: "runtime", severity: "warn" },
  [K8S_EVENT_REASONS.PROBE_WARNING]: { stage: "runtime", severity: "warn" },

  // Volume Operations
  [K8S_EVENT_REASONS.FAILED_MOUNT]: { stage: "initialization", severity: "error" },
  [K8S_EVENT_REASONS.FAILED_ATTACH_VOLUME]: { stage: "initialization", severity: "error" },
  [K8S_EVENT_REASONS.FAILED_MAP_VOLUME]: { stage: "initialization", severity: "error" },
  [K8S_EVENT_REASONS.WARNING_VOLUME_RESIZE]: { stage: "runtime", severity: "warn" },

  // Completion
  [K8S_EVENT_REASONS.COMPLETED]: { stage: "completion", severity: "info" },
  [K8S_EVENT_REASONS.SUCCEEDED]: { stage: "completion", severity: "info" },
};

/**
 * Classify event reason into lifecycle stage and severity.
 * Falls back to runtime stage for unknown reasons.
 */
export function classifyEvent(
  reason: string,
  type: "Normal" | "Warning",
): { stage: LifecycleStage; severity: EventSeverity } {
  const mapped = EVENT_REASON_MAP[reason];
  if (mapped) return mapped;

  return {
    stage: "runtime",
    severity: type === "Warning" ? "warn" : "info",
  };
}

// ============================================================================
// Pod Phase Reason Sets (used by computeDerivedState)
// ============================================================================

export const SUCCEEDED_REASONS = new Set<string>([K8S_EVENT_REASONS.SUCCEEDED, K8S_EVENT_REASONS.COMPLETED]);

export const FAILED_REASONS = new Set<string>([
  K8S_EVENT_REASONS.FAILED,
  K8S_EVENT_REASONS.OOM_KILLED,
  K8S_EVENT_REASONS.EVICTED,
  K8S_EVENT_REASONS.CONTAINER_DIED,
  // Note: CRASH_LOOP_BACK_OFF is NOT terminal - pod is still Running and retrying
]);

export const RUNNING_REASONS = new Set<string>([K8S_EVENT_REASONS.STARTED, K8S_EVENT_REASONS.READY]);

export const PENDING_REASONS = new Set<string>([
  K8S_EVENT_REASONS.SCHEDULED,
  K8S_EVENT_REASONS.PULLING,
  K8S_EVENT_REASONS.PULLED,
  K8S_EVENT_REASONS.CREATED,
  K8S_EVENT_REASONS.FAILED_SCHEDULING,
  K8S_EVENT_REASONS.ERR_IMAGE_PULL,
  K8S_EVENT_REASONS.IMAGE_PULL_BACK_OFF,
  K8S_EVENT_REASONS.ERR_IMAGE_NEVER_PULL,
  K8S_EVENT_REASONS.INVALID_IMAGE_NAME,
  K8S_EVENT_REASONS.PREEMPTING,
]);

// ============================================================================
// Event Reason to Timeline Color Mapping
// ============================================================================

/**
 * Maps Kubernetes event reasons to timeline colors for visual status indication.
 *
 * Color semantics:
 * - green: Terminal success (Completed, Succeeded)
 * - blue: In-progress/active (Scheduled, Pulling, Started, Ready - non-terminal healthy states)
 * - amber: Non-terminal failures (ImagePullBackOff, CrashLoopBackOff, FailedScheduling)
 * - red: Terminal failures (OOMKilled, Failed, Evicted)
 */
export const EVENT_COLOR_MAP: Record<string, TimelineColor> = {
  // Pending stage
  [K8S_EVENT_REASONS.SCHEDULED]: "blue",
  [K8S_EVENT_REASONS.FAILED_SCHEDULING]: "amber",
  [K8S_EVENT_REASONS.PREEMPTING]: "amber",

  // Init stage
  [K8S_EVENT_REASONS.PULLING]: "blue",
  [K8S_EVENT_REASONS.PULLED]: "blue",
  [K8S_EVENT_REASONS.CREATED]: "blue",
  [K8S_EVENT_REASONS.ERR_IMAGE_PULL]: "amber",
  [K8S_EVENT_REASONS.IMAGE_PULL_BACK_OFF]: "amber",
  [K8S_EVENT_REASONS.POD_READY_TO_START_CONTAINERS]: "blue",

  // Running stage
  [K8S_EVENT_REASONS.STARTED]: "blue",
  [K8S_EVENT_REASONS.READY]: "blue",
  [K8S_EVENT_REASONS.CONTAINERS_READY]: "blue",
  [K8S_EVENT_REASONS.UNHEALTHY]: "amber",
  [K8S_EVENT_REASONS.NOT_READY]: "amber",
  [K8S_EVENT_REASONS.CRASH_LOOP_BACK_OFF]: "amber",
  [K8S_EVENT_REASONS.BACK_OFF]: "amber",
  [K8S_EVENT_REASONS.OOM_KILLED]: "red",
  [K8S_EVENT_REASONS.EVICTED]: "red",
  [K8S_EVENT_REASONS.CONTAINER_DIED]: "red",

  // Done stage
  [K8S_EVENT_REASONS.COMPLETED]: "green",
  [K8S_EVENT_REASONS.SUCCEEDED]: "green",
  [K8S_EVENT_REASONS.FAILED]: "red",
};

/**
 * Map an event reason to a timeline color.
 * Defaults to "blue" (in-progress) for unknown reasons.
 */
export function mapEventReasonToColor(reason: string): TimelineColor {
  return EVENT_COLOR_MAP[reason] ?? "blue";
}
