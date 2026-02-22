// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import { memo, useMemo, useRef, useCallback, useEffect, useState, startTransition, useDeferredValue } from "react";
import { useShallow } from "zustand/react/shallow";
import { User, Cpu, ZoomIn, ZoomOut } from "lucide-react";
import { cn, formatHotkey, modKey } from "@/lib/utils";
import type { LogEntry, HistogramBucket } from "@/lib/api/log-adapter/types";
import { formatLogLine } from "@/lib/api/log-adapter/adapters/log-parser";
import type { SearchChip, SearchField, SearchPreset } from "@/components/filter-bar/lib/types";
import { useServices } from "@/contexts/service-context";
import { withViewTransition } from "@/hooks/use-view-transition";
import { Button } from "@/components/shadcn/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/shadcn/tooltip";
import { FilterBar, type FilterBarHandle } from "@/components/filter-bar/filter-bar";
import { useFilterBarShortcut } from "@/components/filter-bar/hooks/use-filter-bar-shortcut";
import {
  TimelineContainer,
  type TimeRangePreset,
  type TimelineContainerHandle,
} from "@/components/log-viewer/components/timeline/components/timeline-container";
import { LogList, type LogListHandle } from "@/components/log-viewer/components/log-list";
import { Footer } from "@/components/log-viewer/components/footer";
import { LogViewerSkeleton } from "@/components/log-viewer/components/log-viewer-skeleton";
import { useLogViewerStore } from "@/components/log-viewer/store/log-viewer-store";
import { HISTOGRAM_BUCKET_JUMP_WINDOW_MS } from "@/components/log-viewer/lib/constants";
import { DEFAULT_HEIGHT } from "@/components/log-viewer/components/timeline/lib/timeline-constants";

// =============================================================================
// Helpers
// =============================================================================

// Field definitions for SearchBar/FilterBar
const LOG_FILTER_FIELDS: readonly SearchField<LogEntry>[] = [
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

/**
 * Histogram data structure for timeline display.
 */
export interface HistogramData {
  buckets: HistogramBucket[];
  intervalMs: number;
}

/**
 * Data-related props for LogViewer.
 * Contains all log entries, loading states, and data refresh handlers.
 */
export interface LogViewerDataProps {
  /** Raw unfiltered log entries - used for FilterBar autocomplete and histogram */
  rawEntries: LogEntry[];
  /** Filtered log entries to display in the list */
  filteredEntries: LogEntry[];
  /** Whether entries are currently loading (initial load) */
  isLoading: boolean;
  /** Whether data is being refetched in background */
  isFetching: boolean;
  /** Error state */
  error: Error | null;
  /** Histogram data for timeline visualization (computed from rawEntries) */
  histogram: HistogramData | undefined;
  /** Pending histogram data (for real-time pan/zoom feedback, from rawEntries) */
  pendingHistogram: HistogramData | undefined;
  /** Whether streaming is active (receiving new log entries) */
  isStreaming: boolean;
  /** URL to open raw logs in new tab (direct to backend, bypassing UI proxy) */
  externalLogUrl?: string;
  /** Callback to refetch data */
  onRefetch: () => void;
}

/**
 * Filter-related props for LogViewer.
 * Contains current filter state and change handlers.
 */
export interface LogViewerFilterProps {
  /** Current filter chips (controlled by parent) */
  filterChips: SearchChip[];
  /** Callback when user changes filter chips */
  onFilterChipsChange: (chips: SearchChip[]) => void;
  /** Scope of the log viewer (workflow, group, or task level) */
  scope: "workflow" | "group" | "task";
}

/**
 * Timeline-related props for LogViewer.
 * Contains time range state, presets, and all time-related handlers.
 */
export interface LogViewerTimelineProps {
  /** USER INTENT: Filter start time (undefined = from beginning) */
  filterStartTime: Date | undefined;
  /** USER INTENT: Filter end time (undefined = live mode/NOW) */
  filterEndTime: Date | undefined;
  /** Display range start (with padding for visual context) */
  displayStart: Date;
  /** Display range end (with padding for visual context) */
  displayEnd: Date;
  /** Active time range preset (all, 5m, 15m, 1h, 6h, 24h, custom) */
  activePreset: TimeRangePreset | undefined;
  /** Callback to set filter start time */
  onFilterStartTimeChange: (time: Date | undefined) => void;
  /** Callback to set filter end time */
  onFilterEndTimeChange: (time: Date | undefined) => void;
  /** Callback to apply a time range preset */
  onPresetSelect: (preset: TimeRangePreset) => void;
  /** Callback when display range changes (for pending histogram during pan/zoom) */
  onDisplayRangeChange: (start: Date, end: Date) => void;
  /** Callback to clear pending display state (on Apply or Cancel) */
  onClearPendingDisplay: () => void;
  /** Entity start time (workflow/group/task start) - GUARANTEED by parent guard */
  entityStartTime: Date;
  /** Entity end time (completion timestamp) - undefined if still running */
  entityEndTime: Date | undefined;
  /**
   * REFERENCE: Synchronized "NOW" timestamp (milliseconds since epoch) from useTick().
   * REQUIRED for time consistency across all timeline calculations.
   */
  now: number;
}

/**
 * LogViewer props with grouped interfaces.
 *
 * Groups 24+ individual props into 3 logical categories:
 * - data: Log entries, loading states, histograms, refetch
 * - filter: Filter chips and scope
 * - timeline: Time range, presets, entity boundaries
 *
 * This reduces coupling and makes the interface more maintainable.
 */
export interface LogViewerProps {
  /** Data-related props (entries, loading, histogram, refetch) */
  data: LogViewerDataProps;
  /** Filter-related props (chips, scope) */
  filter: LogViewerFilterProps;
  /** Timeline-related props (time range, presets, entity boundaries) */
  timeline: LogViewerTimelineProps;
  /** Additional CSS classes */
  className?: string;
  /** Whether to show the timeline histogram and time range controls (default: true) */
  showTimeline?: boolean;
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

function LogViewerInner({ data, filter, timeline, className, showTimeline = true }: LogViewerProps) {
  // Refs for focus management
  const containerRef = useRef<HTMLDivElement>(null);
  const filterBarRef = useRef<FilterBarHandle>(null);

  // Keyboard shortcut: Cmd+F to focus filter bar
  const { containerProps } = useFilterBarShortcut(containerRef, filterBarRef);

  // Destructure data props
  const {
    rawEntries,
    filteredEntries,
    isLoading,
    isFetching,
    error,
    histogram,
    pendingHistogram,
    isStreaming,
    externalLogUrl,
    onRefetch,
  } = data;

  // Destructure filter props
  const { filterChips, onFilterChipsChange, scope } = filter;

  // Destructure timeline props
  const {
    filterStartTime,
    filterEndTime,
    displayStart,
    displayEnd,
    activePreset,
    onFilterStartTimeChange,
    onFilterEndTimeChange,
    onPresetSelect,
    onDisplayRangeChange,
    onClearPendingDisplay,
    entityStartTime,
    entityEndTime,
    now,
  } = timeline;
  const { announcer } = useServices();

  // Scope-aware filter fields: hide "task" field when already scoped to a single task
  const filterFields = useMemo(
    () => (scope === "task" ? LOG_FILTER_FIELDS.filter((f) => f.id !== "task") : LOG_FILTER_FIELDS),
    [scope],
  );

  // Store state - group related values to minimize re-renders
  // Using useShallow to batch multiple state values into one subscription
  const { timelineCollapsed, wrapLines, showTask } = useLogViewerStore(
    useShallow((s) => ({
      timelineCollapsed: s.timelineCollapsed,
      wrapLines: s.wrapLines,
      showTask: s.showTask,
    })),
  );

  // Keep actions as separate subscriptions (they're stable and don't cause re-renders)
  const toggleWrapLinesRaw = useLogViewerStore((s) => s.toggleWrapLines);
  const toggleShowTaskRaw = useLogViewerStore((s) => s.toggleShowTask);
  const reset = useLogViewerStore((s) => s.reset);

  // Ref to timeline container for imperative zoom controls
  const timelineRef = useRef<TimelineContainerHandle>(null);

  // Ref to log list for imperative scroll control and focus management
  const logListRef = useRef<LogListHandle>(null);

  // Local pin state (ephemeral UI state, not persisted)
  const [isPinnedToBottom, setIsPinnedToBottom] = useState(false);

  // Wrap toggle handlers with View Transitions for smooth visual updates
  const toggleWrapLines = useCallback(() => {
    withViewTransition(toggleWrapLinesRaw);
  }, [toggleWrapLinesRaw]);

  const toggleShowTask = useCallback(() => {
    withViewTransition(toggleShowTaskRaw);
  }, [toggleShowTaskRaw]);

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
  const deferredEntries = useDeferredValue(filteredEntries);

  // Track if we're showing stale data (deferred value hasn't caught up)
  const isStale = deferredEntries !== filteredEntries || isFetching;

  // Handle histogram bucket click - jump to that time
  const handleBucketClick = useCallback(
    (bucket: HistogramBucket) => {
      // Set time range around the clicked bucket using constant for window size
      const bucketTime = bucket.timestamp.getTime();
      onFilterStartTimeChange(new Date(bucketTime - HISTOGRAM_BUCKET_JUMP_WINDOW_MS));
      onFilterEndTimeChange(new Date(bucketTime + HISTOGRAM_BUCKET_JUMP_WINDOW_MS));
      announcer.announce("Time range updated", "polite");
    },
    [onFilterStartTimeChange, onFilterEndTimeChange, announcer],
  );

  // Handle preset selection
  const handlePresetSelect = useCallback(
    (preset: TimeRangePreset) => {
      onPresetSelect(preset);
      const message = preset === "all" ? "all logs" : preset === "custom" ? "custom time range" : `last ${preset}`;
      announcer.announce(`Showing ${message}`, "polite");
    },
    [onPresetSelect, announcer],
  );

  // Wrap time change handlers to clear pending display
  const handleStartTimeChangeWithClear = useCallback(
    (time: Date | undefined) => {
      onFilterStartTimeChange(time);
      onClearPendingDisplay();
    },
    [onFilterStartTimeChange, onClearPendingDisplay],
  );

  const handleEndTimeChangeWithClear = useCallback(
    (time: Date | undefined) => {
      onFilterEndTimeChange(time);
      onClearPendingDisplay();
    },
    [onFilterEndTimeChange, onClearPendingDisplay],
  );

  // Handle zoom in - uses timeline's validated zoom logic (matches cmd+wheel up behavior)
  const handleZoomIn = useCallback(() => {
    if (!timelineRef.current) return;

    if (!timelineRef.current.canZoomIn) {
      announcer.announce("Cannot zoom in further", "polite");
      return;
    }

    timelineRef.current.zoomIn();
    announcer.announce("Zoomed in", "polite");
  }, [announcer]);

  // Handle zoom out - uses timeline's validated zoom logic (matches cmd+wheel down behavior)
  const handleZoomOut = useCallback(() => {
    if (!timelineRef.current) return;

    if (!timelineRef.current.canZoomOut) {
      announcer.announce("Cannot zoom out further", "polite");
      return;
    }

    timelineRef.current.zoomOut();
    announcer.announce("Zoomed out", "polite");
  }, [announcer]);

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

  // Handle scroll away from bottom - unpins auto-scroll, does NOT stop streaming
  const handleScrollAwayFromBottom = useCallback(() => {
    if (isPinnedToBottom) {
      setIsPinnedToBottom(false);
      announcer.announce("Auto-scroll paused", "polite");
    }
  }, [isPinnedToBottom, announcer]);

  // Handle toggle pin (for footer button)
  const handleTogglePin = useCallback(() => {
    const wasEnabled = isPinnedToBottom;
    setIsPinnedToBottom(!wasEnabled);
    announcer.announce(wasEnabled ? "Auto-scroll disabled" : "Auto-scroll enabled", "polite");
  }, [isPinnedToBottom, announcer]);

  // Handle jump to bottom + enable pin
  const handleJumpToBottom = useCallback(() => {
    logListRef.current?.scrollToBottom();
    setIsPinnedToBottom(true);
    announcer.announce("Jumped to latest logs", "polite");
  }, [announcer]);

  // Redirect focus to the scroll container for any click on non-input elements.
  // This keeps arrow/page keys working after clicking rows, buttons, etc.
  // e.preventDefault() stops the browser from moving focus to the clicked element;
  // click events still fire normally so buttons and row selection are unaffected.
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Only intercept primary (left) button — right-click and middle-click pass through.
    if (e.button !== 0) return;

    const target = e.target as HTMLElement;

    // Text inputs need focus for typing — let them receive it normally.
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    )
      return;

    // Sections that manage their own focus (filter bar dropdown items, timeline draggers).
    // These must not have their pointer events intercepted or their dropdowns will close.
    if (target.closest("[data-no-focus-redirect]")) return;

    // All other elements (rows, buttons, generic divs): keep focus on the scroll container.
    e.preventDefault();
    logListRef.current?.focus();
  }, []);

  // When the final Escape in the filter bar blurs the input (the one that doesn't
  // call stopPropagation), the keydown bubbles here. Redirect focus to the scroll
  // container so arrow/page keys continue to work immediately.
  const handleContainerKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape") return;
    const target = e.target as HTMLElement;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      logListRef.current?.focus();
    }
  }, []);

  // Loading state
  if (isLoading && filteredEntries.length === 0) {
    return <LogViewerSkeleton />;
  }

  return (
    <div
      ref={containerRef}
      className={cn("flex h-full flex-col", className)}
      onPointerDown={handlePointerDown}
      onKeyDown={handleContainerKeyDown}
      {...containerProps}
    >
      {/* Error state (shown above content, doesn't replace it) */}
      {error && (
        <ErrorState
          error={error}
          onRetry={onRefetch}
        />
      )}

      {/* Section 1: Filter bar — excluded from focus redirect so dropdown items work */}
      <div
        className="shrink-0 border-b p-2"
        data-no-focus-redirect
      >
        <FilterBar
          ref={filterBarRef}
          data={rawEntries}
          fields={filterFields}
          chips={filterChips}
          onChipsChange={handleFilterChipsChange}
          presets={LOG_FILTER_PRESETS}
          placeholder={`Search logs (${formatHotkey("mod+f")})...`}
        />
      </div>

      {/* Section 2: Timeline Histogram — excluded from focus redirect so draggers work */}
      {showTimeline && (
        <div
          className="shrink-0 border-b px-3 py-2"
          data-no-focus-redirect
        >
          <TimelineContainer
            ref={timelineRef}
            buckets={histogram?.buckets ?? []}
            pendingBuckets={pendingHistogram?.buckets}
            onBucketClick={handleBucketClick}
            height={DEFAULT_HEIGHT}
            // Time range header with controls
            showTimeRangeHeader
            filterStartTime={filterStartTime}
            filterEndTime={filterEndTime}
            displayStart={displayStart}
            displayEnd={displayEnd}
            onFilterStartTimeChange={handleStartTimeChangeWithClear}
            onFilterEndTimeChange={handleEndTimeChangeWithClear}
            onDisplayRangeChange={onDisplayRangeChange}
            // Presets
            showPresets
            activePreset={activePreset}
            onPresetSelect={handlePresetSelect}
            // Collapsed state
            defaultCollapsed={timelineCollapsed}
            // Enable interactive draggers
            enableInteractiveDraggers
            // Entity boundaries for pan limits
            entityStartTime={entityStartTime}
            entityEndTime={entityEndTime}
            // Synchronized "NOW" timestamp
            now={now}
            // Zoom controls overlay
            customControls={
              <div className="flex flex-col gap-0.5 opacity-40 transition-opacity hover:opacity-100">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleZoomIn}
                      aria-label="Zoom in"
                      className="bg-background/80 hover:bg-accent/80 size-6 backdrop-blur-sm"
                    >
                      <ZoomIn
                        className="size-3"
                        aria-hidden="true"
                      />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    <span className="text-xs">Zoom in ({modKey}+Wheel up)</span>
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleZoomOut}
                      aria-label="Zoom out"
                      className="bg-background/80 hover:bg-accent/80 size-6 backdrop-blur-sm"
                    >
                      <ZoomOut
                        className="size-3"
                        aria-hidden="true"
                      />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    <span className="text-xs">Zoom out ({modKey}+Wheel down)</span>
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
          ref={logListRef}
          entries={deferredEntries}
          isPinnedToBottom={isPinnedToBottom}
          onScrollAwayFromBottom={handleScrollAwayFromBottom}
          isStale={isStale}
          hideTask={scope === "task"}
        />
      </div>

      {/* Section 4: Footer */}
      <div className="shrink-0">
        <Footer
          wrapLines={wrapLines}
          onToggleWrapLines={toggleWrapLines}
          showTask={scope === "task" ? false : showTask}
          onToggleShowTask={scope === "task" ? undefined : toggleShowTask}
          externalLogUrl={externalLogUrl}
          onDownload={handleDownload}
          isStreaming={isStreaming}
          isPinnedToBottom={isPinnedToBottom}
          onScrollToBottom={handleJumpToBottom}
          onTogglePinnedToBottom={handleTogglePin}
        />
      </div>
    </div>
  );
}

export const LogViewer = memo(LogViewerInner);
