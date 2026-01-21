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
 * live tailing (useLogTail), and the LogViewer presentation component.
 *
 * This is the recommended way to add a log viewer to a page - just provide
 * a workflowId and the container handles everything else.
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
 * // Full customization
 * <LogViewerContainer
 *   workflowId="my-workflow"
 *   scope="task"
 *   enableTailing={false}
 *   onFiltersChange={(chips) => syncToUrl(chips)}
 * />
 * ```
 */

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useLogData, useLogTail, type LogEntry } from "@/lib/api/log-adapter";
import type { SearchChip } from "@/components/filter-bar";
import { LogViewer } from "./LogViewer";
import { LogViewerSkeleton } from "./LogViewerSkeleton";
import { useLogViewerStore } from "../store/log-viewer-store";
import { chipsToLogQuery } from "../lib/chips-to-log-query";

// =============================================================================
// Types
// =============================================================================

export interface LogViewerContainerProps {
  /** Workflow ID to fetch logs for */
  workflowId: string;
  /** Optional dev params (for playground scenarios) */
  devParams?: Record<string, string>;
  /** Dev params for tailing (defaults to devParams if not specified) */
  tailDevParams?: Record<string, string>;
  /** Scope for filtering (workflow, group, task) */
  scope?: "workflow" | "group" | "task";
  /** Additional class names for the container wrapper */
  className?: string;
  /** Additional class names for the LogViewer */
  viewerClassName?: string;
  /** Callback when filters change */
  onFiltersChange?: (chips: SearchChip[]) => void;
  /** Initial filter chips */
  initialChips?: SearchChip[];
  /** Enable live tailing (default: true) */
  enableTailing?: boolean;
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
  tailDevParams,
  scope = "workflow",
  className,
  viewerClassName,
  onFiltersChange,
  initialChips = [],
  enableTailing = true,
  showBorder = true,
}: LogViewerContainerProps) {
  // Remount when workflowId or devParams change to reset all state
  const key = useMemo(
    () => `${workflowId}-${JSON.stringify(devParams ?? {})}`,
    [workflowId, devParams],
  );

  return (
    <LogViewerContainerInner
      key={key}
      workflowId={workflowId}
      devParams={devParams}
      tailDevParams={tailDevParams}
      scope={scope}
      className={className}
      viewerClassName={viewerClassName}
      onFiltersChange={onFiltersChange}
      initialChips={initialChips}
      enableTailing={enableTailing}
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
  tailDevParams: tailDevParamsProp,
  scope,
  className,
  viewerClassName,
  onFiltersChange: onFiltersChangeProp,
  initialChips,
  enableTailing,
  showBorder,
}: LogViewerContainerProps) {
  // Filter chips state
  const [filterChips, setFilterChips] = useState<SearchChip[]>(initialChips ?? []);

  // Get tailing state from store
  const isTailing = useLogViewerStore((s) => s.isTailing);

  // Convert filter chips to query params
  const queryFilters = useMemo(() => chipsToLogQuery(filterChips), [filterChips]);

  // Memoize devParams to prevent unnecessary refetches
  const stableDevParams = useMemo(() => devParams, [devParams]);

  // Unified data hook - returns entries, histogram, facets together
  const {
    entries: queryEntries,
    histogram,
    facets,
    isLoading,
    error,
    refetch,
  } = useLogData({
    workflowId,
    devParams: stableDevParams,
    // Pass filter params
    levels: queryFilters.levels,
    sources: queryFilters.sources,
    search: queryFilters.search,
  });

  // Tail dev params (defaults to main devParams if not specified)
  const tailDevParams = useMemo(
    () => tailDevParamsProp ?? stableDevParams,
    [tailDevParamsProp, stableDevParams],
  );

  // Live tailing hook - appends new entries as they stream in
  const { entries: tailEntries } = useLogTail({
    workflowId,
    enabled: enableTailing && isTailing,
    devParams: tailDevParams,
  });

  // ==========================================================================
  // Ref-based streaming buffer for stable array identity
  // Avoids creating new arrays on every tail update for better performance
  // ==========================================================================

  // Cache the latest timestamp from query entries (computed once per query change)
  const queryLatestTime = useMemo(() => {
    if (queryEntries.length === 0) return 0;
    let maxTime = 0;
    for (const e of queryEntries) {
      const t = e.timestamp.getTime();
      if (t > maxTime) maxTime = t;
    }
    return maxTime;
  }, [queryEntries]);

  // Ref-based buffer maintains stable array identity during streaming
  const combinedEntriesRef = useRef<LogEntry[]>([]);
  const lastQueryEntriesRef = useRef<LogEntry[]>([]);
  const processedTailCountRef = useRef(0);

  // Version counter to trigger re-renders when buffer changes
  const [bufferVersion, setBufferVersion] = useState(0);

  // Update combined entries buffer when query or tail entries change
  useEffect(() => {
    // If query entries changed (different reference = new data load), reset buffer
    if (queryEntries !== lastQueryEntriesRef.current) {
      const newBuffer: LogEntry[] = [];
      for (const e of queryEntries) newBuffer.push(e);
      combinedEntriesRef.current = newBuffer;
      lastQueryEntriesRef.current = queryEntries;
      processedTailCountRef.current = 0;
      setBufferVersion((v) => v + 1);
      return;
    }

    // Append only new tail entries (incremental update)
    const newTailCount = tailEntries.length - processedTailCountRef.current;
    if (newTailCount > 0) {
      let appended = false;
      for (let i = processedTailCountRef.current; i < tailEntries.length; i++) {
        const entry = tailEntries[i];
        if (entry.timestamp.getTime() > queryLatestTime) {
          combinedEntriesRef.current.push(entry);
          appended = true;
        }
      }
      processedTailCountRef.current = tailEntries.length;

      if (appended) {
        setBufferVersion((v) => v + 1);
      }
    }
  }, [queryEntries, tailEntries, queryLatestTime]);

  // Use buffer version in dependency to ensure consumers re-render
  const combinedEntries = useMemo(
    () => combinedEntriesRef.current,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bufferVersion triggers update
    [bufferVersion],
  );

  // Handle filter changes
  const handleFiltersChange = useCallback(
    (chips: SearchChip[]) => {
      setFilterChips(chips);
      onFiltersChangeProp?.(chips);
    },
    [onFiltersChangeProp],
  );

  // Check if any filters are active for preFiltered mode
  const hasFilters = filterChips.length > 0;

  // Show skeleton during initial load
  if (isLoading && combinedEntries.length === 0) {
    return (
      <div
        className={cn(
          showBorder && "border-border bg-card overflow-hidden rounded-lg border",
          className,
        )}
      >
        <LogViewerSkeleton className={viewerClassName} />
      </div>
    );
  }

  return (
    <div
      className={cn(
        showBorder && "border-border bg-card overflow-hidden rounded-lg border",
        className,
      )}
    >
      <LogViewer
        entries={combinedEntries}
        isLoading={isLoading}
        error={error}
        histogram={histogram}
        facets={facets}
        onRefetch={refetch}
        onFiltersChange={handleFiltersChange}
        initialChips={filterChips}
        scope={scope}
        className={viewerClassName}
        preFiltered={hasFilters}
      />
    </div>
  );
}
