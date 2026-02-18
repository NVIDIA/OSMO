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
 *
 * Robustness:
 * Events may arrive out of order or be dropped entirely. The derived state
 * uses the "furthest stage reached" strategy — scanning ALL events for the
 * highest progression index rather than relying on the last event alone.
 * This means:
 * - Missing events: if we see "Running" without "Pending"/"Init" events,
 *   we infer the task passed through those stages.
 * - Out-of-order events: a late "Pending" event after a "Running" event
 *   backfills information but does not regress the derived state.
 */

import type { K8sEvent, PodPhase, LifecycleStage } from "@/lib/api/adapter/events/events-types";
import {
  SUCCEEDED_REASONS,
  FAILED_REASONS,
  RUNNING_REASONS,
  PENDING_REASONS,
  type TimelineColor,
  mapEventReasonToColor,
} from "@/lib/api/adapter/events/events-utils";
import { K8S_EVENT_REASONS } from "@/lib/api/adapter/events/events-types";

/**
 * Lifecycle stages for UI filtering.
 * Derived from event data, not pod phase.
 */
export type Lifecycle = "Scheduling" | "Init" | "Running" | "Failed" | "Done";

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

  /**
   * Furthest non-failure progress index reached (0=pending, 1=init, 2=running, 3=done).
   * -1 if no non-failure events exist.
   *
   * Accounts for the "Scheduled" event boundary: a Scheduled event means
   * scheduling completed, so the index is bumped from 0 (pending) to 1 (init).
   *
   * Used by the progress bar to determine how far a task progressed,
   * independent of event ordering or gaps.
   */
  furthestProgressIndex: number;

  /**
   * Set of progress indices (0–3) that have at least one directly observed event.
   *
   * Used by the progress bar to distinguish "observed" stages (shown as completed)
   * from "inferred" stages (shown in darker gray — we know the task passed through
   * them because a later stage was reached, but we never received events for them).
   */
  observedStageIndices: ReadonlySet<number>;

  /**
   * Timeline color for visual status indication.
   * Derived from the most recent event at the furthest stage reached.
   *
   * Color semantics:
   * - green: Success/healthy (Scheduled, Ready, Started, Completed)
   * - blue: In-progress (Pulling, Creating containers)
   * - amber: Non-terminal failures (ImagePullBackOff, CrashLoopBackOff)
   * - red: Terminal failures (OOMKilled, Failed, Evicted)
   */
  timelineColor: TimelineColor;
}

// ============================================================================
// Progress Index Mapping
// ============================================================================

/**
 * Map a single event to a UI progress index (0–3) based on its stage and reason.
 *
 * Progress indices correspond to the 4 visual lifecycle stages:
 *   0 = Pending  (scheduling)
 *   1 = Init     (image pull, container creation, volume mounts)
 *   2 = Running  (at least one container started/ready)
 *   3 = Done     (completed/succeeded)
 *  -1 = Failure  (not part of linear progression)
 *
 * Special handling for "container" stage:
 * In K8s, a pod in Pending phase can have containers being Created. The
 * transition to Running only happens when at least one container actually
 * starts (Started event). So "Created" and "PodReadyToStartContainers"
 * map to index 1 (init), while all other container events map to index 2.
 */
function eventProgressIndex(event: K8sEvent): number {
  switch (event.stage) {
    case "scheduling":
      return 0;
    case "initialization":
    case "image":
      return 1;
    case "container": {
      // K8s distinction: Created/PodReadyToStartContainers are still init;
      // Started/Ready/Killing/ContainersReady indicate running phase
      const reason = event.reason;
      if (reason === K8S_EVENT_REASONS.CREATED || reason === K8S_EVENT_REASONS.POD_READY_TO_START_CONTAINERS) {
        return 1;
      }
      return 2;
    }
    case "runtime":
      return 2;
    case "completion":
      return 3;
    case "failure":
      return -1;
    default:
      return -1;
  }
}

/**
 * Map a lifecycle stage to a UI lifecycle category.
 *
 * Uses the furthest progress index for non-terminal states (robust to
 * out-of-order and missing events). Terminal event types (failure, completion)
 * from the most recent event take precedence for current-state accuracy.
 */
function deriveLifecycle(furthestProgressIndex: number, lastEventStage: LifecycleStage | null): Lifecycle {
  // Terminal event types: the most recent event determines current state
  if (lastEventStage === "completion") return "Done";
  if (lastEventStage === "failure") return "Failed";

  // Non-terminal: use furthest progress (handles out-of-order & missing events)
  switch (furthestProgressIndex) {
    case 3:
      return "Done";
    case 2:
      return "Running";
    case 1:
      return "Init";
    default:
      return "Scheduling";
  }
}

/**
 * Determine timeline color based on events and pod phase.
 *
 * Strategy:
 * 1. Terminal pod states (Succeeded/Failed) override everything
 * 2. Scan backwards for most recent event at furthest stage reached
 * 3. Map that event's reason to a color
 * 4. Default to "blue" (in-progress) if no matching event found
 *
 * This gives us robust color determination that matches the visual timeline,
 * showing the semantic status of the task's furthest progress.
 */
function determineTimelineColor(events: K8sEvent[], furthestProgressIndex: number, podPhase: PodPhase): TimelineColor {
  // Terminal pod states override everything
  if (podPhase === "Succeeded") return "green";
  if (podPhase === "Failed") return "red";

  // Scan backwards for most recent event at furthest stage
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    const eventIdx = eventProgressIndex(event);

    if (eventIdx === furthestProgressIndex) {
      return mapEventReasonToColor(event.reason);
    }
  }

  // Default: in-progress (blue)
  return "blue";
}

/**
 * Compute all derived state from events in a single pass.
 * Called once during groupEventsByTask().
 *
 * This is the ONLY function that should traverse the events array.
 * All other derivations should use the cached TaskDerivedState.
 *
 * Strategy:
 * - Forward pass: track furthest progress index and observed stage indices
 * - Backward pass: find most recent pod-phase-relevant event for podPhase
 * - Derive lifecycle from furthest progress + last event stage
 * - Derive timeline color from furthest progress + pod phase
 *
 * @precondition events array must be sorted ASC by timestamp (enforced by caller)
 */
export function computeDerivedState(events: K8sEvent[]): TaskDerivedState {
  if (events.length === 0) {
    return {
      podPhase: "Unknown",
      lifecycle: "Scheduling",
      hasScheduledEvent: false,
      furthestProgressIndex: -1,
      observedStageIndices: new Set(),
      timelineColor: "blue",
    };
  }

  // --- Single forward pass: track stage progression and flags ---
  let furthestProgressIndex = -1;
  const observedStageIndices = new Set<number>();
  let hasScheduledEvent = false;

  for (const event of events) {
    const progressIdx = eventProgressIndex(event);
    if (progressIdx >= 0) {
      observedStageIndices.add(progressIdx);
      if (progressIdx > furthestProgressIndex) {
        furthestProgressIndex = progressIdx;
      }
    }
    if (event.reason === K8S_EVENT_REASONS.SCHEDULED) {
      hasScheduledEvent = true;
    }
  }

  // "Scheduled" event means scheduling is COMPLETE → task is at least in init.
  // Bump from pending (0) to init (1) when we know scheduling succeeded.
  if (hasScheduledEvent && furthestProgressIndex === 0) {
    furthestProgressIndex = 1;
  }

  // --- Backward pass: derive pod phase from most recent relevant event ---
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

  // Derive lifecycle from furthest progress + last event stage
  const lastEventStage = events[events.length - 1]?.stage ?? null;
  const lifecycle = deriveLifecycle(furthestProgressIndex, lastEventStage);

  // Derive timeline color from events, furthest progress, and pod phase
  const timelineColor = determineTimelineColor(events, furthestProgressIndex, podPhase);

  return {
    podPhase,
    lifecycle,
    hasScheduledEvent,
    furthestProgressIndex,
    observedStageIndices,
    timelineColor,
  };
}
