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
 * Dragger Gesture Hook
 *
 * Handles drag interaction for timeline range boundaries.
 *
 * ## Features
 *
 * - Mouse drag to adjust time boundaries
 * - NOW constraint: right dragger cannot extend past NOW
 * - Keyboard navigation: Arrow keys nudge ±5 minutes
 * - Visual feedback during drag
 *
 * ## State Management
 *
 * - Dragging updates pending state (not effective state)
 * - Apply button commits pending → effective
 * - Cancel button discards pending
 */

import { useState, useCallback, useRef, useEffect } from "react";

// =============================================================================
// Types
// =============================================================================

export interface UseDraggerGestureOptions {
  /** Side: start or end boundary */
  side: "start" | "end";
  /** Display range start */
  displayStart: Date;
  /** Display range end */
  displayEnd: Date;
  /** Current effective time (what we're adjusting) */
  effectiveTime: Date | undefined;
  /** Whether end time is "NOW" (blocks extending right) */
  isEndTimeNow?: boolean;
  /** Callback when pending time changes */
  onPendingTimeChange: (time: Date | undefined) => void;
  /** Container element ref (for calculating positions) */
  containerRef: React.RefObject<HTMLElement | null>;
}

export interface UseDraggerGestureReturn {
  /** Whether currently dragging */
  isDragging: boolean;
  /** Whether drag is blocked (e.g., extending past NOW) */
  isBlocked: boolean;
  /** Current position as percentage (0-100) */
  positionPercent: number;
  /** Mouse down handler */
  onMouseDown: (e: React.MouseEvent) => void;
  /** Key down handler (for keyboard navigation) */
  onKeyDown: (e: React.KeyboardEvent) => void;
  /** Ref for the dragger element */
  draggerRef: React.RefObject<HTMLDivElement | null>;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook for managing dragger gesture.
 */
export function useDraggerGesture({
  side,
  displayStart,
  displayEnd,
  effectiveTime,
  isEndTimeNow = false,
  onPendingTimeChange,
  containerRef,
}: UseDraggerGestureOptions): UseDraggerGestureReturn {
  const [isDragging, setIsDragging] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);
  const draggerRef = useRef<HTMLDivElement>(null);
  const dragStartXRef = useRef<number>(0);
  const dragStartTimeRef = useRef<number>(0);

  // Calculate display range in milliseconds
  const displayStartMs = displayStart.getTime();
  const displayEndMs = displayEnd.getTime();
  const displayRangeMs = displayEndMs - displayStartMs;

  // Determine current effective time (or fallback to boundary)
  const currentTime = effectiveTime ?? (side === "start" ? displayStart : displayEnd);
  const currentTimeMs = currentTime.getTime();

  // Calculate position as percentage
  const positionPercent =
    displayRangeMs > 0 ? ((currentTimeMs - displayStartMs) / displayRangeMs) * 100 : side === "start" ? 0 : 100;

  // Convert pixel offset to time offset
  const pixelOffsetToTimeOffset = useCallback(
    (pixelOffset: number): number => {
      if (!containerRef.current) return 0;
      const containerWidth = containerRef.current.clientWidth;
      if (containerWidth === 0) return 0;
      return (pixelOffset / containerWidth) * displayRangeMs;
    },
    [containerRef, displayRangeMs],
  );

  // Mouse down handler - start drag
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      setIsDragging(true);
      dragStartXRef.current = e.clientX;
      dragStartTimeRef.current = currentTimeMs;
    },
    [currentTimeMs],
  );

  // Mouse move handler - update pending time
  const onMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging) return;

      const deltaX = e.clientX - dragStartXRef.current;
      const deltaMs = pixelOffsetToTimeOffset(deltaX);
      const newTimeMs = dragStartTimeRef.current + deltaMs;

      // Check if blocked (right dragger in NOW mode cannot extend past NOW)
      const now = new Date();
      if (side === "end" && isEndTimeNow && newTimeMs > now.getTime()) {
        setIsBlocked(true);
        return;
      }

      setIsBlocked(false);

      // Update pending time
      const newTime = new Date(newTimeMs);
      onPendingTimeChange(newTime);
    },
    [isDragging, pixelOffsetToTimeOffset, side, isEndTimeNow, onPendingTimeChange],
  );

  // Mouse up handler - end drag
  const onMouseUp = useCallback(() => {
    if (!isDragging) return;
    setIsDragging(false);
    setIsBlocked(false);
  }, [isDragging]);

  // Keyboard handler - nudge ±5 minutes
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const nudgeMs = 5 * 60 * 1000; // 5 minutes

      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          onPendingTimeChange(new Date(currentTimeMs - nudgeMs));
          break;
        case "ArrowRight":
          e.preventDefault();
          // Check if blocked
          if (side === "end" && isEndTimeNow && currentTimeMs + nudgeMs > new Date().getTime()) {
            setIsBlocked(true);
            return;
          }
          onPendingTimeChange(new Date(currentTimeMs + nudgeMs));
          break;
      }
    },
    [currentTimeMs, side, isEndTimeNow, onPendingTimeChange],
  );

  // Effect: Attach/detach global mouse handlers during drag
  useEffect(() => {
    if (!isDragging) return;

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [isDragging, onMouseMove, onMouseUp]);

  return {
    isDragging,
    isBlocked,
    positionPercent,
    onMouseDown,
    onKeyDown,
    draggerRef,
  };
}
