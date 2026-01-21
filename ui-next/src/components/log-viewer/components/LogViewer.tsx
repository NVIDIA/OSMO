// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import { memo, useCallback, useMemo, useEffect, startTransition, useDeferredValue } from "react";
import { cn } from "@/lib/utils";
import type { LogEntry, HistogramBucket, FieldFacet, TailStatus } from "@/lib/api/log-adapter";
import { formatLogLine } from "@/lib/api/log-adapter";
import type { SearchChip } from "@/components/filter-bar";
import { useServices } from "@/contexts/service-context";
import { withViewTransition } from "@/hooks";
import { QueryBar } from "./QueryBar";
import { TimelineHistogram } from "./TimelineHistogram";
import { FieldsPane } from "./FieldsPane";
import { LogList } from "./LogList";
import { LogToolbar } from "./LogToolbar";
import { LogViewerSkeleton } from "./LogViewerSkeleton";
import { useLogViewerStore } from "../store/log-viewer-store";

// =============================================================================
// Helpers
// =============================================================================

/**
 * Build an active filters map from chips.
 * Used for highlighting active filters in the FieldsPane.
 */
function buildActiveFiltersMap(chips: SearchChip[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const chip of chips) {
    const existing = map.get(chip.field) ?? new Set();
    existing.add(chip.value);
    map.set(chip.field, existing);
  }
  return map;
}

// =============================================================================
// Types
// =============================================================================

export interface LogViewerProps {
  /** Log entries to display (already filtered by Container) */
  entries: LogEntry[];
  /** Whether entries are currently loading (initial load) */
  isLoading?: boolean;
  /** Whether data is being refetched in background */
  isFetching?: boolean;
  /** Error state */
  error?: Error | null;
  /** Histogram data */
  histogram?: {
    buckets: HistogramBucket[];
    intervalMs: number;
  };
  /** Field facets for sidebar */
  facets?: FieldFacet[];
  /** Callback to refetch data */
  onRefetch?: () => void;
  /** Current filter chips (controlled by parent) */
  filterChips: SearchChip[];
  /** Callback when user changes filter chips */
  onFilterChipsChange: (chips: SearchChip[]) => void;
  /** Scope of the log viewer */
  scope?: "workflow" | "group" | "task";
  /** Current tail connection status */
  tailStatus?: TailStatus;
  /** Additional CSS classes */
  className?: string;
}

// =============================================================================
// Error State
// =============================================================================

interface ErrorStateProps {
  error: Error;
  onRetry?: () => void;
}

function ErrorState({ error, onRetry }: ErrorStateProps) {
  return (
    <div className="border-destructive bg-destructive/10 m-4 rounded border p-4">
      <p className="text-destructive text-sm font-medium">Failed to load logs</p>
      <p className="text-destructive/80 mt-1 text-xs">{error.message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="text-destructive mt-2 text-sm underline hover:no-underline"
        >
          Retry
        </button>
      )}
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

function LogViewerInner({
  entries,
  isLoading = false,
  isFetching = false,
  error = null,
  histogram,
  facets = [],
  onRefetch,
  filterChips,
  onFilterChipsChange,
  scope = "workflow",
  tailStatus,
  className,
}: LogViewerProps) {
  const { clipboard, announcer } = useServices();

  // Store state
  const isTailing = useLogViewerStore((s) => s.isTailing);
  const toggleTailing = useLogViewerStore((s) => s.toggleTailing);
  const setTailing = useLogViewerStore((s) => s.setTailing);
  const wrapLines = useLogViewerStore((s) => s.wrapLines);
  const toggleWrapLinesRaw = useLogViewerStore((s) => s.toggleWrapLines);
  const showTask = useLogViewerStore((s) => s.showTask);
  const toggleShowTaskRaw = useLogViewerStore((s) => s.toggleShowTask);
  const fieldsPaneCollapsed = useLogViewerStore((s) => s.fieldsPaneCollapsed);
  const toggleFieldsPaneCollapsedRaw = useLogViewerStore((s) => s.toggleFieldsPaneCollapsed);

  // Wrap toggle handlers with View Transitions for smooth visual updates
  const toggleWrapLines = useCallback(() => {
    withViewTransition(toggleWrapLinesRaw);
  }, [toggleWrapLinesRaw]);

  const toggleShowTask = useCallback(() => {
    withViewTransition(toggleShowTaskRaw);
  }, [toggleShowTaskRaw]);

  const toggleFieldsPaneCollapsed = useCallback(() => {
    withViewTransition(toggleFieldsPaneCollapsedRaw);
  }, [toggleFieldsPaneCollapsedRaw]);
  const reset = useLogViewerStore((s) => s.reset);

  // Reset store on unmount
  useEffect(() => {
    return () => {
      reset();
    };
  }, [reset]);

  // Show task filter only at workflow/group scope
  const showTaskFilter = scope !== "task";

  // Handle filter chip changes with View Transition for smooth visual updates
  const handleFilterChipsChange = useCallback(
    (newChips: SearchChip[]) => {
      // Use View Transition API for smooth crossfade when available
      // Falls back to immediate update if not supported
      withViewTransition(() => {
        startTransition(() => {
          onFilterChipsChange(newChips);
        });
      });
    },
    [onFilterChipsChange],
  );

  // Use deferred value to prevent blocking UI during streaming updates
  // React 19 will keep showing previous results while computing new ones
  const deferredEntries = useDeferredValue(entries);

  // Track if we're showing stale data (deferred value hasn't caught up)
  const isStale = deferredEntries !== entries || isFetching;

  // Build active filters map for FieldsPane
  const activeFilters = useMemo(() => buildActiveFiltersMap(filterChips), [filterChips]);

  // Handle facet click - add/remove filter chip
  const handleFacetClick = useCallback(
    (field: string, value: string) => {
      const existing = filterChips.find((c) => c.field === field && c.value === value);
      if (existing) {
        // Remove chip
        handleFilterChipsChange(filterChips.filter((c) => c !== existing));
      } else {
        // Add chip
        const label = `${field}: ${value}`;
        handleFilterChipsChange([...filterChips, { field, value, label }]);
      }
    },
    [filterChips, handleFilterChipsChange],
  );

  // Handle histogram bucket click
  const handleBucketClick = useCallback((bucket: HistogramBucket) => {
    // Could implement time range filtering here
    console.log("Bucket clicked:", bucket);
  }, []);

  // Handle copy
  const handleCopy = useCallback(
    async (entry: LogEntry) => {
      await clipboard.copy(formatLogLine(entry));
      announcer.announce("Copied to clipboard", "polite");
    },
    [clipboard, announcer],
  );

  // Handle download
  const handleDownload = useCallback(() => {
    const content = deferredEntries.map((e) => formatLogLine(e)).join("\n");
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "logs.txt";
    a.click();
    URL.revokeObjectURL(url);
    announcer.announce("Logs downloaded", "polite");
  }, [deferredEntries, announcer]);

  // Handle scroll away from bottom (pause tailing)
  const handleScrollAwayFromBottom = useCallback(() => {
    if (isTailing) {
      setTailing(false);
      announcer.announce("Tailing paused", "polite");
    }
  }, [isTailing, setTailing, announcer]);

  // Results count for QueryBar - entries are already filtered by Container
  const resultsCount = useMemo(
    () => ({
      total: entries.length,
      filtered: undefined, // No client-side filtering, count is already filtered
    }),
    [entries.length],
  );

  // Show fields pane only at workflow/group scope
  const showFieldsPane = scope !== "task" && facets.length > 0;

  // Loading state
  if (isLoading && entries.length === 0) {
    return <LogViewerSkeleton />;
  }

  return (
    <div className={cn("flex h-full flex-col", className)}>
      {/* Error state (shown above content, doesn't replace it) */}
      {error && (
        <ErrorState
          error={error}
          onRetry={onRefetch}
        />
      )}

      {/* Query bar */}
      <div className="shrink-0 border-b">
        <QueryBar
          entries={entries}
          chips={filterChips}
          onChipsChange={handleFilterChipsChange}
          resultsCount={resultsCount}
          showTaskFilter={showTaskFilter}
          className="px-3 py-2"
        />
      </div>

      {/* Histogram */}
      {histogram && histogram.buckets.length > 0 && (
        <div className="shrink-0 border-b px-3 py-2">
          <TimelineHistogram
            buckets={histogram.buckets}
            intervalMs={histogram.intervalMs}
            onBucketClick={handleBucketClick}
            height={80}
          />
        </div>
      )}

      {/* Main content area */}
      <div className="flex min-h-0 flex-1">
        {/* Fields pane */}
        {showFieldsPane && (
          <div
            className={cn(
              "shrink-0 border-r transition-[width] duration-200 ease-out",
              fieldsPaneCollapsed ? "w-8" : "w-48",
            )}
          >
            <FieldsPane
              facets={facets}
              activeFilters={activeFilters}
              onFacetClick={handleFacetClick}
              collapsed={fieldsPaneCollapsed}
              onToggleCollapse={toggleFieldsPaneCollapsed}
            />
          </div>
        )}

        {/* Log list with native sticky date headers */}
        <div className="min-w-0 flex-1 overflow-hidden">
          <LogList
            entries={deferredEntries}
            onCopy={handleCopy}
            isTailing={isTailing}
            onScrollAwayFromBottom={handleScrollAwayFromBottom}
            isStale={isStale}
          />
        </div>
      </div>

      {/* Toolbar */}
      <div className="shrink-0">
        <LogToolbar
          totalCount={entries.length}
          filteredCount={undefined}
          isTailing={isTailing}
          onToggleTailing={toggleTailing}
          wrapLines={wrapLines}
          onToggleWrapLines={toggleWrapLines}
          showTask={showTask}
          onToggleShowTask={toggleShowTask}
          onDownload={handleDownload}
          onRefresh={onRefetch}
          isLoading={isLoading || isStale}
          tailStatus={tailStatus}
        />
      </div>
    </div>
  );
}

export const LogViewer = memo(LogViewerInner);
