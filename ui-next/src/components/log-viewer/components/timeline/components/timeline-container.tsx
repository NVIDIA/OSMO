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
 * - **Layer 1 (pannable):** TimelineHistogram (bars) - transforms together
 * - **Layer 2 (fixed):** Markers, selection overlay - stays in place
 *
 * ## Time Semantics (5 Concepts)
 *
 * - **entityStartTime**: REALITY - When workflow actually started (GUARANTEED)
 * - **entityEndTime**: REALITY - When workflow ended (undefined = running)
 * - **filterStartTime**: USER INTENT - Show logs from this time (undefined = from beginning)
 * - **filterEndTime**: USER INTENT - Show logs to this time (undefined = live mode/NOW)
 * - **now**: REFERENCE - Synchronized timestamp for calculations
 *
 * ## Public API
 *
 * This is the main component exported from the timeline module.
 * Consumers should use TimelineContainer, not TimelineHistogram directly.
 */

"use client";

import { memo, useMemo, useState, useRef, useCallback, useImperativeHandle, forwardRef } from "react";
import { cn } from "@/lib/utils";
import type { HistogramBucket } from "@/lib/api/log-adapter/types";
import { ChevronUp, ChevronDown } from "lucide-react";
import { TimelineHistogram } from "@/components/log-viewer/components/timeline/components/timeline-histogram";
import { TimeRangePresets } from "@/components/log-viewer/components/timeline/components/time-range-presets";
import { TimeRangeHeader } from "@/components/log-viewer/components/timeline/components/time-range-header";
import { TimelineAxis } from "@/components/log-viewer/components/timeline/components/timeline-axis";
import { TimelineSelectionOverlay } from "@/components/log-viewer/components/timeline/components/timeline-selection-overlay";
import { TimelineStartMarker } from "@/components/log-viewer/components/timeline/components/timeline-start-marker";
import { TimelineEndMarker } from "@/components/log-viewer/components/timeline/components/timeline-end-marker";
import { useTimelineSelection } from "@/components/log-viewer/components/timeline/hooks/use-timeline-selection";
import { useTimelineState } from "@/components/log-viewer/components/timeline/hooks/use-timeline-state";
import {
  useTimelineWheelGesture,
  useTimelineZoomControls,
} from "@/components/log-viewer/components/timeline/hooks/use-timeline-gestures";
import {
  DEFAULT_HEIGHT,
  type TimeRangePreset,
} from "@/components/log-viewer/components/timeline/lib/timeline-constants";
import { calculateBucketWidth } from "@/components/log-viewer/components/timeline/lib/invalid-zones";

const NOOP_DISPLAY_RANGE_CHANGE = (_start: Date, _end: Date): void => {};

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
  /** USER INTENT: Filter logs from this time (undefined = from beginning) */
  filterStartTime?: Date;
  /** USER INTENT: Filter logs to this time (undefined = live mode/NOW) */
  filterEndTime?: Date;
  /** Display range start (with padding) */
  displayStart?: Date;
  /** Display range end (with padding) */
  displayEnd?: Date;
  /** Callback when filter start time changes (on Apply) */
  onFilterStartTimeChange?: (date: Date | undefined) => void;
  /** Callback when filter end time changes (on Apply) */
  onFilterEndTimeChange?: (date: Date | undefined) => void;
  /** Callback when display range changes (real-time during pan/zoom for bucket re-query) */
  onDisplayRangeChange?: (start: Date, end: Date) => void;
  /** Whether to show the time range header (default: false) */
  showTimeRangeHeader?: boolean;
  /** Whether to enable interactive draggers (default: false) */
  enableInteractiveDraggers?: boolean;
  /**
   * REALITY: Entity start time (workflow/group/task start) - hard lower bound for panning.
   * GUARANTEED: log-viewer only loads when workflow has started (start_time exists).
   */
  entityStartTime: Date;
  /**
   * REALITY: Entity end time (completion timestamp) - undefined if still running.
   */
  entityEndTime?: Date;
  /**
   * REFERENCE: Synchronized "NOW" timestamp (milliseconds since epoch) from useTick().
   * REQUIRED for time consistency across all timeline calculations.
   *
   * For running workflows: useTick() (updates every 1s)
   * For terminated workflows: entityEndTime.getTime() (frozen at completion)
   */
  now: number;
}

// Re-export TimeRangePreset for consumers
export type { TimeRangePreset };

// Imperative handle for zoom controls
export interface TimelineContainerHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  canZoomIn: boolean;
  canZoomOut: boolean;
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
// Main Component
// =============================================================================

function TimelineContainerInner(
  {
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
    filterStartTime,
    filterEndTime,
    displayStart,
    displayEnd,
    onFilterStartTimeChange,
    onFilterEndTimeChange,
    onDisplayRangeChange,
    showTimeRangeHeader = false,
    entityStartTime,
    entityEndTime,
    now,
  }: TimelineContainerProps,
  ref: React.Ref<TimelineContainerHandle>,
): React.ReactNode {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const containerRef = useRef<HTMLDivElement>(null);

  const activeBuckets = pendingBuckets ?? buckets;

  // ============================================================================
  // STATE MANAGEMENT
  // ============================================================================

  const timelineState = useTimelineState({
    filterStartTime,
    filterEndTime,
    displayStart,
    displayEnd,
    entityStartTime,
    entityEndTime,
    buckets: activeBuckets,
    now,
  });

  const { currentDisplay, hasPendingChanges } = timelineState;

  // ============================================================================
  // GESTURES
  // ============================================================================

  // Extract bucket timestamps for constraint validation
  const bucketTimestamps = useMemo(() => activeBuckets.map((b) => b.timestamp), [activeBuckets]);

  // PERF (P0): Compute bucket width ONCE here and pass down to children.
  // Previously each consumer (TimelineHistogram, TimelineAxis) computed this independently.
  const bucketWidthMs = useMemo(() => calculateBucketWidth(bucketTimestamps), [bucketTimestamps]);

  // PERF (P1): Memoize debugContext to avoid creating a new object every render.
  // This object is passed to useTimelineWheelGesture and useTimelineZoomControls
  // which use it in useMemo/useCallback dependency arrays.
  const debugContext = useMemo(() => ({ entityStartTime, entityEndTime, now }), [entityStartTime, entityEndTime, now]);

  const displayRangeHandler = onDisplayRangeChange ?? NOOP_DISPLAY_RANGE_CHANGE;

  useTimelineWheelGesture(containerRef, timelineState, bucketTimestamps, displayRangeHandler, debugContext);

  const zoomControls = useTimelineZoomControls(timelineState, bucketTimestamps, displayRangeHandler, debugContext);

  // Expose zoom controls to parent via imperative handle
  useImperativeHandle(ref, () => zoomControls, [zoomControls]);

  // Drag-to-select functionality
  const handleSelectionCommit = useCallback(
    (startTime: Date, endTime: Date) => {
      onFilterStartTimeChange?.(startTime);
      onFilterEndTimeChange?.(endTime);
    },
    [onFilterStartTimeChange, onFilterEndTimeChange],
  );

  const { selectionRange, isDragging } = useTimelineSelection({
    containerRef,
    displayStart: currentDisplay.start,
    displayEnd: currentDisplay.end,
    onSelectionCommit: handleSelectionCommit,
    enabled: true,
  });

  // ============================================================================
  // CALLBACKS
  // ============================================================================

  const handleToggleCollapse = useCallback(() => {
    setIsCollapsed((prev) => !prev);
  }, []);

  return (
    <div className={className}>
      {/* Header row with presets, controls, and collapse button */}
      <div className="flex items-center justify-between gap-2">
        {showTimeRangeHeader && (
          <TimeRangeHeader
            filterStartTime={filterStartTime}
            filterEndTime={filterEndTime}
            onFilterStartTimeChange={onFilterStartTimeChange}
            onFilterEndTimeChange={onFilterEndTimeChange}
            showPresets={showPresets}
            activePreset={activePreset}
            onPresetSelect={onPresetSelect}
            minStartTime={entityStartTime}
            maxEndTime={entityEndTime}
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
        <div className="pt-4">
          <div className="relative">
            {/* PERF (P1): CSS containment and overscroll-behavior on gesture container.
                - contain: layout style paint - tells browser this subtree is isolated,
                  enabling paint optimizations during pan/zoom.
                - overscroll-behavior: contain - prevents scroll chaining to parent
                  when wheel events reach the edge of the timeline range.
                - touch-action: none - prevents browser default touch gestures
                  (pan, pinch) from interfering with our custom gesture handling. */}
            <div
              ref={containerRef}
              className="relative cursor-crosshair"
              style={{
                height: `${height}px`,
                contain: "layout style paint",
                overscrollBehavior: "contain",
                touchAction: "none",
              }}
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
                now={now}
                onBucketClick={onBucketClick}
                bucketWidthMs={bucketWidthMs}
                isGesturing={hasPendingChanges}
              />

              {/* Layer 2: Selection overlay */}
              <TimelineSelectionOverlay
                selectionRange={selectionRange}
                isDragging={isDragging}
              />
            </div>

            {customControls && <div className="absolute bottom-1 left-1">{customControls}</div>}
          </div>

          {/* Time axis with intelligent ticks */}
          <div className="relative">
            <TimelineAxis
              displayStart={currentDisplay.start}
              displayEnd={currentDisplay.end}
              buckets={activeBuckets}
              bucketWidthMs={bucketWidthMs}
            />

            {/* Entity markers on the axis */}
            <div className="absolute inset-0">
              <TimelineStartMarker
                entityStartTime={entityStartTime}
                displayStart={currentDisplay.start}
                displayEnd={currentDisplay.end}
              />
              <TimelineEndMarker
                entityEndTime={entityEndTime}
                now={now}
                displayStart={currentDisplay.start}
                displayEnd={currentDisplay.end}
                buckets={activeBuckets}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export const TimelineContainer = memo(
  forwardRef<TimelineContainerHandle, TimelineContainerProps>(TimelineContainerInner),
);
