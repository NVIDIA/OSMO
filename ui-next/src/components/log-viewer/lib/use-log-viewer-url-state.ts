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
 * - `preset` - Time range preset: `?preset=15m`
 *
 * ## Time Range Logic
 *
 * - No end time = "NOW" = live mode (tailing latest logs)
 * - Start + no end = "last X time from now"
 * - Start + end = fixed historical range
 * - Preset = quick selection (5m, 15m, 1h, etc.)
 *
 * @example
 * ```tsx
 * const {
 *   filterChips,
 *   setFilterChips,
 *   startTime,
 *   endTime,
 *   activePreset,
 *   setStartTime,
 *   setEndTime,
 *   setPreset,
 *   isLiveMode,
 * } = useLogViewerUrlState();
 *
 * // Live mode detection
 * if (isLiveMode) {
 *   console.log("Tailing latest logs");
 * }
 * ```
 */

"use client";

import { useMemo, useCallback } from "react";
import { useQueryState, parseAsArrayOf, parseAsString, parseAsIsoDateTime, parseAsStringLiteral } from "nuqs";
import type { SearchChip } from "@/components/filter-bar";
import type { TimeRangePreset } from "../components/TimelineHistogram";
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

  /** Active time range preset */
  activePreset: TimeRangePreset | undefined;
  setPreset: (preset: TimeRangePreset) => void;

  /** Derived state - true when endTime is undefined (tailing latest) */
  isLiveMode: boolean;
}

// Valid preset values for URL parsing
const PRESET_VALUES = ["all", "5m", "15m", "1h", "6h", "24h", "custom"] as const;

// =============================================================================
// Hook
// =============================================================================

/**
 * URL-synced state for log viewer filters and time range.
 *
 * All state is persisted to URL query parameters, enabling shareable log views.
 */
export function useLogViewerUrlState(): UseLogViewerUrlStateReturn {
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
  // ───────────────────────────────────────────────────────────────────────────

  const [startTime, setStartTime] = useQueryState(
    "start",
    parseAsIsoDateTime.withOptions({
      shallow: true,
      history: "replace",
      clearOnDefault: true,
    }),
  );

  const [endTime, setEndTime] = useQueryState(
    "end",
    parseAsIsoDateTime.withOptions({
      shallow: true,
      history: "replace",
      clearOnDefault: true,
    }),
  );

  // ───────────────────────────────────────────────────────────────────────────
  // Time Range Preset
  // ───────────────────────────────────────────────────────────────────────────

  const [activePreset, setActivePresetRaw] = useQueryState(
    "preset",
    parseAsStringLiteral(PRESET_VALUES).withDefault("all").withOptions({
      shallow: true,
      history: "replace",
      clearOnDefault: true,
    }),
  );

  // Helper to set preset and derive time range
  const setPreset = useCallback(
    (preset: TimeRangePreset) => {
      const now = new Date();

      switch (preset) {
        case "all":
          setStartTime(null);
          setEndTime(null);
          setActivePresetRaw("all");
          break;
        case "5m":
          setStartTime(new Date(now.getTime() - 5 * 60 * 1000));
          setEndTime(null); // NOW = live mode
          setActivePresetRaw("5m");
          break;
        case "15m":
          setStartTime(new Date(now.getTime() - 15 * 60 * 1000));
          setEndTime(null);
          setActivePresetRaw("15m");
          break;
        case "1h":
          setStartTime(new Date(now.getTime() - 60 * 60 * 1000));
          setEndTime(null);
          setActivePresetRaw("1h");
          break;
        case "6h":
          setStartTime(new Date(now.getTime() - 6 * 60 * 60 * 1000));
          setEndTime(null);
          setActivePresetRaw("6h");
          break;
        case "24h":
          setStartTime(new Date(now.getTime() - 24 * 60 * 60 * 1000));
          setEndTime(null);
          setActivePresetRaw("24h");
          break;
        case "custom":
          setActivePresetRaw("custom");
          // Don't change start/end - they're set manually
          break;
      }
    },
    [setStartTime, setEndTime, setActivePresetRaw],
  );

  // Wrap setters to mark preset as "custom" when times are set manually
  const setStartTimeWithCustom = useCallback(
    (time: Date | undefined) => {
      setStartTime(time ?? null);
      setActivePresetRaw("custom");
    },
    [setStartTime, setActivePresetRaw],
  );

  const setEndTimeWithCustom = useCallback(
    (time: Date | undefined) => {
      setEndTime(time ?? null);
      setActivePresetRaw("custom");
    },
    [setEndTime, setActivePresetRaw],
  );

  // ───────────────────────────────────────────────────────────────────────────
  // Derived State
  // ───────────────────────────────────────────────────────────────────────────

  const isLiveMode = endTime === null || endTime === undefined;

  return {
    filterChips,
    setFilterChips,
    startTime: startTime ?? undefined,
    setStartTime: setStartTimeWithCustom,
    endTime: endTime ?? undefined,
    setEndTime: setEndTimeWithCustom,
    activePreset: activePreset as TimeRangePreset,
    setPreset,
    isLiveMode,
  };
}
