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

import { useState, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import { useLogData, useLogTail, computeHistogram } from "@/lib/api/log-adapter";
import type { SearchChip } from "@/components/filter-bar";
import { LogViewer } from "./LogViewer";
import { LogViewerSkeleton } from "./LogViewerSkeleton";
import type { TimeRangePreset } from "./TimelineHistogram";
import { chipsToLogQuery } from "../lib/chips-to-log-query";
import { useCombinedEntries } from "../lib/use-combined-entries";

// =============================================================================
// Types
// =============================================================================

export interface LogViewerContainerProps {
  /** Workflow ID to fetch logs for */
  workflowId: string;
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
  /** Callback when filter chips change */
  onFilterChipsChange?: (chips: SearchChip[]) => void;
  /** Initial filter chips (used on mount, not synced after) */
  initialFilterChips?: SearchChip[];
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
  devParams,
  liveDevParams,
  scope = "workflow",
  className,
  viewerClassName,
  onFilterChipsChange,
  initialFilterChips = [],
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
      devParams={devParams}
      liveDevParams={liveDevParams}
      scope={scope}
      className={className}
      viewerClassName={viewerClassName}
      onFilterChipsChange={onFilterChipsChange}
      initialFilterChips={initialFilterChips}
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
  devParams,
  liveDevParams: liveDevParamsProp,
  scope,
  className,
  viewerClassName,
  onFilterChipsChange: onFilterChipsChangeProp,
  initialFilterChips,
  enableLiveMode,
  showBorder,
}: LogViewerContainerProps) {
  // Filter chips state - single source of truth
  const [filterChips, setFilterChips] = useState<SearchChip[]>(initialFilterChips ?? []);

  // Time range state - will be managed via nuqs in the future
  const [startTime, setStartTime] = useState<Date | undefined>(undefined);
  const [endTime, setEndTime] = useState<Date | undefined>(undefined);
  const [activePreset, setActivePreset] = useState<TimeRangePreset | undefined>("all");

  // Derive live mode from end time (endTime === undefined means "NOW" / live mode)
  const isLiveMode = endTime === undefined;

  // Handle preset selection
  const handlePresetSelect = useCallback((preset: TimeRangePreset) => {
    setActivePreset(preset);
    const now = new Date();

    switch (preset) {
      case "all":
        setStartTime(undefined);
        setEndTime(undefined);
        break;
      case "5m":
        setStartTime(new Date(now.getTime() - 5 * 60 * 1000));
        setEndTime(undefined); // NOW
        break;
      case "15m":
        setStartTime(new Date(now.getTime() - 15 * 60 * 1000));
        setEndTime(undefined);
        break;
      case "1h":
        setStartTime(new Date(now.getTime() - 60 * 60 * 1000));
        setEndTime(undefined);
        break;
      case "6h":
        setStartTime(new Date(now.getTime() - 6 * 60 * 60 * 1000));
        setEndTime(undefined);
        break;
      case "24h":
        setStartTime(new Date(now.getTime() - 24 * 60 * 60 * 1000));
        setEndTime(undefined);
        break;
      case "custom":
        // Custom preset is set programmatically via time changes
        // No action needed here
        break;
    }
  }, []);

  // Handle manual time changes - set to custom preset
  const handleStartTimeChange = useCallback((time: Date | undefined) => {
    setStartTime(time);
    setActivePreset("custom");
  }, []);

  const handleEndTimeChange = useCallback((time: Date | undefined) => {
    setEndTime(time);
    setActivePreset("custom");
  }, []);

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
      // Disable keepPreviousData - prefer skeleton over stale data
      keepPrevious: false,
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

  // Compute display range with padding (7.5% on each side)
  const { displayStart, displayEnd } = useMemo(() => {
    const PADDING_RATIO = 0.075;

    // Fallback time (static, only used when no data available)
    const fallbackStart = new Date(2024, 0, 1);

    // Determine data boundaries
    // For start: use startTime, or first log timestamp, or fallback
    const firstLogTime = combinedEntries[0]?.timestamp ?? fallbackStart;
    const dataStart = startTime ?? firstLogTime;

    // For end: use endTime, or last log timestamp + 1 minute (approximates NOW)
    const lastLogTime = combinedEntries[combinedEntries.length - 1]?.timestamp ?? firstLogTime;
    const approximateNow = new Date(lastLogTime.getTime() + 60_000);
    const dataEnd = endTime ?? approximateNow;

    // Calculate padding
    const rangeMs = dataEnd.getTime() - dataStart.getTime();
    const paddingMs = Math.max(rangeMs * PADDING_RATIO, 60_000 * PADDING_RATIO); // Min 6 seconds padding

    return {
      displayStart: new Date(dataStart.getTime() - paddingMs),
      displayEnd: new Date(dataEnd.getTime() + paddingMs),
    };
  }, [startTime, endTime, combinedEntries]);

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

  // Handle filter chip changes - update local state and notify parent
  const handleFilterChipsChange = useCallback(
    (chips: SearchChip[]) => {
      setFilterChips(chips);
      onFilterChipsChangeProp?.(chips);
    },
    [onFilterChipsChangeProp],
  );

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

  return (
    <div className={cn(showBorder && "border-border bg-card overflow-hidden rounded-lg border", className)}>
      <LogViewer
        entries={combinedEntries}
        totalCount={stats.totalCount}
        isLoading={isLoading}
        isFetching={isFetching}
        error={error}
        histogram={histogram}
        onRefetch={refetch}
        filterChips={filterChips}
        onFilterChipsChange={handleFilterChipsChange}
        scope={scope}
        className={viewerClassName}
        startTime={startTime}
        endTime={endTime}
        displayStart={displayStart}
        displayEnd={displayEnd}
        activePreset={activePreset}
        onStartTimeChange={handleStartTimeChange}
        onEndTimeChange={handleEndTimeChange}
        onPresetSelect={handlePresetSelect}
      />
    </div>
  );
}
