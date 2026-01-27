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

import { useMemo, useCallback } from "react";
import { useQueryState, useQueryStates, parseAsArrayOf, parseAsString, parseAsIsoDateTime } from "nuqs";
import type { SearchChip } from "@/components/filter-bar";
import type { TimeRangePreset } from "../components/timeline";
import { parseUrlChips } from "@/lib/url-utils";

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
// Helper Functions
// =============================================================================

/**
 * Derive the active preset from current start/end times.
 * Returns the matching preset or "custom" if times don't match any preset.
 *
 * @param start - Start time from URL
 * @param end - End time from URL
 * @param nowMs - Synchronized NOW timestamp in milliseconds (from useTick)
 */
function deriveActivePreset(start: Date | null, end: Date | null, nowMs: number): TimeRangePreset {
  // All time
  if (!start && !end) {
    return "all";
  }

  // Live mode (no end time) - check if start matches a preset
  if (!end && start) {
    const diffMs = nowMs - start.getTime();
    const toleranceMs = 10000; // 10 second tolerance for "now"

    // Check each preset duration
    if (Math.abs(diffMs - 5 * 60 * 1000) < toleranceMs) return "5m";
    if (Math.abs(diffMs - 15 * 60 * 1000) < toleranceMs) return "15m";
    if (Math.abs(diffMs - 60 * 60 * 1000) < toleranceMs) return "1h";
    if (Math.abs(diffMs - 6 * 60 * 60 * 1000) < toleranceMs) return "6h";
    if (Math.abs(diffMs - 24 * 60 * 60 * 1000) < toleranceMs) return "24h";
  }

  // Custom range
  return "custom";
}

// =============================================================================
// Hook
// =============================================================================

/**
 * URL-synced state for log viewer filters and time range.
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
  const synchronizedNowMs = nowMs;
  // ───────────────────────────────────────────────────────────────────────────
  // Filter Chips (repeated param: ?f=level:error&f=task:train)
  // ───────────────────────────────────────────────────────────────────────────

  const [filterStrings, setFilterStrings] = useQueryState(
    "f",
    parseAsArrayOf(parseAsString).withOptions({
      shallow: true,
      history: "replace",
      clearOnDefault: true,
    }),
  );

  // Parse filter strings to SearchChip format
  const filterChips = useMemo<SearchChip[]>(() => parseUrlChips(filterStrings ?? []), [filterStrings]);

  // Convert chips back to filter strings for URL
  const setFilterChips = useCallback(
    (chips: SearchChip[]) => {
      if (chips.length === 0) {
        setFilterStrings(null);
      } else {
        setFilterStrings(chips.map((c) => `${c.field}:${c.value}`));
      }
    },
    [setFilterStrings],
  );

  // ───────────────────────────────────────────────────────────────────────────
  // Time Range (ISO datetime strings)
  // Using useQueryStates for atomic updates to prevent losing other URL params
  // ───────────────────────────────────────────────────────────────────────────

  const [timeRange, setTimeRange] = useQueryStates(
    {
      start: parseAsIsoDateTime.withOptions({
        shallow: true,
        history: "replace",
        clearOnDefault: true,
      }),
      end: parseAsIsoDateTime.withOptions({
        shallow: true,
        history: "replace",
        clearOnDefault: true,
      }),
    },
    {
      // Ensure atomic updates - all params change together
      shallow: true,
      history: "replace",
    },
  );

  let startTime = timeRange.start;
  let endTime = timeRange.end;

  // ───────────────────────────────────────────────────────────────────────────
  // Validation & Backfill
  // Enforce guarantees: entityStartTime <= filterStartTime < filterEndTime <= entityEndTime/Now
  // ───────────────────────────────────────────────────────────────────────────

  let needsUpdate = false;
  const updates: { start?: Date | null; end?: Date | null } = {};

  if (entityStartTime) {
    const entityStartMs = entityStartTime.getTime();
    // Upper bound: entityEndTime (if completed) or NOW (if running)
    const effectiveMaxMs = (entityEndTime ?? new Date(synchronizedNowMs)).getTime();

    // GUARANTEE 1: filterStartTime >= entityStartTime
    // Case 1a: No start time in URL → backfill with entityStartTime
    if (!startTime) {
      startTime = entityStartTime;
      updates.start = entityStartTime;
      needsUpdate = true;
    }
    // Case 1b: Start time < entityStartTime → clamp to entityStartTime
    else if (startTime.getTime() < entityStartMs) {
      startTime = entityStartTime;
      updates.start = entityStartTime;
      needsUpdate = true;
    }

    // GUARANTEE 2: filterStartTime < filterEndTime (if both exist)
    // If endTime exists and is <= startTime, clamp endTime to startTime + 1ms
    if (endTime && startTime && endTime.getTime() <= startTime.getTime()) {
      endTime = new Date(startTime.getTime() + 1);
      updates.end = endTime;
      needsUpdate = true;
    }

    // GUARANTEE 3: filterEndTime <= entityEndTime ?? now
    // If endTime exceeds max bound, clamp to max
    if (endTime && endTime.getTime() > effectiveMaxMs) {
      const maxTime = entityEndTime ?? new Date(synchronizedNowMs);
      endTime = maxTime;
      updates.end = maxTime;
      needsUpdate = true;
    }

    // Apply all updates atomically
    if (needsUpdate) {
      void setTimeRange(updates);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Derived Preset (computed from start/end, not stored in URL)
  // ───────────────────────────────────────────────────────────────────────────

  const activePreset = useMemo<TimeRangePreset>(
    () => deriveActivePreset(startTime, endTime, synchronizedNowMs),
    [startTime, endTime, synchronizedNowMs],
  );

  // Helper to set preset by resolving to actual start/end times
  // Uses atomic update to preserve other URL params (like scenario)
  // CRITICAL: Uses synchronized NOW for consistency
  const setPreset = useCallback(
    (preset: TimeRangePreset) => {
      const now = synchronizedNowMs;

      switch (preset) {
        case "all":
          setTimeRange({ start: null, end: null });
          break;
        case "5m":
          setTimeRange({
            start: new Date(now - 5 * 60 * 1000),
            end: null, // NOW = live mode
          });
          break;
        case "15m":
          setTimeRange({
            start: new Date(now - 15 * 60 * 1000),
            end: null,
          });
          break;
        case "1h":
          setTimeRange({
            start: new Date(now - 60 * 60 * 1000),
            end: null,
          });
          break;
        case "6h":
          setTimeRange({
            start: new Date(now - 6 * 60 * 60 * 1000),
            end: null,
          });
          break;
        case "24h":
          setTimeRange({
            start: new Date(now - 24 * 60 * 60 * 1000),
            end: null,
          });
          break;
        case "custom":
          // Custom preset doesn't change start/end - they're set manually
          // This case is for completeness but shouldn't be called in practice
          break;
      }
    },
    [setTimeRange, synchronizedNowMs],
  );

  // ───────────────────────────────────────────────────────────────────────────
  // Derived State
  // ───────────────────────────────────────────────────────────────────────────

  const isLiveMode = endTime === null || endTime === undefined;

  // Wrap setters to convert undefined to null for nuqs
  // Use atomic updates to preserve other URL params
  // VALIDATION: Enforce time ordering guarantees
  const setStartTimeWrapped = useCallback(
    (time: Date | undefined) => {
      const updates: { start?: Date | null; end?: Date | null } = {};
      let validatedTime = time;

      // GUARANTEE 1: filterStartTime >= entityStartTime
      if (entityStartTime && time) {
        const entityStartMs = entityStartTime.getTime();
        if (time.getTime() < entityStartMs) {
          validatedTime = entityStartTime;
        }
      }

      updates.start = validatedTime ?? null;

      // GUARANTEE 2: filterStartTime < filterEndTime
      // If new start >= current end, push end forward
      if (validatedTime && endTime && validatedTime.getTime() >= endTime.getTime()) {
        updates.end = new Date(validatedTime.getTime() + 1);
      }

      setTimeRange(updates);
    },
    [setTimeRange, entityStartTime, endTime],
  );

  const setEndTimeWrapped = useCallback(
    (time: Date | undefined) => {
      const updates: { start?: Date | null; end?: Date | null } = {};
      let validatedTime = time;

      // GUARANTEE 3: filterEndTime <= entityEndTime ?? now
      if (time) {
        const maxTime = entityEndTime ?? new Date(synchronizedNowMs);
        const effectiveMaxMs = maxTime.getTime();
        if (time.getTime() > effectiveMaxMs) {
          validatedTime = maxTime;
        }
      }

      updates.end = validatedTime ?? null;

      // GUARANTEE 2: filterStartTime < filterEndTime
      // If new end <= current start, pull start back
      if (validatedTime && startTime && validatedTime.getTime() <= startTime.getTime()) {
        updates.start = new Date(validatedTime.getTime() - 1);
      }

      setTimeRange(updates);
    },
    [setTimeRange, entityEndTime, synchronizedNowMs, startTime],
  );

  return {
    filterChips,
    setFilterChips,
    startTime: startTime ?? undefined,
    setStartTime: setStartTimeWrapped,
    endTime: endTime ?? undefined,
    setEndTime: setEndTimeWrapped,
    activePreset,
    setPreset,
    isLiveMode,
  };
}
