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
 * Timeline Utilities
 *
 * Pure calculation functions for timeline state management.
 * These functions are unit-tested and handle all constraint logic.
 */

import { calculateInvalidZonePositions, calculateBucketWidth } from "./invalid-zones";

// =============================================================================
// Pure Calculation Functions
// =============================================================================

/**
 * Calculate position percentage from time within display range.
 *
 * @param timeMs - Time in milliseconds
 * @param displayStartMs - Display range start in milliseconds
 * @param displayEndMs - Display range end in milliseconds
 * @returns Position as percentage (0-100)
 */
export function calculatePositionPercent(timeMs: number, displayStartMs: number, displayEndMs: number): number {
  const rangeMs = displayEndMs - displayStartMs;
  if (rangeMs <= 0) return 0;
  return ((timeMs - displayStartMs) / rangeMs) * 100;
}

/**
 * Calculate time from percentage within display range.
 *
 * @param percent - Position as percentage (0-100)
 * @param displayStartMs - Display range start in milliseconds
 * @param displayEndMs - Display range end in milliseconds
 * @returns Time in milliseconds
 */
export function calculateTimeFromPercent(percent: number, displayStartMs: number, displayEndMs: number): number {
  const rangeMs = displayEndMs - displayStartMs;
  return displayStartMs + (percent / 100) * rangeMs;
}

/**
 * Clamp time to range boundaries.
 *
 * @param timeMs - Time in milliseconds
 * @param minMs - Minimum time in milliseconds
 * @param maxMs - Maximum time in milliseconds
 * @returns Clamped time in milliseconds
 */
export function clampTimeToRange(timeMs: number, minMs: number, maxMs: number): number {
  return Math.max(minMs, Math.min(maxMs, timeMs));
}

/**
 * Check if a gesture is a zoom operation (range size changed).
 *
 * @param newRangeMs - New range in milliseconds
 * @param currentRangeMs - Current range in milliseconds
 * @param tolerance - Tolerance for floating point comparison (default: 1ms)
 * @returns True if zoom gesture (range size changed)
 */
export function isZoomGesture(newRangeMs: number, currentRangeMs: number, tolerance: number = 1): boolean {
  return Math.abs(newRangeMs - currentRangeMs) > tolerance;
}

/**
 * Check if a pan gesture should be blocked at right boundary.
 *
 * @param newEndMs - New end time in milliseconds
 * @param currentEndMs - Current end time in milliseconds
 * @param boundaryEndMs - Boundary end time in milliseconds
 * @param newRangeMs - New range in milliseconds
 * @param currentRangeMs - Current range in milliseconds
 * @param thresholdMs - Threshold for boundary detection (default: 1000ms)
 * @returns True if pan should be blocked
 */
export function shouldBlockPan(
  newEndMs: number,
  currentEndMs: number,
  boundaryEndMs: number,
  newRangeMs: number,
  currentRangeMs: number,
  thresholdMs: number = 1000,
): boolean {
  const isPanningRight = newEndMs > currentEndMs;
  const isAtBoundary = currentEndMs >= boundaryEndMs - thresholdMs;
  const isZoom = isZoomGesture(newRangeMs, currentRangeMs);
  return isPanningRight && isAtBoundary && !isZoom;
}

// =============================================================================
// Constraint Validation
// =============================================================================

/**
 * Timeline boundaries (entity start/end times).
 */
export interface TimelineBounds {
  minTime: Date;
  maxTime: Date;
}

/**
 * Result of pan constraint validation.
 */
export interface PanConstraintResult {
  blocked: boolean;
  reason?: "left-boundary" | "right-boundary" | "left-invalid-zone-boundary";
}

/**
 * Validate pan constraint against boundaries and effective times.
 *
 * ## 2-Layer Model Constraints
 *
 * Layer 1 (pannable): [invalidZoneLeft] [bars] [invalidZoneRight]
 * Layer 2 (fixed): [left overlay] | viewport | [right overlay]
 *
 * This enforces:
 * 1. Right boundary: Cannot pan past entity end boundary (unless zooming)
 * 2. Left boundary: Invalid zone left's right edge cannot pass window's left overlay right edge (unless zooming)
 *
 * @param newDisplayStart - New display start
 * @param newDisplayEnd - New display end
 * @param currentDisplayStart - Current display start
 * @param currentDisplayEnd - Current display end
 * @param bounds - Entity boundaries (minTime = entityStart, maxTime = entityEnd + padding)
 * @param currentStartPercent - Current start dragger position as fraction (0-1), undefined if not set
 * @param effectiveStartTime - Effective start time, undefined if not set
 * @returns Constraint validation result
 */
export function validatePanConstraint(
  newDisplayStart: Date,
  newDisplayEnd: Date,
  currentDisplayStart: Date,
  currentDisplayEnd: Date,
  bounds: TimelineBounds,
  currentStartPercent: number | undefined,
  effectiveStartTime: Date | undefined,
): PanConstraintResult {
  const newStartMs = newDisplayStart.getTime();
  const newEndMs = newDisplayEnd.getTime();
  const currentStartMs = currentDisplayStart.getTime();
  const currentEndMs = currentDisplayEnd.getTime();
  const boundaryEndMs = bounds.maxTime.getTime();
  const boundaryStartMs = bounds.minTime.getTime();
  const displayRangeMs = newEndMs - newStartMs;
  const currentRangeMs = currentEndMs - currentStartMs;

  // Check right boundary pan block
  if (shouldBlockPan(newEndMs, currentEndMs, boundaryEndMs, displayRangeMs, currentRangeMs)) {
    return { blocked: true, reason: "right-boundary" };
  }

  // Check left invalid zone boundary constraint
  // This prevents the invalid zone's right edge (entityStart) from passing
  // the window's left overlay right edge (effectiveStart position)
  if (currentStartPercent !== undefined && effectiveStartTime && displayRangeMs > 0) {
    const newEffectiveStartMs = newStartMs + currentStartPercent * displayRangeMs;

    if (boundaryStartMs > newEffectiveStartMs && !isZoomGesture(displayRangeMs, currentRangeMs)) {
      return { blocked: true, reason: "left-invalid-zone-boundary" };
    }
  }

  return { blocked: false };
}

/**
 * Calculate display range with padding around effective range.
 *
 * @param effectiveStart - Effective start time (can be undefined)
 * @param effectiveEnd - Effective end time (can be undefined)
 * @param fallbackStart - Fallback start if effective start is undefined
 * @param fallbackEnd - Fallback end if effective end is undefined
 * @param paddingRatio - Padding as ratio of range (default: 0.075 = 7.5%)
 * @param minPaddingMs - Minimum padding in milliseconds (default: 30000 = 30s)
 * @returns Display start and end with padding applied
 */
export function calculateDisplayRangeWithPadding(
  effectiveStart: Date | undefined,
  effectiveEnd: Date | undefined,
  fallbackStart: Date,
  fallbackEnd: Date,
  paddingRatio: number = 0.075,
  minPaddingMs: number = 30_000,
): { displayStart: Date; displayEnd: Date } {
  const startMs = effectiveStart?.getTime() ?? fallbackStart.getTime();
  const endMs = effectiveEnd?.getTime() ?? fallbackEnd.getTime();
  const rangeMs = endMs - startMs;
  const paddingMs = Math.max(rangeMs * paddingRatio, minPaddingMs);

  return {
    displayStart: new Date(startMs - paddingMs),
    displayEnd: new Date(endMs + paddingMs),
  };
}

// =============================================================================
// Overlay Position Calculations
// =============================================================================

/**
 * Result of overlay position calculation.
 */
export interface OverlayPositions {
  /** Width of left overlay as percentage (0-100) */
  leftWidth: number;
  /** Start position of right overlay as percentage (0-100) */
  rightStart: number;
  /** Width of right overlay as percentage (0-100) */
  rightWidth: number;
}

/**
 * Calculate overlay positions for the timeline window.
 *
 * The overlays dim areas outside the effective range within the display range.
 *
 * @param displayStartMs - Display range start in milliseconds
 * @param displayEndMs - Display range end in milliseconds
 * @param effectiveStartMs - Effective range start in milliseconds (or display start if undefined)
 * @param effectiveEndMs - Effective range end in milliseconds (or display end if undefined)
 * @returns Overlay positions as percentages, or null if display range is invalid
 */
export function calculateOverlayPositions(
  displayStartMs: number,
  displayEndMs: number,
  effectiveStartMs: number,
  effectiveEndMs: number,
): OverlayPositions | null {
  const displayRangeMs = displayEndMs - displayStartMs;
  if (displayRangeMs <= 0) return null;

  const leftWidth = ((effectiveStartMs - displayStartMs) / displayRangeMs) * 100;
  const rightStart = ((effectiveEndMs - displayStartMs) / displayRangeMs) * 100;
  const rightWidth = 100 - rightStart;

  return {
    leftWidth: Math.max(0, leftWidth),
    rightStart: Math.max(0, Math.min(100, rightStart)),
    rightWidth: Math.max(0, rightWidth),
  };
}

/**
 * Check if end time is considered "NOW".
 *
 * @param endTime - End time to check (undefined means NOW)
 * @param thresholdMs - Threshold for considering as NOW (default: 60000ms = 1 minute)
 * @returns True if end time is undefined or within threshold of current time
 */
export function isEndTimeNow(endTime: Date | undefined, thresholdMs: number = 60_000): boolean {
  if (!endTime) return true;
  const nowTime = Date.now();
  const diffMs = Math.abs(nowTime - endTime.getTime());
  return diffMs < thresholdMs;
}

/**
 * Calculate pan boundaries from entity times.
 *
 * @param entityStartMs - Entity start time in milliseconds
 * @param entityEndMs - Entity end time in milliseconds (undefined if running)
 * @param now - Current timestamp (for running entities)
 * @param paddingRatio - Padding ratio for completed entities (default: 0.075)
 * @param minPaddingMs - Minimum padding in milliseconds (default: 30000)
 * @returns Timeline bounds for pan constraints
 */
export function calculatePanBoundaries(
  entityStartMs: number,
  entityEndMs: number | undefined,
  now: number,
  paddingRatio: number = 0.075,
  minPaddingMs: number = 30_000,
): TimelineBounds {
  let endMs: number;
  if (entityEndMs !== undefined) {
    const durationMs = entityEndMs - entityStartMs;
    const paddingMs = Math.max(durationMs * paddingRatio, minPaddingMs);
    endMs = entityEndMs + paddingMs;
  } else {
    endMs = now + 60_000;
  }

  return {
    minTime: new Date(entityStartMs),
    maxTime: new Date(endMs),
  };
}

// =============================================================================
// Invalid Zone Constraints
// =============================================================================

/**
 * Result of invalid zone validation.
 */
export interface InvalidZoneValidation {
  /** Whether the display range violates invalid zone limits */
  blocked: boolean;
  /** Reason for blocking (if blocked) */
  reason?: "left-invalid-zone-limit" | "right-invalid-zone-limit";
  /** Left invalid zone percentage */
  leftInvalidPercent: number;
  /** Right invalid zone percentage */
  rightInvalidPercent: number;
}

/**
 * Validate that invalid zones don't exceed maximum percentage of viewport.
 *
 * This prevents panning/zooming too far such that most of the viewport
 * is just invalid zones (striped areas where no logs exist).
 *
 * @param newDisplayStartMs - New display start in milliseconds
 * @param newDisplayEndMs - New display end in milliseconds
 * @param entityStartTime - Entity start time (workflow start)
 * @param entityEndTime - Entity end time (undefined if running)
 * @param now - Current "NOW" timestamp
 * @param bucketTimestamps - Array of bucket timestamps to calculate bucket width
 * @param maxInvalidPercent - Maximum allowed invalid zone percentage (default: 10)
 * @returns Validation result
 */
export function validateInvalidZoneLimits(
  newDisplayStartMs: number,
  newDisplayEndMs: number,
  entityStartTime: Date | undefined,
  entityEndTime: Date | undefined,
  now: number | undefined,
  bucketTimestamps: Date[],
  maxInvalidPercent: number = 10,
): InvalidZoneValidation {
  // If no entity start, no invalid zones exist
  if (!entityStartTime) {
    return {
      blocked: false,
      leftInvalidPercent: 0,
      rightInvalidPercent: 0,
    };
  }

  const bucketWidthMs = calculateBucketWidth(bucketTimestamps);
  const zones = calculateInvalidZonePositions(
    entityStartTime.getTime(),
    entityEndTime?.getTime(),
    now ?? Date.now(),
    newDisplayStartMs,
    newDisplayEndMs,
    bucketWidthMs,
  );

  // Check if left invalid zone exceeds limit
  if (zones.leftInvalidWidth > maxInvalidPercent) {
    return {
      blocked: true,
      reason: "left-invalid-zone-limit",
      leftInvalidPercent: zones.leftInvalidWidth,
      rightInvalidPercent: zones.rightInvalidWidth,
    };
  }

  // Check if right invalid zone exceeds limit
  if (zones.rightInvalidWidth > maxInvalidPercent) {
    return {
      blocked: true,
      reason: "right-invalid-zone-limit",
      leftInvalidPercent: zones.leftInvalidWidth,
      rightInvalidPercent: zones.rightInvalidWidth,
    };
  }

  return {
    blocked: false,
    leftInvalidPercent: zones.leftInvalidWidth,
    rightInvalidPercent: zones.rightInvalidWidth,
  };
}
