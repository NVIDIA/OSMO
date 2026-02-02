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

"use client";

/**
 * Log Viewer Container
 *
 * A ready-to-use component that wires together data fetching (useLogData),
 * live streaming (useLogTail), and the LogViewer presentation component.
 *
 * This is the recommended way to add a log viewer to a page - just provide
 * a workflowId and the container handles everything else.
 *
 * ## Live Mode
 *
 * When `enableLiveMode` is true and the store's `isLiveMode` is active:
 * - New log entries are streamed in real-time
 * - Auto-scroll to bottom is enabled
 * - User scrolling away from bottom pauses live mode
 *
 * In the upcoming time range selector, live mode will be enabled when
 * the user selects "NOW" as the end time.
 *
 * @example
 * ```tsx
 * // Basic usage
 * <LogViewerContainer workflowId="my-workflow" />
 *
 * // With dev scenario (for playground)
 * <LogViewerContainer
 *   workflowId="my-workflow"
 *   devParams={{ log_scenario: "error-heavy" }}
 * />
 *
 * // Disable live streaming
 * <LogViewerContainer
 *   workflowId="my-workflow"
 *   enableLiveMode={false}
 * />
 * ```
 */

import { useMemo, useState, useCallback, useDeferredValue } from "react";
import { cn } from "@/lib/utils";
import { useLogData, useLogTail, computeHistogram } from "@/lib/api/log-adapter";
import { LogViewer } from "./LogViewer";
import type { LogViewerDataProps, LogViewerFilterProps, LogViewerTimelineProps } from "./LogViewer";
import { LogViewerSkeleton } from "./LogViewerSkeleton";
import { chipsToLogQuery } from "../lib/chips-to-log-query";
import { useCombinedEntries } from "../lib/use-combined-entries";
import { useLogViewerUrlState } from "../lib/use-log-viewer-url-state";
import { useTick, useTickController } from "@/hooks/use-tick";
import { DISPLAY_PADDING_RATIO, MIN_PADDING_MS } from "./timeline/lib/timeline-constants";

// =============================================================================
// Types
// =============================================================================

/**
 * Pending display range for real-time pan/zoom feedback.
 * Combined into single state to prevent race conditions between start/end updates.
 */
interface PendingDisplayRange {
  start: Date;
  end: Date;
}

export interface WorkflowMetadata {
  name: string;
  status: string;
  submitTime?: Date;
  startTime?: Date;
  endTime?: Date;
}

export interface LogViewerContainerProps {
  /** Workflow ID to fetch logs for */
  workflowId: string;
  /** Optional workflow metadata for timeline bounds */
  workflowMetadata?: WorkflowMetadata | null;
  /** Optional dev params (for playground scenarios) */
  devParams?: Record<string, string>;
  /** Dev params for live streaming (defaults to devParams if not specified) */
  liveDevParams?: Record<string, string>;
  /** Scope for filtering (workflow, group, task) */
  scope?: "workflow" | "group" | "task";
  /** Additional class names for the container wrapper */
  className?: string;
  /** Additional class names for the LogViewer */
  viewerClassName?: string;
  /**
   * Enable live mode capability (default: true).
   * When true, logs can stream in real-time when isLiveMode is active in store.
   * In the upcoming time range selector, this will be tied to end time = "NOW".
   */
  enableLiveMode?: boolean;
  /** Show border around the container (default: true) */
  showBorder?: boolean;
}

// =============================================================================
// Component
// =============================================================================

/**
 * Container component that handles data fetching and wires up LogViewer.
 */
export function LogViewerContainer({
  workflowId,
  workflowMetadata,
  devParams,
  liveDevParams,
  scope = "workflow",
  className,
  viewerClassName,
  enableLiveMode = true,
  showBorder = true,
}: LogViewerContainerProps) {
  // Extract primitive values from devParams to create a stable key
  // This prevents remounting when devParams object reference changes but values are identical
  const logScenario = devParams?.log_scenario;

  // Remount when workflowId or log scenario changes to reset all state
  const key = useMemo(() => `${workflowId}-${logScenario ?? ""}`, [workflowId, logScenario]);

  return (
    <LogViewerContainerInner
      key={key}
      workflowId={workflowId}
      workflowMetadata={workflowMetadata}
      devParams={devParams}
      liveDevParams={liveDevParams}
      scope={scope}
      className={className}
      viewerClassName={viewerClassName}
      enableLiveMode={enableLiveMode}
      showBorder={showBorder}
    />
  );
}

/**
 * Inner implementation that handles all the data fetching logic.
 * Separated to allow key-based remounting on prop changes.
 */
function LogViewerContainerInner({
  workflowId,
  workflowMetadata,
  devParams,
  liveDevParams: liveDevParamsProp,
  scope,
  className,
  viewerClassName,
  enableLiveMode,
  showBorder,
}: LogViewerContainerProps) {
  // Enable synchronized ticking when workflow is running (no endTime)
  useTickController(workflowMetadata?.endTime === undefined);

  // Get synchronized "NOW" timestamp across all components
  const now = useTick();

  // URL-synced state for filters and time range
  // Pass entity boundaries and synchronized NOW for validation/backfill
  const {
    filterChips,
    setFilterChips,
    startTime,
    endTime,
    activePreset,
    setStartTime,
    setEndTime,
    setPreset,
    isLiveMode,
  } = useLogViewerUrlState({
    entityStartTime: workflowMetadata?.startTime, // REALITY: Hard lower bound
    entityEndTime: workflowMetadata?.endTime, // REALITY: Hard upper bound (if completed)
    now, // REFERENCE: Synchronized NOW from useTick()
  });

  // Pending display range state (for real-time pan/zoom without committing)
  // Combined into single state to prevent race conditions between start/end updates
  const [pendingDisplay, setPendingDisplay] = useState<PendingDisplayRange | null>(null);

  // Convert filter chips to query params
  const queryFilters = useMemo(() => chipsToLogQuery(filterChips), [filterChips]);

  // Extract primitive value from devParams for stable memoization
  // This prevents refetches when devParams object reference changes but values are identical
  const logScenario = devParams?.log_scenario;

  // Reconstruct devParams from primitive to ensure stable reference
  const stableDevParams = useMemo(() => (logScenario ? { log_scenario: logScenario } : undefined), [logScenario]);

  // Memoize the entire params object to prevent unnecessary refetches
  // This ensures the params object reference is stable when values don't change
  const logDataParams = useMemo(
    () => ({
      workflowId,
      devParams: stableDevParams,
      levels: queryFilters.levels,
      tasks: queryFilters.tasks,
      retries: queryFilters.retries,
      sources: queryFilters.sources,
      search: queryFilters.search,
      start: startTime,
      end: endTime,
      // Keep previous data visible while fetching to prevent flickering
      keepPrevious: true,
    }),
    [workflowId, stableDevParams, queryFilters, startTime, endTime],
  );

  // Unified data hook - returns entries, histogram, facets together
  const { entries: queryEntries, stats, isLoading, isFetching, error, refetch } = useLogData(logDataParams);

  // Live streaming dev params (defaults to main devParams if not specified)
  // Extract primitive and reconstruct to ensure stability
  const liveLogScenario = liveDevParamsProp?.log_scenario ?? logScenario;
  const stableLiveDevParams = useMemo(
    () => (liveLogScenario ? { log_scenario: liveLogScenario } : undefined),
    [liveLogScenario],
  );

  // Live streaming hook - appends new entries as they stream in
  // Active when live mode is enabled and the capability is allowed
  const { entries: liveEntries } = useLogTail({
    workflowId,
    enabled: enableLiveMode && isLiveMode,
    devParams: stableLiveDevParams,
  });

  // Memoize filter params for useCombinedEntries to prevent unnecessary recomputation
  // Each property is listed individually in deps to ensure stable reference when values don't change
  const filterParams = useMemo(
    () => ({
      levels: queryFilters.levels,
      tasks: queryFilters.tasks,
      retries: queryFilters.retries,
      sources: queryFilters.sources,
      search: queryFilters.search,
      start: startTime,
      end: endTime,
    }),
    [
      queryFilters.levels,
      queryFilters.tasks,
      queryFilters.retries,
      queryFilters.sources,
      queryFilters.search,
      startTime,
      endTime,
    ],
  );

  // Combine query entries with live streaming entries
  // Applies current filters to live entries to ensure visual consistency
  const combinedEntries = useCombinedEntries(queryEntries, liveEntries, filterParams);

  // Debounce histogram recomputation during live streaming
  // This prevents expensive histogram recalculation from blocking UI updates
  const deferredCombinedEntries = useDeferredValue(combinedEntries);

  // Extract stable timestamp primitives to prevent recalculation when arrays get new references
  const firstLogTimeMs = combinedEntries[0]?.timestamp.getTime();
  const lastLogTimeMs = combinedEntries[combinedEntries.length - 1]?.timestamp.getTime();
  const workflowStartTimeMs = workflowMetadata?.startTime?.getTime();
  const workflowEndTimeMs = workflowMetadata?.endTime?.getTime();

  // Compute display range with padding to ensure invalid zones are visible
  const { displayStart, displayEnd } = useMemo(() => {
    // Determine data boundaries with proper fallback hierarchy
    // For start: use query startTime, or entity start time, or first log timestamp, or 1 hour before NOW
    const firstLogTime = firstLogTimeMs ? new Date(firstLogTimeMs) : undefined;
    const entityStartTime = workflowStartTimeMs ? new Date(workflowStartTimeMs) : undefined;
    const dataStart = startTime ?? entityStartTime ?? firstLogTime ?? new Date(now - 60 * 60 * 1000);

    // For end: use query endTime, or entity end time, or last log timestamp, or NOW
    const lastLogTime = lastLogTimeMs ? new Date(lastLogTimeMs) : undefined;
    const entityEndTime = workflowEndTimeMs ? new Date(workflowEndTimeMs) : undefined;
    const dataEnd = endTime ?? entityEndTime ?? lastLogTime ?? new Date(now);

    // Calculate padding using constants from timeline-constants (SSOT)
    const rangeMs = dataEnd.getTime() - dataStart.getTime();
    const paddingMs = Math.max(rangeMs * DISPLAY_PADDING_RATIO, MIN_PADDING_MS);

    return {
      displayStart: new Date(dataStart.getTime() - paddingMs),
      displayEnd: new Date(dataEnd.getTime() + paddingMs),
    };
  }, [startTime, endTime, firstLogTimeMs, lastLogTimeMs, workflowStartTimeMs, workflowEndTimeMs, now]);

  // Recompute histogram from deferred entries to prevent blocking UI during streaming
  // Uses useDeferredValue to allow React to prioritize user interactions over histogram updates
  // This ensures:
  // - Buckets adjust dynamically based on the current time range
  // - Histogram includes new live entries (with slight delay during rapid updates)
  // - Bucket intervals adapt as the effective time range changes
  // - Buckets are marked as in/out of effective range for visual dimming
  const histogram = useMemo(() => {
    return computeHistogram(deferredCombinedEntries, {
      numBuckets: 50,
      displayStart,
      displayEnd,
      effectiveStart: startTime,
      effectiveEnd: endTime,
    });
  }, [deferredCombinedEntries, displayStart, displayEnd, startTime, endTime]);

  // Pending histogram (computed with pending display range for real-time pan/zoom feedback)
  // Uses deferred entries to prevent blocking during pan/zoom gestures
  const pendingHistogram = useMemo(() => {
    if (!pendingDisplay) return undefined;

    return computeHistogram(deferredCombinedEntries, {
      numBuckets: 50,
      displayStart: pendingDisplay.start,
      displayEnd: pendingDisplay.end,
      effectiveStart: startTime,
      effectiveEnd: endTime,
    });
  }, [deferredCombinedEntries, pendingDisplay, startTime, endTime]);

  // Handle display range change from pan/zoom (before Apply)
  const handleDisplayRangeChange = useCallback((newDisplayStart: Date, newDisplayEnd: Date) => {
    setPendingDisplay({ start: newDisplayStart, end: newDisplayEnd });
  }, []);

  // Clear pending state (called by LogViewer on Apply or Cancel)
  const handleClearPendingDisplay = useCallback(() => {
    setPendingDisplay(null);
  }, []);

  // ==========================================================================
  // Grouped Props with Memoization
  // ==========================================================================
  // These objects are memoized to prevent unnecessary re-renders in LogViewer.
  // Each group contains logically related props.
  // NOTE: Hooks must be called before any early returns (Rules of Hooks).

  // Group data props (entries, loading states, histogram, refetch)
  const dataProps = useMemo<LogViewerDataProps>(
    () => ({
      entries: combinedEntries,
      totalCount: stats.totalCount,
      isLoading,
      isFetching,
      error,
      histogram,
      pendingHistogram,
      isLiveMode,
      onRefetch: refetch,
    }),
    [combinedEntries, stats.totalCount, isLoading, isFetching, error, histogram, pendingHistogram, isLiveMode, refetch],
  );

  // Group filter props (chips, scope)
  const filterProps = useMemo<LogViewerFilterProps>(
    () => ({
      filterChips,
      onFilterChipsChange: setFilterChips,
      scope: scope ?? "workflow",
    }),
    [filterChips, setFilterChips, scope],
  );

  // Extract entity times for timeline props (may be undefined before workflow starts)
  const entityStartTime = workflowMetadata?.startTime;
  const entityEndTime = workflowMetadata?.endTime;

  // Group timeline props (time range, presets, entity boundaries)
  // Note: entityStartTime is typed as optional here but will be guaranteed by guards below
  const timelineProps = useMemo<LogViewerTimelineProps | null>(() => {
    // Can't construct valid timeline props without entityStartTime
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

  // Check if workflow has started - if not, show a message
  const workflowNotStarted = workflowMetadata && !workflowMetadata.startTime;

  if (workflowNotStarted) {
    return (
      <div className={cn(showBorder && "border-border bg-card overflow-hidden rounded-lg border", className)}>
        <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
          <div className="bg-muted text-muted-foreground rounded-full p-4">
            <svg
              className="size-8"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <circle
                cx="12"
                cy="12"
                r="10"
              />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <div className="space-y-1">
            <p className="text-foreground text-sm font-medium">Workflow Not Started</p>
            <p className="text-muted-foreground text-xs">
              {workflowMetadata.submitTime
                ? `Submitted ${workflowMetadata.submitTime.toLocaleString()}, waiting to start`
                : "Workflow has been submitted but hasn't started yet"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Show skeleton during initial load and when refetching without data
  // User preference: show skeleton instead of stale data for correctness
  const showSkeleton = isLoading && combinedEntries.length === 0;

  if (showSkeleton) {
    return (
      <div className={cn(showBorder && "border-border bg-card overflow-hidden rounded-lg border", className)}>
        <LogViewerSkeleton className={viewerClassName} />
      </div>
    );
  }

  // GUARD: Workflow must have started before rendering LogViewer
  // entityStartTime is guaranteed for LogViewer to function properly
  if (!workflowMetadata?.startTime || !timelineProps) {
    return (
      <div className={cn(showBorder && "border-border bg-card overflow-hidden rounded-lg border", className)}>
        <div className="text-muted-foreground p-4 text-center text-sm">Workflow has not started yet</div>
      </div>
    );
  }

  return (
    <div className={cn(showBorder && "border-border bg-card overflow-hidden rounded-lg border", className)}>
      <LogViewer
        data={dataProps}
        filter={filterProps}
        timeline={timelineProps}
        className={viewerClassName}
      />
    </div>
  );
}
