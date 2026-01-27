// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

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

import { useMemo, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { useLogData, useLogTail, computeHistogram } from "@/lib/api/log-adapter";
import { LogViewer } from "./LogViewer";
import { LogViewerSkeleton } from "./LogViewerSkeleton";
import { chipsToLogQuery } from "../lib/chips-to-log-query";
import { useCombinedEntries } from "../lib/use-combined-entries";
import { useLogViewerUrlState } from "../lib/use-log-viewer-url-state";
import { useTick, useTickController } from "@/hooks/use-tick";

// =============================================================================
// Types
// =============================================================================

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
  const [pendingDisplayStart, setPendingDisplayStart] = useState<Date | undefined>(undefined);
  const [pendingDisplayEnd, setPendingDisplayEnd] = useState<Date | undefined>(undefined);

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

  // Combine query entries with live streaming entries
  // Applies current filters to live entries to ensure visual consistency
  const combinedEntries = useCombinedEntries(queryEntries, liveEntries, {
    levels: queryFilters.levels,
    tasks: queryFilters.tasks,
    retries: queryFilters.retries,
    sources: queryFilters.sources,
    search: queryFilters.search,
    start: startTime,
    end: endTime,
  });

  // Extract stable timestamp primitives to prevent recalculation when arrays get new references
  const firstLogTimeMs = combinedEntries[0]?.timestamp.getTime();
  const lastLogTimeMs = combinedEntries[combinedEntries.length - 1]?.timestamp.getTime();
  const workflowStartTimeMs = workflowMetadata?.startTime?.getTime();
  const workflowEndTimeMs = workflowMetadata?.endTime?.getTime();

  // Compute display range with padding (10% on each side to ensure invalid zones are visible)
  const { displayStart, displayEnd } = useMemo(() => {
    const PADDING_RATIO = 0.1; // Increased from 7.5% to ensure invalid zones are visible

    // Determine data boundaries with proper fallback hierarchy
    // For start: use query startTime, or entity start time, or first log timestamp, or 1 hour before NOW
    const firstLogTime = firstLogTimeMs ? new Date(firstLogTimeMs) : undefined;
    const entityStartTime = workflowStartTimeMs ? new Date(workflowStartTimeMs) : undefined;
    const dataStart = startTime ?? entityStartTime ?? firstLogTime ?? new Date(now - 60 * 60 * 1000);

    // For end: use query endTime, or entity end time, or last log timestamp, or NOW
    const lastLogTime = lastLogTimeMs ? new Date(lastLogTimeMs) : undefined;
    const entityEndTime = workflowEndTimeMs ? new Date(workflowEndTimeMs) : undefined;
    const dataEnd = endTime ?? entityEndTime ?? lastLogTime ?? new Date(now);

    // Calculate padding (minimum 10 seconds to ensure invalid zone visibility)
    const rangeMs = dataEnd.getTime() - dataStart.getTime();
    const paddingMs = Math.max(rangeMs * PADDING_RATIO, 10_000); // Min 10 seconds padding

    return {
      displayStart: new Date(dataStart.getTime() - paddingMs),
      displayEnd: new Date(dataEnd.getTime() + paddingMs),
    };
  }, [startTime, endTime, firstLogTimeMs, lastLogTimeMs, workflowStartTimeMs, workflowEndTimeMs, now]);

  // Recompute histogram from combined entries to stay in sync with visible log entries
  // This ensures:
  // - Buckets adjust dynamically based on the current time range
  // - Histogram includes new live entries
  // - Bucket intervals adapt as the effective time range changes
  // - Buckets are marked as in/out of effective range for visual dimming
  const histogram = useMemo(() => {
    return computeHistogram(combinedEntries, {
      numBuckets: 50,
      displayStart,
      displayEnd,
      effectiveStart: startTime,
      effectiveEnd: endTime,
    });
  }, [combinedEntries, displayStart, displayEnd, startTime, endTime]);

  // Pending histogram (computed with pending display range for real-time pan/zoom feedback)
  const pendingHistogram = useMemo(() => {
    if (!pendingDisplayStart || !pendingDisplayEnd) return undefined;

    return computeHistogram(combinedEntries, {
      numBuckets: 50,
      displayStart: pendingDisplayStart,
      displayEnd: pendingDisplayEnd,
      effectiveStart: startTime,
      effectiveEnd: endTime,
    });
  }, [combinedEntries, pendingDisplayStart, pendingDisplayEnd, startTime, endTime]);

  // Handle display range change from pan/zoom (before Apply)
  const handleDisplayRangeChange = useCallback((newDisplayStart: Date, newDisplayEnd: Date) => {
    setPendingDisplayStart(newDisplayStart);
    setPendingDisplayEnd(newDisplayEnd);
  }, []);

  // Clear pending state (called by LogViewer on Apply or Cancel)
  const handleClearPendingDisplay = useCallback(() => {
    setPendingDisplayStart(undefined);
    setPendingDisplayEnd(undefined);
  }, []);

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
  if (!workflowMetadata?.startTime) {
    return (
      <div className={cn(showBorder && "border-border bg-card overflow-hidden rounded-lg border", className)}>
        <div className="text-muted-foreground p-4 text-center text-sm">Workflow has not started yet</div>
      </div>
    );
  }

  return (
    <div className={cn(showBorder && "border-border bg-card overflow-hidden rounded-lg border", className)}>
      <LogViewer
        entries={combinedEntries}
        totalCount={stats.totalCount}
        isLoading={isLoading}
        isFetching={isFetching}
        error={error}
        histogram={histogram}
        pendingHistogram={pendingHistogram}
        onRefetch={refetch}
        filterChips={filterChips}
        onFilterChipsChange={setFilterChips}
        scope={scope}
        className={viewerClassName}
        filterStartTime={startTime}
        filterEndTime={endTime}
        displayStart={displayStart}
        displayEnd={displayEnd}
        activePreset={activePreset}
        onFilterStartTimeChange={setStartTime}
        onFilterEndTimeChange={setEndTime}
        onPresetSelect={setPreset}
        onDisplayRangeChange={handleDisplayRangeChange}
        onClearPendingDisplay={handleClearPendingDisplay}
        entityStartTime={workflowMetadata.startTime}
        entityEndTime={workflowMetadata.endTime}
        now={now}
      />
    </div>
  );
}
