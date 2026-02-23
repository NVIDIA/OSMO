// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Timeline Selection Hook
 *
 * Handles drag-to-select gestures on the timeline.
 * Converts mouse coordinates to time ranges and updates filter state.
 *
 * ## Performance
 *
 * PERF (P1): Uses refs for ALL transient drag state (isDragging, dragStartX,
 * displayStart/End snapshots). Only the final selectionRange that drives the
 * visual overlay is kept in React state. This prevents listener thrashing:
 * previously every mousemove during a drag caused handleMouseMove/handleMouseUp
 * to get new closures, tearing down and re-attaching window event listeners.
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
  // Only selectionRange drives the visual overlay - kept in state for re-render.
  const [selectionRange, setSelectionRange] = useState<SelectionRange | null>(null);
  // isDragging is also in state because the parent uses it for conditional rendering.
  const [isDragging, setIsDragging] = useState(false);

  // Refs for transient drag state - never cause re-renders or listener churn.
  const dragStartXRef = useRef<number | null>(null);
  const isDraggingRef = useRef(false);
  const selectionRangeRef = useRef<SelectionRange | null>(null);

  // PERF (P1): RAF handle for batching mousemove → setSelectionRange updates.
  // Without batching, every mousemove event (which can fire at 120Hz+ on
  // high-refresh displays) triggers a React state update and re-render.
  // With RAF batching, we coalesce multiple mousemove events into a single
  // state update per animation frame (16.67ms at 60fps).
  const rafIdRef = useRef<number | null>(null);

  // Snapshot of display range at the time listeners are attached.
  // Updated via ref so handlers always see the latest values without re-binding.
  const displayStartRef = useRef(displayStart);
  const displayEndRef = useRef(displayEnd);
  const onSelectionCommitRef = useRef(onSelectionCommit);

  // Keep refs in sync with props (write in useEffect per React Compiler rules).
  useEffect(() => {
    displayStartRef.current = displayStart;
  }, [displayStart]);

  useEffect(() => {
    displayEndRef.current = displayEnd;
  }, [displayEnd]);

  useEffect(() => {
    onSelectionCommitRef.current = onSelectionCommit;
  }, [onSelectionCommit]);

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
   * Converts percentage to timestamp within display range (reads from ref).
   */
  const percentToTime = useCallback(
    (percent: number): number => {
      const startMs = displayStartRef.current.getTime();
      const endMs = displayEndRef.current.getTime();
      const rangeMs = endMs - startMs;
      return startMs + (percent / 100) * rangeMs;
    },
    [], // Stable: reads from ref
  );

  /**
   * Handle mouse down - start selection.
   * Stable callback: reads transient state from refs, not closures.
   */
  const handleMouseDown = useCallback(
    (e: MouseEvent) => {
      if (!enabled || e.button !== 0) return; // Only left mouse button
      const container = containerRef.current;
      if (!container || !container.contains(e.target as Node)) return;

      e.preventDefault();
      const percent = clientXToPercent(e.clientX);
      dragStartXRef.current = e.clientX;
      isDraggingRef.current = true;
      setIsDragging(true);

      // Initialize selection range
      const time = percentToTime(percent);
      const range: SelectionRange = {
        startPercent: percent,
        endPercent: percent,
        startTime: time,
        endTime: time,
      };
      selectionRangeRef.current = range;
      setSelectionRange(range);
    },
    [enabled, containerRef, clientXToPercent, percentToTime],
  );

  /**
   * Handle mouse move - update selection.
   * Stable callback: reads isDragging from ref, not state.
   *
   * PERF (P1): Uses requestAnimationFrame to batch visual updates.
   * The ref is updated immediately (for mouseup to read the latest value),
   * but the React state update is deferred to the next animation frame.
   * Multiple mousemove events within one frame are coalesced into a single render.
   */
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDraggingRef.current || dragStartXRef.current === null) return;

      const currentPercent = clientXToPercent(e.clientX);
      const startPercent = clientXToPercent(dragStartXRef.current);

      // Determine min/max (handle dragging left or right)
      const minPercent = Math.min(startPercent, currentPercent);
      const maxPercent = Math.max(startPercent, currentPercent);

      const startTime = percentToTime(minPercent);
      const endTime = percentToTime(maxPercent);

      const range: SelectionRange = {
        startPercent: minPercent,
        endPercent: maxPercent,
        startTime,
        endTime,
      };
      // Update ref immediately so mouseup always reads latest value
      selectionRangeRef.current = range;

      // Batch the React state update in a RAF to coalesce rapid mousemove events
      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(() => {
          rafIdRef.current = null;
          // Read from ref to get the most recent value (may have been updated
          // by subsequent mousemove events since RAF was scheduled)
          setSelectionRange(selectionRangeRef.current);
        });
      }
    },
    [clientXToPercent, percentToTime], // No isDragging/selectionRange in deps
  );

  /**
   * Handle mouse up - commit selection.
   * Stable callback: reads all transient state from refs.
   */
  const handleMouseUp = useCallback(() => {
    if (!isDraggingRef.current) return;

    // Cancel any pending RAF to avoid a stale state update after drag ends
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    isDraggingRef.current = false;
    setIsDragging(false);
    dragStartXRef.current = null;

    // Commit selection if range is meaningful (> 1% width)
    const range = selectionRangeRef.current;
    if (range && range.endPercent - range.startPercent > 1) {
      onSelectionCommitRef.current?.(new Date(range.startTime), new Date(range.endTime));
    }

    // Clear selection after commit
    selectionRangeRef.current = null;
    setSelectionRange(null);
  }, []); // Fully stable - reads everything from refs

  // Attach global mouse events - stable listener references prevent thrashing.
  useEffect(() => {
    if (!enabled) return;

    const container = containerRef.current;
    if (!container) return;

    container.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      container.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      // Cancel any pending RAF to prevent state updates on unmounted component
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [enabled, containerRef, handleMouseDown, handleMouseMove, handleMouseUp]);

  return {
    selectionRange,
    isDragging,
  };
}
