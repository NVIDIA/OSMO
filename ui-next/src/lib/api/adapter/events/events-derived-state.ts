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
 * Derived State Layer for Event Analysis
 *
 * SSOT: Events array is the single source of truth.
 * This module computes all derived state from events in a SINGLE PASS,
 * caches the results on TaskGroup, and provides pure functions for UI logic.
 *
 * Architecture:
 * - Events (raw data) → computeDerivedState() → TaskDerivedState (cached)
 * - UI logic operates on TaskDerivedState (O(1) lookups, not O(n) scans)
 */

import type { K8sEvent, PodPhase, LifecycleStage } from "@/lib/api/adapter/events/events-types";
import {
  SUCCEEDED_REASONS,
  FAILED_REASONS,
  RUNNING_REASONS,
  PENDING_REASONS,
} from "@/lib/api/adapter/events/events-utils";
import { K8S_EVENT_REASONS } from "@/lib/api/adapter/events/events-types";

/**
 * Lifecycle stages for UI filtering.
 * Derived from event data, not pod phase.
 */
export type Lifecycle = "Pending" | "Init" | "Running" | "Failed" | "Done";

/**
 * Derived state computed once from events and cached on TaskGroup.
 * Single source of truth: events array.
 * Computed once during grouping, cached for O(1) access.
 */
export interface TaskDerivedState {
  /** Canonical K8s pod phase (derived from event reasons) */
  podPhase: PodPhase;

  /** UI lifecycle stage for filtering (derived from event stages) */
  lifecycle: Lifecycle;

  /** Whether task has a "Scheduled" event (for progress bar distinction) */
  hasScheduledEvent: boolean;
}

/**
 * Map a lifecycle stage to a UI lifecycle category.
 */
function deriveLifecycle(lastEventStage: LifecycleStage | null, events: K8sEvent[]): Lifecycle {
  if (!lastEventStage) return "Pending";

  switch (lastEventStage) {
    case "scheduling":
      return "Pending";
    case "image":
    case "initialization":
      return "Init";
    case "container":
    case "runtime":
      return "Running";
    case "completion":
      return "Done";
    case "failure":
      return "Failed";
    default: {
      const hasFailure = events.some((e) => e.stage === "failure");
      if (hasFailure) return "Failed";
      const hasCompletion = events.some((e) => e.stage === "completion");
      if (hasCompletion) return "Done";
      return "Running";
    }
  }
}

/**
 * Compute all derived state from events in a single pass.
 * Called once during groupEventsByTask().
 *
 * This is the ONLY function that should traverse the events array.
 * All other derivations should use the cached TaskDerivedState.
 *
 * @precondition events array must be sorted ASC by timestamp (enforced by caller)
 */
export function computeDerivedState(events: K8sEvent[]): TaskDerivedState {
  if (events.length === 0) {
    return { podPhase: "Unknown", lifecycle: "Pending", hasScheduledEvent: false };
  }

  // Derive pod phase from most recent event (iterate backwards, no sort needed)
  let podPhase: PodPhase = "Unknown";
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (SUCCEEDED_REASONS.has(event.reason)) {
      podPhase = "Succeeded";
      break;
    }
    if (FAILED_REASONS.has(event.reason)) {
      podPhase = "Failed";
      break;
    }
    if (RUNNING_REASONS.has(event.reason)) {
      podPhase = "Running";
      break;
    }
    if (PENDING_REASONS.has(event.reason)) {
      podPhase = "Pending";
      break;
    }
  }

  // Derive lifecycle from last event stage
  const hasScheduledEvent = events.some((e) => e.reason === K8S_EVENT_REASONS.SCHEDULED);
  const lastEventStage = events[events.length - 1]?.stage ?? null;
  const lifecycle = deriveLifecycle(lastEventStage, events);

  return { podPhase, lifecycle, hasScheduledEvent };
}
