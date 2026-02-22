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
 * Log Presentation Layer Hook
 *
 * Owns all derived/interactive state for the log viewer:
 * - URL-synced filter chips and time range
 * - Client-side filtering (raw entries → filtered entries)
 * - Histogram computation (from raw entries, not filtered)
 * - Display range (anchored to entity lifecycle, not filtered entries)
 * - Pending display range for pan/zoom preview
 * - External log URL derivation
 *
 * Accepts raw stream data from useLogStream (data layer) and workflow
 * metadata, and returns everything LogViewer (component layer) needs.
 *
 * See ARCHITECTURE.md for the full design rationale.
 */

"use client";

import { useMemo, useState, useCallback } from "react";

import type { LogEntry } from "@/lib/api/log-adapter/types";
import type { StreamPhase } from "@/lib/api/log-adapter/hooks/use-log-stream";
import { computeHistogram, filterEntries } from "@/lib/api/log-adapter/adapters/compute";
import { getApiHostname } from "@/lib/config";
import { chipsToLogQuery } from "@/components/log-viewer/lib/chips-to-log-query";
import type { UseLogViewerUrlStateReturn } from "@/components/log-viewer/lib/use-log-viewer-url-state";
import type {
  LogViewerDataProps,
  LogViewerFilterProps,
  LogViewerTimelineProps,
} from "@/components/log-viewer/components/log-viewer";
import {
  DISPLAY_PADDING_RATIO,
  MIN_PADDING_MS,
} from "@/components/log-viewer/components/timeline/lib/timeline-constants";

import type { WorkflowMetadata } from "@/components/log-viewer/components/log-viewer-container";

// =============================================================================
// Types
// =============================================================================

interface PendingDisplayRange {
  start: Date;
  end: Date;
}

/**
 * State API for filter chips + time range.
 *
 * This is the same shape returned by both useLogViewerUrlState (URL-synced)
 * and useLogViewerLocalState (instance-isolated). The presentation hook
 * is agnostic to the backing implementation — callers choose which to use.
 */
type LogViewerStateApi = UseLogViewerUrlStateReturn;

export interface UseLogPresentationParams {
  /** Raw entries from useLogStream */
  rawEntries: LogEntry[];
  /** Stream phase from useLogStream */
  phase: StreamPhase;
  /** Stream error from useLogStream */
  error: Error | null;
  /** Whether stream is actively receiving data */
  isStreaming: boolean;
  /** Restart stream callback */
  restart: () => void;

  /** Workflow metadata (start/end times, status) */
  workflowMetadata: WorkflowMetadata | null;
  /** Synchronized "now" timestamp from useTick() */
  now: number;

  /** Scope for filter field visibility */
  scope: "workflow" | "group" | "task";
  /** Backend-provided log URL (for external link derivation) */
  logUrl: string;

  /**
   * Injected state API for filter chips + time range.
   * Caller chooses the implementation:
   * - useLogViewerUrlState for the standalone log viewer page (shareable URLs)
   * - useLogViewerLocalState for embedded panel log viewers (isolated instances)
   */
  stateApi: LogViewerStateApi;
}

export interface UseLogPresentationReturn {
  /** Grouped data props for LogViewer */
  dataProps: LogViewerDataProps;
  /** Grouped filter props for LogViewer */
  filterProps: LogViewerFilterProps;
  /** Grouped timeline props for LogViewer (null if entity hasn't started) */
  timelineProps: LogViewerTimelineProps | null;
}

// =============================================================================
// Hook
// =============================================================================

export function useLogPresentation(params: UseLogPresentationParams): UseLogPresentationReturn {
  const { rawEntries, phase, error, isStreaming, restart, workflowMetadata, now, scope, logUrl, stateApi } = params;

  // -------------------------------------------------------------------------
  // 1. Filter chips + time range (injected — URL-synced or local)
  // -------------------------------------------------------------------------
  const { filterChips, setFilterChips, startTime, endTime, activePreset, setStartTime, setEndTime, setPreset } =
    stateApi;

  // Pending display range for pan/zoom preview
  const [pendingDisplay, setPendingDisplay] = useState<PendingDisplayRange | null>(null);

  // -------------------------------------------------------------------------
  // 2. Convert chips to query filters for client-side filtering
  // -------------------------------------------------------------------------
  const queryFilters = useMemo(() => chipsToLogQuery(filterChips), [filterChips]);

  const filterParams = useMemo(
    () => ({
      tasks: queryFilters.tasks,
      retries: queryFilters.retries,
      sources: queryFilters.sources,
      search: queryFilters.search,
      start: startTime,
      end: endTime,
    }),
    [queryFilters, startTime, endTime],
  );

  // -------------------------------------------------------------------------
  // 3. Client-side filtering (pure derivation)
  // -------------------------------------------------------------------------
  const filteredEntries = useMemo(() => filterEntries(rawEntries, filterParams), [rawEntries, filterParams]);

  // -------------------------------------------------------------------------
  // 4. Display range from entity lifecycle bounds (not filtered entries)
  // -------------------------------------------------------------------------
  const entityStartTimeMs = workflowMetadata?.startTime?.getTime();
  const entityEndTimeMs = workflowMetadata?.endTime?.getTime();

  const { displayStart, displayEnd } = useMemo(() => {
    const dataStart = entityStartTimeMs ? new Date(entityStartTimeMs) : new Date(now - 60 * 60 * 1000);
    const dataEnd = entityEndTimeMs ? new Date(entityEndTimeMs) : new Date(now);

    const rangeMs = dataEnd.getTime() - dataStart.getTime();
    const paddingMs = Math.max(rangeMs * DISPLAY_PADDING_RATIO, MIN_PADDING_MS);

    return {
      displayStart: new Date(dataStart.getTime() - paddingMs),
      displayEnd: new Date(dataEnd.getTime() + paddingMs),
    };
  }, [entityStartTimeMs, entityEndTimeMs, now]);

  // -------------------------------------------------------------------------
  // 5. Histogram computation (from filtered entries to match current behavior)
  // -------------------------------------------------------------------------
  const histogram = useMemo(
    () =>
      computeHistogram(filteredEntries, {
        numBuckets: 50,
        displayStart,
        displayEnd,
        effectiveStart: startTime,
        effectiveEnd: endTime,
      }),
    [filteredEntries, displayStart, displayEnd, startTime, endTime],
  );

  const pendingHistogram = useMemo(() => {
    if (!pendingDisplay) return undefined;
    return computeHistogram(filteredEntries, {
      numBuckets: 50,
      displayStart: pendingDisplay.start,
      displayEnd: pendingDisplay.end,
      effectiveStart: startTime,
      effectiveEnd: endTime,
    });
  }, [filteredEntries, pendingDisplay, startTime, endTime]);

  // -------------------------------------------------------------------------
  // 6. Pan/zoom handlers
  // -------------------------------------------------------------------------
  const handleDisplayRangeChange = useCallback((newStart: Date, newEnd: Date) => {
    setPendingDisplay({ start: newStart, end: newEnd });
  }, []);

  const handleClearPendingDisplay = useCallback(() => {
    setPendingDisplay(null);
  }, []);

  // -------------------------------------------------------------------------
  // 7. External log URL (for "open in new tab" link)
  // -------------------------------------------------------------------------
  const externalLogUrl = useMemo(() => {
    if (!logUrl) return "";

    // If the logUrl is already absolute, use it directly
    if (logUrl.startsWith("http://") || logUrl.startsWith("https://")) {
      return logUrl;
    }

    // Build absolute URL from the relative backend log URL
    const hostname = getApiHostname();
    const baseUrl = hostname.startsWith("http") ? hostname : `https://${hostname}`;
    // logUrl is a relative path like "/api/workflow/foo/logs" or "api/workflow/foo/task/bar/logs"
    const normalizedPath = logUrl.startsWith("/") ? logUrl : `/${logUrl}`;
    return `${baseUrl}${normalizedPath}`;
  }, [logUrl]);

  // -------------------------------------------------------------------------
  // 8. Construct grouped props for LogViewer
  // -------------------------------------------------------------------------
  const dataProps = useMemo<LogViewerDataProps>(
    () => ({
      rawEntries,
      filteredEntries,
      isLoading: phase === "connecting",
      isFetching: phase === "streaming",
      error,
      histogram,
      pendingHistogram,
      isStreaming,
      externalLogUrl,
      onRefetch: restart,
    }),
    [rawEntries, filteredEntries, phase, error, histogram, pendingHistogram, isStreaming, externalLogUrl, restart],
  );

  const filterProps = useMemo<LogViewerFilterProps>(
    () => ({
      filterChips,
      onFilterChipsChange: setFilterChips,
      scope,
    }),
    [filterChips, setFilterChips, scope],
  );

  const entityStartTime = workflowMetadata?.startTime;
  const entityEndTime = workflowMetadata?.endTime;

  const timelineProps = useMemo<LogViewerTimelineProps | null>(() => {
    if (!entityStartTime) return null;
    return {
      filterStartTime: startTime,
      filterEndTime: endTime,
      displayStart,
      displayEnd,
      activePreset,
      onFilterStartTimeChange: setStartTime,
      onFilterEndTimeChange: setEndTime,
      onPresetSelect: setPreset,
      onDisplayRangeChange: handleDisplayRangeChange,
      onClearPendingDisplay: handleClearPendingDisplay,
      entityStartTime,
      entityEndTime,
      now,
    };
  }, [
    startTime,
    endTime,
    displayStart,
    displayEnd,
    activePreset,
    setStartTime,
    setEndTime,
    setPreset,
    handleDisplayRangeChange,
    handleClearPendingDisplay,
    entityStartTime,
    entityEndTime,
    now,
  ]);

  return { dataProps, filterProps, timelineProps };
}
