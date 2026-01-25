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
 * Timeline Mouse Wheel Hook
 *
 * Handles mouse wheel interactions for the timeline histogram:
 * - Mouse wheel: Pan left/right (wheel up = pan left, wheel down = pan right)
 * - Cmd/Ctrl+wheel: Zoom in/out (wheel up = zoom in, wheel down = zoom out)
 *
 * Both interactions trigger pending state (not committed until Apply).
 *
 * ## Pan Behavior
 * - Wheel up → pan left (show older logs)
 * - Wheel down → pan right (show newer logs)
 * - Pan amount: 10% of visible range per wheel tick
 *
 * ## Zoom Behavior
 * - Cmd/Ctrl+wheel up → zoom in (narrow range by 20%)
 * - Cmd/Ctrl+wheel down → zoom out (widen range by 25%)
 * - Zoom preserves center point
 * - Respects minimum range (1 minute)
 * - Right boundary cannot exceed NOW in live mode
 */

import { useCallback, useEffect } from "react";

// =============================================================================
// Constants
// =============================================================================

/**
 * Pan amount as fraction of visible range (10% per wheel tick).
 */
const PAN_FACTOR = 0.1;

/**
 * Zoom in factor (narrow by 20%).
 */
const ZOOM_IN_FACTOR = 0.8;

/**
 * Zoom out factor (widen by 25%).
 */
const ZOOM_OUT_FACTOR = 1.25;

/**
 * Minimum range in milliseconds (1 minute).
 */
const MIN_RANGE_MS = 60_000;

// =============================================================================
// Types
// =============================================================================

export interface UseTimelineWheelOptions {
  /** Container element ref */
  containerRef: React.RefObject<HTMLElement | null>;
  /** Whether wheel interactions are enabled */
  enabled?: boolean;
  /** Display range start */
  displayStart: Date;
  /** Display range end */
  displayEnd: Date;
  /** Current effective start time */
  effectiveStart: Date | undefined;
  /** Current effective end time */
  effectiveEnd: Date | undefined;
  /** Whether end time is NOW (blocks extending past NOW) */
  isEndTimeNow: boolean;
  /** Callback when pending range changes (zoom/dragger) */
  onPendingRangeChange: (start: Date | undefined, end: Date | undefined) => void;
  /** Callback when pending display changes (pan/zoom) */
  onPendingDisplayChange: (displayStart: Date, displayEnd: Date) => void;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook for handling mouse wheel interactions on timeline.
 */
export function useTimelineWheel({
  containerRef,
  enabled = true,
  displayStart,
  displayEnd,
  effectiveStart,
  effectiveEnd,
  isEndTimeNow,
  onPendingRangeChange,
  onPendingDisplayChange,
}: UseTimelineWheelOptions): void {
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      if (!enabled) return;

      // Determine if this is a zoom gesture (cmd/ctrl held)
      const isZoom = e.metaKey || e.ctrlKey;

      // Prevent default scroll behavior
      e.preventDefault();

      // Get current effective range
      const startMs = effectiveStart?.getTime();
      const endMs = effectiveEnd?.getTime();
      const now = Date.now();

      // If both are undefined, can't do anything
      if (startMs === undefined && endMs === undefined) return;

      // Determine actual boundaries
      const actualStartMs = startMs ?? now - 60 * 60 * 1000; // Default: 1 hour ago
      const actualEndMs = endMs ?? now; // Default: NOW

      const rangeMs = actualEndMs - actualStartMs;

      if (isZoom) {
        // Zoom in/out: Adjust display range centered on histogram middle
        // Draggers stay at same pixel positions, bars change scale
        const isZoomIn = e.deltaY < 0;
        const factor = isZoomIn ? ZOOM_IN_FACTOR : ZOOM_OUT_FACTOR;

        // Calculate new display range
        const displayRangeMs = displayEnd.getTime() - displayStart.getTime();
        const newDisplayRangeMs = displayRangeMs * factor;

        // Respect minimum range
        if (newDisplayRangeMs < MIN_RANGE_MS) return;

        // Use the center of the DISPLAY range as the zoom origin
        const displayCenterMs = (displayStart.getTime() + displayEnd.getTime()) / 2;
        const newDisplayStartMs = displayCenterMs - newDisplayRangeMs / 2;
        const newDisplayEndMs = displayCenterMs + newDisplayRangeMs / 2;

        // Apply pending display change (draggers stay in place, histogram rescales)
        onPendingDisplayChange(new Date(newDisplayStartMs), new Date(newDisplayEndMs));
      } else {
        // Pan left/right (shifts display window only, effective range stays same)
        const isPanLeft = e.deltaY < 0;
        const displayRangeMs = displayEnd.getTime() - displayStart.getTime();
        const panAmountMs = displayRangeMs * PAN_FACTOR;
        const deltaMs = isPanLeft ? -panAmountMs : panAmountMs;

        const newDisplayStartMs = displayStart.getTime() + deltaMs;
        const newDisplayEndMs = displayEnd.getTime() + deltaMs;

        // For now, we allow panning freely - backend will clamp to available data
        // In the future, we could constrain based on bucket boundaries

        // Apply pending display change (histogram slides, draggers stay in place)
        onPendingDisplayChange(new Date(newDisplayStartMs), new Date(newDisplayEndMs));
      }
    },
    [enabled, displayStart, displayEnd, effectiveStart, effectiveEnd, isEndTimeNow, onPendingRangeChange, onPendingDisplayChange],
  );

  // Attach wheel event listener
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return;

    // Add passive: false to allow preventDefault
    container.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      container.removeEventListener("wheel", handleWheel);
    };
  }, [containerRef, enabled, handleWheel]);
}
