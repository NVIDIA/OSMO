// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import { memo, useCallback, useEffect, startTransition, useDeferredValue } from "react";
import { User, Cpu, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LogEntry, HistogramBucket } from "@/lib/api/log-adapter";
import { formatLogLine } from "@/lib/api/log-adapter";
import type { SearchChip, SearchField, SearchPreset } from "@/components/filter-bar/lib/types";
import { useServices } from "@/contexts/service-context";
import { withViewTransition } from "@/hooks";
import { Button } from "@/components/shadcn/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/shadcn/tooltip";
import { FilterBar } from "@/components/filter-bar";
import { TimelineHistogram, type TimeRangePreset } from "./TimelineHistogram";
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
        chips: [{ field: "level", value: "error", label: "level:error" }],
        render: ({ active }: { active: boolean }) => (
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-semibold transition-all",
              active ? "bg-red-600 text-white dark:bg-red-500" : cn(LEVEL_STYLES.error, "opacity-80 hover:opacity-90"),
              "group-data-[selected=true]:scale-110 group-data-[selected=true]:shadow-md",
            )}
          >
            ERROR
          </span>
        ),
      },
      {
        id: "level-warn",
        chips: [{ field: "level", value: "warn", label: "level:warn" }],
        render: ({ active }: { active: boolean }) => (
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-semibold transition-all",
              active
                ? "bg-yellow-600 text-white dark:bg-yellow-500"
                : cn(LEVEL_STYLES.warn, "opacity-80 hover:opacity-90"),
              "group-data-[selected=true]:scale-110 group-data-[selected=true]:shadow-md",
            )}
          >
            WARN
          </span>
        ),
      },
      {
        id: "level-info",
        chips: [{ field: "level", value: "info", label: "level:info" }],
        render: ({ active }: { active: boolean }) => (
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-semibold transition-all",
              active ? "bg-blue-600 text-white dark:bg-blue-500" : cn(LEVEL_STYLES.info, "opacity-80 hover:opacity-90"),
              "group-data-[selected=true]:scale-110 group-data-[selected=true]:shadow-md",
            )}
          >
            INFO
          </span>
        ),
      },
      {
        id: "level-debug",
        chips: [{ field: "level", value: "debug", label: "level:debug" }],
        render: ({ active }: { active: boolean }) => (
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-semibold transition-all",
              active
                ? "bg-gray-600 text-white dark:bg-gray-500"
                : cn(LEVEL_STYLES.debug, "opacity-80 hover:opacity-90"),
              "group-data-[selected=true]:scale-110 group-data-[selected=true]:shadow-md",
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
        chips: [{ field: "source", value: "user", label: "source:user" }],
        render: ({ active }: { active: boolean }) => (
          <span
            className={cn(
              "flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold transition-all",
              active
                ? "bg-nvidia text-white"
                : "bg-nvidia-bg text-nvidia-dark dark:bg-nvidia-bg-dark dark:text-nvidia-light opacity-80 hover:opacity-90",
              "group-data-[selected=true]:scale-110 group-data-[selected=true]:shadow-md",
              "mx-1",
            )}
          >
            <User className="h-3 w-3 text-current" />
            USER
          </span>
        ),
      },
      {
        id: "source-osmo",
        chips: [{ field: "source", value: "osmo", label: "source:osmo" }],
        render: ({ active }: { active: boolean }) => (
          <span
            className={cn(
              "flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold transition-all",
              active
                ? "bg-nvidia text-white"
                : "bg-nvidia-bg text-nvidia-dark dark:bg-nvidia-bg-dark dark:text-nvidia-light opacity-80 hover:opacity-90",
              "group-data-[selected=true]:scale-110 group-data-[selected=true]:shadow-md",
              "mx-1",
            )}
          >
            <Cpu className="h-3 w-3 text-current" />
            OSMO
          </span>
        ),
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
  /** Pending histogram data (for real-time pan/zoom feedback) */
  pendingHistogram?: {
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
  /** Start time for log query (effective range - undefined = from beginning) */
  startTime?: Date;
  /** End time for log query (effective range - undefined = to now/latest) */
  endTime?: Date;
  /** Display range start (with padding) */
  displayStart?: Date;
  /** Display range end (with padding) */
  displayEnd?: Date;
  /** Active time range preset */
  activePreset?: TimeRangePreset;
  /** Callback to set start time */
  onStartTimeChange?: (time: Date | undefined) => void;
  /** Callback to set end time */
  onEndTimeChange?: (time: Date | undefined) => void;
  /** Callback to apply a time range preset */
  onPresetSelect?: (preset: TimeRangePreset) => void;
  /** Callback when display range changes (for pending histogram) */
  onDisplayRangeChange?: (start: Date, end: Date) => void;
  /** Callback to clear pending display state */
  onClearPendingDisplay?: () => void;
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
  pendingHistogram,
  onRefetch,
  filterChips,
  onFilterChipsChange,
  // Reserved props for future scope-aware features (e.g., showing group/task context).
  // Kept in the interface to maintain API stability.
  scope: _scope = "workflow",
  className,
  startTime,
  endTime,
  displayStart,
  displayEnd,
  activePreset,
  onStartTimeChange,
  onEndTimeChange,
  onPresetSelect,
  onDisplayRangeChange,
  onClearPendingDisplay,
}: LogViewerProps) {
  const { clipboard, announcer } = useServices();

  // Store state - only UI preferences
  const timelineCollapsed = useLogViewerStore((s) => s.timelineCollapsed);
  const wrapLines = useLogViewerStore((s) => s.wrapLines);
  const toggleWrapLinesRaw = useLogViewerStore((s) => s.toggleWrapLines);
  const showTask = useLogViewerStore((s) => s.showTask);
  const toggleShowTaskRaw = useLogViewerStore((s) => s.toggleShowTask);

  // Derive live mode from end time (endTime === undefined means "NOW" / live mode)
  const isLiveMode = endTime === undefined;

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

  // Handle histogram bucket click - jump to that time
  const handleBucketClick = useCallback(
    (bucket: HistogramBucket) => {
      if (!onStartTimeChange || !onEndTimeChange) return;
      // Set time range around the clicked bucket
      // Show ±5 minutes around the bucket
      const bucketTime = bucket.timestamp.getTime();
      const fiveMinutes = 5 * 60 * 1000;
      onStartTimeChange(new Date(bucketTime - fiveMinutes));
      onEndTimeChange(new Date(bucketTime + fiveMinutes));
      announcer.announce("Time range updated", "polite");
    },
    [onStartTimeChange, onEndTimeChange, announcer],
  );

  // Handle preset selection
  const handlePresetSelect = useCallback(
    (preset: TimeRangePreset) => {
      if (!onPresetSelect) return;
      onPresetSelect(preset);
      const message = preset === "all" ? "all logs" : preset === "custom" ? "custom time range" : `last ${preset}`;
      announcer.announce(`Showing ${message}`, "polite");
    },
    [onPresetSelect, announcer],
  );

  // Wrap time change handlers to clear pending display
  const handleStartTimeChangeWithClear = useCallback(
    (time: Date | undefined) => {
      onStartTimeChange?.(time);
      onClearPendingDisplay?.();
    },
    [onStartTimeChange, onClearPendingDisplay],
  );

  const handleEndTimeChangeWithClear = useCallback(
    (time: Date | undefined) => {
      onEndTimeChange?.(time);
      onClearPendingDisplay?.();
    },
    [onEndTimeChange, onClearPendingDisplay],
  );

  // Handle zoom in - matches cmd+wheel up behavior (narrow display by 20%)
  const handleZoomIn = useCallback(() => {
    if (!onDisplayRangeChange || !displayStart || !displayEnd) return;

    const ZOOM_IN_FACTOR = 0.8; // Same as use-timeline-wheel
    const MIN_RANGE_MS = 60_000; // 1 minute minimum

    const displayRangeMs = displayEnd.getTime() - displayStart.getTime();
    const newDisplayRangeMs = displayRangeMs * ZOOM_IN_FACTOR;

    if (newDisplayRangeMs < MIN_RANGE_MS) {
      announcer.announce("Cannot zoom in further", "polite");
      return;
    }

    // Center on the middle of current display
    const displayCenterMs = (displayStart.getTime() + displayEnd.getTime()) / 2;
    const newDisplayStartMs = displayCenterMs - newDisplayRangeMs / 2;
    const newDisplayEndMs = displayCenterMs + newDisplayRangeMs / 2;

    onDisplayRangeChange(new Date(newDisplayStartMs), new Date(newDisplayEndMs));
    announcer.announce("Zoomed in", "polite");
  }, [displayStart, displayEnd, onDisplayRangeChange, announcer]);

  // Handle zoom out - matches cmd+wheel down behavior (widen display by 25%)
  const handleZoomOut = useCallback(() => {
    if (!onDisplayRangeChange || !displayStart || !displayEnd) return;

    const ZOOM_OUT_FACTOR = 1.25; // Same as use-timeline-wheel

    const displayRangeMs = displayEnd.getTime() - displayStart.getTime();
    const newDisplayRangeMs = displayRangeMs * ZOOM_OUT_FACTOR;

    // Center on the middle of current display
    const displayCenterMs = (displayStart.getTime() + displayEnd.getTime()) / 2;
    const newDisplayStartMs = displayCenterMs - newDisplayRangeMs / 2;
    const newDisplayEndMs = displayCenterMs + newDisplayRangeMs / 2;

    onDisplayRangeChange(new Date(newDisplayStartMs), new Date(newDisplayEndMs));
    announcer.announce("Zoomed out", "polite");
  }, [displayStart, displayEnd, onDisplayRangeChange, announcer]);

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

  // Handle scroll away from bottom - pauses live mode by setting end time to current time
  // User can re-enable by clicking "Jump to Now" or selecting NOW in time range
  const handleScrollAwayFromBottom = useCallback(() => {
    if (isLiveMode && onEndTimeChange) {
      onEndTimeChange(new Date());
      announcer.announce("Live mode paused", "polite");
    }
  }, [isLiveMode, onEndTimeChange, announcer]);

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

      {/* Section 1: Filter bar */}
      <div className="shrink-0 border-b p-2">
        <FilterBar
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
            pendingBuckets={pendingHistogram?.buckets}
            onBucketClick={handleBucketClick}
            height={80}
            // Time range header with controls
            showTimeRangeHeader
            startTime={startTime}
            endTime={endTime}
            displayStart={displayStart}
            displayEnd={displayEnd}
            onStartTimeChange={handleStartTimeChangeWithClear}
            onEndTimeChange={handleEndTimeChangeWithClear}
            onDisplayRangeChange={onDisplayRangeChange}
            // Presets
            showPresets
            activePreset={activePreset}
            onPresetSelect={handlePresetSelect}
            // Collapsed state
            defaultCollapsed={timelineCollapsed}
            // Enable interactive draggers
            enableInteractiveDraggers
            // Entity boundaries for pan limits (mock: use first bucket as start)
            entityStartTime={histogram.buckets[0]?.timestamp}
            entityEndTime={undefined} // undefined = still running (for now)
            // Zoom controls overlay
            customControls={
              <div className="flex flex-col gap-0.5 opacity-40 transition-opacity hover:opacity-100">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleZoomIn}
                      className="bg-background/80 hover:bg-accent/80 size-6 backdrop-blur-sm"
                    >
                      <ZoomIn className="size-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    <span className="text-xs">Zoom in (Cmd+Wheel up)</span>
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleZoomOut}
                      className="bg-background/80 hover:bg-accent/80 size-6 backdrop-blur-sm"
                    >
                      <ZoomOut className="size-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    <span className="text-xs">Zoom out (Cmd+Wheel down)</span>
                  </TooltipContent>
                </Tooltip>
              </div>
            }
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
