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
 * Timeline Axis - Intelligent time axis with adaptive tick generation
 *
 * Features:
 * - Adaptive tick intervals based on zoom level
 * - Smart label formatting (time-only vs date+time)
 * - Always shows midnight crossings
 * - Even spacing at all zoom levels
 * - Subtle visual design
 */

"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { HistogramBucket } from "@/lib/api/log-adapter/types";
import { calculateBucketWidth } from "@/components/log-viewer/components/timeline/lib/invalid-zones";

// =============================================================================
// Types
// =============================================================================

interface Tick {
  /** Timestamp in milliseconds */
  timestamp: number;
  /** Position as percentage (0-100) */
  position: number;
  /** Label text to display */
  label: string;
  /** Whether this is a major tick (midnight crossing) */
  isMajor: boolean;
}

export interface TimelineAxisProps {
  /** Display range start */
  displayStart: Date;
  /** Display range end */
  displayEnd: Date;
  /** Histogram buckets for calculating center alignment offset */
  buckets: HistogramBucket[];
  /** Pre-computed bucket width in milliseconds (from TimelineContainer) */
  bucketWidthMs?: number;
  /** Additional CSS classes */
  className?: string;
}

// =============================================================================
// Tick Generation Logic
// =============================================================================

/**
 * Nice time intervals in milliseconds for different zoom levels.
 * Ordered from smallest to largest.
 */
const TICK_INTERVALS = [
  { ms: 1 * 60 * 1000, label: "1min" }, // 1 minute
  { ms: 5 * 60 * 1000, label: "5min" }, // 5 minutes
  { ms: 15 * 60 * 1000, label: "15min" }, // 15 minutes
  { ms: 30 * 60 * 1000, label: "30min" }, // 30 minutes
  { ms: 1 * 60 * 60 * 1000, label: "1h" }, // 1 hour
  { ms: 3 * 60 * 60 * 1000, label: "3h" }, // 3 hours
  { ms: 6 * 60 * 60 * 1000, label: "6h" }, // 6 hours
  { ms: 12 * 60 * 60 * 1000, label: "12h" }, // 12 hours
  { ms: 24 * 60 * 60 * 1000, label: "1d" }, // 1 day
  { ms: 2 * 24 * 60 * 60 * 1000, label: "2d" }, // 2 days
  { ms: 7 * 24 * 60 * 60 * 1000, label: "1w" }, // 1 week
];

/**
 * Target number of ticks to display (for good legibility).
 */
const TARGET_TICK_COUNT = 8;

/**
 * Selects an appropriate tick interval based on the time range.
 * Returns the interval that produces closest to TARGET_TICK_COUNT ticks.
 */
function selectTickInterval(rangeMs: number): number {
  let bestInterval = TICK_INTERVALS[0].ms;
  let bestDiff = Math.abs(rangeMs / bestInterval - TARGET_TICK_COUNT);

  for (const { ms } of TICK_INTERVALS) {
    const tickCount = rangeMs / ms;
    const diff = Math.abs(tickCount - TARGET_TICK_COUNT);

    if (diff < bestDiff) {
      bestDiff = diff;
      bestInterval = ms;
    }
  }

  return bestInterval;
}

/**
 * Checks if a timestamp is at midnight UTC.
 */
function isMidnight(timestamp: number): boolean {
  const date = new Date(timestamp);
  return date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0;
}

/**
 * Rounds a timestamp down to the nearest interval.
 */
function roundDownToInterval(timestamp: number, intervalMs: number): number {
  return Math.floor(timestamp / intervalMs) * intervalMs;
}

/**
 * Static month abbreviation lookup.
 * PERF (P2): Replaces `date.toLocaleString("en-US", { month: "short", timeZone: "UTC" })`
 * which is ~40x slower due to Intl formatting overhead.
 */
const UTC_MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/**
 * Formats a date for axis labels.
 * - Time-only for regular ticks: "14:30"
 * - Date+Time for midnight crossings: "Jan 15 00:00"
 */
function formatTickLabel(timestamp: number, isMajor: boolean): string {
  const date = new Date(timestamp);

  if (isMajor) {
    // Midnight crossing: show date + time
    const month = UTC_MONTH_SHORT[date.getUTCMonth()];
    const day = date.getUTCDate();
    const hours = date.getUTCHours().toString().padStart(2, "0");
    const minutes = date.getUTCMinutes().toString().padStart(2, "0");
    return `${month} ${day} ${hours}:${minutes}`;
  } else {
    // Regular tick: time only
    const hours = date.getUTCHours().toString().padStart(2, "0");
    const minutes = date.getUTCMinutes().toString().padStart(2, "0");
    return `${hours}:${minutes}`;
  }
}

/**
 * Generates ticks for the time axis.
 */
function generateTicks(displayStart: Date, displayEnd: Date): Tick[] {
  const startMs = displayStart.getTime();
  const endMs = displayEnd.getTime();
  const rangeMs = endMs - startMs;

  // Select appropriate interval
  const intervalMs = selectTickInterval(rangeMs);

  // Generate ticks at regular intervals
  const ticks: Tick[] = [];
  let currentMs = roundDownToInterval(startMs, intervalMs);

  // Ensure we start from a visible tick
  if (currentMs < startMs) {
    currentMs += intervalMs;
  }

  // Track the last midnight we've seen
  let lastMidnightMs: number | null = null;

  while (currentMs <= endMs) {
    const position = ((currentMs - startMs) / rangeMs) * 100;

    // Check if this is a midnight crossing
    const isCurrentMidnight = isMidnight(currentMs);
    const isMajor = isCurrentMidnight && currentMs !== lastMidnightMs;

    if (isCurrentMidnight) {
      lastMidnightMs = currentMs;
    }

    ticks.push({
      timestamp: currentMs,
      position,
      label: formatTickLabel(currentMs, isMajor),
      isMajor,
    });

    currentMs += intervalMs;
  }

  // CRITICAL: Always include midnight crossings between ticks
  // Find all midnights in the range that aren't already ticks
  const tickTimestamps = new Set(ticks.map((t) => t.timestamp));
  let checkMs = roundDownToInterval(startMs, 24 * 60 * 60 * 1000); // Start of day

  while (checkMs <= endMs) {
    if (isMidnight(checkMs) && !tickTimestamps.has(checkMs) && checkMs >= startMs) {
      const position = ((checkMs - startMs) / rangeMs) * 100;
      ticks.push({
        timestamp: checkMs,
        position,
        label: formatTickLabel(checkMs, true),
        isMajor: true,
      });
    }
    checkMs += 24 * 60 * 60 * 1000; // Next day
  }

  // Sort by position
  return ticks.sort((a, b) => a.position - b.position);
}

// =============================================================================
// Component
// =============================================================================

export function TimelineAxis({
  displayStart,
  displayEnd,
  buckets,
  bucketWidthMs: bucketWidthMsProp,
  className,
}: TimelineAxisProps): React.ReactNode {
  const ticks = useMemo(() => generateTicks(displayStart, displayEnd), [displayStart, displayEnd]);

  // PERF (P0): Use pre-computed bucketWidthMs from props when available,
  // falling back to local calculation for standalone usage.
  const resolvedBucketWidthMs = useMemo(() => {
    if (bucketWidthMsProp !== undefined) return bucketWidthMsProp;
    if (buckets.length < 2) return 0;
    const bucketTimestamps = buckets.map((b) => b.timestamp);
    return calculateBucketWidth(bucketTimestamps);
  }, [bucketWidthMsProp, buckets]);

  // Calculate bucket width for center alignment offset
  const centerOffsetPercent = useMemo(() => {
    if (resolvedBucketWidthMs === 0) return 0;

    const displayStartMs = displayStart.getTime();
    const displayEndMs = displayEnd.getTime();
    const displayRangeMs = displayEndMs - displayStartMs;

    if (displayRangeMs <= 0) return 0;

    // Shift ticks by half bucket width to center them on bars
    const halfBucketWidthMs = resolvedBucketWidthMs / 2;
    return (halfBucketWidthMs / displayRangeMs) * 100;
  }, [resolvedBucketWidthMs, displayStart, displayEnd]);

  return (
    <div className={cn("relative h-6 w-full", className)}>
      {/* Baseline */}
      <div className="bg-border absolute top-0 h-px w-full" />

      {/* Ticks */}
      {ticks.map((tick, index) => (
        <div
          key={`${tick.timestamp}-${index}`}
          className="absolute top-0"
          style={{ left: `${tick.position + centerOffsetPercent}%` }}
        >
          {/* Tick mark */}
          <div className={cn("bg-border absolute left-0", tick.isMajor ? "h-3 w-px" : "h-2 w-px")} />

          {/* Label - closer to axis */}
          <div
            className={cn(
              "text-muted-foreground absolute top-3 -translate-x-1/2 text-[10px] whitespace-nowrap tabular-nums",
              tick.isMajor ? "font-medium" : "opacity-70",
            )}
          >
            {tick.label}
          </div>
        </div>
      ))}
    </div>
  );
}
