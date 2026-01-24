// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import { memo, useCallback, useEffect, startTransition, useDeferredValue } from "react";
import { cn } from "@/lib/utils";
import type { LogEntry, HistogramBucket } from "@/lib/api/log-adapter";
import { formatLogLine } from "@/lib/api/log-adapter";
import type { SearchChip, SearchField, SearchPreset } from "@/components/filter-bar/lib/types";
import { useServices } from "@/contexts/service-context";
import { withViewTransition } from "@/hooks";
import { SearchBar } from "./SearchBar";
import { TimelineHistogram } from "./TimelineHistogram";
import { LogList } from "./LogList";
import { Footer } from "./Footer";
import { LogViewerSkeleton } from "./LogViewerSkeleton";
import { useLogViewerStore } from "../store/log-viewer-store";

// =============================================================================
// Helpers
// =============================================================================

// Level styles matching the log body chips exactly
const LEVEL_STYLES = {
  error: "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30",
  warn: "text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-950/30",
  info: "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30",
  debug: "text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-950/30",
  fatal: "text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/30",
} as const;

// Field definitions for SearchBar/FilterBar
const LOG_FILTER_FIELDS: readonly SearchField<LogEntry>[] = [
  {
    id: "level",
    label: "Level",
    prefix: "level:",
    getValues: () => ["error", "warn", "info", "debug", "fatal"],
    match: (item, value) => item.labels.level === value,
    exhaustive: true,
  },
  {
    id: "source",
    label: "Source",
    prefix: "source:",
    getValues: () => ["user", "osmo"],
    match: (item, value) => item.labels.source === value,
    exhaustive: true,
  },
  {
    id: "task",
    label: "Task",
    prefix: "task:",
    getValues: (data) => [
      ...new Set(data.map((log) => log.labels.task).filter((task): task is string => task !== undefined)),
    ],
    match: (item, value) => item.labels.task === value,
    freeFormHint: "Type to search tasks",
  },
  {
    id: "retry",
    label: "Retry",
    prefix: "retry:",
    getValues: (data) => [
      ...new Set(data.map((log) => log.labels.retry).filter((retry): retry is string => retry !== undefined)),
    ],
    match: (item, value) => item.labels.retry === value,
    validate: (value) => {
      const num = Number(value);
      if (isNaN(num)) {
        return "Retry must be a number";
      }
      if (!Number.isInteger(num)) {
        return "Retry must be a whole number";
      }
      if (num < 0) {
        return "Retry must be 0 or greater";
      }
      return true;
    },
    freeFormHint: "Type retry number (0, 1, 2, ...)",
  },
] as const;

// Preset configurations
const LOG_FILTER_PRESETS: {
  label: string;
  items: SearchPreset[];
}[] = [
  {
    label: "Level",
    items: [
      {
        id: "level-error",
        chip: { field: "level", value: "error", label: "level:error" },
        render: ({ active }: { active: boolean }) => (
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-semibold transition-all",
              LEVEL_STYLES.error,
              active && "ring-2 ring-red-600/30 ring-inset dark:ring-red-400/30",
              !active && "opacity-50",
              "group-data-[selected=true]:scale-110 group-data-[selected=true]:shadow-md group-data-[selected=true]:ring-2 group-data-[selected=true]:ring-red-600/50 dark:group-data-[selected=true]:ring-red-400/50",
              !active && "hover:opacity-75",
            )}
          >
            ERROR
          </span>
        ),
      },
      {
        id: "level-warn",
        chip: { field: "level", value: "warn", label: "level:warn" },
        render: ({ active }: { active: boolean }) => (
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-semibold transition-all",
              LEVEL_STYLES.warn,
              active && "ring-2 ring-yellow-600/30 ring-inset dark:ring-yellow-400/30",
              !active && "opacity-50",
              "group-data-[selected=true]:scale-110 group-data-[selected=true]:shadow-md group-data-[selected=true]:ring-2 group-data-[selected=true]:ring-yellow-600/50 dark:group-data-[selected=true]:ring-yellow-400/50",
              !active && "hover:opacity-75",
            )}
          >
            WARN
          </span>
        ),
      },
      {
        id: "level-info",
        chip: { field: "level", value: "info", label: "level:info" },
        render: ({ active }: { active: boolean }) => (
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-semibold transition-all",
              LEVEL_STYLES.info,
              active && "ring-2 ring-blue-600/30 ring-inset dark:ring-blue-400/30",
              !active && "opacity-50",
              "group-data-[selected=true]:scale-110 group-data-[selected=true]:shadow-md group-data-[selected=true]:ring-2 group-data-[selected=true]:ring-blue-600/50 dark:group-data-[selected=true]:ring-blue-400/50",
              !active && "hover:opacity-75",
            )}
          >
            INFO
          </span>
        ),
      },
      {
        id: "level-debug",
        chip: { field: "level", value: "debug", label: "level:debug" },
        render: ({ active }: { active: boolean }) => (
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-semibold transition-all",
              LEVEL_STYLES.debug,
              active && "ring-2 ring-gray-600/30 ring-inset dark:ring-gray-400/30",
              !active && "opacity-50",
              "group-data-[selected=true]:scale-110 group-data-[selected=true]:shadow-md group-data-[selected=true]:ring-2 group-data-[selected=true]:ring-gray-600/50 dark:group-data-[selected=true]:ring-gray-400/50",
              !active && "hover:opacity-75",
            )}
          >
            DEBUG
          </span>
        ),
      },
    ],
  },
  {
    label: "Source",
    items: [
      {
        id: "source-user",
        chip: { field: "source", value: "user", label: "source:user" },
        render: ({ active }: { active: boolean }) => <span className={active ? "font-semibold" : ""}>User</span>,
      },
      {
        id: "source-osmo",
        chip: { field: "source", value: "osmo", label: "source:osmo" },
        render: ({ active }: { active: boolean }) => <span className={active ? "font-semibold" : ""}>OSMO</span>,
      },
    ],
  },
];

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

      {/* Section 1: SearchBar with FilterBar */}
      <div className="shrink-0 border-b p-2">
        <SearchBar
          data={entries}
          fields={LOG_FILTER_FIELDS}
          chips={filterChips}
          onChipsChange={handleFilterChipsChange}
          presets={LOG_FILTER_PRESETS}
          placeholder="Search logs or use level:, task:, source:, retry:..."
        />
      </div>

      {/* Section 2: Timeline Histogram */}
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

      {/* Section 3: LogList (full width) */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <LogList
          entries={deferredEntries}
          onCopy={handleCopy}
          isLiveMode={isLiveMode}
          onScrollAwayFromBottom={handleScrollAwayFromBottom}
          isStale={isStale}
        />
      </div>

      {/* Section 4: Footer */}
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
