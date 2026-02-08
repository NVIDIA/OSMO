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
 * Renders Layer 1 (pannable content): histogram bars + invalid zones
 *
 * ## Architecture (2-Layer Model)
 *
 * This component represents **Layer 1 (pannable content)**:
 *   [invalidZoneLeft] <---> [histogram bars] <---> [invalidZoneRight]
 *
 * - All elements transform together as a single unit
 * - Transform is calculated by parent (TimelineContainer)
 * - Invalid zones show areas beyond entity boundaries
 *
 * ## Usage
 *
 * This is NOT a public component. Use TimelineContainer instead.
 * TimelineContainer orchestrates state, gestures, and composition.
 */

"use client";

import { memo, useMemo, useRef, useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import type { HistogramBucket } from "@/lib/api/log-adapter/types";
import { LOG_LEVELS, LOG_LEVEL_STYLES, LOG_LEVEL_LABELS } from "@/lib/api/log-adapter/constants";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import { formatDateTimeFullUTC } from "@/lib/format-date";
import {
  calculateBucketWidth,
  calculateInvalidZonePositions,
} from "@/components/log-viewer/components/timeline/lib/invalid-zones";

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
  /** Entity start time (workflow start) - left boundary of valid zone - GUARANTEED */
  entityStartTime: Date;
  /** Entity end time (workflow end) - right boundary of valid zone, undefined if still running */
  entityEndTime?: Date;
  /** Synchronized "NOW" timestamp from useTick() - REQUIRED for consistency */
  now: number;
  /** Callback when bucket is clicked */
  onBucketClick?: (bucket: HistogramBucket) => void;
}

// =============================================================================
// Invalid Zone (colocated - only used by TimelineHistogram)
// =============================================================================

/**
 * Invalid Zone - areas beyond entity boundaries where logs cannot exist.
 * Part of Layer 1 (pannable content) - pans together with bars.
 *
 * Visual: Diagonal stripe pattern showing areas before workflow start or after completion.
 */
interface InvalidZoneProps {
  /** Position from left edge as percentage (0-100) */
  leftPercent: number;
  /** Width as percentage (0-100) */
  widthPercent: number;
  /** Side: left (before entity start) or right (after entity end) */
  side: "left" | "right";
}

function InvalidZone({ leftPercent, widthPercent, side }: InvalidZoneProps) {
  if (widthPercent <= 0) return null;

  return (
    <div
      className={cn(
        "pointer-events-none absolute top-0 h-full",
        // NO transition - moves instantly with parent transform
        // Striped pattern using CSS background
        "[background:repeating-linear-gradient(45deg,rgb(0_0_0/0.04),rgb(0_0_0/0.04)_8px,rgb(0_0_0/0.10)_8px,rgb(0_0_0/0.10)_16px)]",
        "dark:[background:repeating-linear-gradient(45deg,rgb(255_255_255/0.03),rgb(255_255_255/0.03)_8px,rgb(255_255_255/0.08)_8px,rgb(255_255_255/0.08)_16px)]",
      )}
      style={{
        left: `${leftPercent}%`,
        width: `${widthPercent}%`,
      }}
      aria-hidden="true"
      data-invalid-zone-side={side}
      title={`Invalid zone (${side}): logs cannot exist here`}
    />
  );
}

// =============================================================================
// Gap Component (explicit buffer between invalid zone and histogram bars)
// =============================================================================

/**
 * Gap - explicit buffer space between invalid zones and histogram bars.
 * Part of Layer 1 (pannable content) - pans together with bars.
 *
 * Renders as a one-bucket-width empty space that:
 * - Maintains constant visual width during pan (same zoom level)
 * - Scales naturally during zoom (tied to bucket width)
 * - Prevents "resizing gap" visual bug by being explicit rather than implicit
 */
interface GapProps {
  /** Position from left edge as percentage (0-100) */
  leftPercent: number;
  /** Width as percentage (0-100) */
  widthPercent: number;
  /** Side: left (buffer before entity start) or right (buffer after entity end/now) */
  side: "left" | "right";
}

function Gap({ leftPercent, widthPercent, side }: GapProps) {
  if (widthPercent <= 0) return null;

  return (
    <div
      className="pointer-events-none absolute top-0 h-full"
      style={{
        left: `${leftPercent}%`,
        width: `${widthPercent}%`,
      }}
      aria-hidden="true"
      data-gap-side={side}
      title={`Gap (${side}): buffer space between invalid zone and data`}
    />
  );
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
}

function StackedBar({ bucket, maxTotal, onClick }: StackedBarProps) {
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
          className="relative flex-1 cursor-pointer opacity-85 transition-opacity duration-75 hover:opacity-100"
          style={{ height: `${heightPercentage}%` }}
          onClick={onClick}
          data-histogram-bar
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
      <TooltipContent
        side="top"
        className="pointer-events-none"
      >
        <BucketTooltipContent bucket={bucket} />
      </TooltipContent>
    </Tooltip>
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
  entityStartTime,
  entityEndTime,
  now,
  onBucketClick,
}: TimelineHistogramProps) {
  // Use pending buckets if available, otherwise committed buckets
  const activeBuckets = pendingBuckets ?? buckets;

  // Ref to measure container pixel width for accurate gap calculation
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number | null>(null);

  // Measure container width on mount and resize
  useEffect(() => {
    if (!containerRef.current) return;

    const updateWidth = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.offsetWidth);
      }
    };

    updateWidth();
    const resizeObserver = new ResizeObserver(updateWidth);
    resizeObserver.observe(containerRef.current);

    return () => resizeObserver.disconnect();
  }, []);

  // Invalid zone positions (part of Layer 1 - transforms with bars)
  // CRITICAL: ALWAYS use currentDisplay to ensure invalid zones match actual viewport
  const invalidZonePositions = useMemo(() => {
    // entityStartTime is guaranteed (log-viewer only loads when workflow started)

    // Calculate bucket width using pure function
    const bucketTimestamps = activeBuckets.map((b) => b.timestamp);
    const bucketWidthMs = calculateBucketWidth(bucketTimestamps);

    // ALWAYS use currentDisplay - this is the actual viewport position
    // Invalid zones must match the viewport, not the original range
    // This ensures consistent invalid zone visibility across pan/zoom and committed states
    const displayStartMs = currentDisplay.start.getTime();
    const displayEndMs = currentDisplay.end.getTime();

    // Use pure tested function to calculate positions
    // CRITICAL: NOW must be provided for running workflows to ensure correct right boundary
    // Using 0 as fallback for type safety (should never happen - TimelineContainer always provides it)
    const nowMs = now ?? 0;
    if (process.env.NODE_ENV !== "production" && !now && !entityEndTime) {
      console.warn(
        "[TimelineHistogram] NOW timestamp not provided for running workflow - right invalid zone may be incorrect",
      );
    }
    const positions = calculateInvalidZonePositions(
      entityStartTime.getTime(),
      entityEndTime?.getTime(),
      nowMs,
      displayStartMs,
      displayEndMs,
      bucketWidthMs,
      activeBuckets.length, // Total buckets visible - used to match flexbox bar width
    );

    // CRITICAL: Adjust gap widths to account for inter-bar spacing (gap-px = 1px)
    // The bars use flexbox with 1px gaps between them, so actual bar width is:
    // (containerWidth - (n-1)*1px) / n
    // We need to scale the gap percentage by this factor to match visual bar width
    if (containerWidth && activeBuckets.length > 0) {
      const n = activeBuckets.length;
      const interBarGapsPx = (n - 1) * 1; // 1px gap between each bar
      const correctionFactor = (containerWidth - interBarGapsPx) / containerWidth;

      return {
        ...positions,
        leftGapWidth: positions.leftGapWidth * correctionFactor,
        rightGapWidth: positions.rightGapWidth * correctionFactor,
      };
    }

    return positions;
  }, [entityStartTime, entityEndTime, now, currentDisplay, activeBuckets, containerWidth]);

  // ============================================================================
  // TRANSFORM CALCULATION
  // ============================================================================

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

  // ============================================================================
  // MAX TOTAL (for bar height scaling)
  // ============================================================================

  const maxTotal = useMemo(() => {
    let max = 0;
    for (const bucket of activeBuckets) {
      if (bucket.total > max) max = bucket.total;
    }
    return max;
  }, [activeBuckets]);

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      style={barTransform ? { transform: barTransform } : undefined}
      data-layer="pannable"
    >
      {/* Invalid zones and gaps - part of pannable layer */}
      {/* Structure: [Invalid Zone][Gap][Bars][Gap][Invalid Zone] */}
      {/* All elements transform together to prevent visual "jumping" */}
      {invalidZonePositions && (
        <>
          {/* Left invalid zone (before entity start minus gap) */}
          {invalidZonePositions.leftInvalidWidth > 0 && (
            <InvalidZone
              leftPercent={0}
              widthPercent={invalidZonePositions.leftInvalidWidth}
              side="left"
            />
          )}
          {/* Left gap (1.0 bucket width buffer between invalid zone and first bar) */}
          {invalidZonePositions.leftGapWidth > 0 && (
            <Gap
              leftPercent={invalidZonePositions.leftGapStart}
              widthPercent={invalidZonePositions.leftGapWidth}
              side="left"
            />
          )}
          {/* Right gap (1.0 bucket width buffer between last bar and invalid zone) */}
          {invalidZonePositions.rightGapWidth > 0 && (
            <Gap
              leftPercent={invalidZonePositions.rightGapStart}
              widthPercent={invalidZonePositions.rightGapWidth}
              side="right"
            />
          )}
          {/* Right invalid zone (after entity end/now plus gap) */}
          {invalidZonePositions.rightInvalidWidth > 0 && (
            <InvalidZone
              leftPercent={invalidZonePositions.rightInvalidStart}
              widthPercent={invalidZonePositions.rightInvalidWidth}
              side="right"
            />
          )}
        </>
      )}

      {/* Histogram bars */}
      {/* CRITICAL: Bars must NOT use inset-0 (100% width) as that covers the gaps */}
      {/* Instead, position bars between gaps using their calculated positions */}
      <div
        className="absolute top-0 bottom-0 flex items-end gap-px"
        style={{
          left: invalidZonePositions
            ? `${invalidZonePositions.leftGapStart + invalidZonePositions.leftGapWidth}%`
            : "0%",
          width: invalidZonePositions
            ? `${invalidZonePositions.rightGapStart - (invalidZonePositions.leftGapStart + invalidZonePositions.leftGapWidth)}%`
            : "100%",
        }}
      >
        {activeBuckets.map((bucket, i) => (
          <StackedBar
            key={`${bucket.timestamp.getTime()}-${i}`}
            bucket={bucket}
            maxTotal={maxTotal}
            onClick={onBucketClick ? () => onBucketClick(bucket) : undefined}
          />
        ))}
      </div>
    </div>
  );
}

export const TimelineHistogram = memo(TimelineHistogramInner);
