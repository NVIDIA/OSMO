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
 * Timeline Container - High-level orchestrator for timeline components
 *
 * ## Responsibilities
 *
 * - State management (useTimelineState)
 * - Gesture handling (wheel, drag, keyboard)
 * - Pan constraint enforcement
 * - Composition of TimelineHistogram + TimelineWindow + TimelineControls
 *
 * ## Architecture (2-Layer Model)
 *
 * Composes two layers:
 * - **Layer 1 (pannable):** TimelineHistogram (bars + invalid zones) - transforms together
 * - **Layer 2 (fixed):** TimelineWindow (overlays + draggers) - stays in place
 *
 * ## Public API
 *
 * This is the main component exported from the timeline module.
 * Consumers should use TimelineContainer, not TimelineHistogram directly.
 */

"use client";

import { memo, useMemo, useState, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import { formatTime24ShortUTC } from "@/lib/format-date";
import type { HistogramBucket } from "@/lib/api/log-adapter";
import { ChevronUp, ChevronDown } from "lucide-react";
import { TimelineHistogram } from "./TimelineHistogram";
import { TimeRangePresets } from "./TimeRangePresets";
import { TimeRangeHeader } from "./TimeRangeHeader";
import { useTimelineState } from "../hooks/use-timeline-state";
import { useTimelineWheelGesture } from "../hooks/use-timeline-gestures";
import { useTick, useTickController } from "@/hooks/use-tick";
import { isEndTimeNow as checkIsEndTimeNow } from "../lib/timeline-utils";
import { DEFAULT_HEIGHT, type TimeRangePreset } from "../lib/timeline-constants";

// =============================================================================
// Types
// =============================================================================

export interface TimelineContainerProps {
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
  /**
   * Synchronized "NOW" timestamp (milliseconds since epoch).
   * Optional - if not provided, will auto-synchronize using useTick() when workflow is running.
   * Useful when parent component already uses useTick() to avoid duplicate tick subscriptions.
   */
  now?: number;
}

// Re-export TimeRangePreset for consumers
export type { TimeRangePreset };

// =============================================================================
// Hooks
// =============================================================================

/**
 * Hook to compute time axis labels.
 * CRITICAL: Use currentDisplay (viewport) not currentEffective (data range)
 */
function useTimeLabels(currentDisplay: { start: Date; end: Date }, isEndTimeNow: boolean) {
  const startLabel = useMemo(() => {
    return formatTime24ShortUTC(currentDisplay.start);
  }, [currentDisplay.start]);

  const endLabel = useMemo(() => {
    if (isEndTimeNow) return "NOW";
    return formatTime24ShortUTC(currentDisplay.end);
  }, [isEndTimeNow, currentDisplay.end]);

  return { startLabel, endLabel };
}

// =============================================================================
// Sub-components
// =============================================================================

interface CollapseButtonProps {
  isCollapsed: boolean;
  onToggle: () => void;
  className?: string;
}

function CollapseButton({ isCollapsed, onToggle, className }: CollapseButtonProps): React.ReactNode {
  return (
    <button
      onClick={onToggle}
      className={cn(
        "text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs transition-colors",
        className,
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
  );
}

// =============================================================================
// Empty State Component
// =============================================================================

interface TimelineEmptyStateProps {
  height: number;
  className?: string;
  showTimeRangeHeader: boolean;
  showPresets: boolean;
  headerProps: {
    startTime?: Date;
    endTime?: Date;
    onStartTimeChange?: (date: Date) => void;
    onEndTimeChange?: (date: Date) => void;
    activePreset?: TimeRangePreset;
    onPresetSelect?: (preset: TimeRangePreset) => void;
  };
}

function TimelineEmptyState({
  height,
  className,
  showTimeRangeHeader,
  showPresets,
  headerProps,
}: TimelineEmptyStateProps): React.ReactNode {
  return (
    <div className={cn("space-y-4", className)}>
      {showTimeRangeHeader && (
        <TimeRangeHeader
          startTime={headerProps.startTime}
          endTime={headerProps.endTime}
          onStartTimeChange={headerProps.onStartTimeChange}
          onEndTimeChange={headerProps.onEndTimeChange}
          showPresets={showPresets}
          activePreset={headerProps.activePreset}
          onPresetSelect={headerProps.onPresetSelect}
        />
      )}
      {!showTimeRangeHeader && showPresets && (
        <TimeRangePresets
          activePreset={headerProps.activePreset}
          onPresetSelect={headerProps.onPresetSelect}
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

// =============================================================================
// Main Component
// =============================================================================

function TimelineContainerInner({
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
  entityStartTime,
  entityEndTime,
  now,
}: TimelineContainerProps): React.ReactNode {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const containerRef = useRef<HTMLDivElement>(null);

  // ============================================================================
  // SYNCHRONIZED NOW TIMESTAMP
  // ============================================================================

  // Enable synchronized ticking when workflow is running (no entityEndTime)
  // This ensures right invalid zone calculation uses fresh NOW
  useTickController(entityEndTime === undefined);

  // Get synchronized "NOW" timestamp
  // - If `now` prop is provided (from parent like LogViewer): use it
  // - Otherwise: use useTick() for standalone usage
  const tickNow = useTick();
  const synchronizedNow = now ?? tickNow;

  // Use pending buckets if available, otherwise committed buckets
  const activeBuckets = pendingBuckets ?? buckets;

  // Check if end time is considered "NOW"
  const isEndTimeNow = checkIsEndTimeNow(endTime);

  // ============================================================================
  // STATE MANAGEMENT
  // ============================================================================

  const timelineState = useTimelineState({
    startTime,
    endTime,
    displayStart,
    displayEnd,
    entityStartTime,
    entityEndTime,
    buckets: activeBuckets,
    now: synchronizedNow,
  });

  const { currentDisplay, currentEffective: _currentEffective, hasPendingChanges } = timelineState;

  // ============================================================================
  // DERIVED VALUES
  // ============================================================================

  const { startLabel, endLabel } = useTimeLabels(currentDisplay, isEndTimeNow);

  // ============================================================================
  // GESTURES
  // ============================================================================

  // Extract bucket timestamps for invalid zone validation
  const bucketTimestamps = useMemo(() => activeBuckets.map((b) => b.timestamp), [activeBuckets]);

  useTimelineWheelGesture(containerRef, timelineState, bucketTimestamps, onDisplayRangeChange ?? (() => {}), {
    entityStartTime,
    entityEndTime,
    now: synchronizedNow,
    overlayPositions: undefined, // Disabled during simplification
  });

  // ============================================================================
  // CALLBACKS
  // ============================================================================

  const handleToggleCollapse = useCallback(() => {
    setIsCollapsed((prev) => !prev);
  }, []);

  // ============================================================================
  // EMPTY STATE
  // ============================================================================

  const showEmptyMessage = activeBuckets.length === 0 && !entityStartTime;

  if (showEmptyMessage) {
    return (
      <TimelineEmptyState
        height={height}
        className={className}
        showTimeRangeHeader={showTimeRangeHeader}
        showPresets={showPresets}
        headerProps={{
          startTime,
          endTime,
          onStartTimeChange,
          onEndTimeChange,
          activePreset,
          onPresetSelect,
        }}
      />
    );
  }

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div className={cn(className)}>
      {/* Header row with presets, controls, and collapse button */}
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

        <CollapseButton
          isCollapsed={isCollapsed}
          onToggle={handleToggleCollapse}
          className={!hasPendingChanges ? "ml-auto" : undefined}
        />
      </div>

      {/* Collapsible histogram area */}
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
              {/* Layer 1: Pannable content (TimelineHistogram) */}
              <TimelineHistogram
                buckets={activeBuckets}
                pendingBuckets={pendingBuckets}
                displayStart={displayStart}
                displayEnd={displayEnd}
                currentDisplay={currentDisplay}
                entityStartTime={entityStartTime}
                entityEndTime={entityEndTime}
                now={synchronizedNow}
                onBucketClick={onBucketClick}
              />
            </div>

            {customControls && <div className="absolute bottom-1 left-1">{customControls}</div>}
          </div>

          {/* Time axis labels */}
          <div className="text-muted-foreground flex justify-between pb-2 text-[10px] tabular-nums">
            <span>{startLabel}</span>
            <span>{endLabel ?? "NOW"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export const TimelineContainer = memo(TimelineContainerInner);
