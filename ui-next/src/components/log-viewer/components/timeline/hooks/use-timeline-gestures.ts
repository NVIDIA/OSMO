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
 *   - Supports both mouse wheel and trackpad two-finger scrolling
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
 * ## Trackpad Support
 *
 * Two-finger scrolling on trackpads (MacBook, Magic Mouse, etc.) is fully supported.
 * The browser's native wheel event fires for both mouse wheel and trackpad gestures.
 *
 * Note: Trackpads have inertia, which can cause multiple wheel events from a single
 * gesture. The @use-gesture library handles this, but if you notice oversensitivity,
 * consider integrating Lethargy (https://github.com/d4nyll/lethargy) for better
 * intent detection.
 *
 * ## Drag Behavior
 *
 * - Dragger stays at pixel position relative to display range
 * - NOW constraint: end dragger cannot extend past current time
 * - Position calculated from mouse offset and container width
 */

import { useWheel, useDrag } from "@use-gesture/react";
import { useCallback, useRef, useState, useEffect } from "react";
import type { useTimelineState } from "./use-timeline-state";
import { clampTimeToRange, validateInvalidZoneLimits } from "../lib/timeline-utils";
import {
  PAN_FACTOR,
  ZOOM_IN_FACTOR,
  ZOOM_OUT_FACTOR,
  MIN_RANGE_MS,
  KEYBOARD_NUDGE_MS,
  NOW_THRESHOLD_MS,
} from "../lib/timeline-constants";

// Re-export zoom factors for external use
export { ZOOM_IN_FACTOR, ZOOM_OUT_FACTOR };

// =============================================================================
// Debug Logging
// =============================================================================

interface WheelDebugEvent {
  timestamp: number;
  dx: number;
  dy: number;
  effectiveDelta: number;
  isZoom: boolean;
  wasBlocked: boolean;
  blockReason?: string;
  oldRange: { start: string; end: string };
  newRange: { start: string; end: string };
  context?: {
    entityStart?: string;
    entityEnd?: string;
    now?: string;
    effectiveStart: string;
    effectiveEnd: string;
    currentStartPercent: number;
    windowLeft?: number;
    windowRight?: number;
  };
}

const wheelDebugLog: WheelDebugEvent[] = [];
let isDebugEnabled = false;
let debugInitialized = false;

function initializeDebug() {
  if (debugInitialized) return;
  debugInitialized = true;

  if (typeof window === "undefined") return;

  const params = new URLSearchParams(window.location.search);
  isDebugEnabled = params.get("debug") === "timeline" || params.get("debug") === "true";

  console.log("[Timeline Debug] Initialization check:", {
    url: window.location.href,
    debugParam: params.get("debug"),
    isDebugEnabled,
  });

  if (isDebugEnabled) {
    console.log("[Timeline Debug] ✅ ENABLED - use window.timelineDebug() to view logs");
    // Expose debug function globally
    (window as unknown as Record<string, () => void>).timelineDebug = () => {
      console.table(
        wheelDebugLog.map((e) => ({
          time: new Date(e.timestamp).toLocaleTimeString(),
          dx: e.dx,
          dy: e.dy,
          effectiveDelta: e.effectiveDelta,
          isZoom: e.isZoom ? "ZOOM" : "PAN",
          blocked: e.wasBlocked ? "BLOCKED" : "OK",
          reason: e.blockReason || "-",
        })),
      );
      console.log("\nFull details:", wheelDebugLog);
      console.log("\nTo copy:", JSON.stringify(wheelDebugLog, null, 2));
    };

    (window as unknown as Record<string, () => void>).timelineDebugClear = () => {
      wheelDebugLog.length = 0;
      console.log("[Timeline Debug] Logs cleared");
    };

    (window as unknown as Record<string, () => void>).timelineDebugStats = () => {
      const total = wheelDebugLog.length;
      const blocked = wheelDebugLog.filter((e) => e.wasBlocked).length;
      const pans = wheelDebugLog.filter((e) => !e.isZoom).length;
      const zooms = wheelDebugLog.filter((e) => e.isZoom).length;

      console.log("[Timeline Debug] Stats:", {
        total,
        blocked: `${blocked} (${((blocked / total) * 100).toFixed(1)}%)`,
        pans: `${pans} (${((pans / total) * 100).toFixed(1)}%)`,
        zooms: `${zooms} (${((zooms / total) * 100).toFixed(1)}%)`,
      });
    };
  } else {
    console.log("[Timeline Debug] ❌ DISABLED - add ?debug=timeline to URL to enable");
  }
}

function logWheelEvent(event: WheelDebugEvent) {
  if (!isDebugEnabled) return;

  wheelDebugLog.push(event);

  // Keep only last 100 events
  if (wheelDebugLog.length > 100) {
    wheelDebugLog.shift();
  }
}

// =============================================================================
// Wheel Gestures
// =============================================================================

/**
 * Hook for timeline wheel gestures (pan and zoom).
 *
 * ## CRITICAL: Two SEPARATE and MUTUALLY EXCLUSIVE behaviors
 *
 * 1. **Simple wheel/scroll** (no modifier keys) → **PAN left/right**
 *    - Mouse wheel up / trackpad scroll up → pan left
 *    - Mouse wheel down / trackpad scroll down → pan right
 *    - Trackpad horizontal swipe left → pan left
 *    - Trackpad horizontal swipe right → pan right
 *    - Shifts both start and end by same amount (keeps range constant)
 *    - Subject to invalid zone limits (max 10% of viewport)
 *
 * 2. **Cmd/Ctrl + wheel/scroll** (metaKey or ctrlKey) → **ZOOM in/out**
 *    - Trackpad pinch in / wheel up with Cmd → zoom in (decrease visible range)
 *    - Trackpad pinch out / wheel down with Cmd → zoom out (increase visible range)
 *    - Keeps center point stable while changing range
 *    - Respects minimum range limit and invalid zone limits (max 10% of viewport)
 *
 * These behaviors DO NOT interfere with each other - they are handled in completely
 * separate if/else branches.
 *
 * ## Invalid Zone Limits
 *
 * Pan and zoom operations are limited to ensure invalid zones (striped areas before
 * workflow start or after completion) don't exceed 10% of the viewport. This prevents
 * users from panning/zooming so far that most of the screen is just invalid zones.
 *
 * ## Delta Handling
 *
 * The wheel event provides both deltaX (horizontal) and deltaY (vertical):
 * - **deltaX**: Trackpad horizontal two-finger swipe
 * - **deltaY**: Mouse wheel or trackpad vertical two-finger swipe
 *
 * We use whichever delta has the larger absolute value, allowing both horizontal
 * and vertical gestures to work naturally for the horizontal timeline.
 *
 * ## Implementation Details
 *
 * Uses @use-gesture/react's useWheel hook with target option for proper event handling.
 * The target option is recommended when preventDefault is needed, as it attaches listeners
 * directly to the DOM node rather than relying on React's event system.
 *
 * @see https://use-gesture.netlify.app/docs/gestures/#about-the-wheel-gesture
 * @see https://use-gesture.netlify.app/docs/options/
 *
 * @param containerRef - Container element ref
 * @param state - Timeline state from useTimelineState
 * @param bucketTimestamps - Bucket timestamps for calculating bucket width
 * @param onDisplayRangeChange - Callback when display range changes
 * @param debugContext - Optional debug context (entityStart/End, now, window positions)
 */
export function useTimelineWheelGesture(
  containerRef: React.RefObject<HTMLElement | null>,
  state: ReturnType<typeof useTimelineState>,
  bucketTimestamps: Date[],
  onDisplayRangeChange: (start: Date, end: Date) => void,
  debugContext?: {
    entityStartTime?: Date;
    entityEndTime?: Date;
    now?: number;
    overlayPositions?: { leftWidth: number; rightStart: number; rightWidth: number };
  },
): void {
  const { currentDisplay, currentEffective, currentStartPercent, actions } = state;

  // Initialize debug system on first render
  initializeDebug();

  // Build debug context object
  const buildDebugContext = useCallback(() => {
    if (!isDebugEnabled || !debugContext) return undefined;
    return {
      entityStart: debugContext.entityStartTime?.toISOString(),
      entityEnd: debugContext.entityEndTime?.toISOString(),
      now: debugContext.now ? new Date(debugContext.now).toISOString() : undefined,
      effectiveStart: currentEffective.start?.toISOString() ?? "undefined",
      effectiveEnd: currentEffective.end?.toISOString() ?? "undefined",
      currentStartPercent: currentStartPercent ?? 0,
      windowLeft: debugContext.overlayPositions?.leftWidth,
      windowRight: debugContext.overlayPositions?.rightStart,
    };
  }, [debugContext, currentEffective, currentStartPercent]);

  useWheel(
    ({ event, delta: [dx, dy] }) => {
      // ALWAYS log to verify handler is called (even when debug is disabled)
      console.log("[Timeline Wheel] Event received:", {
        dx,
        dy,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        debugEnabled: isDebugEnabled,
      });

      // Prevent default browser scroll behavior
      event.preventDefault();

      // Check modifier key to determine behavior
      const isZoom = event.metaKey || event.ctrlKey;
      const displayStartMs = currentDisplay.start.getTime();
      const displayEndMs = currentDisplay.end.getTime();
      const displayRangeMs = displayEndMs - displayStartMs;

      // ========================================================================
      // BEHAVIOR 1: ZOOM (Cmd/Ctrl + wheel)
      // ========================================================================
      if (isZoom) {
        // Use whichever delta is larger (supports both vertical wheel and horizontal trackpad)
        const primaryDelta = Math.abs(dy) > Math.abs(dx) ? dy : dx;

        // Skip if no effective delta (prevents spurious zoom when delta=0)
        if (primaryDelta === 0) return;

        const factor = primaryDelta < 0 ? ZOOM_IN_FACTOR : ZOOM_OUT_FACTOR;
        const newRangeMs = displayRangeMs * factor;

        // Respect minimum range
        if (newRangeMs < MIN_RANGE_MS) {
          logWheelEvent({
            timestamp: Date.now(),
            dx,
            dy,
            effectiveDelta: primaryDelta,
            isZoom: true,
            wasBlocked: true,
            blockReason: "MIN_RANGE_MS",
            oldRange: {
              start: new Date(displayStartMs).toISOString(),
              end: new Date(displayEndMs).toISOString(),
            },
            newRange: {
              start: new Date(displayStartMs).toISOString(),
              end: new Date(displayEndMs).toISOString(),
            },
            context: buildDebugContext(),
          });
          return;
        }

        // Use center of display range as zoom origin
        const centerMs = (displayStartMs + displayEndMs) / 2;
        const newStart = new Date(centerMs - newRangeMs / 2);
        const newEnd = new Date(centerMs + newRangeMs / 2);

        // Validate invalid zone limits
        const validation = validateInvalidZoneLimits(
          newStart.getTime(),
          newEnd.getTime(),
          debugContext?.entityStartTime,
          debugContext?.entityEndTime,
          debugContext?.now,
          bucketTimestamps,
        );

        if (validation.blocked) {
          logWheelEvent({
            timestamp: Date.now(),
            dx,
            dy,
            effectiveDelta: primaryDelta,
            isZoom: true,
            wasBlocked: true,
            blockReason: validation.reason,
            oldRange: {
              start: new Date(displayStartMs).toISOString(),
              end: new Date(displayEndMs).toISOString(),
            },
            newRange: {
              start: newStart.toISOString(),
              end: newEnd.toISOString(),
            },
            context: buildDebugContext(),
          });
          return;
        }

        logWheelEvent({
          timestamp: Date.now(),
          dx,
          dy,
          effectiveDelta: primaryDelta,
          isZoom: true,
          wasBlocked: false,
          oldRange: {
            start: new Date(displayStartMs).toISOString(),
            end: new Date(displayEndMs).toISOString(),
          },
          newRange: {
            start: newStart.toISOString(),
            end: newEnd.toISOString(),
          },
          context: buildDebugContext(),
        });

        actions.setPendingDisplay(newStart, newEnd);
        onDisplayRangeChange(newStart, newEnd);
      }
      // ========================================================================
      // BEHAVIOR 2: PAN (simple wheel, no modifiers)
      // ========================================================================
      else {
        // Support both vertical (dy) and horizontal (dx) scrolling
        // For horizontal timeline, both should pan left/right:
        // - dx > 0 (scroll right) → pan right
        // - dx < 0 (scroll left) → pan left
        // - dy > 0 (scroll down) → pan right
        // - dy < 0 (scroll up) → pan left

        // Combine both deltas (use whichever is larger)
        // Horizontal scrolling (dx) is more direct for horizontal panning
        const effectiveDelta = Math.abs(dx) > Math.abs(dy) ? dx : dy;

        // Skip if no effective delta (prevents spurious pan when delta=0)
        if (effectiveDelta === 0) return;

        const panAmountMs = displayRangeMs * PAN_FACTOR;
        const deltaMs = effectiveDelta < 0 ? -panAmountMs : panAmountMs;

        const newStart = new Date(displayStartMs + deltaMs);
        const newEnd = new Date(displayEndMs + deltaMs);

        // Validate invalid zone limits
        const validation = validateInvalidZoneLimits(
          newStart.getTime(),
          newEnd.getTime(),
          debugContext?.entityStartTime,
          debugContext?.entityEndTime,
          debugContext?.now,
          bucketTimestamps,
        );

        if (validation.blocked) {
          logWheelEvent({
            timestamp: Date.now(),
            dx,
            dy,
            effectiveDelta,
            isZoom: false,
            wasBlocked: true,
            blockReason: validation.reason,
            oldRange: {
              start: new Date(displayStartMs).toISOString(),
              end: new Date(displayEndMs).toISOString(),
            },
            newRange: {
              start: newStart.toISOString(),
              end: newEnd.toISOString(),
            },
            context: buildDebugContext(),
          });
          return;
        }

        logWheelEvent({
          timestamp: Date.now(),
          dx,
          dy,
          effectiveDelta,
          isZoom: false,
          wasBlocked: false,
          oldRange: {
            start: new Date(displayStartMs).toISOString(),
            end: new Date(displayEndMs).toISOString(),
          },
          newRange: {
            start: newStart.toISOString(),
            end: newEnd.toISOString(),
          },
          context: buildDebugContext(),
        });

        actions.setPendingDisplay(newStart, newEnd);
        onDisplayRangeChange(newStart, newEnd);
      }
    },
    {
      // Attach directly to DOM node via ref (recommended for preventDefault)
      target: containerRef,
      // Must set passive: false to allow preventDefault() to work
      eventOptions: { passive: false },
    },
  );

  // Debug: Log when ref is attached (runs once after mount)
  useEffect(() => {
    console.log("[Timeline Wheel] useWheel hook configured, containerRef.current:", containerRef.current);
  }, [containerRef]);
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
