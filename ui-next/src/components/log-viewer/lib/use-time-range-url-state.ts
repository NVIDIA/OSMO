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
 * Time Range URL State Management
 *
 * Manages log viewer time range via URL query parameters.
 * This enables shareable/bookmarkable time-filtered log views.
 *
 * ## URL Parameter Format
 *
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
 *   startTime,
 *   endTime,
 *   activePreset,
 *   isLiveMode,
 *   setStartTime,
 *   setEndTime,
 *   setPreset,
 * } = useTimeRangeUrlState({ now: Date.now(), entityStartTime: workflow.startedAt });
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

import { useMemo, useCallback, useEffect } from "react";
import { useQueryStates, parseAsIsoDateTime } from "nuqs";
import type { TimeRangePreset } from "@/components/log-viewer/components/timeline/components/TimelineContainer";
import { validateTimeRange } from "@/components/log-viewer/lib/use-log-viewer-url-state";

// =============================================================================
// Types
// =============================================================================

export interface UseTimeRangeUrlStateOptions {
  /**
   * REFERENCE: Synchronized "NOW" timestamp (milliseconds since epoch) from useTick().
   * CRITICAL: Required for preset calculations, live mode detection, and as upper bound.
   */
  now: number;
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
}

export interface UseTimeRangeUrlStateReturn {
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
 * URL-synced state for log viewer time range.
 *
 * Presets are resolved to actual start/end times in the URL.
 * For example, "last 5m" becomes: ?start=2026-01-24T19:11:00Z (with no end = live mode)
 *
 * @param options - Options including now timestamp and entity boundaries
 */
export function useTimeRangeUrlState(options: UseTimeRangeUrlStateOptions): UseTimeRangeUrlStateReturn {
  const { now: synchronizedNowMs, entityStartTime, entityEndTime } = options;

  // ───────────────────────────────────────────────────────────────────────────
  // Time Range (ISO datetime strings)
  // Using useQueryStates for atomic updates to prevent losing other URL params
  // ───────────────────────────────────────────────────────────────────────────

  const [timeRange, setTimeRange] = useQueryStates(
    {
      start: parseAsIsoDateTime.withOptions({
        shallow: true,
        clearOnDefault: true,
      }),
      end: parseAsIsoDateTime.withOptions({
        shallow: true,
        clearOnDefault: true,
      }),
    },
    {
      // Ensure atomic updates - all params change together
      shallow: true,
    },
  );

  // ───────────────────────────────────────────────────────────────────────────
  // Validation & Backfill (via useEffect to avoid state updates during render)
  // Enforce guarantees: entityStartTime <= filterStartTime < filterEndTime <= entityEndTime/Now
  // ───────────────────────────────────────────────────────────────────────────

  // Compute validated times for use in this render cycle
  // These are local variables that show what the times SHOULD be, while the
  // useEffect below will update the URL state to match
  const now = new Date(synchronizedNowMs);
  const validated = validateTimeRange(timeRange.start, timeRange.end, entityStartTime, entityEndTime, now);
  const startTime = validated.start ?? timeRange.start;
  const endTime = validated.end ?? timeRange.end;

  // Effect to correct invalid URL params (e.g., user manually edited URL to out-of-bounds values)
  // Only corrects INVALID values, never backfills MISSING values
  useEffect(() => {
    if (!entityStartTime) return;

    const nowDate = new Date(synchronizedNowMs);
    const { start, end, needsCorrection } = validateTimeRange(
      timeRange.start,
      timeRange.end,
      entityStartTime,
      entityEndTime,
      nowDate,
    );

    if (needsCorrection) {
      // useQueryStates handles atomic updates - just pass both values
      void setTimeRange(
        {
          start: start ?? null,
          end: end ?? null,
        },
        { history: "push" },
      );
    }
  }, [entityStartTime, entityEndTime, synchronizedNowMs, timeRange.start, timeRange.end, setTimeRange]);

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
      const nowVal = synchronizedNowMs;
      const historyMode = { history: "push" as const };

      switch (preset) {
        case "all":
          setTimeRange({ start: null, end: null }, historyMode);
          break;
        case "5m":
          setTimeRange(
            {
              start: new Date(nowVal - 5 * 60 * 1000),
              end: null, // NOW = live mode
            },
            historyMode,
          );
          break;
        case "15m":
          setTimeRange(
            {
              start: new Date(nowVal - 15 * 60 * 1000),
              end: null,
            },
            historyMode,
          );
          break;
        case "1h":
          setTimeRange(
            {
              start: new Date(nowVal - 60 * 60 * 1000),
              end: null,
            },
            historyMode,
          );
          break;
        case "6h":
          setTimeRange(
            {
              start: new Date(nowVal - 6 * 60 * 60 * 1000),
              end: null,
            },
            historyMode,
          );
          break;
        case "24h":
          setTimeRange(
            {
              start: new Date(nowVal - 24 * 60 * 60 * 1000),
              end: null,
            },
            historyMode,
          );
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
  // VALIDATION: Enforce time ordering guarantees via validateTimeRange utility
  const setStartTimeWrapped = useCallback(
    (time: Date | undefined) => {
      const nowDate = new Date(synchronizedNowMs);
      const { start: validatedStart, end: validatedEnd } = validateTimeRange(
        time,
        endTime,
        entityStartTime,
        entityEndTime,
        nowDate,
      );

      // Always update both - validation may have adjusted end to maintain start < end
      setTimeRange(
        {
          start: validatedStart ?? null,
          end: validatedEnd ?? null,
        },
        { history: "push" },
      );
    },
    [setTimeRange, entityStartTime, entityEndTime, synchronizedNowMs, endTime],
  );

  const setEndTimeWrapped = useCallback(
    (time: Date | undefined) => {
      const nowDate = new Date(synchronizedNowMs);
      const { start: validatedStart, end: validatedEnd } = validateTimeRange(
        startTime,
        time,
        entityStartTime,
        entityEndTime,
        nowDate,
      );

      // Always update both - validation may have adjusted start to maintain start < end
      setTimeRange(
        {
          start: validatedStart ?? null,
          end: validatedEnd ?? null,
        },
        { history: "push" },
      );
    },
    [setTimeRange, entityStartTime, entityEndTime, synchronizedNowMs, startTime],
  );

  return {
    startTime: startTime ?? undefined,
    setStartTime: setStartTimeWrapped,
    endTime: endTime ?? undefined,
    setEndTime: setEndTimeWrapped,
    activePreset,
    setPreset,
    isLiveMode,
  };
}
