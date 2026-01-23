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
import type { LogEntry, HistogramBucket, FieldFacet, LogFieldDefinition } from "@/lib/api/log-adapter";
import { formatLogLine } from "@/lib/api/log-adapter";
import type { SearchChip } from "@/components/filter-bar";
import { useServices } from "@/contexts/service-context";
import { withViewTransition } from "@/hooks";
import { SearchBar } from "./SearchBar";
import { FacetBar } from "./FacetBar";
import { TimelineHistogram } from "./TimelineHistogram";
import { LogList } from "./LogList";
import { Footer } from "./Footer";
import { LogViewerSkeleton } from "./LogViewerSkeleton";
import { useLogViewerStore } from "../store/log-viewer-store";

// =============================================================================
// Helpers
// =============================================================================

/**
 * Extract search text from chips (first "text" field chip).
 */
function getSearchTextFromChips(chips: SearchChip[]): string {
  for (const chip of chips) {
    if (chip.field === "text") {
      return chip.value;
    }
  }
  return "";
}

/**
 * Build a selected filters map from chips for facet filtering.
 * Groups chip values by field name.
 */
function buildSelectedFiltersMap(chips: SearchChip[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const chip of chips) {
    // Skip text chips (handled by SearchBar)
    if (chip.field === "text") continue;

    const existing = map.get(chip.field) ?? new Set();
    existing.add(chip.value);
    map.set(chip.field, existing);
  }
  return map;
}

/**
 * Update chips based on facet filter changes.
 * Preserves text chips and updates facet field chips.
 */
function updateChipsForFacetChange(currentChips: SearchChip[], field: string, newValues: Set<string>): SearchChip[] {
  // Keep all chips that don't match the field being changed
  const otherChips = currentChips.filter((c) => c.field !== field);

  // Add new chips for each selected value
  const newChips: SearchChip[] = [];
  for (const value of newValues) {
    newChips.push({
      field,
      value,
      label: `${field}: ${value}`,
    });
  }

  return [...otherChips, ...newChips];
}

/**
 * Update chips based on search text change.
 * Replaces or adds/removes the "text" chip.
 */
function updateChipsForSearchChange(currentChips: SearchChip[], searchText: string): SearchChip[] {
  // Remove existing text chip
  const otherChips = currentChips.filter((c) => c.field !== "text");

  // Add new text chip if search is not empty
  if (searchText.trim()) {
    return [
      ...otherChips,
      {
        field: "text",
        value: searchText.trim(),
        label: searchText.trim(),
      },
    ];
  }

  return otherChips;
}

// =============================================================================
// Types
// =============================================================================

export interface LogViewerProps {
  /** Log entries to display (already filtered by Container) */
  entries: LogEntry[];
  /** Total count of entries before filtering */
  totalCount?: number;
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
  /** Optional custom facet field configuration (icons, labels) - overrides defaults */
  facetConfig?: ReadonlyMap<string, LogFieldDefinition>;
  /** Callback to refetch data */
  onRefetch?: () => void;
  /** Current filter chips (controlled by parent) */
  filterChips: SearchChip[];
  /** Callback when user changes filter chips */
  onFilterChipsChange: (chips: SearchChip[]) => void;
  /** Scope of the log viewer */
  scope?: "workflow" | "group" | "task";
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
  totalCount,
  isLoading = false,
  isFetching = false,
  error = null,
  histogram,
  facets = [],
  facetConfig,
  onRefetch,
  filterChips,
  onFilterChipsChange,
  // Reserved props for future scope-aware features (e.g., showing group/task context).
  // Kept in the interface to maintain API stability.
  scope: _scope = "workflow",
  className,
}: LogViewerProps) {
  const { clipboard, announcer } = useServices();

  // Store state - live mode enables auto-scroll and fetches latest logs
  // In the upcoming time range selector, this will be true when end time = "NOW"
  const isLiveMode = useLogViewerStore((s) => s.isLiveMode);
  const setLiveMode = useLogViewerStore((s) => s.setLiveMode);
  const wrapLines = useLogViewerStore((s) => s.wrapLines);
  const toggleWrapLinesRaw = useLogViewerStore((s) => s.toggleWrapLines);
  const showTask = useLogViewerStore((s) => s.showTask);
  const toggleShowTaskRaw = useLogViewerStore((s) => s.toggleShowTask);

  // Wrap toggle handlers with View Transitions for smooth visual updates
  const toggleWrapLines = useCallback(() => {
    withViewTransition(toggleWrapLinesRaw);
  }, [toggleWrapLinesRaw]);

  const toggleShowTask = useCallback(() => {
    withViewTransition(toggleShowTaskRaw);
  }, [toggleShowTaskRaw]);

  const reset = useLogViewerStore((s) => s.reset);

  // Reset store on unmount
  useEffect(() => {
    return () => {
      reset();
    };
  }, [reset]);

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

  // Extract search text from chips for SearchBar
  const searchText = useMemo(() => getSearchTextFromChips(filterChips), [filterChips]);

  // Build selected filters map for FacetBar
  const selectedFilters = useMemo(() => buildSelectedFiltersMap(filterChips), [filterChips]);

  // Handle search text change from SearchBar
  const handleSearchChange = useCallback(
    (newSearchText: string) => {
      const updatedChips = updateChipsForSearchChange(filterChips, newSearchText);
      handleFilterChipsChange(updatedChips);
    },
    [filterChips, handleFilterChipsChange],
  );

  // Handle facet filter change from FacetBar
  const handleFacetFilterChange = useCallback(
    (field: string, values: Set<string>) => {
      const updatedChips = updateChipsForFacetChange(filterChips, field, values);
      handleFilterChipsChange(updatedChips);
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

  // Handle scroll away from bottom - pauses live mode
  // User can re-enable by clicking "Jump to Now" or selecting NOW in time range
  const handleScrollAwayFromBottom = useCallback(() => {
    if (isLiveMode) {
      setLiveMode(false);
      announcer.announce("Live mode paused", "polite");
    }
  }, [isLiveMode, setLiveMode, announcer]);

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

      {/* Section 1: SearchBar */}
      <div className="shrink-0 border-b px-3 py-2">
        <SearchBar
          value={searchText}
          onChange={handleSearchChange}
        />
      </div>

      {/* Section 2: FacetBar */}
      {facets.length > 0 && (
        <div className="shrink-0 border-b px-3 py-3">
          <FacetBar
            facets={facets}
            selectedFilters={selectedFilters}
            onFilterChange={handleFacetFilterChange}
            facetConfig={facetConfig}
          />
        </div>
      )}

      {/* Section 3: Timeline Histogram */}
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

      {/* Section 4: LogList (full width) */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <LogList
          entries={deferredEntries}
          onCopy={handleCopy}
          isLiveMode={isLiveMode}
          onScrollAwayFromBottom={handleScrollAwayFromBottom}
          isStale={isStale}
        />
      </div>

      {/* Section 5: Footer */}
      <div className="shrink-0">
        <Footer
          wrapLines={wrapLines}
          onToggleWrapLines={toggleWrapLines}
          showTask={showTask}
          onToggleShowTask={toggleShowTask}
          onDownload={handleDownload}
          onRefresh={onRefetch}
          isLoading={isLoading || isStale}
          filteredCount={entries.length}
          totalCount={totalCount ?? entries.length}
        />
      </div>
    </div>
  );
}

export const LogViewer = memo(LogViewerInner);
