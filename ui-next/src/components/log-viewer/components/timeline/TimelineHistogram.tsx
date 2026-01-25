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
 * - Bars are dimmed when outside effective range (controlled by draggers)
 *
 * ## Usage
 *
 * This is NOT a public component. Use TimelineContainer instead.
 * TimelineContainer orchestrates state, gestures, and composition.
 */

"use client";

import { memo, useMemo } from "react";
import { cn } from "@/lib/utils";
import type { HistogramBucket } from "@/lib/api/log-adapter";
import { LOG_LEVELS, LOG_LEVEL_STYLES, LOG_LEVEL_LABELS } from "@/lib/api/log-adapter";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import { formatDateTimeFullUTC } from "@/lib/format-date";
import type { TimelineBounds } from "./timeline-utils";

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
  /** Pan boundaries (entity start/end) */
  panBoundaries: TimelineBounds | null;
  /** Current effective range (for dimming bars) */
  currentEffective: { start: Date | undefined; end: Date | undefined };
  /** Whether interactive draggers are enabled (affects dimming logic) */
  enableInteractiveDraggers: boolean;
  /** Entity start time */
  entityStartTime?: Date;
  /** Entity end time */
  entityEndTime?: Date;
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
        "transition-all duration-200 ease-out",
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
          className={`relative flex-1 cursor-pointer transition-opacity duration-75 ${
            !dimmed ? "opacity-85 hover:opacity-100" : "opacity-50"
          }`}
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
// Main Component
// =============================================================================

function TimelineHistogramInner({
  buckets,
  pendingBuckets,
  displayStart,
  displayEnd,
  currentDisplay,
  panBoundaries,
  currentEffective,
  enableInteractiveDraggers,
  entityStartTime: _entityStartTime,
  entityEndTime: _entityEndTime,
  onBucketClick,
}: TimelineHistogramProps) {
  // Use pending buckets if available, otherwise committed buckets
  const activeBuckets = pendingBuckets ?? buckets;

  // ============================================================================
  // INVALID ZONE POSITIONS (Layer 1: based on original display range)
  // ============================================================================

  const invalidZonePositions = useMemo(() => {
    if (!panBoundaries) return null;

    // Use original (committed) display range, not current (which includes pending pans)
    // This ensures invalid zones transform together with bars as a single pannable layer
    const originalStart = displayStart ?? buckets[0]?.timestamp;
    const originalEnd = displayEnd ?? buckets[buckets.length - 1]?.timestamp;
    if (!originalStart || !originalEnd) return null;

    const displayStartMs = originalStart.getTime();
    const displayEndMs = originalEnd.getTime();
    const displayRangeMs = displayEndMs - displayStartMs;
    if (displayRangeMs <= 0) return null;

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
  }, [panBoundaries, displayStart, displayEnd, buckets]);

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
  // DIMMING LOGIC
  // ============================================================================

  const maxTotal = useMemo(() => {
    let max = 0;
    for (const bucket of activeBuckets) {
      if (bucket.total > max) max = bucket.total;
    }
    return max;
  }, [activeBuckets]);

  const shouldDimBucket = useMemo(() => {
    // Return a function that checks if a bucket should be dimmed
    return (bucket: HistogramBucket): boolean => {
      // Without draggers, rely on bucket's own property
      if (!enableInteractiveDraggers) {
        return bucket.isInEffectiveRange === false;
      }

      // With draggers, check if bucket is outside effective range
      const bucketMs = bucket.timestamp.getTime();
      const startMs = currentEffective.start?.getTime();
      const endMs = currentEffective.end?.getTime();

      return (startMs !== undefined && bucketMs < startMs) || (endMs !== undefined && bucketMs > endMs);
    };
  }, [enableInteractiveDraggers, currentEffective.start, currentEffective.end]);

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div
      className="absolute inset-0 transition-transform duration-200 ease-out"
      style={barTransform ? { transform: barTransform } : undefined}
      data-layer="pannable"
    >
      {/* Invalid zones - part of pannable layer */}
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

      {/* Histogram bars */}
      <div className="absolute inset-0 flex items-end gap-px">
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
    </div>
  );
}

export const TimelineHistogram = memo(TimelineHistogramInner);
