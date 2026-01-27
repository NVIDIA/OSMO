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
import { useCallback, useRef, useState } from "react";
import type { useTimelineState } from "./use-timeline-state";
import { clampTimeToRange, validateInvalidZoneLimits, calculateMaxInvalidZoneBuckets } from "../lib/timeline-utils";
import { validateZoomInConstraints, validateZoomOutConstraints, calculateSymmetricZoom } from "../lib/wheel-validation";
import {
  PAN_FACTOR,
  ZOOM_IN_FACTOR,
  ZOOM_OUT_FACTOR,
  KEYBOARD_NUDGE_MS,
  NOW_THRESHOLD_MS,
} from "../lib/timeline-constants";
import { calculateBucketWidth, calculateInvalidZonePositions } from "../lib/invalid-zones";

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
  asymmetricApplied?: boolean;
  wasConstrained?: boolean;
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
    // Invalid zone debug info
    leftInvalidWidth?: number;
    rightInvalidWidth?: number;
    leftInvalidBuckets?: number;
    rightInvalidBuckets?: number;
    combinedInvalidBuckets?: number;
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

  if (isDebugEnabled) {
    console.log(
      "[Timeline Debug] ✅ ENABLED\n" +
        "  • window.timelineDebug() - view all events table\n" +
        "  • window.timelineDebugCurrent() - show current state & invalid zones\n" +
        "  • window.timelineDebugStats() - show statistics\n" +
        "  • window.timelineDebugClear() - clear logs",
    );
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
          leftInvalid: e.context?.leftInvalidWidth?.toFixed(1) + "%" || "-",
          rightInvalid: e.context?.rightInvalidWidth?.toFixed(1) + "%" || "-",
          totalInvalid: e.context?.combinedInvalidBuckets?.toFixed(1) + " buckets" || "-",
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

    (window as unknown as Record<string, () => void>).timelineDebugCurrent = () => {
      const latest = wheelDebugLog[wheelDebugLog.length - 1];
      if (!latest || !latest.context) {
        console.log("[Timeline Debug] No events logged yet");
        return;
      }

      // Calculate limits based on current state
      const displayRangeMs = new Date(latest.newRange.end).getTime() - new Date(latest.newRange.start).getTime();
      const leftInvalidMs = ((latest.context.leftInvalidWidth ?? 0) / 100) * displayRangeMs;
      const rightInvalidMs = ((latest.context.rightInvalidWidth ?? 0) / 100) * displayRangeMs;
      const totalInvalidMs = leftInvalidMs + rightInvalidMs;

      // Estimate bucket width from invalid zone data
      const bucketWidthMs =
        totalInvalidMs > 0 && (latest.context.combinedInvalidBuckets ?? 0) > 0
          ? totalInvalidMs / (latest.context.combinedInvalidBuckets ?? 1)
          : 60000; // fallback to 1 minute

      // Use single source of truth for limit calculations
      const limits = calculateMaxInvalidZoneBuckets(displayRangeMs, bucketWidthMs);
      const totalBucketsVisible = displayRangeMs / bucketWidthMs;

      console.log("[Timeline Debug] Current State:", {
        displayRange: `${latest.newRange.start} → ${latest.newRange.end}`,
        entityBounds: `${latest.context.entityStart} → ${latest.context.entityEnd}`,
        invalidZones: {
          left: `${latest.context.leftInvalidWidth?.toFixed(1)}% (${latest.context.leftInvalidBuckets?.toFixed(1)} buckets)`,
          right: `${latest.context.rightInvalidWidth?.toFixed(1)}% (${latest.context.rightInvalidBuckets?.toFixed(1)} buckets)`,
          combined: `${latest.context.combinedInvalidBuckets?.toFixed(1)} buckets`,
        },
        limits: {
          perSide: `${limits.maxBucketsPerSide} buckets (10% of ${totalBucketsVisible.toFixed(1)} visible)`,
          combined: `${limits.maxBucketsCombined} buckets (20% of ${totalBucketsVisible.toFixed(1)} visible)`,
        },
        bucketWidth: `${(bucketWidthMs / 1000).toFixed(1)}s`,
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
 * ## Algorithm (Center-Anchored with Monotonic Decrease)
 *
 * 1. Try symmetric expansion from center
 * 2. Validate against ALL THREE constraints (left, right, combined)
 * 3. If blocked by per-side limit on ONE side:
 *    a. Calculate ideal edge position for new bucket-quantized limit
 *    b. Constrain to ensure monotonic decrease (can only move toward entity or stay)
 *    c. Transfer deficit from constrained expansion to opposite side
 *    d. Validate asymmetric result
 * 4. If blocked by combined limit: BLOCK (both sides contributing)
 * 5. If asymmetric validation fails: BLOCK entirely (all-or-nothing)
 * 6. If valid: return asymmetric zoom
 *
 * ## Monotonic Decrease Strategy (Zoom OUT only shrinks invalid zones)
 *
 * **CRITICAL CONSTRAINT**: During zoom OUT, invalid zone absolute width is **monotonically non-increasing**:
 * - Can **decrease** (edge moves toward entity boundary, "pulling in")
 * - Can **stay same** (edge pinned at current position)
 * - Can **NEVER increase** (prevents exceeding limits on subsequent operations)
 *
 * During zoom IN: No constraint needed (viewport edges naturally move toward center,
 * which pushes invalid zones outward - never violates limits)
 *
 * **Implementation**:
 * - Left edge: `Math.max(idealPosition, currentPosition)` → only moves RIGHT (toward entity) or stays
 * - Right edge: `Math.min(idealPosition, currentPosition)` → only moves LEFT (toward entity) or stays
 *
 * **Example**: 60s buckets, zooming from 25 buckets (1500s) → 30 buckets (1800s)
 *   - Currently: 2 buckets (120s) left invalid zone at limit
 *   - New limit: 3 buckets (180s) allowed
 *   - Ideal position: entityStart - 180s
 *   - Current position: entityStart - 120s
 *   - **Constrained: Math.max(ideal, current) = keep current (stay at 120s, don't grow to 180s)**
 *   - Result: 120s / 1800s = 6.7% (well under limit ✓)
 *   - Zoom back in: 120s is still under limit ✓ (monotonic decrease prevented over-limit state!)
 *
 * ## Three-Constraint System
 *
 * Valid states form a triangle:
 *   [10%][data][0%]  ✓ At left boundary
 *   [5%][data][5%]   ✓ Balanced
 *   [0%][data][10%]  ✓ At right boundary
 *   [10%][data][10%] ✓ Both at limit (combined 20%)
 *   [7%][data][3%]   ✓ Within triangle
 *   [11%][data][0%]  ✗ Left exceeds per-side
 *   [10%][data][11%] ✗ Right exceeds per-side
 *
 * @param displayStartMs - Current display start in milliseconds
 * @param displayEndMs - Current display end in milliseconds
 * @param newRangeMs - Desired new range in milliseconds
 * @param entityStartTime - Entity start time (workflow start)
 * @param entityEndTime - Entity end time (undefined if running)
 * @param now - Current "NOW" timestamp
 * @param bucketTimestamps - Bucket timestamps for calculating bucket width
 * @param validateFn - Function to validate invalid zone limits
 * @returns Asymmetric zoom result
 */
function calculateAsymmetricZoom(
  displayStartMs: number,
  displayEndMs: number,
  newRangeMs: number,
  entityStartTime: Date | undefined,
  entityEndTime: Date | undefined,
  now: number | undefined,
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

  // Calculate bucket width for positioning invalid zones at limit
  const bucketWidthMs = calculateBucketWidth(bucketTimestamps);
  if (bucketWidthMs === 0 || !entityStartTime) {
    // No buckets or entity - cannot calculate, block
    return {
      blocked: true,
      reason: "no-buckets-or-entity: cannot calculate invalid zone positioning",
    };
  }

  // CRITICAL: Use single source of truth for max invalid zone calculation
  const limits = calculateMaxInvalidZoneBuckets(newRangeMs, bucketWidthMs);
  const maxInvalidZoneMs = limits.maxInvalidZoneMsPerSide; // Quantized to bucket boundaries

  // Step 4: Calculate asymmetric zoom with deficit transfer
  // CRITICAL CONSTRAINT: Monotonically decreasing invalid zones during zoom OUT
  // Invalid zone can only: stay same (pinned) or decrease (pulled toward entity)
  // This ensures we never exceed limits on subsequent zoom operations
  if (reason === "left-invalid-zone-limit") {
    // Left invalid zone would exceed limit if we expanded symmetrically
    // Calculate ideal position for max allowed invalid zone
    const entityStartMs = entityStartTime.getTime();
    const idealConstrainedStart = entityStartMs - maxInvalidZoneMs;

    // Enforce monotonic decrease: left edge can only move RIGHT (toward entity) or stay
    // Math.max ensures we pick the position CLOSER to entity (larger timestamp)
    const constrainedStart = Math.max(idealConstrainedStart, displayStartMs);

    // Calculate how much we wanted to expand left
    const symmetricLeftMove = displayStartMs - symmetricStart;
    // How much we actually moved left (may be 0 if pinned)
    const constrainedLeftMove = displayStartMs - constrainedStart;
    const leftDeficit = symmetricLeftMove - constrainedLeftMove;

    // Transfer deficit to right side
    const constrainedEnd = symmetricEnd + leftDeficit;

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
      return {
        blocked: false,
        newStartMs: constrainedStart,
        newEndMs: constrainedEnd,
        wasAsymmetric: true,
      };
    }

    // Asymmetric version also failed - BLOCK entirely
    return {
      blocked: true,
      reason: `asymmetric-failed: left constrained to monotonic decrease, transferred deficit to right but ${asymmetricValidation.reason}`,
    };
  }

  if (reason === "right-invalid-zone-limit") {
    // Right invalid zone would exceed limit if we expanded symmetrically
    // Calculate ideal position for max allowed invalid zone
    const rightBoundaryMs = entityEndTime?.getTime() ?? now ?? Date.now();
    const idealConstrainedEnd = rightBoundaryMs + maxInvalidZoneMs;

    // Enforce monotonic decrease: right edge can only move LEFT (toward entity) or stay
    // Math.min ensures we pick the position CLOSER to entity (smaller timestamp)
    const constrainedEnd = Math.min(idealConstrainedEnd, displayEndMs);

    // Calculate how much we wanted to expand right
    const symmetricRightMove = symmetricEnd - displayEndMs;
    // How much we actually moved right (may be 0 if pinned)
    const constrainedRightMove = constrainedEnd - displayEndMs;
    const rightDeficit = symmetricRightMove - constrainedRightMove;

    // Transfer deficit to left side
    const constrainedStart = symmetricStart - rightDeficit;

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
      return {
        blocked: false,
        newStartMs: constrainedStart,
        newEndMs: constrainedEnd,
        wasAsymmetric: true,
      };
    }

    // Asymmetric version also failed - BLOCK entirely
    return {
      blocked: true,
      reason: `asymmetric-failed: right constrained to monotonic decrease, transferred deficit to left but ${asymmetricValidation.reason}`,
    };
  }

  // Unknown reason - should not happen, but block to be safe
  return {
    blocked: true,
    reason: `unknown-validation-reason: ${reason}`,
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
  // Accepts optional custom display range for post-operation logging
  const buildDebugContext = useCallback(
    (customDisplayStart?: number, customDisplayEnd?: number) => {
      if (!isDebugEnabled || !debugContext) return undefined;

      // Calculate invalid zone positions for debug output
      const bucketWidthMs = calculateBucketWidth(bucketTimestamps);
      const displayStartMs = customDisplayStart ?? currentDisplay.start.getTime();
      const displayEndMs = customDisplayEnd ?? currentDisplay.end.getTime();
      const displayRangeMs = displayEndMs - displayStartMs;

      const invalidZones =
        debugContext.entityStartTime && bucketWidthMs > 0
          ? calculateInvalidZonePositions(
              debugContext.entityStartTime.getTime(),
              debugContext.entityEndTime?.getTime(),
              debugContext.now ?? Date.now(),
              displayStartMs,
              displayEndMs,
              bucketWidthMs,
              bucketTimestamps.length,
            )
          : null;

      // Calculate bucket counts for invalid zones
      const leftInvalidBuckets = invalidZones
        ? ((invalidZones.leftInvalidWidth / 100) * displayRangeMs) / bucketWidthMs
        : 0;
      const rightInvalidBuckets = invalidZones
        ? ((invalidZones.rightInvalidWidth / 100) * displayRangeMs) / bucketWidthMs
        : 0;

      return {
        entityStart: debugContext.entityStartTime?.toISOString(),
        entityEnd: debugContext.entityEndTime?.toISOString(),
        now: debugContext.now ? new Date(debugContext.now).toISOString() : undefined,
        effectiveStart: currentEffective.start?.toISOString() ?? "undefined",
        effectiveEnd: currentEffective.end?.toISOString() ?? "undefined",
        currentStartPercent: currentStartPercent ?? 0,
        windowLeft: debugContext.overlayPositions?.leftWidth,
        windowRight: debugContext.overlayPositions?.rightStart,
        // Invalid zone debug info
        leftInvalidWidth: invalidZones?.leftInvalidWidth,
        rightInvalidWidth: invalidZones?.rightInvalidWidth,
        leftInvalidBuckets,
        rightInvalidBuckets,
        combinedInvalidBuckets: leftInvalidBuckets + rightInvalidBuckets,
      };
    },
    [debugContext, currentEffective, currentStartPercent, currentDisplay, bucketTimestamps],
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

        // Calculate bucket width for bucket count constraints
        const bucketWidthMs = calculateBucketWidth(bucketTimestamps);

        // ====================================================================
        // ZOOM IN constraints
        // ====================================================================
        if (isZoomingIn) {
          // Validate zoom in constraints (MIN_RANGE_MS, MIN_BUCKET_COUNT)
          const zoomInValidation = validateZoomInConstraints(newRangeMs, bucketWidthMs);
          if (zoomInValidation.blocked) {
            logWheelEvent({
              timestamp: Date.now(),
              dx,
              dy,
              effectiveDelta: primaryDelta,
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
              context: buildDebugContext(),
            });
            return;
          }

          // Calculate symmetric zoom using pure function
          const { newStartMs, newEndMs } = calculateSymmetricZoom(displayStartMs, displayEndMs, newRangeMs);

          // CRITICAL: Validate invalid zone constraints for zoom in
          // When zooming in near invalid zones, the percentage of invalid zone
          // INCREASES (relative to the smaller viewport), potentially violating limits
          const validation = validateInvalidZoneLimits(
            newStartMs,
            newEndMs,
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
                start: new Date(newStartMs).toISOString(),
                end: new Date(newEndMs).toISOString(),
              },
              context: buildDebugContext(newStartMs, newEndMs),
            });
            return;
          }

          const newStart = new Date(newStartMs);
          const newEnd = new Date(newEndMs);

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
            context: buildDebugContext(newStartMs, newEndMs),
          });

          actions.setPendingDisplay(newStart, newEnd);
          onDisplayRangeChange(newStart, newEnd);
          return;
        }

        // ====================================================================
        // ZOOM OUT constraints
        // ====================================================================

        // Validate zoom out constraints (MAX_RANGE_MS, MAX_BUCKET_COUNT)
        const zoomOutValidation = validateZoomOutConstraints(newRangeMs, bucketWidthMs);
        if (zoomOutValidation.blocked) {
          logWheelEvent({
            timestamp: Date.now(),
            dx,
            dy,
            effectiveDelta: primaryDelta,
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
            context: buildDebugContext(),
          });
          return;
        }

        // For zoom out, use asymmetric zoom calculation
        // This tries symmetric first, then shifts to one side if needed
        const asymmetricResult = calculateAsymmetricZoom(
          displayStartMs,
          displayEndMs,
          newRangeMs,
          debugContext?.entityStartTime,
          debugContext?.entityEndTime,
          debugContext?.now,
          bucketTimestamps,
          validateInvalidZoneLimits,
        );

        if (asymmetricResult.blocked) {
          logWheelEvent({
            timestamp: Date.now(),
            dx,
            dy,
            effectiveDelta: primaryDelta,
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
            context: buildDebugContext(),
          });
          return;
        }

        const newStart = new Date(asymmetricResult.newStartMs!);
        const newEnd = new Date(asymmetricResult.newEndMs!);

        logWheelEvent({
          timestamp: Date.now(),
          dx,
          dy,
          effectiveDelta: primaryDelta,
          isZoom: true,
          wasBlocked: false,
          blockReason: asymmetricResult.wasAsymmetric ? "asymmetric-zoom-applied" : undefined,
          oldRange: {
            start: new Date(displayStartMs).toISOString(),
            end: new Date(displayEndMs).toISOString(),
          },
          newRange: {
            start: newStart.toISOString(),
            end: newEnd.toISOString(),
          },
          context: buildDebugContext(asymmetricResult.newStartMs, asymmetricResult.newEndMs),
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

        // Validate invalid zone limits
        const validation = validateInvalidZoneLimits(
          newStart.getTime(),
          newEnd.getTime(),
          debugContext?.entityStartTime,
          debugContext?.entityEndTime,
          debugContext?.now,
          bucketTimestamps,
        );

        // If blocked, try to constrain pan to maximum allowed amount
        let wasConstrained = false;
        if (validation.blocked) {
          const bucketWidthMs = calculateBucketWidth(bucketTimestamps);
          if (bucketWidthMs === 0) {
            logWheelEvent({
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
              context: buildDebugContext(newStart.getTime(), newEnd.getTime()),
            });
            return;
          }

          // Calculate CURRENT invalid zones (before pan)
          const currentInvalidZones = calculateInvalidZonePositions(
            debugContext?.entityStartTime?.getTime() ?? 0,
            debugContext?.entityEndTime?.getTime(),
            debugContext?.now ?? Date.now(),
            displayStartMs,
            displayEndMs,
            bucketWidthMs,
            bucketTimestamps.length,
          );

          const displayRangeMs = displayEndMs - displayStartMs;
          const currentLeftInvalidMs = (currentInvalidZones.leftInvalidWidth / 100) * displayRangeMs;
          const currentRightInvalidMs = (currentInvalidZones.rightInvalidWidth / 100) * displayRangeMs;
          const currentLeftInvalidBuckets = currentLeftInvalidMs / bucketWidthMs;
          const currentRightInvalidBuckets = currentRightInvalidMs / bucketWidthMs;

          // Use single source of truth for max invalid zone calculation
          const limits = calculateMaxInvalidZoneBuckets(displayRangeMs, bucketWidthMs);
          const maxInvalidBucketsPerSide = limits.maxBucketsPerSide;

          // Determine which side is being constrained and calculate headroom
          let maxAllowedDeltaMs = 0;

          if (validation.reason === "left-invalid-zone-limit") {
            // Panning left - constrain by left invalid zone limit
            // Available headroom = (maxBuckets - currentBuckets) * bucketWidth
            const availableBuckets = Math.max(0, maxInvalidBucketsPerSide - currentLeftInvalidBuckets);
            maxAllowedDeltaMs = -(availableBuckets * bucketWidthMs);
          } else if (validation.reason === "right-invalid-zone-limit") {
            // Panning right - constrain by right invalid zone limit
            const availableBuckets = Math.max(0, maxInvalidBucketsPerSide - currentRightInvalidBuckets);
            maxAllowedDeltaMs = availableBuckets * bucketWidthMs;
          } else {
            // Combined limit or unknown - block entirely
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
              context: buildDebugContext(newStart.getTime(), newEnd.getTime()),
            });
            return;
          }

          // Apply constrained delta (may be zero if already at limit)
          if (Math.abs(maxAllowedDeltaMs) < 1) {
            logWheelEvent({
              timestamp: Date.now(),
              dx,
              dy,
              effectiveDelta,
              isZoom: false,
              wasBlocked: true,
              blockReason: "at-limit: no headroom available",
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

          deltaMs = maxAllowedDeltaMs;
          newStart = new Date(displayStartMs + deltaMs);
          newEnd = new Date(displayEndMs + deltaMs);
          wasConstrained = true;
        }

        logWheelEvent({
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
          context: buildDebugContext(newStart.getTime(), newEnd.getTime()),
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
