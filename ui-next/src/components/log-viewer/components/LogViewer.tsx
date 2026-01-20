// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import { memo, useCallback, useMemo, useState, useEffect, startTransition } from "react";
import { cn } from "@/lib/utils";
import type { LogEntry, HistogramBucket, FieldFacet } from "@/lib/api/log-adapter";
import { formatLogLine } from "@/lib/api/log-adapter";
import type { SearchChip } from "@/components/filter-bar";
import { useServices } from "@/contexts/service-context";
import { QueryBar } from "./QueryBar";
import { TimelineHistogram } from "./TimelineHistogram";
import { FieldsPane } from "./FieldsPane";
import { LogList } from "./LogList";
import { LogToolbar } from "./LogToolbar";
import { useLogViewerStore } from "../store/log-viewer-store";
import { applyFilters, buildActiveFiltersMap } from "../lib/filters";
import { SKELETON_WIDTHS } from "../lib/constants";

// =============================================================================
// Types
// =============================================================================

export interface LogViewerProps {
  /** Log entries to display */
  entries: LogEntry[];
  /** Whether entries are currently loading */
  isLoading?: boolean;
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
  /** Callback when filters change (for URL sync) */
  onFiltersChange?: (chips: SearchChip[]) => void;
  /** Initial filter chips (from URL) */
  initialChips?: SearchChip[];
  /** Scope of the log viewer */
  scope?: "workflow" | "group" | "task";
  /** Additional CSS classes */
  className?: string;
}

// =============================================================================
// Loading Skeleton
// =============================================================================

function LogViewerSkeleton() {
  return (
    <div className="flex h-full animate-pulse flex-col">
      {/* Query bar skeleton */}
      <div className="bg-muted/30 h-10 border-b" />
      {/* Histogram skeleton */}
      <div className="bg-muted/20 h-20 border-b" />
      {/* Content skeleton */}
      <div className="flex-1 space-y-2 p-4">
        {SKELETON_WIDTHS.map((width, i) => (
          <div
            key={i}
            className="bg-muted/30 h-6 rounded"
            style={{ width }}
          />
        ))}
      </div>
    </div>
  );
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
  error = null,
  histogram,
  facets = [],
  onRefetch,
  onFiltersChange,
  initialChips = [],
  scope = "workflow",
  className,
}: LogViewerProps) {
  const { clipboard, announcer } = useServices();

  // Local chip state (synced with URL via onFiltersChange)
  const [chips, setChips] = useState<SearchChip[]>(initialChips);

  // Store state
  const isTailing = useLogViewerStore((s) => s.isTailing);
  const toggleTailing = useLogViewerStore((s) => s.toggleTailing);
  const setTailing = useLogViewerStore((s) => s.setTailing);
  const wrapLines = useLogViewerStore((s) => s.wrapLines);
  const toggleWrapLines = useLogViewerStore((s) => s.toggleWrapLines);
  const reset = useLogViewerStore((s) => s.reset);

  // Reset store on unmount
  useEffect(() => {
    return () => {
      reset();
    };
  }, [reset]);

  // Note: initialChips is used as initial state via useState above.
  // No sync effect needed - if parent needs to control chips, use onFiltersChange callback.

  // Handle chip changes
  const handleChipsChange = useCallback(
    (newChips: SearchChip[]) => {
      startTransition(() => {
        setChips(newChips);
        onFiltersChange?.(newChips);
      });
    },
    [onFiltersChange],
  );

  // Filter entries based on chips
  const filteredEntries = useMemo(() => applyFilters(entries, chips), [entries, chips]);

  // Build active filters map for FieldsPane
  const activeFilters = useMemo(() => buildActiveFiltersMap(chips), [chips]);

  // Handle facet click - add/remove filter chip
  const handleFacetClick = useCallback(
    (field: string, value: string) => {
      const existing = chips.find((c) => c.field === field && c.value === value);
      if (existing) {
        // Remove chip
        handleChipsChange(chips.filter((c) => c !== existing));
      } else {
        // Add chip
        const label = `${field}: ${value}`;
        handleChipsChange([...chips, { field, value, label }]);
      }
    },
    [chips, handleChipsChange],
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
    const content = filteredEntries.map((e) => formatLogLine(e)).join("\n");
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "logs.txt";
    a.click();
    URL.revokeObjectURL(url);
    announcer.announce("Logs downloaded", "polite");
  }, [filteredEntries, announcer]);

  // Handle scroll away from bottom (pause tailing)
  const handleScrollAwayFromBottom = useCallback(() => {
    if (isTailing) {
      setTailing(false);
      announcer.announce("Tailing paused", "polite");
    }
  }, [isTailing, setTailing, announcer]);

  // Results count for QueryBar
  const resultsCount = useMemo(
    () => ({
      total: entries.length,
      filtered: chips.length > 0 ? filteredEntries.length : undefined,
    }),
    [entries.length, filteredEntries.length, chips.length],
  );

  // Show task filter only at workflow/group scope
  const showTaskFilter = scope !== "task";

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
          chips={chips}
          onChipsChange={handleChipsChange}
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
          <div className="w-48 shrink-0 border-r">
            <FieldsPane
              facets={facets}
              activeFilters={activeFilters}
              onFacetClick={handleFacetClick}
            />
          </div>
        )}

        {/* Log list */}
        <div className="min-w-0 flex-1">
          <LogList
            entries={filteredEntries}
            onCopy={handleCopy}
            isTailing={isTailing}
            onScrollAwayFromBottom={handleScrollAwayFromBottom}
          />
        </div>
      </div>

      {/* Toolbar */}
      <div className="shrink-0">
        <LogToolbar
          totalCount={entries.length}
          filteredCount={chips.length > 0 ? filteredEntries.length : undefined}
          isTailing={isTailing}
          onToggleTailing={toggleTailing}
          wrapLines={wrapLines}
          onToggleWrapLines={toggleWrapLines}
          onDownload={handleDownload}
          onRefresh={onRefetch}
          isLoading={isLoading}
        />
      </div>
    </div>
  );
}

export const LogViewer = memo(LogViewerInner);
