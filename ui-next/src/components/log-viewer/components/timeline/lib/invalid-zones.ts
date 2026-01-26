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
 * Invalid Zone Position Calculations
 *
 * Pure functions for calculating invalid zone positions.
 * Invalid zones indicate areas where logs cannot exist (before workflow start or after completion).
 */

import { GAP_BUCKET_MULTIPLIER } from "./timeline-constants";

export interface InvalidZonePositions {
  /** Left zone width as percentage (0-100) */
  leftInvalidWidth: number;
  /** Right zone start position as percentage (0-100) */
  rightInvalidStart: number;
  /** Right zone width as percentage (0-100) */
  rightInvalidWidth: number;
  /** Left gap start position as percentage (0-100) - where left invalid zone ends */
  leftGapStart: number;
  /** Left gap width as percentage (0-100) - always 1.0 bucket width */
  leftGapWidth: number;
  /** Right gap start position as percentage (0-100) - where entity/now ends */
  rightGapStart: number;
  /** Right gap width as percentage (0-100) - always 1.0 bucket width */
  rightGapWidth: number;
}

/**
 * Calculate bucket width from histogram buckets.
 *
 * @param buckets - Array of bucket timestamps
 * @returns Bucket width in milliseconds, or 0 if cannot be determined
 */
export function calculateBucketWidth(buckets: Date[]): number {
  if (buckets.length < 2) return 0;
  return buckets[1].getTime() - buckets[0].getTime();
}

/**
 * Calculate invalid zone positions.
 *
 * CONTRACTS:
 * 1. Left zone ends at entityStart - 1.0 bucket width (one bar's worth of buffer)
 * 2. Right zone starts at (entityEnd OR now) + 1.0 bucket width (one bar's worth of buffer)
 * 3. Gap is exactly one bucket width (visually aligns with histogram bars)
 * 4. Positions are percentages relative to displayRange
 * 5. When displayRange changes (pan/zoom), gap scales proportionally with bars
 *
 * @param entityStartMs - Entity start time in milliseconds (workflow start)
 * @param entityEndMs - Entity end time in milliseconds (undefined if running, use now)
 * @param nowMs - Current "NOW" timestamp in milliseconds
 * @param displayStartMs - Display range start in milliseconds
 * @param displayEndMs - Display range end in milliseconds
 * @param bucketWidthMs - Width of one bucket in milliseconds
 * @returns Invalid zone positions as percentages
 */
export function calculateInvalidZonePositions(
  entityStartMs: number,
  entityEndMs: number | undefined,
  nowMs: number,
  displayStartMs: number,
  displayEndMs: number,
  bucketWidthMs: number,
): InvalidZonePositions {
  const displayRangeMs = displayEndMs - displayStartMs;

  // Guard: invalid range
  if (displayRangeMs <= 0) {
    return {
      leftInvalidWidth: 0,
      rightInvalidStart: 100,
      rightInvalidWidth: 0,
      leftGapStart: 0,
      leftGapWidth: 0,
      rightGapStart: 100,
      rightGapWidth: 0,
    };
  }

  const toPercent = (ms: number): number => (ms / displayRangeMs) * 100;

  // ============================================================================
  // LEFT ZONE: Before entity start
  // ============================================================================

  // Left gap = GAP_BUCKET_MULTIPLIER bucket widths (one bar's worth of empty space as visual buffer)
  const leftGapMs = bucketWidthMs * GAP_BUCKET_MULTIPLIER;

  // Left zone ends 1.0 bucket width BEFORE entity start
  // Gap goes from (entityStart - 1.0 bucket) to entityStart
  const leftZoneEndMs = entityStartMs - leftGapMs;
  const leftGapStartMs = leftZoneEndMs;
  const leftGapEndMs = entityStartMs;

  let leftWidthPercent = 0;
  let leftGapStartPercent = 0;
  let leftGapWidthPercent = 0;

  if (displayStartMs < leftZoneEndMs && leftZoneEndMs > displayStartMs) {
    const clampedEndMs = Math.min(leftZoneEndMs, displayEndMs);
    leftWidthPercent = toPercent(clampedEndMs - displayStartMs);
  }

  // Calculate left gap position (between invalid zone and entity start)
  if (displayEndMs > leftGapStartMs && displayStartMs < leftGapEndMs) {
    const clampedGapStartMs = Math.max(leftGapStartMs, displayStartMs);
    const clampedGapEndMs = Math.min(leftGapEndMs, displayEndMs);
    leftGapStartPercent = toPercent(clampedGapStartMs - displayStartMs);
    leftGapWidthPercent = toPercent(clampedGapEndMs - clampedGapStartMs);
  }

  // ============================================================================
  // RIGHT ZONE: After entity end (or NOW for running workflows)
  // ============================================================================

  // Use entityEnd if available, otherwise NOW
  const rightBoundaryMs = entityEndMs ?? nowMs;

  // Right gap = GAP_BUCKET_MULTIPLIER bucket widths (one bar's worth of empty space as visual buffer)
  const rightGapMs = bucketWidthMs * GAP_BUCKET_MULTIPLIER;

  // Gap goes from rightBoundary to (rightBoundary + 1.0 bucket)
  // Zone starts 1.0 bucket width after the boundary
  const rightGapStartMs = rightBoundaryMs;
  const rightGapEndMs = rightBoundaryMs + rightGapMs;
  const zoneStartMs = rightGapEndMs;

  let rightStartPercent = 100;
  let rightWidthPercent = 0;
  let rightGapStartPercent = 100;
  let rightGapWidthPercent = 0;

  if (displayEndMs > zoneStartMs) {
    const clampedZoneStartMs = Math.max(zoneStartMs, displayStartMs);
    rightStartPercent = toPercent(clampedZoneStartMs - displayStartMs);
    rightWidthPercent = toPercent(displayEndMs - clampedZoneStartMs);
  }

  // Calculate right gap position (between entity end/now and invalid zone)
  if (displayEndMs > rightGapStartMs && displayStartMs < rightGapEndMs) {
    const clampedGapStartMs = Math.max(rightGapStartMs, displayStartMs);
    const clampedGapEndMs = Math.min(rightGapEndMs, displayEndMs);
    rightGapStartPercent = toPercent(clampedGapStartMs - displayStartMs);
    rightGapWidthPercent = toPercent(clampedGapEndMs - clampedGapStartMs);
  }

  return {
    leftInvalidWidth: leftWidthPercent,
    rightInvalidStart: rightStartPercent,
    rightInvalidWidth: rightWidthPercent,
    leftGapStart: leftGapStartPercent,
    leftGapWidth: leftGapWidthPercent,
    rightGapStart: rightGapStartPercent,
    rightGapWidth: rightGapWidthPercent,
  };
}
