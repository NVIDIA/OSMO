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
 * Wheel Gesture Validation Functions
 *
 * Pure functions for validating zoom/pan operations.
 * These functions encapsulate constraint checking logic and can be tested independently.
 */

import { MIN_RANGE_MS, MAX_RANGE_MS, MIN_BUCKET_COUNT, MAX_BUCKET_COUNT } from "./timeline-constants";

// =============================================================================
// Types
// =============================================================================

/**
 * Result of zoom validation check.
 */
export interface ZoomValidationResult {
  /** Whether the zoom operation is blocked */
  blocked: boolean;
  /** Reason for blocking (if blocked) */
  reason?: string;
}

// =============================================================================
// Zoom Validation Functions
// =============================================================================

/**
 * Validate zoom IN constraints (MIN_RANGE_MS and MIN_BUCKET_COUNT).
 *
 * @param newRangeMs - Proposed new range in milliseconds
 * @param bucketWidthMs - Width of one bucket in milliseconds
 * @returns Validation result with blocked status and reason
 */
export function validateZoomInConstraints(newRangeMs: number, bucketWidthMs: number): ZoomValidationResult {
  // Check MIN_RANGE_MS (1 minute minimum)
  if (newRangeMs < MIN_RANGE_MS) {
    return {
      blocked: true,
      reason: "MIN_RANGE_MS",
    };
  }

  // Check MIN_BUCKET_COUNT (prevents zooming in past 20 bars)
  if (bucketWidthMs > 0) {
    const newBucketCount = newRangeMs / bucketWidthMs;
    if (newBucketCount < MIN_BUCKET_COUNT) {
      return {
        blocked: true,
        reason: `MIN_BUCKET_COUNT: ${newBucketCount.toFixed(1)} < ${MIN_BUCKET_COUNT}`,
      };
    }
  }

  return { blocked: false };
}

/**
 * Validate zoom OUT constraints (MAX_RANGE_MS and MAX_BUCKET_COUNT).
 *
 * @param newRangeMs - Proposed new range in milliseconds
 * @param bucketWidthMs - Width of one bucket in milliseconds
 * @returns Validation result with blocked status and reason
 */
export function validateZoomOutConstraints(newRangeMs: number, bucketWidthMs: number): ZoomValidationResult {
  // Check MAX_RANGE_MS (1 day maximum)
  if (newRangeMs > MAX_RANGE_MS) {
    return {
      blocked: true,
      reason: "MAX_RANGE_MS",
    };
  }

  // Check MAX_BUCKET_COUNT (prevents zooming out past 100 bars)
  if (bucketWidthMs > 0) {
    const newBucketCount = newRangeMs / bucketWidthMs;
    if (newBucketCount > MAX_BUCKET_COUNT) {
      return {
        blocked: true,
        reason: `MAX_BUCKET_COUNT: ${newBucketCount.toFixed(1)} > ${MAX_BUCKET_COUNT}`,
      };
    }
  }

  return { blocked: false };
}

/**
 * Calculate symmetric zoom result centered on current display range.
 *
 * @param displayStartMs - Current display start in milliseconds
 * @param displayEndMs - Current display end in milliseconds
 * @param newRangeMs - New range size in milliseconds
 * @returns New start and end times for symmetric zoom
 */
export function calculateSymmetricZoom(
  displayStartMs: number,
  displayEndMs: number,
  newRangeMs: number,
): { newStartMs: number; newEndMs: number } {
  const centerMs = (displayStartMs + displayEndMs) / 2;
  return {
    newStartMs: centerMs - newRangeMs / 2,
    newEndMs: centerMs + newRangeMs / 2,
  };
}

/**
 * Calculate pan result by shifting display range by delta.
 *
 * @param displayStartMs - Current display start in milliseconds
 * @param displayEndMs - Current display end in milliseconds
 * @param deltaMs - Amount to shift in milliseconds (positive = right, negative = left)
 * @returns New start and end times after panning
 */
export function calculatePan(
  displayStartMs: number,
  displayEndMs: number,
  deltaMs: number,
): { newStartMs: number; newEndMs: number } {
  return {
    newStartMs: displayStartMs + deltaMs,
    newEndMs: displayEndMs + deltaMs,
  };
}
