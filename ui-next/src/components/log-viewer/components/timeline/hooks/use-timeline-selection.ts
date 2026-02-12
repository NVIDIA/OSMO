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
 * Timeline Selection Hook
 *
 * Handles drag-to-select gestures on the timeline.
 * Converts mouse coordinates to time ranges and updates filter state.
 */

import { useCallback, useRef, useState, useEffect } from "react";

// =============================================================================
// Types
// =============================================================================

export interface SelectionRange {
  /** Start position as percentage (0-100) */
  startPercent: number;
  /** End position as percentage (0-100) */
  endPercent: number;
  /** Start time in milliseconds */
  startTime: number;
  /** End time in milliseconds */
  endTime: number;
}

export interface UseTimelineSelectionParams {
  /** Container element ref */
  containerRef: React.RefObject<HTMLElement | null>;
  /** Display range start */
  displayStart: Date;
  /** Display range end */
  displayEnd: Date;
  /** Callback when selection is committed */
  onSelectionCommit?: (startTime: Date, endTime: Date) => void;
  /** Whether selection is enabled */
  enabled?: boolean;
}

export interface UseTimelineSelectionReturn {
  /** Current selection range (null when not selecting) */
  selectionRange: SelectionRange | null;
  /** Whether currently dragging */
  isDragging: boolean;
}

// =============================================================================
// Hook
// =============================================================================

export function useTimelineSelection({
  containerRef,
  displayStart,
  displayEnd,
  onSelectionCommit,
  enabled = true,
}: UseTimelineSelectionParams): UseTimelineSelectionReturn {
  const [selectionRange, setSelectionRange] = useState<SelectionRange | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartXRef = useRef<number | null>(null);

  /**
   * Converts client X coordinate to percentage of container width.
   */
  const clientXToPercent = useCallback(
    (clientX: number): number => {
      const container = containerRef.current;
      if (!container) return 0;

      const rect = container.getBoundingClientRect();
      const x = clientX - rect.left;
      const percent = (x / rect.width) * 100;
      return Math.max(0, Math.min(100, percent)); // Clamp to [0, 100]
    },
    [containerRef],
  );

  /**
   * Converts percentage to timestamp within display range.
   */
  const percentToTime = useCallback(
    (percent: number): number => {
      const startMs = displayStart.getTime();
      const endMs = displayEnd.getTime();
      const rangeMs = endMs - startMs;
      return startMs + (percent / 100) * rangeMs;
    },
    [displayStart, displayEnd],
  );

  /**
   * Handle mouse down - start selection.
   */
  const handleMouseDown = useCallback(
    (e: MouseEvent) => {
      if (!enabled || e.button !== 0) return; // Only left mouse button
      const container = containerRef.current;
      if (!container || !container.contains(e.target as Node)) return;

      e.preventDefault();
      const percent = clientXToPercent(e.clientX);
      dragStartXRef.current = e.clientX;
      setIsDragging(true);

      // Initialize selection range
      const time = percentToTime(percent);
      setSelectionRange({
        startPercent: percent,
        endPercent: percent,
        startTime: time,
        endTime: time,
      });
    },
    [enabled, containerRef, clientXToPercent, percentToTime],
  );

  /**
   * Handle mouse move - update selection.
   */
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging || dragStartXRef.current === null) return;

      const currentPercent = clientXToPercent(e.clientX);
      const startPercent = clientXToPercent(dragStartXRef.current);

      // Determine min/max (handle dragging left or right)
      const minPercent = Math.min(startPercent, currentPercent);
      const maxPercent = Math.max(startPercent, currentPercent);

      const startTime = percentToTime(minPercent);
      const endTime = percentToTime(maxPercent);

      setSelectionRange({
        startPercent: minPercent,
        endPercent: maxPercent,
        startTime,
        endTime,
      });
    },
    [isDragging, clientXToPercent, percentToTime],
  );

  /**
   * Handle mouse up - commit selection.
   */
  const handleMouseUp = useCallback(() => {
    if (!isDragging) return;

    setIsDragging(false);
    dragStartXRef.current = null;

    // Commit selection if range is meaningful (> 1% width)
    if (selectionRange && selectionRange.endPercent - selectionRange.startPercent > 1) {
      onSelectionCommit?.(new Date(selectionRange.startTime), new Date(selectionRange.endTime));
    }

    // Clear selection after commit
    setSelectionRange(null);
  }, [isDragging, selectionRange, onSelectionCommit]);

  // Attach global mouse events
  useEffect(() => {
    if (!enabled) return;

    const container = containerRef.current;
    if (!container) return;

    // Use capture phase to intercept before other handlers
    container.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      container.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [enabled, containerRef, handleMouseDown, handleMouseMove, handleMouseUp]);

  return {
    selectionRange,
    isDragging,
  };
}
