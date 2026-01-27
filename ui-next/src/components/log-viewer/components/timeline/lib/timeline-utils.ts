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

// =============================================================================
// Constraint Validation
// =============================================================================

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
 * Result of max invalid zone bucket calculation.
 */
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
  reason?: "left-invalid-zone-limit" | "right-invalid-zone-limit" | "combined-invalid-zone-limit";
  /** Left invalid zone in bucket count */
  leftInvalidBuckets: number;
  /** Right invalid zone in bucket count */
  rightInvalidBuckets: number;
}

/**
 * Validate that invalid zones don't exceed maximum percentage of viewport.
 *
 * This prevents panning/zooming too far such that most of the viewport
 * is just invalid zones (striped areas where no logs exist).
 *
 * ## Three-Constraint System (Triangle of Valid States)
 *
 * All THREE constraints must pass:
 * 1. left ≤ 10% (per-side limit)
 * 2. right ≤ 10% (per-side limit)
 * 3. left + right ≤ 20% (combined limit - allows both sides at 10% each)
 *
 * Valid states form a triangle:
 *   [10%][data][0%]   ✓ At left boundary
 *   [5%][data][5%]    ✓ Balanced
 *   [0%][data][10%]   ✓ At right boundary
 *   [10%][data][10%]  ✓ Both at limit
 *   [7%][data][3%]    ✓ Within triangle
 *   [11%][data][0%]   ✗ Left exceeds per-side
 *   [10%][data][11%]  ✗ Right exceeds per-side
 *   [11%][data][11%]  ✗ Combined exceeds (22% > 20%)
 *
 * This creates natural "give" during panning while respecting limits.
 *
 * Uses bucket-aligned calculation to ensure invalid zone boundaries snap to bar edges.
 *
 * @param newDisplayStartMs - New display start in milliseconds
 * @param newDisplayEndMs - New display end in milliseconds
 * @param entityStartTime - Entity start time (workflow start)
 * @param entityEndTime - Entity end time (undefined if running)
 * @param now - Current "NOW" timestamp
 * @param bucketTimestamps - Array of bucket timestamps to calculate bucket width
 * @param maxPerSidePercent - Maximum allowed invalid zone percentage per side (default: 10)
 * @param maxCombinedPercent - Maximum allowed combined invalid zone percentage (default: 20)
 * @returns Validation result
 */
export function validateInvalidZoneLimits(
  newDisplayStartMs: number,
  newDisplayEndMs: number,
  entityStartTime: Date,
  entityEndTime: Date | undefined,
  now: number | undefined,
  bucketTimestamps: Date[],
  maxPerSidePercent: number = 10,
  maxCombinedPercent: number = 20,
): InvalidZoneValidation {
  // NOTE: entityStartTime is guaranteed to exist (log-viewer only loads when workflow started)

  const bucketWidthMs = calculateBucketWidth(bucketTimestamps);

  // Guard against zero bucket width
  if (bucketWidthMs === 0) {
    return {
      blocked: false,
      leftInvalidBuckets: 0,
      rightInvalidBuckets: 0,
    };
  }

  const displayRangeMs = newDisplayEndMs - newDisplayStartMs;
  const zones = calculateInvalidZonePositions(
    entityStartTime.getTime(),
    entityEndTime?.getTime(),
    now ?? Date.now(),
    newDisplayStartMs,
    newDisplayEndMs,
    bucketWidthMs,
    bucketTimestamps.length,
  );

  // Convert percentage-based zone widths to milliseconds
  const leftInvalidMs = (zones.leftInvalidWidth / 100) * displayRangeMs;
  const rightInvalidMs = (zones.rightInvalidWidth / 100) * displayRangeMs;

  // Calculate bucket counts (how many bars worth of invalid zone) - for debug info
  const leftInvalidBuckets = leftInvalidMs / bucketWidthMs;
  const rightInvalidBuckets = rightInvalidMs / bucketWidthMs;

  // THREE-CONSTRAINT VALIDATION (all must pass)
  // CRITICAL: Validate against FRACTIONAL percentage limits, not quantized bucket counts
  // This ensures consistency with asymmetric zoom positioning which uses fractional limits
  // Using percentage directly avoids quantization mismatches

  // Constraint 1: Left per-side limit (percentage-based)
  if (zones.leftInvalidWidth > maxPerSidePercent) {
    return {
      blocked: true,
      reason: "left-invalid-zone-limit",
      leftInvalidBuckets,
      rightInvalidBuckets,
    };
  }

  // Constraint 2: Right per-side limit (percentage-based)
  if (zones.rightInvalidWidth > maxPerSidePercent) {
    return {
      blocked: true,
      reason: "right-invalid-zone-limit",
      leftInvalidBuckets,
      rightInvalidBuckets,
    };
  }

  // Constraint 3: Combined limit (both sides together)
  // This is the key constraint that creates the triangle of valid states
  // Combined limit is HIGHER than per-side limit to allow asymmetric zoom
  const combinedInvalidPercent = zones.leftInvalidWidth + zones.rightInvalidWidth;
  if (combinedInvalidPercent > maxCombinedPercent) {
    return {
      blocked: true,
      reason: "combined-invalid-zone-limit",
      leftInvalidBuckets,
      rightInvalidBuckets,
    };
  }

  return {
    blocked: false,
    leftInvalidBuckets,
    rightInvalidBuckets,
  };
}
