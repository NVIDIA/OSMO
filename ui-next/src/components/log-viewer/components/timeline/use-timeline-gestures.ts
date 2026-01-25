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
 * Timeline Gestures Hook
 *
 * Unified gesture handling using @use-gesture/react.
 * Replaces custom mouse/wheel/keyboard handling.
 *
 * ## Gestures
 *
 * - **Wheel**: Pan left/right (no modifier) or zoom in/out (Cmd/Ctrl)
 * - **Drag** (draggers): Adjust effective time boundaries
 * - **Keyboard** (draggers): Arrow keys nudge ±5 minutes
 *
 * ## Wheel Behavior
 *
 * - Wheel up → pan left or zoom in (with Cmd/Ctrl)
 * - Wheel down → pan right or zoom out (with Cmd/Ctrl)
 * - Pan amount: 10% of visible range
 * - Zoom factor: 0.8 (in) or 1.25 (out)
 * - Minimum range: 1 minute
 *
 * ## Drag Behavior
 *
 * - Dragger stays at pixel position relative to display range
 * - NOW constraint: end dragger cannot extend past current time
 * - Position calculated from mouse offset and container width
 */

import { useWheel, useDrag } from "@use-gesture/react";
import { useCallback, useRef, useState } from "react";
import type { useTimelineState } from "./use-timeline-state";
import { validatePanConstraint, clampTimeToRange, type TimelineBounds } from "./timeline-utils";

// =============================================================================
// Constants
// =============================================================================

/** Pan amount as fraction of visible range (10% per wheel tick) */
const PAN_FACTOR = 0.1;

/** Zoom in factor (narrow by 20%) */
export const ZOOM_IN_FACTOR = 0.8;

/** Zoom out factor (widen by 25%) */
export const ZOOM_OUT_FACTOR = 1.25;

/** Minimum range in milliseconds (1 minute) */
const MIN_RANGE_MS = 60_000;

/** Keyboard nudge amount in milliseconds (5 minutes) */
const KEYBOARD_NUDGE_MS = 5 * 60 * 1000;

/** Threshold for considering end time as "now" (1 minute) */
const NOW_THRESHOLD_MS = 60_000;

// =============================================================================
// Wheel Gestures
// =============================================================================

/**
 * Hook for timeline wheel gestures (pan and zoom).
 *
 * Attaches wheel handler directly to container via target option.
 * No return value needed since binding happens automatically.
 *
 * @param containerRef - Container element ref
 * @param state - Timeline state from useTimelineState
 * @param panBoundaries - Entity boundaries for pan constraints
 * @param onDisplayRangeChange - Callback when display range changes
 */
export function useTimelineWheelGesture(
  containerRef: React.RefObject<HTMLElement | null>,
  state: ReturnType<typeof useTimelineState>,
  panBoundaries: TimelineBounds | null,
  onDisplayRangeChange: (start: Date, end: Date) => void,
): void {
  const { currentDisplay, currentEffective, currentStartPercent, actions } = state;

  useWheel(
    ({ event, delta: [, dy] }) => {
      event.preventDefault();

      const isZoom = event.metaKey || event.ctrlKey;
      const displayStartMs = currentDisplay.start.getTime();
      const displayEndMs = currentDisplay.end.getTime();
      const displayRangeMs = displayEndMs - displayStartMs;

      if (isZoom) {
        // Zoom: adjust range centered on histogram middle
        const factor = dy < 0 ? ZOOM_IN_FACTOR : ZOOM_OUT_FACTOR;
        const newRangeMs = displayRangeMs * factor;

        // Respect minimum range
        if (newRangeMs < MIN_RANGE_MS) return;

        // Use center of display range as zoom origin
        const centerMs = (displayStartMs + displayEndMs) / 2;
        const newStart = new Date(centerMs - newRangeMs / 2);
        const newEnd = new Date(centerMs + newRangeMs / 2);

        actions.setPendingDisplay(newStart, newEnd);
        onDisplayRangeChange(newStart, newEnd);
      } else {
        // Pan: shift window left/right
        const panAmountMs = displayRangeMs * PAN_FACTOR;
        const deltaMs = dy < 0 ? -panAmountMs : panAmountMs;

        const newStart = new Date(displayStartMs + deltaMs);
        const newEnd = new Date(displayEndMs + deltaMs);

        // Validate constraints
        if (panBoundaries) {
          const constraint = validatePanConstraint(
            newStart,
            newEnd,
            currentDisplay.start,
            currentDisplay.end,
            panBoundaries,
            currentStartPercent,
            currentEffective.start,
          );

          if (constraint.blocked) return;
        }

        actions.setPendingDisplay(newStart, newEnd);
        onDisplayRangeChange(newStart, newEnd);
      }
    },
    {
      target: containerRef,
      eventOptions: { passive: false },
    },
  );
}

// =============================================================================
// Dragger Gestures
// =============================================================================

/**
 * Dragger gesture return value.
 */
export interface DraggerGesture {
  /** Whether currently dragging */
  isDragging: boolean;
  /** Whether drag is blocked (e.g., past NOW) */
  isBlocked: boolean;
  /** Current position as percentage (0-100) */
  positionPercent: number;
  /** Pointer down handler (initiates drag via @use-gesture) */
  onPointerDown: (e: React.PointerEvent) => void;
  /** Key down handler for keyboard navigation */
  onKeyDown: (e: React.KeyboardEvent) => void;
}

/**
 * Hook for dragger gesture (mouse drag + keyboard navigation).
 *
 * @param side - Which dragger (start or end)
 * @param containerRef - Container element ref
 * @param state - Timeline state from useTimelineState
 * @param effectiveTime - Current effective time for this dragger
 * @param isEndTimeNow - Whether end time is "NOW" (blocks extending past NOW)
 * @returns Dragger gesture object
 */
export function useTimelineDraggerGesture(
  side: "start" | "end",
  containerRef: React.RefObject<HTMLElement | null>,
  state: ReturnType<typeof useTimelineState>,
  effectiveTime: Date | undefined,
  isEndTimeNow: boolean,
): DraggerGesture {
  const { currentDisplay, currentEffective, actions } = state;

  const [isDragging, setIsDragging] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);

  // Store drag context (transient state - not in React state to avoid re-renders)
  const dragContextRef = useRef<{
    startX: number;
    startTimeMs: number;
    containerWidth: number;
  } | null>(null);

  // Calculate current position as percentage
  const displayStartMs = currentDisplay.start.getTime();
  const displayEndMs = currentDisplay.end.getTime();
  const displayRangeMs = displayEndMs - displayStartMs;

  const currentTime = effectiveTime ?? (side === "start" ? currentDisplay.start : currentDisplay.end);
  const currentTimeMs = currentTime.getTime();

  const positionPercent =
    displayRangeMs > 0 ? ((currentTimeMs - displayStartMs) / displayRangeMs) * 100 : side === "start" ? 0 : 100;

  // Drag handler via @use-gesture
  const bindDrag = useDrag(
    ({ first, last, xy: [x], tap }) => {
      if (tap) return;

      const container = containerRef.current;
      if (!container) return;

      if (first) {
        setIsDragging(true);
        dragContextRef.current = {
          startX: x,
          startTimeMs: currentTimeMs,
          containerWidth: container.offsetWidth,
        };
        return;
      }

      const ctx = dragContextRef.current;
      if (!ctx) return;

      // Calculate new time from pixel offset
      const pixelDelta = x - ctx.startX;
      const timePerPixel = displayRangeMs / ctx.containerWidth;
      const newTimeMs = ctx.startTimeMs + pixelDelta * timePerPixel;

      // Apply display range constraints
      const clampedTimeMs = clampTimeToRange(newTimeMs, displayStartMs, displayEndMs);

      // Check NOW constraint for end dragger
      if (side === "end" && isEndTimeNow && clampedTimeMs > Date.now() + NOW_THRESHOLD_MS) {
        setIsBlocked(true);
        return;
      }

      setIsBlocked(false);

      if (last) {
        setIsDragging(false);
        dragContextRef.current = null;
      }

      // Update effective time based on which dragger moved
      const newTime = new Date(clampedTimeMs);
      if (side === "start") {
        actions.setPendingEffective(newTime, currentEffective.end);
      } else {
        actions.setPendingEffective(currentEffective.start, newTime);
      }
    },
    {
      filterTaps: true,
      threshold: 3,
      pointer: { touch: true },
      axis: "x",
    },
  );

  // Keyboard nudge (arrow keys)
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!effectiveTime) return;

      let delta = 0;
      if (e.key === "ArrowLeft") {
        delta = -KEYBOARD_NUDGE_MS;
      } else if (e.key === "ArrowRight") {
        delta = KEYBOARD_NUDGE_MS;
      } else {
        return;
      }

      e.preventDefault();
      const newTimeMs = effectiveTime.getTime() + delta;

      // Check NOW constraint for end dragger
      if (side === "end" && isEndTimeNow && newTimeMs > Date.now() + NOW_THRESHOLD_MS) {
        setIsBlocked(true);
        return;
      }

      setIsBlocked(false);
      const newTime = new Date(newTimeMs);

      if (side === "start") {
        actions.setPendingEffective(newTime, currentEffective.end);
      } else {
        actions.setPendingEffective(currentEffective.start, newTime);
      }
    },
    [effectiveTime, side, isEndTimeNow, actions, currentEffective],
  );

  // Get gesture handlers
  const dragHandlers = bindDrag();

  return {
    isDragging,
    isBlocked,
    positionPercent,
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragHandlers.onPointerDown?.(e as never);
    },
    onKeyDown,
  };
}
