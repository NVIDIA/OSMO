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

/**
 * Timeline Histogram - Pure presentation component
 *
 * ## Responsibility
 *
 * Renders Layer 1 (pannable content): histogram bars
 *
 * ## Architecture (2-Layer Model)
 *
 * This component represents **Layer 1 (pannable content)**:
 *   [histogram bars]
 *
 * - All elements transform together as a single unit
 * - Transform is calculated by parent (TimelineContainer)
 * - Entity boundary markers are rendered separately in Layer 2
 *
 * ## Performance
 *
 * - Uses a SINGLE shared tooltip via event delegation instead of N Radix Tooltip instances.
 *   Hovered bar index is tracked via data-bar-index attributes and mouse events on the
 *   container, avoiding per-bar React component overhead and Radix portal mounts.
 * - Inline onClick closures replaced with event delegation via data-bar-index.
 * - Keys use timestamp-only (no index) for stable reconciliation.
 * - bucketWidth is received as a prop (computed once in TimelineContainer).
 *
 * ## Usage
 *
 * This is NOT a public component. Use TimelineContainer instead.
 * TimelineContainer orchestrates state, gestures, and composition.
 */

"use client";

import { memo, useMemo, useState, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import type { HistogramBucket } from "@/lib/api/log-adapter/types";
import { LOG_LEVELS, LOG_LEVEL_STYLES, LOG_LEVEL_LABELS } from "@/lib/api/log-adapter/constants";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import { formatDateTimeFullUTC } from "@/lib/format-date";

// =============================================================================
// Types
// =============================================================================

export interface TimelineHistogramProps {
  /** Histogram buckets to display */
  buckets: HistogramBucket[];
  /** Pending buckets (if available) */
  pendingBuckets?: HistogramBucket[];
  /** Original display start (for transform calculation) */
  displayStart?: Date;
  /** Original display end (for transform calculation) */
  displayEnd?: Date;
  /** Current display range (including pending changes) */
  currentDisplay: { start: Date; end: Date };
  /** Entity start time (workflow start) - GUARANTEED */
  entityStartTime: Date;
  /** Entity end time (workflow end) - undefined if still running */
  entityEndTime?: Date;
  /** Synchronized "NOW" timestamp from useTick() - REQUIRED for consistency */
  now: number;
  /** Callback when bucket is clicked */
  onBucketClick?: (bucket: HistogramBucket) => void;
  /** Pre-computed bucket width in milliseconds (from TimelineContainer) */
  bucketWidthMs: number;
  /** Whether a gesture (pan/zoom) is in progress - disables CSS transitions for perf */
  isGesturing?: boolean;
}

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
              <span className="font-mono">{count.toLocaleString("en-US")}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// =============================================================================
// Stacked Bar Component (tooltip-free, lightweight)
// =============================================================================

interface StackedBarProps {
  bucket: HistogramBucket;
  maxTotal: number;
  leftPercent: number;
  widthPercent: number;
  barIndex: number;
  isGesturing?: boolean;
}

function StackedBar({ bucket, maxTotal, leftPercent, widthPercent, barIndex, isGesturing }: StackedBarProps) {
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
    return null;
  }

  // Apply subtle dimming if bar is outside the effective filter range
  // Keep bars clearly visible (65%) to show full context
  const isOutsideFilter = bucket.isInEffectiveRange === false;
  const opacityClass = isOutsideFilter ? "opacity-65" : "opacity-95";

  return (
    <div
      className={cn(
        "absolute bottom-0 cursor-pointer hover:opacity-100",
        // PERF (P2): Disable CSS transitions during pan/zoom to avoid compositor overhead
        !isGesturing && "transition-opacity duration-75",
        opacityClass,
      )}
      style={{
        left: `${leftPercent}%`,
        width: `${widthPercent}%`,
        height: `${heightPercentage}%`,
      }}
      data-bar-index={barIndex}
    >
      <div className="border-border flex h-full flex-col-reverse overflow-hidden rounded-[1px] border-x">
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
  );
}

// =============================================================================
// Main Component
// =============================================================================

function TimelineHistogramInner({
  buckets,
  pendingBuckets,
  displayStart,
  displayEnd,
  currentDisplay,
  onBucketClick,
  bucketWidthMs,
  isGesturing,
}: TimelineHistogramProps) {
  // ---- shared tooltip state (single instance, event-delegated) ----
  const [hoveredBarIndex, setHoveredBarIndex] = useState<number | null>(null);
  const tooltipAnchorRef = useRef<HTMLSpanElement>(null);

  const barTransform = useMemo(() => {
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

  const maxTotal = useMemo(() => {
    let max = 0;
    for (const bucket of buckets) {
      if (bucket.total > max) max = bucket.total;
    }
    return max;
  }, [buckets]);

  const barPositions = useMemo(() => {
    if (buckets.length === 0 || bucketWidthMs === 0) return [];

    const displayStartMs = currentDisplay.start.getTime();
    const displayEndMs = currentDisplay.end.getTime();
    const displayRangeMs = displayEndMs - displayStartMs;

    if (displayRangeMs <= 0) return [];

    return buckets.map((bucket) => {
      const bucketStartMs = bucket.timestamp.getTime();
      const leftPercent = ((bucketStartMs - displayStartMs) / displayRangeMs) * 100;
      const widthPercent = (bucketWidthMs / displayRangeMs) * 100;

      return {
        bucket,
        leftPercent,
        widthPercent,
      };
    });
  }, [buckets, currentDisplay, bucketWidthMs]);

  // ---- event delegation handlers ----

  /**
   * Resolve the bar index from a DOM event target by walking up the tree
   * looking for the nearest element with a data-bar-index attribute.
   */
  const resolveBarIndex = useCallback((target: EventTarget | null): number | null => {
    let el = target as HTMLElement | null;
    // Walk up at most 4 levels (bar -> inner div -> segment div is max depth)
    for (let i = 0; i < 4 && el; i++) {
      const attr = el.getAttribute?.("data-bar-index");
      if (attr !== null && attr !== undefined) {
        return Number(attr);
      }
      el = el.parentElement;
    }
    return null;
  }, []);

  // PERF (P0): Suppress tooltip interactions during gestures (pan/zoom/drag).
  // During active gestures, mouseover/mousemove events on bars would trigger
  // React state updates (setHoveredBarIndex) and Radix tooltip mounts, causing
  // unnecessary re-renders that compete with gesture frame budget.
  const handleMouseOver = useCallback(
    (e: React.MouseEvent) => {
      if (isGesturing) return;
      const idx = resolveBarIndex(e.target);
      if (idx !== null) {
        setHoveredBarIndex(idx);
        // position the invisible anchor under the cursor so the Radix tooltip opens there
        if (tooltipAnchorRef.current) {
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const x = e.clientX - rect.left;
          tooltipAnchorRef.current.style.left = `${x}px`;
        }
      }
    },
    [resolveBarIndex, isGesturing],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isGesturing || hoveredBarIndex === null) return;
      // Keep anchor tracking the cursor horizontally
      if (tooltipAnchorRef.current) {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const x = e.clientX - rect.left;
        tooltipAnchorRef.current.style.left = `${x}px`;
      }
    },
    [hoveredBarIndex, isGesturing],
  );

  const handleMouseLeave = useCallback(() => {
    setHoveredBarIndex(null);
  }, []);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!onBucketClick) return;
      const idx = resolveBarIndex(e.target);
      if (idx !== null && idx >= 0 && idx < barPositions.length) {
        onBucketClick(barPositions[idx].bucket);
      }
    },
    [onBucketClick, resolveBarIndex, barPositions],
  );

  // PERF (P0): Suppress tooltip during gestures by deriving visibility from both
  // hoveredBarIndex and isGesturing. This avoids calling setState in an effect
  // (which the React Compiler flags) while still preventing tooltip renders
  // during pan/zoom that would compete with gesture frame budget.
  const hoveredBucket =
    !isGesturing && hoveredBarIndex !== null && hoveredBarIndex >= 0 && hoveredBarIndex < barPositions.length
      ? barPositions[hoveredBarIndex].bucket
      : null;

  return (
    <div
      className="absolute inset-0 will-change-transform"
      style={barTransform ? { transform: barTransform } : undefined}
      data-layer="pannable"
    >
      {/* Histogram bars - event delegation on container */}
      {/* PERF (P1): pointer-events: none during gestures prevents the browser from
          running hit-testing on every bar element during pan/zoom, eliminating
          hover recalculation overhead that competes with gesture frame budget. */}
      <div
        className="absolute inset-0"
        style={{
          contain: "strict",
          pointerEvents: isGesturing ? "none" : undefined,
        }}
        onMouseOver={handleMouseOver}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
      >
        {barPositions.map((pos, i) => (
          <StackedBar
            key={pos.bucket.timestamp.getTime()}
            bucket={pos.bucket}
            maxTotal={maxTotal}
            leftPercent={pos.leftPercent}
            widthPercent={pos.widthPercent}
            barIndex={i}
            isGesturing={isGesturing}
          />
        ))}

        {/* Single shared tooltip - positioned by the invisible anchor */}
        <Tooltip open={hoveredBucket !== null}>
          <TooltipTrigger asChild>
            <span
              ref={tooltipAnchorRef}
              className="pointer-events-none absolute bottom-0 h-full w-0"
              aria-hidden="true"
            />
          </TooltipTrigger>
          {hoveredBucket && (
            <TooltipContent
              side="top"
              className="pointer-events-none"
            >
              <BucketTooltipContent bucket={hoveredBucket} />
            </TooltipContent>
          )}
        </Tooltip>
      </div>
    </div>
  );
}

export const TimelineHistogram = memo(TimelineHistogramInner);
