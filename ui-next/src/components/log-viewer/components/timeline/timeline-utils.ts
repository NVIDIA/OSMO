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
