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

import { memo, useMemo, useState, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import { formatDateTimeFullUTC, formatTime24ShortUTC } from "@/lib/format-date";
import type { HistogramBucket } from "@/lib/api/log-adapter";
import { LOG_LEVELS, LOG_LEVEL_STYLES, LOG_LEVEL_LABELS } from "@/lib/api/log-adapter";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/shadcn/dropdown-menu";
import { Button } from "@/components/shadcn/button";
import { ChevronUp, ChevronDown, Check } from "lucide-react";
import { TimelineWindow } from "./TimelineWindow";
import { InvalidZone } from "./InvalidZone";
import { TimelineControls } from "./TimelineControls";
import { useTimelineState } from "./use-timeline-state";
import { useTimelineWheelGesture, useTimelineDraggerGesture } from "./use-timeline-gestures";
import { useServices } from "@/contexts/service-context";
import type { TimelineBounds } from "./timeline-utils";

// =============================================================================
// Types
// =============================================================================

export interface TimelineHistogramProps {
  /** Histogram buckets to display (committed state) */
  buckets: HistogramBucket[];
  /** Pending histogram buckets (shown during pan/zoom before Apply) */
  pendingBuckets?: HistogramBucket[];
  /** Callback when a bucket is clicked */
  onBucketClick?: (bucket: HistogramBucket) => void;
  /** Additional CSS classes */
  className?: string;
  /** Height of the histogram bars in pixels (default: 80) */
  height?: number;
  /** Whether to show time range preset buttons */
  showPresets?: boolean;
  /** Callback when a preset is selected */
  onPresetSelect?: (preset: TimeRangePreset) => void;
  /** Currently active preset (for styling) */
  activePreset?: TimeRangePreset;
  /** Custom controls to render (e.g., zoom controls) */
  customControls?: React.ReactNode;
  /** Whether the histogram starts collapsed */
  defaultCollapsed?: boolean;
  /** Start time for the time range selector (effective range) */
  startTime?: Date;
  /** End time for the time range selector (effective range) */
  endTime?: Date;
  /** Display range start (with padding) */
  displayStart?: Date;
  /** Display range end (with padding) */
  displayEnd?: Date;
  /** Callback when start time changes (on Apply) */
  onStartTimeChange?: (date: Date | undefined) => void;
  /** Callback when end time changes (on Apply) */
  onEndTimeChange?: (date: Date | undefined) => void;
  /** Callback when display range changes (real-time during pan/zoom for bucket re-query) */
  onDisplayRangeChange?: (start: Date, end: Date) => void;
  /** Whether to show the time range header (default: false) */
  showTimeRangeHeader?: boolean;
  /** Whether to enable interactive draggers (default: false) */
  enableInteractiveDraggers?: boolean;
  /**
   * Entity start time (workflow/group/task start) - hard lower bound for panning.
   * Required for meaningful timeline functionality - undefined indicates workflow not started.
   */
  entityStartTime?: Date;
  /** Entity end time (completion timestamp) - undefined if still running */
  entityEndTime?: Date;
  /** Synchronized "NOW" timestamp from useTick (for running workflows) */
  now?: number;
}

export type TimeRangePreset = "all" | "5m" | "15m" | "1h" | "6h" | "24h" | "custom";

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_HEIGHT = 80;

/** Padding ratio for display range (7.5% on each side) - shared with use-timeline-state */
const DISPLAY_PADDING_RATIO = 0.075;

/** Minimum padding in milliseconds (30 seconds) - shared with use-timeline-state */
const MIN_PADDING_MS = 30_000;

/** Threshold for considering end time as "now" (1 minute) - shared with use-timeline-gestures */
const NOW_THRESHOLD_MS = 60_000;

const PRESET_LABELS: Record<TimeRangePreset, string> = {
  all: "All",
  "5m": "Last 5m",
  "15m": "Last 15m",
  "1h": "Last 1h",
  "6h": "Last 6h",
  "24h": "Last 24h",
  custom: "Custom",
};

const PRESET_ORDER: TimeRangePreset[] = ["all", "5m", "15m", "1h", "6h", "24h"];

// =============================================================================
// Tooltip Content
// =============================================================================

interface BucketTooltipProps {
  bucket: HistogramBucket;
}

function BucketTooltipContent({ bucket }: BucketTooltipProps) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium tabular-nums">{formatDateTimeFullUTC(bucket.timestamp)}</div>
      <div className="space-y-0.5">
        {LOG_LEVELS.map((level) => {
          const count = bucket.counts[level] ?? 0;
          if (count === 0) return null;
          return (
            <div
              key={level}
              className="flex items-center gap-1.5 text-xs"
            >
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: LOG_LEVEL_STYLES[level].color }}
              />
              <span>{LOG_LEVEL_LABELS[level]}:</span>
              <span className="font-mono">{count.toLocaleString()}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// =============================================================================
// Stacked Bar Component
// =============================================================================

interface StackedBarProps {
  bucket: HistogramBucket;
  maxTotal: number;
  onClick?: () => void;
  dimmed?: boolean;
}

function StackedBar({ bucket, maxTotal, onClick, dimmed = false }: StackedBarProps) {
  const heightPercentage = maxTotal > 0 ? (bucket.total / maxTotal) * 100 : 0;

  const levelSegments = useMemo(() => {
    if (bucket.total === 0) return [];

    return LOG_LEVELS.map((level) => {
      const count = bucket.counts[level] ?? 0;
      const percentage = (count / bucket.total) * 100;
      return {
        level,
        percentage,
        count,
      };
    }).filter((seg) => seg.count > 0);
  }, [bucket]);

  if (levelSegments.length === 0) {
    return <div className="flex-1" />;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "relative flex-1 cursor-pointer transition-opacity duration-75",
            !dimmed && "opacity-85 hover:opacity-100",
            dimmed && "opacity-50",
          )}
          style={{ height: `${heightPercentage}%` }}
          onClick={onClick}
        >
          <div className="flex h-full flex-col-reverse overflow-hidden rounded-[1px]">
            {levelSegments.map((segment) => (
              <div
                key={segment.level}
                style={{
                  height: `${segment.percentage}%`,
                  backgroundColor: LOG_LEVEL_STYLES[segment.level].color,
                }}
              />
            ))}
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top">
        <BucketTooltipContent bucket={bucket} />
      </TooltipContent>
    </Tooltip>
  );
}

// =============================================================================
// Time Range Presets Component
// =============================================================================

interface TimeRangePresetsProps {
  activePreset?: TimeRangePreset;
  onPresetSelect?: (preset: TimeRangePreset) => void;
}

function TimeRangePresets({ activePreset, onPresetSelect }: TimeRangePresetsProps) {
  const displayLabel = activePreset ? PRESET_LABELS[activePreset] : "Range";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-xs"
        >
          {displayLabel}
          <ChevronDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-32"
      >
        {PRESET_ORDER.map((preset) => (
          <DropdownMenuItem
            key={preset}
            onClick={() => onPresetSelect?.(preset)}
            className="justify-between text-xs"
          >
            <span>{PRESET_LABELS[preset]}</span>
            {activePreset === preset ? <Check className="size-3" /> : <span className="size-3" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem
          disabled
          className="justify-between text-xs"
        >
          <span className="text-muted-foreground">Custom</span>
          {activePreset === "custom" ? <Check className="text-muted-foreground size-3" /> : <span className="size-3" />}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// =============================================================================
// Time Range Header Component
// =============================================================================

interface TimeRangeHeaderProps {
  startTime?: Date;
  endTime?: Date;
  onStartTimeChange?: (date: Date) => void;
  onEndTimeChange?: (date: Date) => void;
  showPresets?: boolean;
  activePreset?: TimeRangePreset;
  onPresetSelect?: (preset: TimeRangePreset) => void;
}

function TimeRangeHeader({
  startTime,
  endTime,
  onStartTimeChange,
  onEndTimeChange,
  showPresets,
  activePreset,
  onPresetSelect,
}: TimeRangeHeaderProps) {
  const handleStartChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const date = new Date(e.target.value);
    if (!isNaN(date.getTime())) {
      onStartTimeChange?.(date);
      onPresetSelect?.("custom");
    }
  };

  const handleEndChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const date = new Date(e.target.value);
    if (!isNaN(date.getTime())) {
      onEndTimeChange?.(date);
      onPresetSelect?.("custom");
    }
  };

  const formatForInput = (date?: Date) => {
    if (!date) return "";
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium">Time Range:</span>
        <div className="flex items-center gap-2">
          <input
            type="datetime-local"
            value={formatForInput(startTime)}
            onChange={handleStartChange}
            className="border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring h-7 rounded-md border px-3 text-xs transition-colors focus-visible:ring-1 focus-visible:outline-none"
          />
          <span className="text-muted-foreground text-xs">to</span>
          <input
            type="datetime-local"
            value={formatForInput(endTime)}
            onChange={handleEndChange}
            className="border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring h-7 rounded-md border px-3 text-xs transition-colors focus-visible:ring-1 focus-visible:outline-none"
          />
        </div>
        {showPresets && (
          <TimeRangePresets
            activePreset={activePreset}
            onPresetSelect={onPresetSelect}
          />
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

function TimelineHistogramInner({
  buckets,
  pendingBuckets,
  onBucketClick,
  className,
  height = DEFAULT_HEIGHT,
  showPresets = false,
  onPresetSelect,
  activePreset,
  customControls,
  defaultCollapsed = false,
  startTime,
  endTime,
  displayStart,
  displayEnd,
  onStartTimeChange,
  onEndTimeChange,
  onDisplayRangeChange,
  showTimeRangeHeader = false,
  enableInteractiveDraggers = false,
  entityStartTime,
  entityEndTime,
  now,
}: TimelineHistogramProps) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const { announcer } = useServices();
  const containerRef = useRef<HTMLDivElement>(null);

  // Use pending buckets if available, otherwise committed buckets
  const activeBuckets = pendingBuckets ?? buckets;

  // ============================================================================
  // UNIFIED STATE: Single source of truth
  // ============================================================================

  const timelineState = useTimelineState({
    startTime,
    endTime,
    displayStart,
    displayEnd,
    entityStartTime,
    entityEndTime,
    buckets: activeBuckets,
    now,
  });

  const { currentDisplay, currentEffective, hasPendingChanges, actions } = timelineState;

  // ============================================================================
  // PAN BOUNDARIES
  // ============================================================================

  const panBoundaries: TimelineBounds | null = useMemo(() => {
    const startMs = entityStartTime?.getTime() ?? activeBuckets[0]?.timestamp.getTime();
    if (!startMs) return null;

    let endMs: number;
    if (entityEndTime) {
      const durationMs = entityEndTime.getTime() - startMs;
      const paddingMs = Math.max(durationMs * DISPLAY_PADDING_RATIO, MIN_PADDING_MS);
      endMs = entityEndTime.getTime() + paddingMs;
    } else {
      const currentNow = now ?? startMs + 7 * 24 * 60 * 60 * 1000;
      endMs = currentNow + 60_000;
    }

    return {
      minTime: new Date(startMs),
      maxTime: new Date(endMs),
    };
  }, [entityStartTime, entityEndTime, activeBuckets, now]);

  // ============================================================================
  // GESTURES: Unified gesture handling with @use-gesture/react
  // ============================================================================

  // Wheel gesture (attaches directly to containerRef via target option)
  useTimelineWheelGesture(containerRef, timelineState, panBoundaries, onDisplayRangeChange ?? (() => {}));

  const isEndTimeNow = useMemo(() => {
    if (!endTime) return true;
    const nowTime = new Date();
    const diffMs = Math.abs(nowTime.getTime() - endTime.getTime());
    return diffMs < NOW_THRESHOLD_MS;
  }, [endTime]);

  const startDragger = useTimelineDraggerGesture(
    "start",
    containerRef,
    timelineState,
    currentEffective.start,
    false, // Start dragger never blocked
  );

  const endDragger = useTimelineDraggerGesture("end", containerRef, timelineState, currentEffective.end, isEndTimeNow);

  // ============================================================================
  // CALLBACKS
  // ============================================================================

  const handleApply = useCallback(() => {
    onStartTimeChange?.(currentEffective.start);
    onEndTimeChange?.(currentEffective.end);
    actions.commitPending();

    const startLabel = currentEffective.start ? formatTime24ShortUTC(currentEffective.start) : "beginning";
    const endLabel = currentEffective.end ? formatTime24ShortUTC(currentEffective.end) : "NOW";
    announcer.announce(`Time range updated to ${startLabel} to ${endLabel}`, "polite");
  }, [currentEffective, onStartTimeChange, onEndTimeChange, actions, announcer]);

  const handleCancel = useCallback(() => {
    actions.cancelPending();
    announcer.announce("Time range changes cancelled", "polite");
  }, [actions, announcer]);

  // ============================================================================
  // DERIVED VALUES
  // ============================================================================

  const maxTotal = useMemo(() => {
    let max = 0;
    for (const bucket of activeBuckets) {
      if (bucket.total > max) max = bucket.total;
    }
    return max;
  }, [activeBuckets]);

  const shouldDimBucket = useCallback(
    (bucket: HistogramBucket): boolean => {
      // Without draggers, rely on bucket's own property
      if (!enableInteractiveDraggers) {
        return bucket.isInEffectiveRange === false;
      }

      // With draggers, check if bucket is outside effective range
      const bucketMs = bucket.timestamp.getTime();
      const startMs = currentEffective.start?.getTime();
      const endMs = currentEffective.end?.getTime();

      return (startMs !== undefined && bucketMs < startMs) || (endMs !== undefined && bucketMs > endMs);
    },
    [enableInteractiveDraggers, currentEffective.start, currentEffective.end],
  );

  // Invalid zone positions
  const invalidZonePositions = useMemo(() => {
    if (!panBoundaries) return null;

    const displayRangeMs = currentDisplay.end.getTime() - currentDisplay.start.getTime();
    if (displayRangeMs <= 0) return null;

    const displayStartMs = currentDisplay.start.getTime();
    const displayEndMs = currentDisplay.end.getTime();
    const boundaryStartMs = panBoundaries.minTime.getTime();
    const boundaryEndMs = panBoundaries.maxTime.getTime();

    let leftInvalidWidth = 0;
    if (displayStartMs < boundaryStartMs) {
      const invalidMs = Math.min(boundaryStartMs - displayStartMs, displayRangeMs);
      leftInvalidWidth = (invalidMs / displayRangeMs) * 100;
    }

    let rightInvalidStart = 100;
    let rightInvalidWidth = 0;
    if (displayEndMs > boundaryEndMs) {
      const validEndPosition = ((boundaryEndMs - displayStartMs) / displayRangeMs) * 100;
      rightInvalidStart = Math.max(0, Math.min(100, validEndPosition));
      rightInvalidWidth = 100 - rightInvalidStart;
    }

    return {
      leftInvalidWidth: Math.max(0, Math.min(100, leftInvalidWidth)),
      rightInvalidStart: Math.max(0, Math.min(100, rightInvalidStart)),
      rightInvalidWidth: Math.max(0, Math.min(100, rightInvalidWidth)),
    };
  }, [panBoundaries, currentDisplay]);

  // Overlay positions
  const overlayPositions = useMemo(() => {
    if (!enableInteractiveDraggers) return null;

    const displayRangeMs = currentDisplay.end.getTime() - currentDisplay.start.getTime();
    if (displayRangeMs <= 0) return null;

    const effectiveStartMs =
      currentEffective.start?.getTime() ?? entityStartTime?.getTime() ?? currentDisplay.start.getTime();
    const leftWidth = ((effectiveStartMs - currentDisplay.start.getTime()) / displayRangeMs) * 100;

    const effectiveEndMs = currentEffective.end?.getTime() ?? entityEndTime?.getTime() ?? currentDisplay.end.getTime();
    const rightStart = ((effectiveEndMs - currentDisplay.start.getTime()) / displayRangeMs) * 100;
    const rightWidth = 100 - rightStart;

    return {
      leftWidth: Math.max(0, leftWidth),
      rightStart: Math.max(0, Math.min(100, rightStart)),
      rightWidth: Math.max(0, rightWidth),
    };
  }, [enableInteractiveDraggers, currentDisplay, currentEffective, entityStartTime, entityEndTime]);

  // Time labels for axis
  const startLabel = useMemo(() => {
    const time = currentEffective.start ?? activeBuckets[0]?.timestamp ?? entityStartTime;
    return time ? formatTime24ShortUTC(time) : null;
  }, [currentEffective.start, activeBuckets, entityStartTime]);

  const endLabel = useMemo(() => {
    if (isEndTimeNow) return "NOW";
    return currentEffective.end ? formatTime24ShortUTC(currentEffective.end) : null;
  }, [isEndTimeNow, currentEffective.end]);

  // Bar transform (for pan animation when no pending buckets yet)
  const barTransform = useMemo(() => {
    // No transform needed when pending buckets are available (they're already positioned correctly)
    if (pendingBuckets) return undefined;

    const originalStart = displayStart ?? buckets[0]?.timestamp;
    const originalEnd = displayEnd ?? buckets[buckets.length - 1]?.timestamp;
    if (!originalStart || !originalEnd) return undefined;

    const originalRangeMs = originalEnd.getTime() - originalStart.getTime();
    const currentRangeMs = currentDisplay.end.getTime() - currentDisplay.start.getTime();
    if (originalRangeMs <= 0 || currentRangeMs <= 0) return undefined;

    const scale = originalRangeMs / currentRangeMs;
    const shiftMs = currentDisplay.start.getTime() - originalStart.getTime();
    const translatePercent = -(shiftMs / currentRangeMs) * 100;

    return `translateX(${translatePercent}%) scaleX(${scale})`;
  }, [pendingBuckets, displayStart, displayEnd, buckets, currentDisplay]);

  // Empty state
  const showEmptyMessage = activeBuckets.length === 0 && !entityStartTime;

  if (showEmptyMessage) {
    return (
      <div className={cn("space-y-4", className)}>
        {showTimeRangeHeader && (
          <TimeRangeHeader
            startTime={startTime}
            endTime={endTime}
            onStartTimeChange={onStartTimeChange}
            onEndTimeChange={onEndTimeChange}
            showPresets={showPresets}
            activePreset={activePreset}
            onPresetSelect={onPresetSelect}
          />
        )}
        {!showTimeRangeHeader && showPresets && (
          <TimeRangePresets
            activePreset={activePreset}
            onPresetSelect={onPresetSelect}
          />
        )}
        <div
          className="bg-muted text-muted-foreground flex items-center justify-center rounded text-xs"
          style={{ height }}
        >
          No data for histogram
        </div>
      </div>
    );
  }

  return (
    <div className={cn(className)}>
      <div className="flex items-center justify-between gap-2">
        {showTimeRangeHeader && (
          <TimeRangeHeader
            startTime={startTime}
            endTime={endTime}
            onStartTimeChange={onStartTimeChange}
            onEndTimeChange={onEndTimeChange}
            showPresets={showPresets}
            activePreset={activePreset}
            onPresetSelect={onPresetSelect}
          />
        )}
        {!showTimeRangeHeader && showPresets && (
          <TimeRangePresets
            activePreset={activePreset}
            onPresetSelect={onPresetSelect}
          />
        )}

        {enableInteractiveDraggers && (
          <TimelineControls
            hasPendingChanges={hasPendingChanges}
            onApply={handleApply}
            onCancel={handleCancel}
            className="ml-auto"
          />
        )}

        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className={cn(
            "text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs transition-colors",
            !hasPendingChanges && "ml-auto",
          )}
          aria-label={isCollapsed ? "Expand histogram" : "Collapse histogram"}
        >
          {isCollapsed ? (
            <>
              <span>Expand</span>
              <ChevronDown className="size-3" />
            </>
          ) : (
            <>
              <span>Collapse</span>
              <ChevronUp className="size-3" />
            </>
          )}
        </button>
      </div>

      <div
        className="overflow-hidden transition-all duration-300 ease-in-out"
        style={{
          maxHeight: isCollapsed ? "0px" : `${height + 60}px`,
          opacity: isCollapsed ? 0 : 1,
        }}
      >
        <div className="space-y-2 pt-4">
          <div className="relative">
            <div
              ref={containerRef}
              className="relative"
              style={{ height: `${height}px` }}
            >
              <div
                className="absolute inset-0 flex items-end gap-px transition-transform duration-200 ease-out"
                style={barTransform ? { transform: barTransform } : undefined}
              >
                {activeBuckets.map((bucket, i) => (
                  <StackedBar
                    key={`${bucket.timestamp.getTime()}-${i}`}
                    bucket={bucket}
                    maxTotal={maxTotal}
                    onClick={onBucketClick ? () => onBucketClick(bucket) : undefined}
                    dimmed={shouldDimBucket(bucket)}
                  />
                ))}
              </div>

              {invalidZonePositions && (
                <>
                  {invalidZonePositions.leftInvalidWidth > 0 && (
                    <InvalidZone
                      leftPercent={0}
                      widthPercent={invalidZonePositions.leftInvalidWidth}
                      side="left"
                    />
                  )}
                  {invalidZonePositions.rightInvalidWidth > 0 && (
                    <InvalidZone
                      leftPercent={invalidZonePositions.rightInvalidStart}
                      widthPercent={invalidZonePositions.rightInvalidWidth}
                      side="right"
                    />
                  )}
                </>
              )}

              {enableInteractiveDraggers && overlayPositions && (
                <TimelineWindow
                  leftPanelStart={0}
                  leftPanelWidth={overlayPositions.leftWidth}
                  rightPanelStart={overlayPositions.rightStart}
                  rightPanelWidth={overlayPositions.rightWidth}
                  startDragger={startDragger}
                  endDragger={endDragger}
                />
              )}
            </div>

            {customControls && <div className="absolute bottom-1 left-1">{customControls}</div>}
          </div>

          <div className="text-muted-foreground flex justify-between pb-2 text-[10px] tabular-nums">
            <span>{startLabel}</span>
            <span>{endLabel ?? "NOW"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export const TimelineHistogram = memo(TimelineHistogramInner);
