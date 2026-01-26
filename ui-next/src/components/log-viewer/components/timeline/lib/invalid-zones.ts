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

export interface InvalidZonePositions {
  /** Left zone width as percentage (0-100) */
  leftInvalidWidth: number;
  /** Right zone start position as percentage (0-100) */
  rightInvalidStart: number;
  /** Right zone width as percentage (0-100) */
  rightInvalidWidth: number;
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
 * 1. Left zone ends at entityStart - 1.5 bucket widths (symmetric with right)
 * 2. Right zone starts at (entityEnd OR now) + 1.5 bucket widths
 * 3. Gap is ALWAYS exactly 1.5 bucket widths in milliseconds on BOTH sides
 * 4. Gaps are symmetric (same millisecond value on left and right)
 * 5. Positions are percentages relative to displayRange
 * 6. When displayRange changes (pan/zoom), positions transform linearly
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
    };
  }

  const toPercent = (ms: number): number => (ms / displayRangeMs) * 100;

  // ============================================================================
  // LEFT ZONE: Before entity start
  // ============================================================================

  // Gap = 1.5 bucket widths (same as right side for consistency)
  const gapMs = bucketWidthMs * 1.5;

  // Left zone ends 1.5 bucket widths BEFORE entity start (gives bars breathing room)
  const leftZoneEndMs = entityStartMs - gapMs;

  let leftWidthPercent = 0;
  if (displayStartMs < leftZoneEndMs && leftZoneEndMs > displayStartMs) {
    const clampedEndMs = Math.min(leftZoneEndMs, displayEndMs);
    leftWidthPercent = toPercent(clampedEndMs - displayStartMs);
  }

  // ============================================================================
  // RIGHT ZONE: After entity end (or NOW for running workflows)
  // ============================================================================

  // Use entityEnd if available, otherwise NOW
  const rightBoundaryMs = entityEndMs ?? nowMs;

  // Zone starts 1.5 bucket widths after the boundary
  const zoneStartMs = rightBoundaryMs + gapMs;

  let rightStartPercent = 100;
  let rightWidthPercent = 0;

  if (displayEndMs > zoneStartMs) {
    const clampedZoneStartMs = Math.max(zoneStartMs, displayStartMs);
    rightStartPercent = toPercent(clampedZoneStartMs - displayStartMs);
    rightWidthPercent = toPercent(displayEndMs - clampedZoneStartMs);
  }

  return {
    leftInvalidWidth: leftWidthPercent,
    rightInvalidStart: rightStartPercent,
    rightInvalidWidth: rightWidthPercent,
  };
}
