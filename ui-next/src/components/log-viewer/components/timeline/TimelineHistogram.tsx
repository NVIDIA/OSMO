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
import { TimelineWindow } from "./TimelineWindow";
import { InvalidZone } from "./InvalidZone";
import { TimelineControls } from "./TimelineControls";
import { useDraggerGesture } from "./use-dragger-gesture";
import { useTimelineWheel } from "./use-timeline-wheel";
import { useServices } from "@/contexts/service-context";

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

// Default height for histogram bars
const DEFAULT_HEIGHT = 80;

// Padding ratio for display range (7.5% on each side)
const DISPLAY_PADDING_RATIO = 0.075;

// Minimum padding in milliseconds (30 seconds)
const MIN_PADDING_MS = 30_000;

// Default fallback duration when no data (1 hour in milliseconds)
const DEFAULT_DURATION_MS = 60 * 60 * 1000;

// Threshold for considering a boundary reached (1 second in milliseconds)
const BOUNDARY_THRESHOLD_MS = 1000;

// Threshold for considering end time as "now" (1 minute in milliseconds)
const NOW_THRESHOLD_MS = 60_000;

// Minimum range for dragger adjustment (1 minute in milliseconds)
const MIN_EFFECTIVE_RANGE_MS = 60_000;

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
// Stacked Bar Component (DOM-based for better styling)
// =============================================================================

interface StackedBarProps {
  bucket: HistogramBucket;
  maxTotal: number;
  onClick?: () => void;
  /** Whether to dim this bar (outside effective range) */
  dimmed?: boolean;
}

function StackedBar({ bucket, maxTotal, onClick, dimmed = false }: StackedBarProps) {
  // Calculate the overall bar height as a percentage
  const heightPercentage = maxTotal > 0 ? (bucket.total / maxTotal) * 100 : 0;

  // Calculate level percentages within this bar
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

  // Use pending buckets if available (during pan/zoom), otherwise use committed buckets
  const activeBuckets = pendingBuckets ?? buckets;

  // ============================================================================
  // STATE: Clean separation of concerns
  // ============================================================================

  // Pending display range (where histogram shows - shifts during pan)
  const [pendingDisplayStart, setPendingDisplayStart] = useState<Date | undefined>(undefined);
  const [pendingDisplayEnd, setPendingDisplayEnd] = useState<Date | undefined>(undefined);

  // Pending effective times (actual timestamps - the source of truth during interactions)
  // These represent the actual time boundaries the user wants, independent of display range
  const [pendingEffectiveStart, setPendingEffectiveStart] = useState<Date | undefined>(undefined);
  const [pendingEffectiveEnd, setPendingEffectiveEnd] = useState<Date | undefined>(undefined);

  // Check if there are pending changes
  const hasPendingChanges =
    pendingDisplayStart !== undefined ||
    pendingDisplayEnd !== undefined ||
    pendingEffectiveStart !== undefined ||
    pendingEffectiveEnd !== undefined;

  // ============================================================================
  // DERIVED VALUES: Calculate from state
  // ============================================================================

  // Current display range (with pending or from props)
  // Fallback hierarchy: pending > props > buckets > entity times > current time
  const derivedDisplayStart = useMemo(() => {
    if (pendingDisplayStart) return pendingDisplayStart;
    if (displayStart) return displayStart;
    if (activeBuckets[0]) return activeBuckets[0].timestamp;
    if (entityStartTime) return entityStartTime;
    return new Date();
  }, [pendingDisplayStart, displayStart, activeBuckets, entityStartTime]);

  const derivedDisplayEnd = useMemo(() => {
    if (pendingDisplayEnd) return pendingDisplayEnd;
    if (displayEnd) return displayEnd;
    if (activeBuckets[activeBuckets.length - 1]) return activeBuckets[activeBuckets.length - 1].timestamp;
    if (entityEndTime) return entityEndTime;
    // If no end time (still running), use start + 1 hour as approximation
    return new Date(derivedDisplayStart.getTime() + 60 * 60 * 1000);
  }, [pendingDisplayEnd, displayEnd, activeBuckets, entityEndTime, derivedDisplayStart]);

  // Determine effective times (pending takes precedence over committed)
  // These are the actual time boundaries that matter - the source of truth
  const effectiveStartTime = pendingEffectiveStart ?? startTime ?? entityStartTime;
  const effectiveEndTime = pendingEffectiveEnd ?? endTime ?? entityEndTime;

  // Calculate dragger positions as percentages (0-1) - DERIVED from effective times
  // These are only used for visual positioning
  const currentStartPercent = useMemo(() => {
    const displayRangeMs = derivedDisplayEnd.getTime() - derivedDisplayStart.getTime();
    if (displayRangeMs <= 0) return undefined;

    const timeToUse = effectiveStartTime;
    if (!timeToUse) return undefined;

    return (timeToUse.getTime() - derivedDisplayStart.getTime()) / displayRangeMs;
  }, [effectiveStartTime, derivedDisplayStart, derivedDisplayEnd]);

  // ============================================================================
  // PAN BOUNDARIES: Calculate entity-based bounds for panning
  // ============================================================================

  // Calculate pan boundaries based on entity start/end times
  // For still-running entities, use synchronized NOW from useTick
  const panBoundaries = useMemo(() => {
    // Prefer entity times over bucket data for boundaries
    const startMs = entityStartTime?.getTime() ?? activeBuckets[0]?.timestamp.getTime();

    if (!startMs) {
      return null; // No boundaries available
    }

    let endMs: number;
    if (entityEndTime) {
      // Completed entity: add padding beyond end time
      const durationMs = entityEndTime.getTime() - startMs;
      const paddingMs = Math.max(durationMs * DISPLAY_PADDING_RATIO, MIN_PADDING_MS);
      endMs = entityEndTime.getTime() + paddingMs;
    } else {
      // Still running: use synchronized NOW with buffer for future panning
      // Allow panning up to 1 minute into the future for real-time workflows
      // If now is not provided, use a far-future boundary (should not happen in practice)
      const currentNow = now ?? startMs + 7 * 24 * 60 * 60 * 1000; // 7 days fallback
      endMs = currentNow + 60_000; // Add 1 minute buffer
    }

    return {
      minTime: new Date(startMs),
      maxTime: new Date(endMs),
    };
  }, [entityStartTime, entityEndTime, activeBuckets, now]);

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

  // Pan/Zoom: Shift display range only (dragger percentages stay frozen)
  // Both pan and zoom keep draggers at same pixel position
  const handlePendingDisplayChange = useCallback(
    (newDisplayStart: Date, newDisplayEnd: Date) => {
      // ENFORCE display constraints
      if (panBoundaries) {
        const currentEndMs = derivedDisplayEnd.getTime();
        const newStartMs = newDisplayStart.getTime();
        const newEndMs = newDisplayEnd.getTime();
        const boundaryStartMs = panBoundaries.minTime.getTime();
        const boundaryEndMs = panBoundaries.maxTime.getTime();
        const displayRangeMs = newEndMs - newStartMs;

        // CONSTRAINT: entity boundary must never be positioned to the right of effective start
        // We need to calculate what effectiveStart WILL BE after this display change
        if (displayRangeMs > 0) {
          let newEffectiveStartMs: number;

          if (currentStartPercent !== undefined) {
            // Dragger is set: calculate where it will be after display change
            newEffectiveStartMs = newStartMs + currentStartPercent * displayRangeMs;
          } else {
            // No dragger: use startTime or default to entity boundary
            newEffectiveStartMs = startTime?.getTime() ?? boundaryStartMs;
          }

          // Check constraint: entity boundary position <= effective start position
          // In pixel terms: (boundaryStartMs - displayStartMs) / displayRangeMs <= (effectiveStartMs - displayStartMs) / displayRangeMs
          // Simplifies to: boundaryStartMs <= effectiveStartMs
          if (boundaryStartMs > newEffectiveStartMs) {
            // Violation! Need to clamp displayStart
            // Where: newEffectiveStartMs = displayStartMs + currentStartPercent * displayRangeMs (if dragger set)
            // So: boundaryStartMs <= displayStartMs + currentStartPercent * displayRangeMs
            // Therefore: displayStartMs >= boundaryStartMs - currentStartPercent * displayRangeMs

            let minDisplayStartMs: number;
            if (currentStartPercent !== undefined) {
              minDisplayStartMs = boundaryStartMs - currentStartPercent * displayRangeMs;
            } else {
              // No dragger: can't show invalid zone beyond effective start
              minDisplayStartMs = newEffectiveStartMs;
            }

            // Check if we need to clamp (i.e., if the requested position violates constraint)
            if (newStartMs < minDisplayStartMs) {
              // Block the entire operation - don't clamp and proceed, just return
              // This prevents unintended zoom when panning is blocked
              return;
            }
          }
        }

        // Block right pan if already at/past right boundary and trying to go further right
        const isPanningRight = newEndMs > currentEndMs;
        const isAtRightBoundary = currentEndMs >= boundaryEndMs - BOUNDARY_THRESHOLD_MS;
        if (isPanningRight && isAtRightBoundary) {
          return; // Block the pan gesture
        }
      }

      // Both pan and zoom: Draggers stay at same PIXEL POSITION (freeze effective times)
      // The difference between pan and zoom is how the histogram bars render, not dragger behavior
      if (pendingEffectiveStart === undefined && effectiveStartTime !== undefined) {
        setPendingEffectiveStart(effectiveStartTime);
      }
      if (pendingEffectiveEnd === undefined && effectiveEndTime !== undefined) {
        setPendingEffectiveEnd(effectiveEndTime);
      }

      // Shift display range
      setPendingDisplayStart(newDisplayStart);
      setPendingDisplayEnd(newDisplayEnd);

      // Notify parent to fetch new buckets for this display range
      onDisplayRangeChange?.(newDisplayStart, newDisplayEnd);
    },
    [
      pendingEffectiveStart,
      pendingEffectiveEnd,
      effectiveStartTime,
      effectiveEndTime,
      currentStartPercent,
      onDisplayRangeChange,
      panBoundaries,
      derivedDisplayEnd,
      startTime,
    ],
  );

  // Drag/Zoom: Update effective times directly + auto-adjust display
  const handlePendingRangeChange = useCallback(
    (newStart: Date | undefined, newEnd: Date | undefined) => {
      // Store effective times directly (source of truth)
      if (newStart !== undefined) {
        setPendingEffectiveStart(newStart);
      }
      if (newEnd !== undefined) {
        setPendingEffectiveEnd(newEnd);
      }

      // Auto-adjust display range to keep draggers visible
      const startMs =
        newStart?.getTime() ??
        activeBuckets[0]?.timestamp.getTime() ??
        entityStartTime?.getTime() ??
        Date.now() - DEFAULT_DURATION_MS;
      const endMs = newEnd?.getTime() ?? entityEndTime?.getTime() ?? Date.now();
      const rangeMs = endMs - startMs;
      const paddingMs = Math.max(rangeMs * DISPLAY_PADDING_RATIO, MIN_EFFECTIVE_RANGE_MS * DISPLAY_PADDING_RATIO);

      const newDisplayStart = new Date(startMs - paddingMs);
      const newDisplayEnd = new Date(endMs + paddingMs);

      // DO NOT clamp display range - allow it to extend beyond boundaries
      // Invalid zones will be visible in these areas

      setPendingDisplayStart(newDisplayStart);
      setPendingDisplayEnd(newDisplayEnd);

      // Notify parent to fetch new buckets
      onDisplayRangeChange?.(newDisplayStart, newDisplayEnd);
    },
    [activeBuckets, entityStartTime, entityEndTime, onDisplayRangeChange],
  );

  // Apply: Commit effective times to parent
  const handleApply = useCallback(() => {
    // Effective times are the source of truth
    onStartTimeChange?.(effectiveStartTime);
    onEndTimeChange?.(effectiveEndTime);

    // Clear pending state
    setPendingEffectiveStart(undefined);
    setPendingEffectiveEnd(undefined);
    setPendingDisplayStart(undefined);
    setPendingDisplayEnd(undefined);

    // Announce to screen reader
    const startLabel = effectiveStartTime ? formatTime24ShortUTC(effectiveStartTime) : "beginning";
    const endLabel = effectiveEndTime ? formatTime24ShortUTC(effectiveEndTime) : "NOW";
    announcer.announce(`Time range updated to ${startLabel} to ${endLabel}`, "polite");
  }, [effectiveStartTime, effectiveEndTime, onStartTimeChange, onEndTimeChange, announcer]);

  // Cancel: Revert all pending changes
  const handleCancel = useCallback(() => {
    setPendingEffectiveStart(undefined);
    setPendingEffectiveEnd(undefined);
    setPendingDisplayStart(undefined);
    setPendingDisplayEnd(undefined);
    announcer.announce("Time range changes cancelled", "polite");
  }, [announcer]);

  // Determine if end time is "now" (within threshold or undefined)
  const isEndTimeNow = useMemo(() => {
    if (!endTime) return true; // undefined means NOW
    const now = new Date();
    const diffMs = Math.abs(now.getTime() - endTime.getTime());
    return diffMs < NOW_THRESHOLD_MS;
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
    onPendingDisplayChange: handlePendingDisplayChange,
  });

  // Compute invalid zone positions (areas beyond entity boundaries)
  const invalidZonePositions = useMemo(() => {
    if (!panBoundaries) return null;

    const displayRangeMs = derivedDisplayEnd.getTime() - derivedDisplayStart.getTime();
    if (displayRangeMs <= 0) return null;

    const displayStartMs = derivedDisplayStart.getTime();
    const displayEndMs = derivedDisplayEnd.getTime();
    const boundaryStartMs = panBoundaries.minTime.getTime();
    const boundaryEndMs = panBoundaries.maxTime.getTime();

    // Left invalid zone: before entity start
    let leftInvalidWidth = 0;
    if (displayStartMs < boundaryStartMs) {
      const invalidMs = Math.min(boundaryStartMs - displayStartMs, displayRangeMs);
      leftInvalidWidth = (invalidMs / displayRangeMs) * 100;
    }

    // Right invalid zone: after entity end + padding
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
  }, [panBoundaries, derivedDisplayStart, derivedDisplayEnd]);

  // Compute overlay positions (as percentages)
  const overlayPositions = useMemo(() => {
    if (!enableInteractiveDraggers) return null;

    const displayRangeMs = derivedDisplayEnd.getTime() - derivedDisplayStart.getTime();
    if (displayRangeMs <= 0) return null;

    // Left overlay: from display start to effective start
    // When no time filter is set (effectiveStartTime === undefined), default to entity start
    // This ensures the left overlay is visible, showing the padding before workflow start
    const effectiveStartMs =
      effectiveStartTime?.getTime() ?? entityStartTime?.getTime() ?? derivedDisplayStart.getTime();
    const leftWidth = ((effectiveStartMs - derivedDisplayStart.getTime()) / displayRangeMs) * 100;

    // Right overlay: from effective end to display end
    // When no time filter is set (effectiveEndTime === undefined), default to entity end (or display end if still running)
    // This ensures the right overlay is visible when the workflow has completed
    const effectiveEndMs = effectiveEndTime?.getTime() ?? entityEndTime?.getTime() ?? derivedDisplayEnd.getTime();
    const rightStart = ((effectiveEndMs - derivedDisplayStart.getTime()) / displayRangeMs) * 100;
    const rightWidth = 100 - rightStart;

    return {
      leftWidth: Math.max(0, leftWidth),
      rightStart: Math.max(0, Math.min(100, rightStart)),
      rightWidth: Math.max(0, rightWidth),
    };
  }, [
    enableInteractiveDraggers,
    derivedDisplayStart,
    derivedDisplayEnd,
    effectiveStartTime,
    effectiveEndTime,
    entityStartTime,
    entityEndTime,
  ]);

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
    if (entityStartTime) return formatTime24ShortUTC(entityStartTime);
    return null;
  }, [effectiveStartTime, activeBuckets, entityStartTime]);

  // Find max total for scaling
  const maxTotal = useMemo(() => {
    let max = 0;
    for (const bucket of activeBuckets) {
      if (bucket.total > max) max = bucket.total;
    }
    return max;
  }, [activeBuckets]);

  // Extract primitive milliseconds for stable callback dependencies
  const effectiveStartMs = effectiveStartTime?.getTime();
  const effectiveEndMs = effectiveEndTime?.getTime();

  // Calculate which buckets should be dimmed based on effective range (includes pending)
  const shouldDimBucket = useCallback(
    (bucket: HistogramBucket): boolean => {
      // If not in interactive mode, use the bucket's own property
      if (!enableInteractiveDraggers) {
        return bucket.isInEffectiveRange === false;
      }

      // Otherwise, calculate based on current effective range (pending or committed)
      const bucketTime = bucket.timestamp.getTime();

      // Check if bucket is outside effective range
      if (effectiveStartMs !== undefined && bucketTime < effectiveStartMs) {
        return true;
      }
      if (effectiveEndMs !== undefined && bucketTime > effectiveEndMs) {
        return true;
      }

      return false;
    },
    [enableInteractiveDraggers, effectiveStartMs, effectiveEndMs],
  );

  // Determine if we should show the empty state message
  // Only show empty message if we have no buckets AND no entity metadata
  const showEmptyMessage = activeBuckets.length === 0 && !entityStartTime;

  // If completely empty (no buckets, no metadata), show simplified empty state
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
                    onClick={onBucketClick ? () => onBucketClick(bucket) : undefined}
                    dimmed={shouldDimBucket(bucket)}
                  />
                ))}
              </div>

              {/* Invalid zones - Areas beyond entity boundaries (pan boundaries) */}
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

              {/* Timeline Window - Unified viewing portal with panels and grippers */}
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
