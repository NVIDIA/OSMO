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
  /** Histogram buckets to display (committed state) */
  buckets: HistogramBucket[];
  /** Pending histogram buckets (shown during pan/zoom before Apply) */
  pendingBuckets?: HistogramBucket[];
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
  pendingBuckets,
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
  onDisplayRangeChange,
  showTimeRangeHeader = false,
  enableInteractiveDraggers = false,
}: TimelineHistogramProps) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const { announcer } = useServices();
  const containerRef = useRef<HTMLDivElement>(null);

  // Use pending buckets if available (during pan/zoom), otherwise use committed buckets
  const activeBuckets = pendingBuckets ?? buckets;

  // ============================================================================
  // STATE: Clean separation of concerns
  // ============================================================================

  // Pending display range (where histogram shows - shifts during pan)
  const [pendingDisplayStart, setPendingDisplayStart] = useState<Date | undefined>(undefined);
  const [pendingDisplayEnd, setPendingDisplayEnd] = useState<Date | undefined>(undefined);

  // Pending dragger positions as fractions (0-1) - stable during pan
  const [pendingStartPercent, setPendingStartPercent] = useState<number | undefined>(undefined);
  const [pendingEndPercent, setPendingEndPercent] = useState<number | undefined>(undefined);

  // Check if there are pending changes
  const hasPendingChanges =
    pendingDisplayStart !== undefined ||
    pendingDisplayEnd !== undefined ||
    pendingStartPercent !== undefined ||
    pendingEndPercent !== undefined;

  // ============================================================================
  // DERIVED VALUES: Calculate from state
  // ============================================================================

  // Current display range (with pending or from props)
  const derivedDisplayStart = useMemo(
    () => pendingDisplayStart ?? displayStart ?? activeBuckets[0]?.timestamp ?? new Date(),
    [pendingDisplayStart, displayStart, activeBuckets],
  );
  const derivedDisplayEnd = useMemo(
    () => pendingDisplayEnd ?? displayEnd ?? activeBuckets[activeBuckets.length - 1]?.timestamp ?? new Date(),
    [pendingDisplayEnd, displayEnd, activeBuckets],
  );

  // Calculate current dragger positions as percentages (0-1)
  const currentStartPercent = useMemo(() => {
    if (pendingStartPercent !== undefined) return pendingStartPercent;
    if (!startTime) return undefined;

    const displayRangeMs = derivedDisplayEnd.getTime() - derivedDisplayStart.getTime();
    if (displayRangeMs <= 0) return undefined;

    return (startTime.getTime() - derivedDisplayStart.getTime()) / displayRangeMs;
  }, [pendingStartPercent, startTime, derivedDisplayStart, derivedDisplayEnd]);

  const currentEndPercent = useMemo(() => {
    if (pendingEndPercent !== undefined) return pendingEndPercent;
    if (!endTime) return undefined;

    const displayRangeMs = derivedDisplayEnd.getTime() - derivedDisplayStart.getTime();
    if (displayRangeMs <= 0) return undefined;

    return (endTime.getTime() - derivedDisplayStart.getTime()) / displayRangeMs;
  }, [pendingEndPercent, endTime, derivedDisplayStart, derivedDisplayEnd]);

  // Derive effective times from dragger positions + display range
  const effectiveStartTime = useMemo(() => {
    if (currentStartPercent === undefined) return startTime;
    const displayRangeMs = derivedDisplayEnd.getTime() - derivedDisplayStart.getTime();
    return new Date(derivedDisplayStart.getTime() + currentStartPercent * displayRangeMs);
  }, [currentStartPercent, derivedDisplayStart, derivedDisplayEnd, startTime]);

  const effectiveEndTime = useMemo(() => {
    if (currentEndPercent === undefined) return endTime;
    const displayRangeMs = derivedDisplayEnd.getTime() - derivedDisplayStart.getTime();
    return new Date(derivedDisplayStart.getTime() + currentEndPercent * displayRangeMs);
  }, [currentEndPercent, derivedDisplayStart, derivedDisplayEnd, endTime]);

  // Calculate bar container transform for pan/zoom animation
  const barTransform = useMemo(() => {
    // If we have pendingBuckets, they're already the correct data for the display range
    // No transform needed - just render them directly
    if (pendingBuckets) return "translateX(0) scaleX(1)";

    // Original display range (from props or first/last bucket)
    const originalDisplayStart = displayStart ?? buckets[0]?.timestamp;
    const originalDisplayEnd = displayEnd ?? buckets[buckets.length - 1]?.timestamp;
    if (!originalDisplayStart || !originalDisplayEnd) return "translateX(0) scaleX(1)";

    const originalDisplayStartMs = originalDisplayStart.getTime();
    const originalDisplayEndMs = originalDisplayEnd.getTime();
    const originalRangeMs = originalDisplayEndMs - originalDisplayStartMs;
    if (originalRangeMs <= 0) return "translateX(0) scaleX(1)";

    const currentDisplayStartMs = derivedDisplayStart.getTime();
    const currentDisplayEndMs = derivedDisplayEnd.getTime();
    const currentRangeMs = currentDisplayEndMs - currentDisplayStartMs;
    if (currentRangeMs <= 0) return "translateX(0) scaleX(1)";

    // Calculate scale: bars expand when display narrows (zoom in), compress when display widens (zoom out)
    const scale = originalRangeMs / currentRangeMs;

    // Calculate translation to keep bars aligned with display range
    // We need to shift the bars based on how the display start has moved
    const shiftMs = currentDisplayStartMs - originalDisplayStartMs;
    const translatePercent = -(shiftMs / currentRangeMs) * 100;

    return `translateX(${translatePercent}%) scaleX(${scale})`;
  }, [pendingBuckets, displayStart, displayEnd, buckets, derivedDisplayStart, derivedDisplayEnd]);

  // ============================================================================
  // CALLBACKS: User interactions
  // ============================================================================

  // Pan/Zoom: Shift display range only (dragger percentages stay same)
  const handlePendingDisplayChange = useCallback(
    (newDisplayStart: Date, newDisplayEnd: Date) => {
      // Capture current dragger percentages if not already pending
      if (pendingStartPercent === undefined && currentStartPercent !== undefined) {
        setPendingStartPercent(currentStartPercent);
      }
      if (pendingEndPercent === undefined && currentEndPercent !== undefined) {
        setPendingEndPercent(currentEndPercent);
      }

      // Shift display range
      setPendingDisplayStart(newDisplayStart);
      setPendingDisplayEnd(newDisplayEnd);

      // Notify parent to fetch new buckets for this display range
      onDisplayRangeChange?.(newDisplayStart, newDisplayEnd);

      // Note: dragger percentages are now frozen, so draggers stay at same pixel position
      // but now point to different times (derived from frozen percentages + new display range)
    },
    [pendingStartPercent, pendingEndPercent, currentStartPercent, currentEndPercent, onDisplayRangeChange],
  );

  // Drag/Zoom: Update dragger percentages + auto-adjust display
  const handlePendingRangeChange = useCallback(
    (newStart: Date | undefined, newEnd: Date | undefined) => {
      const PADDING_RATIO = 0.075;

      // Calculate new dragger percentages
      const displayRangeMs = derivedDisplayEnd.getTime() - derivedDisplayStart.getTime();
      if (displayRangeMs > 0) {
        if (newStart !== undefined) {
          setPendingStartPercent((newStart.getTime() - derivedDisplayStart.getTime()) / displayRangeMs);
        }
        if (newEnd !== undefined) {
          setPendingEndPercent((newEnd.getTime() - derivedDisplayStart.getTime()) / displayRangeMs);
        }
      }

      // Auto-adjust display range to keep draggers visible
      const startMs = newStart?.getTime() ?? activeBuckets[0]?.timestamp.getTime() ?? Date.now() - 60 * 60 * 1000;
      const endMs = newEnd?.getTime() ?? Date.now();
      const rangeMs = endMs - startMs;
      const paddingMs = Math.max(rangeMs * PADDING_RATIO, 60_000 * PADDING_RATIO);

      const newDisplayStart = new Date(startMs - paddingMs);
      const newDisplayEnd = new Date(endMs + paddingMs);

      setPendingDisplayStart(newDisplayStart);
      setPendingDisplayEnd(newDisplayEnd);

      // Notify parent to fetch new buckets
      onDisplayRangeChange?.(newDisplayStart, newDisplayEnd);
    },
    [derivedDisplayStart, derivedDisplayEnd, activeBuckets, onDisplayRangeChange],
  );

  // Apply: Commit effective times to parent
  const handleApply = useCallback(() => {
    // Effective times are already calculated from dragger positions + display range
    onStartTimeChange?.(effectiveStartTime);
    onEndTimeChange?.(effectiveEndTime);

    // Clear pending state
    setPendingStartPercent(undefined);
    setPendingEndPercent(undefined);
    setPendingDisplayStart(undefined);
    setPendingDisplayEnd(undefined);

    // Announce to screen reader
    const startLabel = effectiveStartTime ? formatTime24ShortUTC(effectiveStartTime) : "beginning";
    const endLabel = effectiveEndTime ? formatTime24ShortUTC(effectiveEndTime) : "NOW";
    announcer.announce(`Time range updated to ${startLabel} to ${endLabel}`, "polite");
  }, [effectiveStartTime, effectiveEndTime, onStartTimeChange, onEndTimeChange, announcer]);

  // Cancel: Revert all pending changes
  const handleCancel = useCallback(() => {
    setPendingStartPercent(undefined);
    setPendingEndPercent(undefined);
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

  // Dragger gestures (only if interactive mode enabled)
  const handleDraggerStartChange = useCallback(
    (time: Date | undefined) => {
      // Drag updates both start and end (for display range adjustment)
      handlePendingRangeChange(time, effectiveEndTime);
    },
    [effectiveEndTime, handlePendingRangeChange],
  );

  const handleDraggerEndChange = useCallback(
    (time: Date | undefined) => {
      // Drag updates both start and end (for display range adjustment)
      handlePendingRangeChange(effectiveStartTime, time);
    },
    [effectiveStartTime, handlePendingRangeChange],
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
    displayStart: derivedDisplayStart,
    displayEnd: derivedDisplayEnd,
    effectiveStart: effectiveStartTime,
    effectiveEnd: effectiveEndTime,
    isEndTimeNow,
    onPendingRangeChange: handlePendingRangeChange,
    onPendingDisplayChange: handlePendingDisplayChange,
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

  // Get the terminal timestamp label (right edge) - use effective (pending) values
  const terminalLabel = useMemo(() => {
    if (isEndTimeNow) return "NOW";
    if (effectiveEndTime) return formatTime24ShortUTC(effectiveEndTime);
    return null;
  }, [isEndTimeNow, effectiveEndTime]);

  // Get the start timestamp label (left edge) - use effective (pending) values
  const startLabel = useMemo(() => {
    if (effectiveStartTime) return formatTime24ShortUTC(effectiveStartTime);
    if (activeBuckets.length > 0) return formatTime24ShortUTC(activeBuckets[0].timestamp);
    return null;
  }, [effectiveStartTime, activeBuckets]);

  // Find max total for scaling
  const maxTotal = useMemo(() => {
    let max = 0;
    for (const bucket of activeBuckets) {
      if (bucket.total > max) max = bucket.total;
    }
    return max;
  }, [activeBuckets]);

  // Calculate which buckets should be dimmed based on effective range (includes pending)
  const shouldDimBucket = useCallback(
    (bucket: HistogramBucket): boolean => {
      // If not in interactive mode, use the bucket's own property
      if (!enableInteractiveDraggers) {
        return bucket.isInEffectiveRange === false;
      }

      // Otherwise, calculate based on current effective range (pending or committed)
      const bucketTime = bucket.timestamp.getTime();
      const effectiveStartMs = effectiveStartTime?.getTime();
      const effectiveEndMs = effectiveEndTime?.getTime();

      // Check if bucket is outside effective range
      if (effectiveStartMs !== undefined && bucketTime < effectiveStartMs) {
        return true;
      }
      if (effectiveEndMs !== undefined && bucketTime > effectiveEndMs) {
        return true;
      }

      return false;
    },
    [enableInteractiveDraggers, effectiveStartTime, effectiveEndTime],
  );

  // Empty state
  if (activeBuckets.length === 0) {
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
          {/* Timeline Window - Fixed layer with overlays and draggers */}
          <div className="relative">
            <div
              ref={containerRef}
              className="relative"
              style={{ height: `${height}px` }}
            >
              {/* Bars layer - Transforms during pan */}
              <div
                className="absolute inset-0 flex items-end gap-px transition-transform duration-200 ease-out"
                style={{
                  transform: barTransform,
                }}
              >
                {activeBuckets.map((bucket, i) => (
                  <StackedBar
                    key={`${bucket.timestamp.getTime()}-${i}`}
                    bucket={bucket}
                    maxTotal={maxTotal}
                    height={height}
                    onClick={onBucketClick ? () => onBucketClick(bucket) : undefined}
                    dimmed={shouldDimBucket(bucket)}
                  />
                ))}
              </div>

              {/* Overlays layer - Fixed, doesn't transform */}
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

              {/* Draggers layer - Fixed, doesn't transform */}
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
            <span>{startLabel || (activeBuckets[0] && formatTime24ShortUTC(activeBuckets[0].timestamp))}</span>
            <span>{terminalLabel || "NOW"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export const TimelineHistogram = memo(TimelineHistogramInner);
