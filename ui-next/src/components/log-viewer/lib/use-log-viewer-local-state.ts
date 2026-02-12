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
 * Local (Instance-Isolated) Log Viewer State
 *
 * Provides the same interface as useLogViewerUrlState but backed by React
 * local state (useState) instead of URL query parameters (nuqs).
 *
 * Use this for embedded log viewers (e.g., panel tabs) where each instance
 * must be fully isolated. URL state is only appropriate for the standalone
 * log viewer page where shareable/bookmarkable URLs are desired.
 *
 * @see useLogViewerUrlState for the URL-synced variant
 */

"use client";

import { useMemo, useState, useCallback } from "react";

import type { SearchChip } from "@/components/filter-bar/lib/types";
import type { TimeRangePreset } from "@/components/log-viewer/components/timeline/components/TimelineContainer";
import type {
  UseLogViewerUrlStateReturn,
  UseLogViewerUrlStateOptions,
} from "@/components/log-viewer/lib/use-log-viewer-url-state";
import { validateTimeRange } from "@/components/log-viewer/lib/use-log-viewer-url-state";

// =============================================================================
// Helper (same logic as useTimeRangeUrlState's deriveActivePreset)
// =============================================================================

function deriveActivePreset(start: Date | undefined, end: Date | undefined, nowMs: number): TimeRangePreset {
  if (!start && !end) return "all";

  if (!end && start) {
    const diffMs = nowMs - start.getTime();
    const toleranceMs = 10000;

    if (Math.abs(diffMs - 5 * 60 * 1000) < toleranceMs) return "5m";
    if (Math.abs(diffMs - 15 * 60 * 1000) < toleranceMs) return "15m";
    if (Math.abs(diffMs - 60 * 60 * 1000) < toleranceMs) return "1h";
    if (Math.abs(diffMs - 6 * 60 * 60 * 1000) < toleranceMs) return "6h";
    if (Math.abs(diffMs - 24 * 60 * 60 * 1000) < toleranceMs) return "24h";
  }

  return "custom";
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Instance-isolated state for log viewer filters and time range.
 *
 * Returns the same shape as useLogViewerUrlState, so it can be used
 * interchangeably. State is local to the React component tree — multiple
 * instances on the same page do NOT interfere with each other.
 *
 * @param options - Entity boundaries and synchronized NOW timestamp
 */
export function useLogViewerLocalState(options?: UseLogViewerUrlStateOptions): UseLogViewerUrlStateReturn {
  const { entityStartTime, entityEndTime, now: nowMs } = options ?? {};

  if (!nowMs) {
    throw new Error("useLogViewerLocalState: 'now' parameter is required");
  }

  // ─── Filter chips (local state) ────────────────────────────────────────────
  const [filterChips, setFilterChipsRaw] = useState<SearchChip[]>([]);

  const setFilterChips = useCallback((chips: SearchChip[]) => {
    setFilterChipsRaw(chips);
  }, []);

  // ─── Time range (local state) ──────────────────────────────────────────────
  const [rawStart, setRawStart] = useState<Date | undefined>(undefined);
  const [rawEnd, setRawEnd] = useState<Date | undefined>(undefined);

  // Validate against entity boundaries (same logic as URL variant)
  const nowDate = useMemo(() => new Date(nowMs), [nowMs]);
  const validated = useMemo(
    () => validateTimeRange(rawStart, rawEnd, entityStartTime, entityEndTime, nowDate),
    [rawStart, rawEnd, entityStartTime, entityEndTime, nowDate],
  );

  const startTime = validated.start ?? rawStart;
  const endTime = validated.end ?? rawEnd;

  // ─── Preset derivation ─────────────────────────────────────────────────────
  const activePreset = useMemo<TimeRangePreset>(
    () => deriveActivePreset(startTime, endTime, nowMs),
    [startTime, endTime, nowMs],
  );

  // ─── Setters with validation ───────────────────────────────────────────────
  const setStartTime = useCallback(
    (time: Date | undefined) => {
      const now = new Date(nowMs);
      const { start: vs, end: ve } = validateTimeRange(time, rawEnd, entityStartTime, entityEndTime, now);
      setRawStart(vs);
      setRawEnd(ve);
    },
    [nowMs, rawEnd, entityStartTime, entityEndTime],
  );

  const setEndTime = useCallback(
    (time: Date | undefined) => {
      const now = new Date(nowMs);
      const { start: vs, end: ve } = validateTimeRange(rawStart, time, entityStartTime, entityEndTime, now);
      setRawStart(vs);
      setRawEnd(ve);
    },
    [nowMs, rawStart, entityStartTime, entityEndTime],
  );

  const setPreset = useCallback(
    (preset: TimeRangePreset) => {
      switch (preset) {
        case "all":
          setRawStart(undefined);
          setRawEnd(undefined);
          break;
        case "5m":
          setRawStart(new Date(nowMs - 5 * 60 * 1000));
          setRawEnd(undefined);
          break;
        case "15m":
          setRawStart(new Date(nowMs - 15 * 60 * 1000));
          setRawEnd(undefined);
          break;
        case "1h":
          setRawStart(new Date(nowMs - 60 * 60 * 1000));
          setRawEnd(undefined);
          break;
        case "6h":
          setRawStart(new Date(nowMs - 6 * 60 * 60 * 1000));
          setRawEnd(undefined);
          break;
        case "24h":
          setRawStart(new Date(nowMs - 24 * 60 * 60 * 1000));
          setRawEnd(undefined);
          break;
        case "custom":
          // No-op: custom times are set via setStartTime/setEndTime
          break;
      }
    },
    [nowMs],
  );

  // ─── Derived state ─────────────────────────────────────────────────────────
  const isLiveMode = endTime === null || endTime === undefined;

  return {
    filterChips,
    setFilterChips,
    startTime,
    setStartTime,
    endTime,
    setEndTime,
    activePreset,
    setPreset,
    isLiveMode,
  };
}
