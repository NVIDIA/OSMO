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
import { useCallback, useMemo, useRef, useState } from "react";
import type { useTimelineState } from "@/components/log-viewer/components/timeline/hooks/use-timeline-state";
import {
  clampTimeToRange,
  validateInvalidZoneLimits,
} from "@/components/log-viewer/components/timeline/lib/timeline-utils";
import {
  validateZoomInConstraints,
  validateZoomOutConstraints,
  calculateSymmetricZoom,
} from "@/components/log-viewer/components/timeline/lib/wheel-validation";
import {
  PAN_FACTOR,
  ZOOM_IN_FACTOR,
  ZOOM_OUT_FACTOR,
  KEYBOARD_NUDGE_MS,
  NOW_THRESHOLD_MS,
  MAX_MARKER_POSITION_PERCENT,
} from "@/components/log-viewer/components/timeline/lib/timeline-constants";
import { calculateBucketWidth } from "@/components/log-viewer/components/timeline/lib/invalid-zones";
import {
  initTimelineDebug,
  logTimelineEvent,
  isTimelineDebugEnabled,
  type DebugContext,
  type WheelDebugEvent,
} from "@/components/log-viewer/components/timeline/lib/timeline-debug";

// Re-export zoom factors for external use
export { ZOOM_IN_FACTOR, ZOOM_OUT_FACTOR };

// =============================================================================
// Types for Helper Functions
// =============================================================================

/**
 * Common context needed by zoom/pan gesture handlers.
 */
interface GestureContext {
  displayStartMs: number;
  displayEndMs: number;
  displayRangeMs: number;
  bucketTimestamps: Date[];
  entityStartTime: Date;
  entityEndTime?: Date;
  now: number;
  actions: {
    setPendingDisplay: (start: Date, end: Date) => void;
  };
  onDisplayRangeChange: (start: Date, end: Date) => void;
}

/**
 * Debug logging context for wheel events.
 */
interface WheelLoggingContext {
  dx: number;
  dy: number;
  effectiveDelta: number;
  beforeContext: DebugContext | undefined;
  buildDebugContext: (startMs?: number, endMs?: number, skipDom?: boolean) => DebugContext | undefined;
  logEventAfterRender: (event: Omit<WheelDebugEvent, "afterContext">, newStartMs: number, newEndMs: number) => void;
}

// =============================================================================
// Zoom In Handler
// =============================================================================

/**
 * Handle zoom in gesture (Cmd/Ctrl + wheel up).
 *
 * Validates constraints (min range, min bucket count, marker limits)
 * and applies symmetric zoom from center.
 *
 * @returns true if zoom was applied, false if blocked
 */
function handleZoomIn(ctx: GestureContext, newRangeMs: number, logging: WheelLoggingContext): boolean {
  const {
    displayStartMs,
    displayEndMs,
    bucketTimestamps,
    entityStartTime,
    entityEndTime,
    now,
    actions,
    onDisplayRangeChange,
  } = ctx;
  const { dx, dy, effectiveDelta, beforeContext, buildDebugContext, logEventAfterRender } = logging;

  const bucketWidthMs = calculateBucketWidth(bucketTimestamps);

  // Validate zoom in constraints (MIN_RANGE_MS, MIN_BUCKET_COUNT)
  const zoomInValidation = validateZoomInConstraints(newRangeMs, bucketWidthMs);
  if (zoomInValidation.blocked) {
    logTimelineEvent({
      timestamp: Date.now(),
      dx,
      dy,
      effectiveDelta,
      isZoom: true,
      wasBlocked: true,
      blockReason: zoomInValidation.reason,
      oldRange: {
        start: new Date(displayStartMs).toISOString(),
        end: new Date(displayEndMs).toISOString(),
      },
      newRange: {
        start: new Date(displayStartMs).toISOString(),
        end: new Date(displayEndMs).toISOString(),
      },
      beforeContext,
      afterContext: beforeContext, // Blocked - no change
    });
    return false;
  }

  // Calculate symmetric zoom using pure function
  const { newStartMs, newEndMs } = calculateSymmetricZoom(displayStartMs, displayEndMs, newRangeMs);

  // Validate marker position constraints for zoom in
  // When zooming in near markers, their percentage position
  // INCREASES (relative to the smaller viewport), potentially violating limits
  const validation = validateInvalidZoneLimits(
    newStartMs,
    newEndMs,
    entityStartTime,
    entityEndTime,
    now,
    bucketTimestamps,
  );

  if (validation.blocked) {
    logTimelineEvent({
      timestamp: Date.now(),
      dx,
      dy,
      effectiveDelta,
      isZoom: true,
      wasBlocked: true,
      blockReason: validation.reason,
      oldRange: {
        start: new Date(displayStartMs).toISOString(),
        end: new Date(displayEndMs).toISOString(),
      },
      newRange: {
        start: new Date(newStartMs).toISOString(),
        end: new Date(newEndMs).toISOString(),
      },
      beforeContext,
      afterContext: buildDebugContext(newStartMs, newEndMs), // Show what it would have been
    });
    return false;
  }

  const newStart = new Date(newStartMs);
  const newEnd = new Date(newEndMs);

  // Apply state changes first, then log after React re-renders
  actions.setPendingDisplay(newStart, newEnd);
  onDisplayRangeChange(newStart, newEnd);

  // Log with deferred DOM measurement (after React paints)
  logEventAfterRender(
    {
      timestamp: Date.now(),
      dx,
      dy,
      effectiveDelta,
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
      beforeContext,
    },
    newStartMs,
    newEndMs,
  );
  return true;
}

// =============================================================================
// Zoom Out Handler
// =============================================================================

/**
 * Handle zoom out gesture (Cmd/Ctrl + wheel down).
 *
 * Validates constraints (max range, max bucket count) and applies
 * asymmetric zoom if needed to stay within marker position limits.
 *
 * @returns true if zoom was applied, false if blocked
 */
function handleZoomOut(ctx: GestureContext, newRangeMs: number, logging: WheelLoggingContext): boolean {
  const {
    displayStartMs,
    displayEndMs,
    bucketTimestamps,
    entityStartTime,
    entityEndTime,
    now,
    actions,
    onDisplayRangeChange,
  } = ctx;
  const { dx, dy, effectiveDelta, beforeContext, buildDebugContext } = logging;

  const bucketWidthMs = calculateBucketWidth(bucketTimestamps);

  // Validate zoom out constraints (MAX_RANGE_MS, MAX_BUCKET_COUNT)
  const zoomOutValidation = validateZoomOutConstraints(newRangeMs, bucketWidthMs);
  if (zoomOutValidation.blocked) {
    logTimelineEvent({
      timestamp: Date.now(),
      dx,
      dy,
      effectiveDelta,
      isZoom: true,
      wasBlocked: true,
      blockReason: zoomOutValidation.reason,
      oldRange: {
        start: new Date(displayStartMs).toISOString(),
        end: new Date(displayEndMs).toISOString(),
      },
      newRange: {
        start: new Date(displayStartMs).toISOString(),
        end: new Date(displayEndMs).toISOString(),
      },
      beforeContext,
      afterContext: beforeContext, // Blocked - no change
    });
    return false;
  }

  // For zoom out, use asymmetric zoom calculation
  // This tries symmetric first, then shifts to one side if needed
  const asymmetricResult = calculateAsymmetricZoom(
    displayStartMs,
    displayEndMs,
    newRangeMs,
    entityStartTime,
    entityEndTime,
    now,
    bucketTimestamps,
    validateInvalidZoneLimits,
  );

  if (asymmetricResult.blocked) {
    logTimelineEvent({
      timestamp: Date.now(),
      dx,
      dy,
      effectiveDelta,
      isZoom: true,
      wasBlocked: true,
      blockReason: asymmetricResult.reason,
      oldRange: {
        start: new Date(displayStartMs).toISOString(),
        end: new Date(displayEndMs).toISOString(),
      },
      newRange: {
        start: new Date(displayStartMs).toISOString(),
        end: new Date(displayEndMs).toISOString(),
      },
      beforeContext,
      afterContext: beforeContext, // Blocked - no change
    });
    return false;
  }

  const newStart = new Date(asymmetricResult.newStartMs!);
  const newEnd = new Date(asymmetricResult.newEndMs!);

  logTimelineEvent({
    timestamp: Date.now(),
    dx,
    dy,
    effectiveDelta,
    isZoom: true,
    wasBlocked: false,
    asymmetricApplied: asymmetricResult.wasAsymmetric,
    oldRange: {
      start: new Date(displayStartMs).toISOString(),
      end: new Date(displayEndMs).toISOString(),
    },
    newRange: {
      start: newStart.toISOString(),
      end: newEnd.toISOString(),
    },
    beforeContext,
    afterContext: buildDebugContext(asymmetricResult.newStartMs, asymmetricResult.newEndMs),
  });

  actions.setPendingDisplay(newStart, newEnd);
  onDisplayRangeChange(newStart, newEnd);
  return true;
}

// =============================================================================
// Pan Handler
// =============================================================================

/**
 * Handle pan gesture (wheel without modifier keys).
 *
 * Pans the display range left or right, constraining to marker position limits.
 * If the requested pan would violate limits, constrains to maximum allowed amount.
 *
 * @returns true if pan was applied (even if constrained), false if completely blocked
 */
function handlePan(ctx: GestureContext, effectiveDelta: number, logging: WheelLoggingContext): boolean {
  const {
    displayStartMs,
    displayEndMs,
    displayRangeMs,
    bucketTimestamps,
    entityStartTime,
    entityEndTime,
    now,
    actions,
    onDisplayRangeChange,
  } = ctx;
  const { dx, dy, beforeContext, buildDebugContext } = logging;

  // Calculate pan amount proportional to bucket size
  // Pan by 2 buckets per wheel event (or 10% of viewport, whichever is smaller)
  const bucketWidthMs = calculateBucketWidth(bucketTimestamps);
  const bucketsPerWheelEvent = 2;
  const bucketBasedPanMs = bucketWidthMs * bucketsPerWheelEvent;
  const percentageBasedPanMs = displayRangeMs * PAN_FACTOR;
  const panAmountMs = Math.min(bucketBasedPanMs, percentageBasedPanMs);

  let deltaMs = effectiveDelta < 0 ? -panAmountMs : panAmountMs;

  let newStart = new Date(displayStartMs + deltaMs);
  let newEnd = new Date(displayEndMs + deltaMs);

  // Validate marker position limits
  const validation = validateInvalidZoneLimits(
    newStart.getTime(),
    newEnd.getTime(),
    entityStartTime,
    entityEndTime,
    now,
    bucketTimestamps,
  );

  // If blocked, try to constrain pan to maximum allowed amount
  let wasConstrained = false;
  if (validation.blocked) {
    if (bucketWidthMs === 0) {
      logTimelineEvent({
        timestamp: Date.now(),
        dx,
        dy,
        effectiveDelta,
        isZoom: false,
        wasBlocked: true,
        blockReason: "zero-bucket-width",
        oldRange: {
          start: new Date(displayStartMs).toISOString(),
          end: new Date(displayEndMs).toISOString(),
        },
        newRange: {
          start: newStart.toISOString(),
          end: newEnd.toISOString(),
        },
        beforeContext,
        afterContext: buildDebugContext(newStart.getTime(), newEnd.getTime()),
      });
      return false;
    }

    // CRITICAL FIX: Allow panning back from limit
    // If we're at the LEFT limit but trying to pan RIGHT, allow it (no constraint)
    // If we're at the RIGHT limit but trying to pan LEFT, allow it (no constraint)
    // Only constrain when panning FURTHER past the marker limit
    if (
      (validation.reason === "left-invalid-zone-limit" && deltaMs > 0) ||
      (validation.reason === "right-invalid-zone-limit" && deltaMs < 0)
    ) {
      // Panning away from the limit - allow it without constraint
      actions.setPendingDisplay(newStart, newEnd);
      onDisplayRangeChange(newStart, newEnd);
      return true;
    }

    // Calculate exact position where marker would be at limit
    // This ensures smooth panning without snapping/jittering
    const entityStartMs = entityStartTime.getTime();
    const rightBoundaryMs = entityEndTime?.getTime() ?? now;

    // Calculate where display range should be positioned to have marker at EXACTLY the limit
    let constrainedStart: number;
    let constrainedEnd: number;

    if (validation.reason === "left-invalid-zone-limit") {
      // Panning left - constrain so start marker is at MAX_MARKER_POSITION_PERCENT from left edge
      // We want: entityStartMs at 50% of viewport → constrainedStart = entityStartMs - (0.5 × range)
      const maxMarkerOffsetMs = (MAX_MARKER_POSITION_PERCENT / 100) * displayRangeMs;
      constrainedStart = entityStartMs - maxMarkerOffsetMs;
      constrainedEnd = constrainedStart + displayRangeMs;

      // Calculate the constrained delta (maximum allowed pan toward limit)
      const constrainedDeltaMs = constrainedStart - displayStartMs;

      // If we're already past the limit, don't allow further panning in that direction
      if (constrainedDeltaMs >= 0) {
        logTimelineEvent({
          timestamp: Date.now(),
          dx,
          dy,
          effectiveDelta,
          isZoom: false,
          wasBlocked: true,
          blockReason: "at-limit: already past left boundary",
          oldRange: {
            start: new Date(displayStartMs).toISOString(),
            end: new Date(displayEndMs).toISOString(),
          },
          newRange: {
            start: new Date(displayStartMs).toISOString(),
            end: new Date(displayEndMs).toISOString(),
          },
          beforeContext,
          afterContext: beforeContext,
        });
        return false;
      }

      // Only apply constraint if requested delta would overshoot the limit
      // (deltaMs < constrainedDeltaMs means requesting more left pan than allowed)
      if (deltaMs < constrainedDeltaMs) {
        deltaMs = constrainedDeltaMs;
      }
    } else if (validation.reason === "right-invalid-zone-limit") {
      // Panning right - constrain so end marker is at MAX_MARKER_POSITION_PERCENT from right edge
      // We want: rightBoundaryMs at 50% from right → constrainedEnd = rightBoundaryMs + (0.5 × range)
      const maxMarkerOffsetMs = (MAX_MARKER_POSITION_PERCENT / 100) * displayRangeMs;
      constrainedEnd = rightBoundaryMs + maxMarkerOffsetMs;
      constrainedStart = constrainedEnd - displayRangeMs;

      // Calculate the constrained delta (maximum allowed pan toward limit)
      const constrainedDeltaMs = constrainedEnd - displayEndMs;

      // If we're already past the limit, don't allow further panning in that direction
      if (constrainedDeltaMs <= 0) {
        logTimelineEvent({
          timestamp: Date.now(),
          dx,
          dy,
          effectiveDelta,
          isZoom: false,
          wasBlocked: true,
          blockReason: "at-limit: already past right boundary",
          oldRange: {
            start: new Date(displayStartMs).toISOString(),
            end: new Date(displayEndMs).toISOString(),
          },
          newRange: {
            start: new Date(displayStartMs).toISOString(),
            end: new Date(displayEndMs).toISOString(),
          },
          beforeContext,
          afterContext: beforeContext,
        });
        return false;
      }

      // Only apply constraint if requested delta would overshoot the limit
      // (deltaMs > constrainedDeltaMs means requesting more right pan than allowed)
      if (deltaMs > constrainedDeltaMs) {
        deltaMs = constrainedDeltaMs;
      }
    } else {
      // Combined limit or unknown - block entirely
      logTimelineEvent({
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
        beforeContext,
        afterContext: buildDebugContext(newStart.getTime(), newEnd.getTime()),
      });
      return false;
    }

    // Apply constrained delta
    newStart = new Date(displayStartMs + deltaMs);
    newEnd = new Date(displayEndMs + deltaMs);
    wasConstrained = true;
  }

  logTimelineEvent({
    timestamp: Date.now(),
    dx,
    dy,
    effectiveDelta,
    isZoom: false,
    wasBlocked: false,
    wasConstrained,
    oldRange: {
      start: new Date(displayStartMs).toISOString(),
      end: new Date(displayEndMs).toISOString(),
    },
    newRange: {
      start: newStart.toISOString(),
      end: newEnd.toISOString(),
    },
    beforeContext,
    afterContext: buildDebugContext(newStart.getTime(), newEnd.getTime()),
  });

  actions.setPendingDisplay(newStart, newEnd);
  onDisplayRangeChange(newStart, newEnd);
  return true;
}

// =============================================================================
// Asymmetric Zoom Calculation
// =============================================================================

/**
 * Result of asymmetric zoom calculation.
 */
interface AsymmetricZoomResult {
  /** Whether the zoom was blocked entirely */
  blocked: boolean;
  /** Reason for blocking (if blocked) */
  reason?: string;
  /** New display start in milliseconds (if not blocked) */
  newStartMs?: number;
  /** New display end in milliseconds (if not blocked) */
  newEndMs?: number;
  /** Whether the zoom was shifted asymmetrically */
  wasAsymmetric?: boolean;
}

/**
 * Calculate asymmetric zoom when symmetric zoom would violate constraints.
 *
 * ## Algorithm (Center-Anchored with Marker Positioning)
 *
 * 1. Try symmetric expansion from center
 * 2. Validate against marker position constraints (left, right)
 * 3. If blocked on ONE side:
 *    a. Pin the marker on the constrained side at exactly MAX_MARKER_POSITION_PERCENT
 *    b. Transfer the remaining expansion to the opposite side
 *    c. Validate asymmetric result
 * 4. If blocked by combined limit: BLOCK (both sides contributing)
 * 5. If asymmetric validation fails: BLOCK entirely (all-or-nothing)
 * 6. If valid: return asymmetric zoom
 *
 * @param displayStartMs - Current display start in milliseconds
 * @param displayEndMs - Current display end in milliseconds
 * @param newRangeMs - Desired new range in milliseconds
 * @param entityStartTime - Entity start time (workflow start)
 * @param entityEndTime - Entity end time (undefined if running)
 * @param now - Current "NOW" timestamp
 * @param bucketTimestamps - Bucket timestamps for calculating bucket width
 * @param validateFn - Function to validate marker position limits
 * @returns Asymmetric zoom result
 */
function calculateAsymmetricZoom(
  displayStartMs: number,
  displayEndMs: number,
  newRangeMs: number,
  entityStartTime: Date,
  entityEndTime: Date | undefined,
  now: number,
  bucketTimestamps: Date[],
  validateFn: typeof validateInvalidZoneLimits,
): AsymmetricZoomResult {
  const centerMs = (displayStartMs + displayEndMs) / 2;
  const halfRange = newRangeMs / 2;

  // Step 1: Try symmetric expansion from center
  const symmetricStart = centerMs - halfRange;
  const symmetricEnd = centerMs + halfRange;

  const symmetricValidation = validateFn(
    symmetricStart,
    symmetricEnd,
    entityStartTime,
    entityEndTime,
    now,
    bucketTimestamps,
  );

  // If symmetric works, use it
  if (!symmetricValidation.blocked) {
    return {
      blocked: false,
      newStartMs: symmetricStart,
      newEndMs: symmetricEnd,
      wasAsymmetric: false,
    };
  }

  // Step 2: Determine which constraint was violated
  const { reason } = symmetricValidation;

  // Step 3: If combined limit violated, cannot compensate - BLOCK
  if (reason === "combined-invalid-zone-limit") {
    return {
      blocked: true,
      reason: "combined-invalid-zone-limit: both sides contribute to overflow, cannot compensate",
    };
  }

  // Step 4: Calculate asymmetric zoom with deficit transfer
  // Left and right cases follow identical logic - abstract to reduce duplication
  const bucketWidthMs = calculateBucketWidth(bucketTimestamps);
  if (bucketWidthMs === 0) {
    return { blocked: true, reason: "no-buckets: cannot calculate marker positioning" };
  }

  const entityStartMs = entityStartTime.getTime();
  const rightBoundaryMs = entityEndTime?.getTime() ?? now;

  // Determine which side is constrained and calculate bounds
  // CRITICAL: Asymmetric zoom pins one side and expands to achieve the target range
  // The constrained side stays at exactly 10% of the NEW range
  let constrainedStart: number;
  let constrainedEnd: number;

  if (reason === "left-invalid-zone-limit") {
    // Pin start marker at exactly MAX_MARKER_POSITION_PERCENT from left edge of NEW range
    //
    // markerOffset = entityStartMs - constrainedStart = MAX_MARKER_POSITION_PERCENT × newRange
    // constrainedStart = entityStartMs - (MAX_MARKER_POSITION_PERCENT × newRange)
    //
    // Then place right to achieve the full new range:
    // constrainedEnd = constrainedStart + newRange
    const maxMarkerOffsetMs = (MAX_MARKER_POSITION_PERCENT / 100) * newRangeMs;
    constrainedStart = entityStartMs - maxMarkerOffsetMs;
    constrainedEnd = constrainedStart + newRangeMs;
  } else if (reason === "right-invalid-zone-limit") {
    // Pin end marker at exactly MAX_MARKER_POSITION_PERCENT from right edge of NEW range
    //
    // markerOffset = constrainedEnd - rightBoundaryMs = MAX_MARKER_POSITION_PERCENT × newRange
    // constrainedEnd = rightBoundaryMs + (MAX_MARKER_POSITION_PERCENT × newRange)
    //
    // Then place left to achieve the full new range:
    // constrainedStart = constrainedEnd - newRange
    const maxMarkerOffsetMs = (MAX_MARKER_POSITION_PERCENT / 100) * newRangeMs;
    constrainedEnd = rightBoundaryMs + maxMarkerOffsetMs;
    constrainedStart = constrainedEnd - newRangeMs;
  } else {
    return { blocked: true, reason: `unknown-validation-reason: ${reason}` };
  }

  // Validate asymmetric result
  const asymmetricValidation = validateFn(
    constrainedStart,
    constrainedEnd,
    entityStartTime,
    entityEndTime,
    now,
    bucketTimestamps,
  );

  if (!asymmetricValidation.blocked) {
    return { blocked: false, newStartMs: constrainedStart, newEndMs: constrainedEnd, wasAsymmetric: true };
  }

  // Asymmetric compensation also failed - BLOCK entirely
  return {
    blocked: true,
    reason: `asymmetric-failed: ${reason === "left-invalid-zone-limit" ? "left" : "right"} pinned at limit, but ${asymmetricValidation.reason}`,
  };
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
 *    - Subject to marker position limits (max 50% of viewport)
 *
 * 2. **Cmd/Ctrl + wheel/scroll** (metaKey or ctrlKey) → **ZOOM in/out**
 *    - Trackpad pinch in / wheel up with Cmd → zoom in (decrease visible range)
 *    - Trackpad pinch out / wheel down with Cmd → zoom out (increase visible range)
 *    - Keeps center point stable while changing range
 *    - Respects minimum range limit and marker position limits (max 50% of viewport)
 *
 * These behaviors DO NOT interfere with each other - they are handled in completely
 * separate if/else branches.
 *
 * ## Marker Position Limits
 *
 * Pan and zoom operations are constrained so that entity markers (start/end)
 * cannot move beyond 50% of the viewport. This prevents users from panning
 * so far that entity boundaries are no longer visible.
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
  debugContext: {
    entityStartTime: Date;
    entityEndTime?: Date;
    now: number;
    overlayPositions?: { leftWidth: number; rightStart: number; rightWidth: number };
  },
): void {
  const { currentDisplay, currentEffective, currentStartPercent, actions } = state;

  // Initialize debug system on first render
  initTimelineDebug();

  // Build debug context object
  // Accepts optional custom display range for post-operation logging
  // skipDomMeasurements: set to true when building "before" context to avoid measuring old DOM state
  const buildDebugContext = useCallback(
    (_customDisplayStart?: number, _customDisplayEnd?: number, _skipDomMeasurements?: boolean) => {
      if (!isTimelineDebugEnabled() || !debugContext) return undefined;

      return {
        entityStart: debugContext.entityStartTime.toISOString(),
        entityEnd: debugContext.entityEndTime?.toISOString(),
        now: debugContext.now ? new Date(debugContext.now).toISOString() : undefined,
        effectiveStart: currentEffective.start?.toISOString() ?? "undefined",
        effectiveEnd: currentEffective.end?.toISOString() ?? "undefined",
        currentStartPercent: currentStartPercent ?? 0,
        windowLeft: debugContext.overlayPositions?.leftWidth,
        windowRight: debugContext.overlayPositions?.rightStart,
      };
    },
    [debugContext, currentEffective, currentStartPercent],
  );

  // Helper to log wheel event after React re-renders and paints DOM updates
  // Uses requestAnimationFrame to defer measurement until after browser paint
  const logEventAfterRender = useCallback(
    (event: Omit<WheelDebugEvent, "afterContext">, newStartMs: number, newEndMs: number) => {
      if (!isTimelineDebugEnabled()) return;

      // Defer measurement until after React re-renders and browser paints
      requestAnimationFrame(() => {
        const afterContext = buildDebugContext(newStartMs, newEndMs, false);
        logTimelineEvent({
          ...event,
          afterContext,
        });
      });
    },
    [buildDebugContext],
  );

  useWheel(
    ({ event, delta: [dx, dy] }) => {
      // Prevent default browser scroll behavior
      event.preventDefault();

      // Check modifier key to determine behavior
      const isZoom = event.metaKey || event.ctrlKey;
      const displayStartMs = currentDisplay.start.getTime();
      const displayEndMs = currentDisplay.end.getTime();
      const displayRangeMs = displayEndMs - displayStartMs;

      // Capture "before" state for debug logging (skip DOM measurements - they'll be stale)
      const beforeContext = buildDebugContext(undefined, undefined, true);

      // Build common context for gesture handlers
      const gestureCtx: GestureContext = {
        displayStartMs,
        displayEndMs,
        displayRangeMs,
        bucketTimestamps,
        entityStartTime: debugContext.entityStartTime,
        entityEndTime: debugContext.entityEndTime,
        now: debugContext.now,
        actions,
        onDisplayRangeChange,
      };

      // ========================================================================
      // BEHAVIOR 1: ZOOM (Cmd/Ctrl + wheel)
      // ========================================================================
      if (isZoom) {
        // Use whichever delta is larger (supports both vertical wheel and horizontal trackpad)
        const primaryDelta = Math.abs(dy) > Math.abs(dx) ? dy : dx;

        // Skip if no effective delta (prevents spurious zoom when delta=0)
        if (primaryDelta === 0) return;

        const isZoomingIn = primaryDelta < 0;
        const factor = isZoomingIn ? ZOOM_IN_FACTOR : ZOOM_OUT_FACTOR;
        const newRangeMs = displayRangeMs * factor;

        // Build logging context
        const loggingCtx: WheelLoggingContext = {
          dx,
          dy,
          effectiveDelta: primaryDelta,
          beforeContext,
          buildDebugContext,
          logEventAfterRender,
        };

        // Delegate to appropriate zoom handler
        if (isZoomingIn) {
          handleZoomIn(gestureCtx, newRangeMs, loggingCtx);
        } else {
          handleZoomOut(gestureCtx, newRangeMs, loggingCtx);
        }
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

        // Build logging context
        const loggingCtx: WheelLoggingContext = {
          dx,
          dy,
          effectiveDelta,
          beforeContext,
          buildDebugContext,
          logEventAfterRender,
        };

        // Delegate to pan handler
        handlePan(gestureCtx, effectiveDelta, loggingCtx);
      }
    },
    {
      // Attach directly to DOM node via ref (recommended for preventDefault)
      target: containerRef,
      // Must set passive: false to allow preventDefault() to work
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
  now: number,
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

      // Check NOW constraint for end dragger (use synchronized NOW)
      if (side === "end" && isEndTimeNow && clampedTimeMs > now + NOW_THRESHOLD_MS) {
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

      // Check NOW constraint for end dragger (use synchronized NOW)
      if (side === "end" && isEndTimeNow && newTimeMs > now + NOW_THRESHOLD_MS) {
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
    [effectiveTime, side, isEndTimeNow, actions, currentEffective, now],
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

// =============================================================================
// Programmatic Zoom Controls
// =============================================================================

/**
 * Programmatic zoom controls return value.
 */
export interface ZoomControls {
  /** Zoom in (same as Cmd+Wheel Up) */
  zoomIn: () => void;
  /** Zoom out (same as Cmd+Wheel Down) */
  zoomOut: () => void;
  /** Whether zoom in is currently blocked */
  canZoomIn: boolean;
  /** Whether zoom out is currently blocked */
  canZoomOut: boolean;
}

/**
 * Hook for programmatic zoom controls (buttons, keyboard shortcuts, etc.).
 *
 * Provides the same zoom behavior as Cmd+Wheel gestures, but callable programmatically.
 * Uses the exact same zoom factors and validation logic as wheel events.
 *
 * @param state - Timeline state from useTimelineState
 * @param bucketTimestamps - Bucket timestamps for calculating bucket width
 * @param onDisplayRangeChange - Callback when display range changes
 * @param debugContext - Optional debug context (entityStart/End, now, window positions)
 * @returns Zoom control functions and state
 */
export function useTimelineZoomControls(
  state: ReturnType<typeof useTimelineState>,
  bucketTimestamps: Date[],
  onDisplayRangeChange: (start: Date, end: Date) => void,
  debugContext: {
    entityStartTime: Date;
    entityEndTime?: Date;
    now: number;
  },
): ZoomControls {
  const { currentDisplay, actions } = state;

  const zoomIn = useCallback(() => {
    const displayStartMs = currentDisplay.start.getTime();
    const displayEndMs = currentDisplay.end.getTime();
    const displayRangeMs = displayEndMs - displayStartMs;
    const bucketWidthMs = calculateBucketWidth(bucketTimestamps);

    // Calculate new range after zoom
    const newRangeMs = displayRangeMs * ZOOM_IN_FACTOR;

    // Validate basic zoom in constraints (min range, min bucket count)
    const zoomInValidation = validateZoomInConstraints(newRangeMs, bucketWidthMs);
    if (zoomInValidation.blocked) {
      // Zoom in blocked (e.g., min bucket count reached)
      return;
    }

    // Calculate symmetric zoom (center-anchored)
    const { newStartMs, newEndMs } = calculateSymmetricZoom(displayStartMs, displayEndMs, newRangeMs);

    // Validate marker position constraints
    const validation = validateInvalidZoneLimits(
      newStartMs,
      newEndMs,
      debugContext?.entityStartTime,
      debugContext?.entityEndTime,
      debugContext?.now,
      bucketTimestamps,
    );

    if (validation.blocked) {
      // Zoom in blocked by marker position limits
      return;
    }

    // Apply zoom
    const newStart = new Date(newStartMs);
    const newEnd = new Date(newEndMs);
    actions.setPendingDisplay(newStart, newEnd);
    onDisplayRangeChange(newStart, newEnd);
  }, [currentDisplay, bucketTimestamps, debugContext, actions, onDisplayRangeChange]);

  const zoomOut = useCallback(() => {
    const displayStartMs = currentDisplay.start.getTime();
    const displayEndMs = currentDisplay.end.getTime();
    const displayRangeMs = displayEndMs - displayStartMs;
    const bucketWidthMs = calculateBucketWidth(bucketTimestamps);

    // Calculate new range after zoom
    const newRangeMs = displayRangeMs * ZOOM_OUT_FACTOR;

    // Validate basic zoom out constraints (max range, max bucket count)
    const zoomOutValidation = validateZoomOutConstraints(newRangeMs, bucketWidthMs);
    if (zoomOutValidation.blocked) {
      // Zoom out blocked (e.g., max bucket count reached)
      return;
    }

    // Use asymmetric zoom calculation which handles both symmetric and asymmetric internally
    const asymmetricResult = calculateAsymmetricZoom(
      displayStartMs,
      displayEndMs,
      newRangeMs,
      debugContext.entityStartTime,
      debugContext.entityEndTime,
      debugContext.now,
      bucketTimestamps,
      validateInvalidZoneLimits,
    );

    if (asymmetricResult.blocked) {
      // Zoom out blocked by marker position limits
      return;
    }

    // Apply zoom (may be symmetric or asymmetric)
    const newStart = new Date(asymmetricResult.newStartMs!);
    const newEnd = new Date(asymmetricResult.newEndMs!);
    actions.setPendingDisplay(newStart, newEnd);
    onDisplayRangeChange(newStart, newEnd);
  }, [currentDisplay, bucketTimestamps, debugContext, actions, onDisplayRangeChange]);

  // Calculate whether zoom operations are currently possible
  const canZoomIn = useMemo(() => {
    const displayStartMs = currentDisplay.start.getTime();
    const displayEndMs = currentDisplay.end.getTime();
    const displayRangeMs = displayEndMs - displayStartMs;
    const bucketWidthMs = calculateBucketWidth(bucketTimestamps);

    // Calculate new range after zoom
    const newRangeMs = displayRangeMs * ZOOM_IN_FACTOR;

    // Check basic zoom in constraints
    const zoomInValidation = validateZoomInConstraints(newRangeMs, bucketWidthMs);
    if (zoomInValidation.blocked) return false;

    // Check marker position constraints
    const { newStartMs, newEndMs } = calculateSymmetricZoom(displayStartMs, displayEndMs, newRangeMs);
    const validation = validateInvalidZoneLimits(
      newStartMs,
      newEndMs,
      debugContext?.entityStartTime,
      debugContext?.entityEndTime,
      debugContext?.now,
      bucketTimestamps,
    );

    return !validation.blocked;
  }, [currentDisplay, bucketTimestamps, debugContext]);

  const canZoomOut = useMemo(() => {
    const displayStartMs = currentDisplay.start.getTime();
    const displayEndMs = currentDisplay.end.getTime();
    const displayRangeMs = displayEndMs - displayStartMs;
    const bucketWidthMs = calculateBucketWidth(bucketTimestamps);

    // Calculate new range after zoom
    const newRangeMs = displayRangeMs * ZOOM_OUT_FACTOR;

    // Check basic zoom out constraints
    const zoomOutValidation = validateZoomOutConstraints(newRangeMs, bucketWidthMs);
    if (zoomOutValidation.blocked) return false;

    // Check if asymmetric zoom would work (handles both symmetric and asymmetric)
    const asymmetricResult = calculateAsymmetricZoom(
      displayStartMs,
      displayEndMs,
      newRangeMs,
      debugContext.entityStartTime,
      debugContext.entityEndTime,
      debugContext.now,
      bucketTimestamps,
      validateInvalidZoneLimits,
    );

    return !asymmetricResult.blocked;
  }, [currentDisplay, bucketTimestamps, debugContext]);

  return {
    zoomIn,
    zoomOut,
    canZoomIn,
    canZoomOut,
  };
}
