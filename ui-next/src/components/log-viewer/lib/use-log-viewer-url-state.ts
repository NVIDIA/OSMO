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
 * Log Viewer URL State Management
 *
 * Manages all log viewer filter and time range state via URL query parameters.
 * This enables shareable/bookmarkable log views.
 *
 * This hook composes two focused hooks:
 * - `useFilterChipsUrlState` - Filter chips (level, task, retry, source)
 * - `useTimeRangeUrlState` - Time range with presets and live mode
 *
 * ## URL Parameter Format
 *
 * - `f` - Filter chips (repeated): `?f=level:error&f=task:train`
 * - `start` - Start time (ISO string): `?start=2026-01-24T10:00:00Z`
 * - `end` - End time (ISO string): `?end=2026-01-24T11:00:00Z`
 *
 * ## Time Range Logic
 *
 * - No start/end = "all time"
 * - Start only = "from start to NOW" = live mode (tailing latest logs)
 * - Start + end = fixed historical range
 * - Presets resolve to actual start/end times (e.g., "last 5m" = start: now - 5m, end: undefined)
 *
 * ## Active Preset Detection
 *
 * The active preset is derived from current start/end times:
 * - `?start=2026-01-24T19:11:00Z` (no end) → "5m" if diff ≈ 5 minutes
 * - No params → "all"
 * - Custom times → "custom"
 *
 * @example
 * ```tsx
 * const {
 *   filterChips,
 *   setFilterChips,
 *   startTime,
 *   endTime,
 *   activePreset, // Derived from start/end
 *   setStartTime,
 *   setEndTime,
 *   setPreset, // Resolves to start/end
 *   isLiveMode,
 * } = useLogViewerUrlState();
 *
 * // Set preset - updates start/end in URL
 * setPreset("5m"); // → ?start=2026-01-24T19:11:00Z
 *
 * // Live mode detection
 * if (isLiveMode) {
 *   console.log("Tailing latest logs");
 * }
 * ```
 */

"use client";

import type { SearchChip } from "@/components/filter-bar/lib/types";
import type { TimeRangePreset } from "../components/timeline/components/TimelineContainer";
import { useFilterChipsUrlState } from "./use-filter-chips-url-state";
import { useTimeRangeUrlState } from "./use-time-range-url-state";

// =============================================================================
// Types
// =============================================================================

export interface UseLogViewerUrlStateReturn {
  /** Filter chips (level, task, retry, source) */
  filterChips: SearchChip[];
  setFilterChips: (chips: SearchChip[]) => void;

  /** Time range - start time (undefined = beginning of workflow) */
  startTime: Date | undefined;
  setStartTime: (time: Date | undefined) => void;

  /** Time range - end time (undefined = NOW / live mode) */
  endTime: Date | undefined;
  setEndTime: (time: Date | undefined) => void;

  /** Active time range preset (derived from current start/end) */
  activePreset: TimeRangePreset | undefined;
  /** Set preset (resolves to actual start/end times) */
  setPreset: (preset: TimeRangePreset) => void;

  /** Derived state - true when endTime is undefined (tailing latest) */
  isLiveMode: boolean;
}

/**
 * Options for URL state hook.
 */
export interface UseLogViewerUrlStateOptions {
  /**
   * REALITY: Entity start time (workflow/group/task start) - hard lower bound.
   * Used to validate and backfill URL params to prevent invalid ranges.
   */
  entityStartTime?: Date;
  /**
   * REALITY: Entity end time (workflow/group/task end) - hard upper bound.
   * Used to validate filter end time doesn't exceed completion time.
   */
  entityEndTime?: Date;
  /**
   * REFERENCE: Synchronized "NOW" timestamp (milliseconds since epoch) from useTick().
   * CRITICAL: Always provide this for running workflows to ensure time consistency.
   * Used for preset calculations, live mode detection, and as upper bound for running workflows.
   */
  now?: number;
}

// =============================================================================
// Helper Functions (exported for use by useTimeRangeUrlState)
// =============================================================================

/**
 * Validate and clamp time range to entity boundaries.
 *
 * Enforces three guarantees:
 * 1. filterStartTime >= entityStartTime (clamped to entity bounds)
 * 2. filterStartTime < filterEndTime (minimum separation enforced)
 * 3. filterEndTime <= entityEndTime ?? now (clamped to max bound)
 *
 * @param start - Proposed start time
 * @param end - Proposed end time
 * @param entityStart - Hard lower bound (workflow start time)
 * @param entityEnd - Hard upper bound (workflow end time, if completed)
 * @param now - Current time reference (for upper bound if workflow still running)
 * @returns Validated times and whether correction was needed
 */
export function validateTimeRange(
  start: Date | undefined | null,
  end: Date | undefined | null,
  entityStart: Date | undefined,
  entityEnd: Date | undefined,
  now: Date,
): {
  start: Date | undefined;
  end: Date | undefined;
  needsCorrection: boolean;
} {
  let validStart = start ?? undefined;
  let validEnd = end ?? undefined;
  let needsCorrection = false;

  // GUARANTEE 1: If filterStartTime is SET, it must be >= entityStartTime
  // Missing start = no filter = valid (don't backfill)
  if (entityStart && validStart) {
    const entityStartMs = entityStart.getTime();
    if (validStart.getTime() < entityStartMs) {
      validStart = entityStart;
      needsCorrection = true;
    }
  }

  // GUARANTEE 2: If filterEndTime is SET, it must be <= entityEndTime ?? now
  // Missing end = no filter = valid (don't backfill)
  const maxEnd = entityEnd ?? now;
  if (validEnd && validEnd.getTime() > maxEnd.getTime()) {
    validEnd = maxEnd;
    needsCorrection = true;
  }

  // GUARANTEE 3: If BOTH are set, filterStartTime < filterEndTime
  if (validStart && validEnd && validStart.getTime() >= validEnd.getTime()) {
    validEnd = new Date(validStart.getTime() + 1);
    needsCorrection = true;
  }

  return { start: validStart, end: validEnd, needsCorrection };
}

// =============================================================================
// Hook
// =============================================================================

/**
 * URL-synced state for log viewer filters and time range.
 *
 * This hook composes useFilterChipsUrlState and useTimeRangeUrlState
 * to provide a unified interface for all URL-synced state.
 *
 * Presets are resolved to actual start/end times in the URL.
 * For example, "last 5m" becomes: ?start=2026-01-24T19:11:00Z (with no end = live mode)
 *
 * @param options - Options including entityStartTime for validation
 */
export function useLogViewerUrlState(options?: UseLogViewerUrlStateOptions): UseLogViewerUrlStateReturn {
  const { entityStartTime, entityEndTime, now: nowMs } = options ?? {};

  // CRITICAL: Use synchronized NOW from useTick() for consistency
  // This should always be provided by the parent component
  if (!nowMs) {
    throw new Error("useLogViewerUrlState: 'now' parameter is required");
  }

  // Delegate to focused hooks
  const { filterChips, setFilterChips } = useFilterChipsUrlState();

  const timeRangeState = useTimeRangeUrlState({
    now: nowMs,
    entityStartTime,
    entityEndTime,
  });

  // Combine results from both hooks
  return {
    filterChips,
    setFilterChips,
    ...timeRangeState,
  };
}
