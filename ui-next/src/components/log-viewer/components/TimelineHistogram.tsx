// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import { memo, useMemo } from "react";
import { cn } from "@/lib/utils";
import { formatTime24Short } from "@/lib/format-date";
import type { HistogramBucket, LogLevel } from "@/lib/api/log-adapter";
import { LOG_LEVELS, LOG_LEVEL_STYLES, LOG_LEVEL_LABELS } from "@/lib/api/log-adapter";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import { HISTOGRAM_HEIGHT, HISTOGRAM_BAR_GAP, HISTOGRAM_MIN_BAR_WIDTH } from "../lib/constants";

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
  /** Height of the histogram in pixels (defaults to HISTOGRAM_HEIGHT) */
  height?: number;
  /** Whether to show in compact mode (horizontal strip) */
  compact?: boolean;
}

// =============================================================================
// Constants
// =============================================================================

// Levels to show in stacked bars (in order from bottom to top)
// Uses LOG_LEVELS from log-adapter as the single source of truth
const STACKED_LEVELS = LOG_LEVELS;

// =============================================================================
// Tooltip Content
// =============================================================================

interface BucketTooltipProps {
  bucket: HistogramBucket;
}

function BucketTooltipContent({ bucket }: BucketTooltipProps) {
  return (
    <div className="space-y-1">
      <div className="font-medium">{formatTime24Short(bucket.timestamp)}</div>
      <div className="space-y-0.5 text-xs">
        {STACKED_LEVELS.map((level) => {
          const count = bucket.counts[level] ?? 0;
          if (count === 0) return null;
          return (
            <div
              key={level}
              className="flex items-center justify-between gap-4"
            >
              <span className="flex items-center gap-1.5">
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: LOG_LEVEL_STYLES[level].color }}
                />
                {LOG_LEVEL_LABELS[level]}
              </span>
              <span className="font-mono">{count.toLocaleString()}</span>
            </div>
          );
        })}
      </div>
      <div className="border-t pt-1 text-xs font-medium">Total: {bucket.total.toLocaleString()}</div>
    </div>
  );
}

// =============================================================================
// Stacked Bar Component
// =============================================================================

interface StackedBarProps {
  bucket: HistogramBucket;
  x: number;
  width: number;
  maxTotal: number;
  height: number;
  onClick?: () => void;
}

function StackedBar({ bucket, x, width, maxTotal, height, onClick }: StackedBarProps) {
  // Calculate stacked bar segments
  const segments = useMemo(() => {
    if (bucket.total === 0 || maxTotal === 0) return [];

    const normalizedHeight = (bucket.total / maxTotal) * height;
    let currentY = height; // Start from bottom

    const result: { level: LogLevel; y: number; height: number }[] = [];

    for (const level of STACKED_LEVELS) {
      const count = bucket.counts[level] ?? 0;
      if (count === 0) continue;

      const segmentHeight = (count / bucket.total) * normalizedHeight;
      currentY -= segmentHeight;

      result.push({
        level,
        y: currentY,
        height: segmentHeight,
      });
    }

    return result;
  }, [bucket, maxTotal, height]);

  if (segments.length === 0) {
    return null;
  }

  // Use CSS hover instead of useState for better performance
  // SVG :hover works on <g> elements and applies to all children
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <g
          className="cursor-pointer opacity-85 transition-opacity duration-75 hover:opacity-100"
          onClick={onClick}
        >
          {segments.map((segment) => (
            <rect
              key={segment.level}
              x={x}
              y={segment.y}
              width={width}
              height={Math.max(1, segment.height)}
              fill={LOG_LEVEL_STYLES[segment.level].color}
              rx={1}
            />
          ))}
        </g>
      </TooltipTrigger>
      <TooltipContent side="top">
        <BucketTooltipContent bucket={bucket} />
      </TooltipContent>
    </Tooltip>
  );
}

// =============================================================================
// Compact Strip Component
// =============================================================================

interface CompactStripProps {
  buckets: HistogramBucket[];
  onBucketClick?: (bucket: HistogramBucket) => void;
  className?: string;
}

function CompactStrip({ buckets, onBucketClick, className }: CompactStripProps) {
  const totalLogs = useMemo(() => buckets.reduce((sum, b) => sum + b.total, 0), [buckets]);

  // Calculate segment widths proportional to counts
  const segments = useMemo(() => {
    if (totalLogs === 0) return [];

    const result: { level: LogLevel; widthPct: number; count: number }[] = [];

    for (const level of STACKED_LEVELS) {
      let count = 0;
      for (const bucket of buckets) {
        count += bucket.counts[level] ?? 0;
      }
      if (count > 0) {
        result.push({
          level,
          widthPct: (count / totalLogs) * 100,
          count,
        });
      }
    }

    return result;
  }, [buckets, totalLogs]);

  if (segments.length === 0) {
    return (
      <div className={cn("bg-muted h-4 rounded", className)}>
        <span className="sr-only">No logs in histogram</span>
      </div>
    );
  }

  return (
    <div className={cn("flex h-4 overflow-hidden rounded", className)}>
      {segments.map((segment) => (
        <Tooltip key={segment.level}>
          <TooltipTrigger asChild>
            <div
              className="h-full cursor-pointer transition-opacity hover:opacity-90"
              style={{
                width: `${segment.widthPct}%`,
                backgroundColor: LOG_LEVEL_STYLES[segment.level].color,
                minWidth: segment.widthPct > 0 ? 2 : 0,
              }}
              onClick={() => {
                // Find first bucket with this level and click it
                const bucket = buckets.find((b) => (b.counts[segment.level] ?? 0) > 0);
                if (bucket) onBucketClick?.(bucket);
              }}
            />
          </TooltipTrigger>
          <TooltipContent side="top">
            <div className="flex items-center gap-2">
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: LOG_LEVEL_STYLES[segment.level].color }}
              />
              <span>{LOG_LEVEL_LABELS[segment.level]}</span>
              <span className="font-mono">{segment.count.toLocaleString()}</span>
            </div>
          </TooltipContent>
        </Tooltip>
      ))}
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
  height = HISTOGRAM_HEIGHT,
  compact = false,
}: TimelineHistogramProps) {
  // Find max total for scaling
  const maxTotal = useMemo(() => {
    let max = 0;
    for (const bucket of buckets) {
      if (bucket.total > max) max = bucket.total;
    }
    return max;
  }, [buckets]);

  // Generate time axis labels
  const timeLabels = useMemo(() => {
    if (buckets.length === 0) return [];

    // Show 4-5 labels evenly distributed
    const labelCount = Math.min(5, buckets.length);
    const step = Math.floor(buckets.length / labelCount);
    const labels: { time: string; x: number }[] = [];

    for (let i = 0; i < labelCount; i++) {
      const idx = i * step;
      const bucket = buckets[idx];
      if (bucket) {
        labels.push({
          time: formatTime24Short(bucket.timestamp),
          x: (idx / buckets.length) * 100,
        });
      }
    }

    return labels;
  }, [buckets]);

  // Compact mode
  if (compact) {
    return (
      <CompactStrip
        buckets={buckets}
        onBucketClick={onBucketClick}
        className={className}
      />
    );
  }

  // Empty state
  if (buckets.length === 0) {
    return (
      <div
        className={cn("bg-muted text-muted-foreground flex items-center justify-center rounded", className)}
        style={{ height }}
      >
        <span className="text-xs">No data for histogram</span>
      </div>
    );
  }

  // Calculate bar dimensions
  const barWidth = Math.max(HISTOGRAM_MIN_BAR_WIDTH, (100 - buckets.length * HISTOGRAM_BAR_GAP) / buckets.length);
  const chartHeight = height - 20; // Reserve space for time axis

  return (
    <div
      className={cn("w-full", className)}
      style={{ height }}
    >
      <svg
        viewBox={`0 0 100 ${chartHeight}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height: chartHeight }}
        role="img"
        aria-label="Log histogram over time"
      >
        {/* Chart area */}
        {buckets.map((bucket, index) => {
          const x = (index / buckets.length) * 100;
          return (
            <StackedBar
              key={bucket.timestamp.getTime()}
              bucket={bucket}
              x={x}
              width={barWidth}
              maxTotal={maxTotal}
              height={chartHeight}
              onClick={onBucketClick ? () => onBucketClick(bucket) : undefined}
            />
          );
        })}
      </svg>

      {/* Time axis */}
      <div className="relative mt-1 h-4">
        {timeLabels.map((label, i) => (
          <span
            key={i}
            className="text-muted-foreground absolute -translate-x-1/2 text-[10px] tabular-nums"
            style={{ left: `${label.x}%` }}
          >
            {label.time}
          </span>
        ))}
      </div>
    </div>
  );
}

export const TimelineHistogram = memo(TimelineHistogramInner);
