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
 *
 * References:
 * - Pod lifecycle & conditions:  https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/
 * - Pod disruption conditions:   https://kubernetes.io/docs/concepts/workloads/pods/disruptions/#pod-disruption-conditions
 * - Pod condition types (source): https://github.com/kubernetes/api/blob/master/core/v1/types.go
 * - Kubelet event reasons (source): https://github.com/kubernetes/kubernetes/blob/master/pkg/kubelet/events/event.go
 */

import type { EventSeverity, K8sEventReason, LifecycleStage } from "@/lib/api/adapter/events/events-types";
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
// Event Reason Registry (Single Source of Truth)
// ============================================================================

/**
 * Pod phase category for deriving pod phase from event reasons.
 * Absent means the event reason does not directly indicate a pod phase transition.
 */
type PodPhaseCategory = "pending" | "running" | "succeeded" | "failed";

/**
 * Complete classification for a single K8s event reason.
 * All event-reason-specific data lives here -- no other maps needed.
 */
export interface EventReasonConfig {
  stage: LifecycleStage;
  severity: EventSeverity;
  color: TimelineColor;
  podPhaseCategory?: PodPhaseCategory;
}

/**
 * Single source of truth for all K8s event reason classification.
 *
 * Every event reason is defined exactly once with its full configuration:
 * - stage: lifecycle stage for grouping in the timeline UI
 * - severity: info/warn/error for filtering and event type inference
 * - color: timeline color for visual status indication
 * - podPhaseCategory: optional pod phase mapping for deriving PodPhase from events
 *
 * To add a new reason, add a single entry here. All derived lookups
 * (phase sets, color map, warning set) update automatically.
 */
const EVENT_REASON_REGISTRY: Record<K8sEventReason, EventReasonConfig> = {
  // ── Pod Scheduling ──────────────────────────────────────────────────────
  [K8S_EVENT_REASONS.SCHEDULED]: { stage: "scheduling", severity: "info", color: "blue", podPhaseCategory: "pending" },
  [K8S_EVENT_REASONS.FAILED_SCHEDULING]: {
    stage: "scheduling",
    severity: "error",
    color: "amber",
    podPhaseCategory: "pending",
  },
  [K8S_EVENT_REASONS.PREEMPTING]: {
    stage: "scheduling",
    severity: "warn",
    color: "amber",
    podPhaseCategory: "pending",
  },
  [K8S_EVENT_REASONS.UNSCHEDULABLE]: {
    stage: "scheduling",
    severity: "warn",
    color: "amber",
    podPhaseCategory: "pending",
  },
  [K8S_EVENT_REASONS.SCHEDULER_ERROR]: {
    stage: "scheduling",
    severity: "error",
    color: "amber",
    podPhaseCategory: "pending",
  },
  [K8S_EVENT_REASONS.POD_SCHEDULED]: {
    stage: "scheduling",
    severity: "info",
    color: "green",
    podPhaseCategory: "pending",
  },

  // ── Pod Conditions ──────────────────────────────────────────────────────
  [K8S_EVENT_REASONS.INITIALIZED]: { stage: "initialization", severity: "info", color: "green" },
  [K8S_EVENT_REASONS.DISRUPTION_TARGET]: {
    stage: "failure",
    severity: "error",
    color: "red",
    podPhaseCategory: "failed",
  },

  // ── Image Operations ────────────────────────────────────────────────────
  [K8S_EVENT_REASONS.PULLING]: { stage: "image", severity: "info", color: "blue", podPhaseCategory: "pending" },
  [K8S_EVENT_REASONS.PULLED]: { stage: "image", severity: "info", color: "blue", podPhaseCategory: "pending" },
  [K8S_EVENT_REASONS.ERR_IMAGE_PULL]: {
    stage: "image",
    severity: "error",
    color: "amber",
    podPhaseCategory: "pending",
  },
  [K8S_EVENT_REASONS.IMAGE_PULL_BACK_OFF]: {
    stage: "image",
    severity: "error",
    color: "amber",
    podPhaseCategory: "pending",
  },
  [K8S_EVENT_REASONS.ERR_IMAGE_NEVER_PULL]: { stage: "image", severity: "error", color: "amber" },
  [K8S_EVENT_REASONS.INVALID_IMAGE_NAME]: { stage: "image", severity: "error", color: "amber" },
  [K8S_EVENT_REASONS.INSPECT_FAILED]: {
    stage: "image",
    severity: "error",
    color: "amber",
    podPhaseCategory: "pending",
  },

  // ── Pod Sandbox & Container Creation ────────────────────────────────────
  [K8S_EVENT_REASONS.FAILED_CREATE_POD_SANDBOX]: {
    stage: "initialization",
    severity: "error",
    color: "red",
    podPhaseCategory: "pending",
  },
  [K8S_EVENT_REASONS.FAILED_POD_SANDBOX_STATUS]: { stage: "runtime", severity: "warn", color: "amber" },
  [K8S_EVENT_REASONS.FAILED_CREATE_POD_CONTAINER]: {
    stage: "initialization",
    severity: "error",
    color: "red",
    podPhaseCategory: "pending",
  },
  [K8S_EVENT_REASONS.SANDBOX_CHANGED]: { stage: "runtime", severity: "warn", color: "amber" },

  // ── Container Lifecycle ─────────────────────────────────────────────────
  [K8S_EVENT_REASONS.CREATED]: { stage: "container", severity: "info", color: "blue", podPhaseCategory: "pending" },
  [K8S_EVENT_REASONS.STARTED]: { stage: "container", severity: "info", color: "blue", podPhaseCategory: "running" },
  [K8S_EVENT_REASONS.KILLING]: { stage: "container", severity: "warn", color: "amber" },
  [K8S_EVENT_REASONS.EXCEEDED_GRACE_PERIOD]: { stage: "runtime", severity: "warn", color: "amber" },

  // ── Container Readiness ─────────────────────────────────────────────────
  [K8S_EVENT_REASONS.READY]: { stage: "container", severity: "info", color: "blue", podPhaseCategory: "running" },
  [K8S_EVENT_REASONS.NOT_READY]: { stage: "container", severity: "warn", color: "amber" },
  [K8S_EVENT_REASONS.POD_READY_TO_START_CONTAINERS]: { stage: "container", severity: "info", color: "blue" },
  [K8S_EVENT_REASONS.CONTAINERS_READY]: { stage: "container", severity: "info", color: "blue" },

  // ── Container Failures ──────────────────────────────────────────────────
  [K8S_EVENT_REASONS.FAILED]: { stage: "failure", severity: "error", color: "red", podPhaseCategory: "failed" },
  [K8S_EVENT_REASONS.BACK_OFF]: { stage: "failure", severity: "error", color: "amber" },
  [K8S_EVENT_REASONS.CRASH_LOOP_BACK_OFF]: { stage: "failure", severity: "error", color: "amber" },
  [K8S_EVENT_REASONS.OOM_KILLED]: { stage: "failure", severity: "error", color: "red", podPhaseCategory: "failed" },
  [K8S_EVENT_REASONS.CONTAINER_DIED]: { stage: "failure", severity: "error", color: "red", podPhaseCategory: "failed" },
  [K8S_EVENT_REASONS.ERROR]: { stage: "failure", severity: "error", color: "red" },

  // ── Lifecycle Hooks ─────────────────────────────────────────────────────
  [K8S_EVENT_REASONS.FAILED_POST_START_HOOK]: { stage: "runtime", severity: "error", color: "red" },
  [K8S_EVENT_REASONS.FAILED_PRE_STOP_HOOK]: { stage: "runtime", severity: "warn", color: "amber" },

  // ── Pod Eviction ────────────────────────────────────────────────────────
  [K8S_EVENT_REASONS.EVICTED]: { stage: "failure", severity: "error", color: "red", podPhaseCategory: "failed" },
  [K8S_EVENT_REASONS.FAILED_EVICTION]: { stage: "failure", severity: "error", color: "red" },

  // ── Resource Pressure ───────────────────────────────────────────────────
  [K8S_EVENT_REASONS.NODE_NOT_READY]: { stage: "runtime", severity: "error", color: "red" },
  [K8S_EVENT_REASONS.NODE_MEMORY_PRESSURE]: { stage: "runtime", severity: "warn", color: "amber" },
  [K8S_EVENT_REASONS.NODE_DISK_PRESSURE]: { stage: "runtime", severity: "warn", color: "amber" },
  [K8S_EVENT_REASONS.NODE_PID_PRESSURE]: { stage: "runtime", severity: "warn", color: "amber" },
  [K8S_EVENT_REASONS.NETWORK_NOT_READY]: { stage: "runtime", severity: "error", color: "red" },

  // ── Probe Failures ──────────────────────────────────────────────────────
  [K8S_EVENT_REASONS.UNHEALTHY]: { stage: "runtime", severity: "warn", color: "amber" },
  [K8S_EVENT_REASONS.PROBE_WARNING]: { stage: "runtime", severity: "warn", color: "amber" },

  // ── Runtime ─────────────────────────────────────────────────────────────
  [K8S_EVENT_REASONS.FAILED_KILL_POD]: { stage: "runtime", severity: "error", color: "red" },
  [K8S_EVENT_REASONS.FAILED_SYNC]: { stage: "runtime", severity: "error", color: "red" },

  // ── Volume Operations ───────────────────────────────────────────────────
  [K8S_EVENT_REASONS.FAILED_MOUNT]: { stage: "initialization", severity: "error", color: "red" },
  [K8S_EVENT_REASONS.FAILED_ATTACH_VOLUME]: { stage: "initialization", severity: "error", color: "red" },
  [K8S_EVENT_REASONS.FAILED_MAP_VOLUME]: { stage: "initialization", severity: "error", color: "red" },
  [K8S_EVENT_REASONS.FAILED_MOUNT_ON_FILESYSTEM_MISMATCH]: { stage: "initialization", severity: "error", color: "red" },
  [K8S_EVENT_REASONS.VOLUME_RESIZE_FAILED]: { stage: "initialization", severity: "error", color: "red" },
  [K8S_EVENT_REASONS.WARNING_VOLUME_RESIZE]: { stage: "runtime", severity: "warn", color: "amber" },

  // ── In-Place Pod Resize (K8s 1.27+) ────────────────────────────────────
  [K8S_EVENT_REASONS.RESIZE_STARTED]: { stage: "runtime", severity: "info", color: "blue" },
  [K8S_EVENT_REASONS.RESIZE_COMPLETED]: { stage: "runtime", severity: "info", color: "blue" },
  [K8S_EVENT_REASONS.RESIZE_DEFERRED]: { stage: "runtime", severity: "warn", color: "amber" },
  [K8S_EVENT_REASONS.RESIZE_INFEASIBLE]: { stage: "runtime", severity: "warn", color: "amber" },
  [K8S_EVENT_REASONS.RESIZE_ERROR]: { stage: "runtime", severity: "error", color: "red" },

  // ── Completion ──────────────────────────────────────────────────────────
  [K8S_EVENT_REASONS.COMPLETED]: {
    stage: "completion",
    severity: "info",
    color: "green",
    podPhaseCategory: "succeeded",
  },
  [K8S_EVENT_REASONS.SUCCEEDED]: {
    stage: "completion",
    severity: "info",
    color: "green",
    podPhaseCategory: "succeeded",
  },
};

// ============================================================================
// Derived Lookups (built once from the registry)
// ============================================================================

/**
 * Look up an event reason from a wire string.
 * Single hash lookup — returns undefined for unknown/custom event reasons.
 */
function lookupEventReason(reason: string): EventReasonConfig | undefined {
  return (EVENT_REASON_REGISTRY as Record<string, EventReasonConfig | undefined>)[reason];
}

// Build all derived sets in a single pass over the registry.
const _succeeded = new Set<string>();
const _failed = new Set<string>();
const _running = new Set<string>();
const _pending = new Set<string>();
const _warning = new Set<string>();

for (const reason of Object.keys(EVENT_REASON_REGISTRY) as K8sEventReason[]) {
  const config = EVENT_REASON_REGISTRY[reason];
  switch (config.podPhaseCategory) {
    case "succeeded":
      _succeeded.add(reason);
      break;
    case "failed":
      _failed.add(reason);
      break;
    case "running":
      _running.add(reason);
      break;
    case "pending":
      _pending.add(reason);
      break;
  }
  if (config.severity === "warn" || config.severity === "error") {
    _warning.add(reason);
  }
}

export const SUCCEEDED_REASONS: ReadonlySet<string> = _succeeded;
export const FAILED_REASONS: ReadonlySet<string> = _failed;
export const RUNNING_REASONS: ReadonlySet<string> = _running;
export const PENDING_REASONS: ReadonlySet<string> = _pending;

/**
 * Set of event reasons whose severity is "warn" or "error".
 * Used by inferEventType() to derive K8s event type from reason.
 */
export const WARNING_REASONS: ReadonlySet<string> = _warning;

// ============================================================================
// Public API
// ============================================================================

/**
 * Classify event reason into lifecycle stage and severity.
 * Falls back to runtime stage for unknown reasons.
 */
export function classifyEvent(
  reason: string,
  type: "Normal" | "Warning",
): { stage: LifecycleStage; severity: EventSeverity } {
  const config = lookupEventReason(reason);
  if (config) {
    return { stage: config.stage, severity: config.severity };
  }

  return {
    stage: "runtime",
    severity: type === "Warning" ? "warn" : "info",
  };
}

/**
 * Map an event reason to a timeline color.
 * Defaults to "blue" (in-progress) for unknown reasons.
 */
export function mapEventReasonToColor(reason: string): TimelineColor {
  return lookupEventReason(reason)?.color ?? "blue";
}
