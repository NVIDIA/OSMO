// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

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
import { TimelineOverlay } from "./TimelineOverlay";
import { TimelineDragger } from "./TimelineDragger";
import { TimelineControls } from "./TimelineControls";
import { useDraggerGesture } from "../lib/use-dragger-gesture";
import { useTimelineWheel } from "../lib/use-timeline-wheel";
import { useServices } from "@/contexts/service-context";

// =============================================================================
// Types
// =============================================================================

export interface TimelineHistogramProps {
  /** Histogram buckets to display */
  buckets: HistogramBucket[];
  /** Bucket interval in milliseconds */
  intervalMs: number;
  /** Callback when a bucket is clicked */
  onBucketClick?: (bucket: HistogramBucket) => void;
  /** Callback when a time range is selected (drag) */
  onRangeSelect?: (start: Date, end: Date) => void;
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
  /** Callback when start time changes */
  onStartTimeChange?: (date: Date | undefined) => void;
  /** Callback when end time changes */
  onEndTimeChange?: (date: Date | undefined) => void;
  /** Whether to show the time range header (default: false) */
  showTimeRangeHeader?: boolean;
  /** Whether to enable interactive draggers (default: false) */
  enableInteractiveDraggers?: boolean;
}

export type TimeRangePreset = "all" | "5m" | "15m" | "1h" | "6h" | "24h" | "custom";

// =============================================================================
// Constants
// =============================================================================

// Levels to show in stacked bars (in order from bottom to top)
// Uses LOG_LEVELS from log-adapter as the single source of truth
const STACKED_LEVELS = LOG_LEVELS;

// Default height for histogram bars
const DEFAULT_HEIGHT = 80;

// Time range presets configuration
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
      {/* Timestamp header with full date and time for debugging */}
      <div className="text-xs font-medium tabular-nums">{formatDateTimeFullUTC(bucket.timestamp)}</div>

      {/* Level breakdown */}
      <div className="space-y-0.5">
        {STACKED_LEVELS.map((level) => {
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
// Stacked Bar Component (DOM-based for better styling)
// =============================================================================

interface StackedBarProps {
  bucket: HistogramBucket;
  maxTotal: number;
  height: number;
  onClick?: () => void;
  /** Whether to dim this bar (outside effective range) */
  dimmed?: boolean;
}

function StackedBar({ bucket, maxTotal, height: _height, onClick, dimmed = false }: StackedBarProps) {
  // Calculate the overall bar height as a percentage
  const heightPercentage = maxTotal > 0 ? (bucket.total / maxTotal) * 100 : 0;

  // Calculate level percentages within this bar
  const levelSegments = useMemo(() => {
    if (bucket.total === 0) return [];

    return STACKED_LEVELS.map((level) => {
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
            // Normal state: 85% opacity, hover to 100%
            !dimmed && "opacity-85 hover:opacity-100",
            // Dimmed state: 50% opacity (padding zone)
            dimmed && "opacity-50",
          )}
          style={{ height: `${heightPercentage}%` }}
          onClick={onClick}
        >
          {/* Stacked segments in flex column-reverse to stack from bottom up */}
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

  // Format date for datetime-local input (YYYY-MM-DDTHH:mm)
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
  intervalMs: _intervalMs,
  onBucketClick,
  onRangeSelect: _onRangeSelect,
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
  showTimeRangeHeader = false,
  enableInteractiveDraggers = false,
}: TimelineHistogramProps) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const { announcer } = useServices();
  const containerRef = useRef<HTMLDivElement>(null);

  // Pending state for dragger/wheel interactions
  const [pendingStart, setPendingStart] = useState<Date | undefined>(undefined);
  const [pendingEnd, setPendingEnd] = useState<Date | undefined>(undefined);
  const [pendingDisplayStart, setPendingDisplayStart] = useState<Date | undefined>(undefined);
  const [pendingDisplayEnd, setPendingDisplayEnd] = useState<Date | undefined>(undefined);

  // Check if there are pending changes
  const hasPendingChanges = pendingStart !== undefined || pendingEnd !== undefined;

  // Helper to auto-adjust display range after gripper drag/wheel interaction
  const autoAdjustDisplayRange = useCallback(
    (newStart: Date | undefined, newEnd: Date | undefined) => {
      const PADDING_RATIO = 0.075;

      // Determine actual boundaries
      const startMs = newStart?.getTime() ?? buckets[0]?.timestamp.getTime() ?? Date.now() - 60 * 60 * 1000;
      const endMs = newEnd?.getTime() ?? Date.now();
      const rangeMs = endMs - startMs;
      const paddingMs = Math.max(rangeMs * PADDING_RATIO, 60_000 * PADDING_RATIO);

      setPendingDisplayStart(new Date(startMs - paddingMs));
      setPendingDisplayEnd(new Date(endMs + paddingMs));
    },
    [buckets],
  );

  // Handle pending range change from wheel/drag
  const handlePendingRangeChange = useCallback(
    (newStart: Date | undefined, newEnd: Date | undefined) => {
      setPendingStart(newStart);
      setPendingEnd(newEnd);
      autoAdjustDisplayRange(newStart, newEnd);
    },
    [autoAdjustDisplayRange],
  );

  // Apply pending changes
  const handleApply = useCallback(() => {
    const newStart = pendingStart ?? startTime;
    const newEnd = pendingEnd ?? endTime;

    // Update effective range
    onStartTimeChange?.(newStart);
    onEndTimeChange?.(newEnd);

    // Clear pending state
    setPendingStart(undefined);
    setPendingEnd(undefined);
    setPendingDisplayStart(undefined);
    setPendingDisplayEnd(undefined);

    // Announce to screen reader
    const startLabel = newStart ? formatTime24ShortUTC(newStart) : "beginning";
    const endLabel = newEnd ? formatTime24ShortUTC(newEnd) : "NOW";
    announcer.announce(`Time range updated to ${startLabel} to ${endLabel}`, "polite");
  }, [pendingStart, pendingEnd, startTime, endTime, onStartTimeChange, onEndTimeChange, announcer]);

  // Cancel pending changes
  const handleCancel = useCallback(() => {
    setPendingStart(undefined);
    setPendingEnd(undefined);
    setPendingDisplayStart(undefined);
    setPendingDisplayEnd(undefined);
    announcer.announce("Time range changes cancelled", "polite");
  }, [announcer]);

  // Determine if end time is "now" (within 1 minute threshold or undefined)
  const isEndTimeNow = useMemo(() => {
    if (!endTime) return true; // undefined means NOW
    const now = new Date();
    const diffMs = Math.abs(now.getTime() - endTime.getTime());
    return diffMs < 60000; // Within 1 minute
  }, [endTime]);

  // Derive display range from props or buckets (use pending if available)
  const derivedDisplayStart = useMemo(
    () => pendingDisplayStart ?? displayStart ?? buckets[0]?.timestamp ?? new Date(),
    [pendingDisplayStart, displayStart, buckets],
  );
  const derivedDisplayEnd = useMemo(
    () => pendingDisplayEnd ?? displayEnd ?? buckets[buckets.length - 1]?.timestamp ?? new Date(),
    [pendingDisplayEnd, displayEnd, buckets],
  );

  // Get effective range (use pending if available)
  const effectiveStartTime = pendingStart ?? startTime;
  const effectiveEndTime = pendingEnd ?? endTime;

  // Dragger gestures (only if interactive mode enabled)
  const handleDraggerStartChange = useCallback(
    (time: Date | undefined) => {
      // Auto-adjust display range after drag
      const newEnd = pendingEnd ?? endTime;
      handlePendingRangeChange(time, newEnd);
    },
    [pendingEnd, endTime, handlePendingRangeChange],
  );

  const handleDraggerEndChange = useCallback(
    (time: Date | undefined) => {
      // Auto-adjust display range after drag
      const newStart = pendingStart ?? startTime;
      handlePendingRangeChange(newStart, time);
    },
    [pendingStart, startTime, handlePendingRangeChange],
  );

  const startDragger = useDraggerGesture({
    side: "start",
    displayStart: derivedDisplayStart,
    displayEnd: derivedDisplayEnd,
    effectiveTime: effectiveStartTime,
    isEndTimeNow: false, // Start dragger never blocked
    onPendingTimeChange: handleDraggerStartChange,
    containerRef,
  });

  const endDragger = useDraggerGesture({
    side: "end",
    displayStart: derivedDisplayStart,
    displayEnd: derivedDisplayEnd,
    effectiveTime: effectiveEndTime,
    isEndTimeNow,
    onPendingTimeChange: handleDraggerEndChange,
    containerRef,
  });

  // Mouse wheel interactions (pan and zoom)
  useTimelineWheel({
    containerRef,
    enabled: enableInteractiveDraggers,
    effectiveStart: effectiveStartTime,
    effectiveEnd: effectiveEndTime,
    isEndTimeNow,
    onPendingRangeChange: handlePendingRangeChange,
  });

  // Compute overlay positions (as percentages)
  const overlayPositions = useMemo(() => {
    if (!enableInteractiveDraggers) return null;

    const displayRangeMs = derivedDisplayEnd.getTime() - derivedDisplayStart.getTime();
    if (displayRangeMs <= 0) return null;

    // Left overlay: from display start to effective start
    const effectiveStartMs = effectiveStartTime?.getTime() ?? derivedDisplayStart.getTime();
    const leftWidth = ((effectiveStartMs - derivedDisplayStart.getTime()) / displayRangeMs) * 100;

    // Right overlay: from effective end to display end
    const effectiveEndMs = effectiveEndTime?.getTime() ?? derivedDisplayEnd.getTime();
    const rightStart = ((effectiveEndMs - derivedDisplayStart.getTime()) / displayRangeMs) * 100;
    const rightWidth = 100 - rightStart;

    return {
      leftWidth: Math.max(0, leftWidth),
      rightStart: Math.max(0, Math.min(100, rightStart)),
      rightWidth: Math.max(0, rightWidth),
    };
  }, [enableInteractiveDraggers, derivedDisplayStart, derivedDisplayEnd, effectiveStartTime, effectiveEndTime]);

  // Get the terminal timestamp label (right edge)
  const terminalLabel = useMemo(() => {
    if (isEndTimeNow) return "NOW";
    if (endTime) return formatTime24ShortUTC(endTime);
    return null;
  }, [isEndTimeNow, endTime]);

  // Get the start timestamp label (left edge)
  const startLabel = useMemo(() => {
    if (startTime) return formatTime24ShortUTC(startTime);
    if (buckets.length > 0) return formatTime24ShortUTC(buckets[0].timestamp);
    return null;
  }, [startTime, buckets]);

  // Find max total for scaling
  const maxTotal = useMemo(() => {
    let max = 0;
    for (const bucket of buckets) {
      if (bucket.total > max) max = bucket.total;
    }
    return max;
  }, [buckets]);

  // Empty state
  if (buckets.length === 0) {
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
      {/* Top Controls - Always visible */}
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

        {/* Apply/Cancel controls - show when pending changes */}
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

      {/* Histogram Bars with animation - Always in DOM */}
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
              className="relative flex items-end gap-px"
              style={{ height: `${height}px` }}
            >
              {buckets.map((bucket, i) => (
                <StackedBar
                  key={`${bucket.timestamp.getTime()}-${i}`}
                  bucket={bucket}
                  maxTotal={maxTotal}
                  height={height}
                  onClick={onBucketClick ? () => onBucketClick(bucket) : undefined}
                  dimmed={bucket.isInEffectiveRange === false}
                />
              ))}

              {/* Overlays for padding zones (only in interactive mode) */}
              {enableInteractiveDraggers && overlayPositions && (
                <>
                  {overlayPositions.leftWidth > 0 && (
                    <TimelineOverlay
                      leftPercent={0}
                      widthPercent={overlayPositions.leftWidth}
                      side="left"
                    />
                  )}
                  {overlayPositions.rightWidth > 0 && (
                    <TimelineOverlay
                      leftPercent={overlayPositions.rightStart}
                      widthPercent={overlayPositions.rightWidth}
                      side="right"
                    />
                  )}
                </>
              )}

              {/* Draggers (only in interactive mode) */}
              {enableInteractiveDraggers && (
                <>
                  <div
                    onMouseDown={startDragger.onMouseDown}
                    onKeyDown={startDragger.onKeyDown}
                  >
                    <TimelineDragger
                      leftPercent={startDragger.positionPercent}
                      side="start"
                      isDragging={startDragger.isDragging}
                      isBlocked={startDragger.isBlocked}
                      innerRef={startDragger.draggerRef}
                    />
                  </div>
                  <div
                    onMouseDown={endDragger.onMouseDown}
                    onKeyDown={endDragger.onKeyDown}
                  >
                    <TimelineDragger
                      leftPercent={endDragger.positionPercent}
                      side="end"
                      isDragging={endDragger.isDragging}
                      isBlocked={endDragger.isBlocked}
                      innerRef={endDragger.draggerRef}
                    />
                  </div>
                </>
              )}
            </div>

            {/* Custom controls overlay (e.g., zoom controls) */}
            {customControls && <div className="absolute bottom-1 left-1">{customControls}</div>}
          </div>

          {/* Time Axis */}
          <div className="text-muted-foreground flex justify-between pb-2 text-[10px] tabular-nums">
            <span>{startLabel || (buckets[0] && formatTime24ShortUTC(buckets[0].timestamp))}</span>
            <span>{terminalLabel || "NOW"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export const TimelineHistogram = memo(TimelineHistogramInner);
