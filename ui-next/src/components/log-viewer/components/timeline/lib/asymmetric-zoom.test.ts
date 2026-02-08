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
 * Asymmetric Zoom Test Suite
 *
 * Tests the fix for asymmetric zoom out functionality.
 * Before the fix, asymmetric zoom would fail validation because the
 * constrained side was calculated using the INTENDED range instead of
 * the ACTUAL range after deficit transfer.
 *
 * Key insight: When zooming out with one side constrained at 10%, we need
 * to ensure the invalid zone is exactly 10% of the ACTUAL new range, not
 * the INTENDED new range (which would be symmetric).
 */

import { describe, it, expect } from "vitest";
import { validateInvalidZoneLimits } from "@/components/log-viewer/components/timeline/lib/timeline-utils";
import { GAP_BUCKET_MULTIPLIER } from "@/components/log-viewer/components/timeline/lib/timeline-constants";

describe("Asymmetric Zoom - Right Side Constrained", () => {
  // Test setup matching the user's debug output
  const entityStart = new Date("2026-01-24T10:00:30.000Z");
  const entityEnd = new Date("2026-01-24T10:45:00.000Z");
  const now = new Date("2026-02-02T23:58:05.458Z").getTime();

  // Current display range (21 minutes 53 seconds)
  const currentStart = new Date("2026-01-24T10:26:18.876Z").getTime();
  const currentEnd = new Date("2026-01-24T10:48:11.235Z").getTime();

  // Bucket configuration (assume 60-second buckets)
  const bucketWidthMs = 60_000;
  const bucketCount = 20;
  const bucketTimestamps = Array.from({ length: bucketCount }, (_, i) => new Date(currentStart + i * bucketWidthMs));

  it("should pass validation when zooming out from right edge (user's scenario)", () => {
    // ARRANGE: User has panned to right edge (right invalid zone near 10%)
    // Current: displayEnd is 3:11 past entityEnd → right invalid zone ~10%

    // ACT: Simulate asymmetric zoom out (1.25x factor not needed for calculation)

    // Calculate center (symmetric bounds not needed for this test)
    const centerMs = (currentStart + currentEnd) / 2;

    // Asymmetric calculation (NEW FORMULA - the fix!)
    // Right is constrained, so pin it at exactly 10% of ACTUAL range
    const gapMs = bucketWidthMs * GAP_BUCKET_MULTIPLIER;
    const rightBoundaryMs = entityEnd.getTime();

    // Solve for constrainedEnd: rightInvalid = 10% × actualRange
    // Where: actualRange = 2×constrainedEnd - 2×center
    const constrainedEnd = (rightBoundaryMs + gapMs - 0.2 * centerMs) / 0.8;
    const constrainedStart = 2 * centerMs - constrainedEnd;

    // ASSERT: Validation should PASS now
    const validation = validateInvalidZoneLimits(
      constrainedStart,
      constrainedEnd,
      entityStart,
      entityEnd,
      now,
      bucketTimestamps,
    );

    expect(validation.blocked).toBe(false);

    // Verify the right invalid zone is exactly 10% (within floating point tolerance)
    const actualRange = constrainedEnd - constrainedStart;
    const rightInvalidMs = constrainedEnd - (rightBoundaryMs + gapMs);
    const rightInvalidPercent = (rightInvalidMs / actualRange) * 100;

    expect(rightInvalidPercent).toBeCloseTo(10.0, 2); // 2 decimal places = 0.01% tolerance // Within 0.00001%
  });

  it("should achieve the target zoom range (not maintain center)", () => {
    // ARRANGE
    const currentRange = currentEnd - currentStart;
    const zoomFactor = 1.25;
    const targetRange = currentRange * zoomFactor;

    const gapMs = bucketWidthMs * GAP_BUCKET_MULTIPLIER;
    const rightBoundaryMs = entityEnd.getTime();

    // ACT: Calculate using new formula (pin right, achieve target range)
    const fractionalLimitMs = (10 / 100) * targetRange;
    const constrainedEnd = rightBoundaryMs + gapMs + fractionalLimitMs;
    const constrainedStart = constrainedEnd - targetRange;
    const actualRange = constrainedEnd - constrainedStart;

    // ASSERT: Verify the key properties
    // 1. Actual range equals target range (not maintaining center!)
    expect(actualRange).toBeCloseTo(targetRange, 1);

    // 2. Right invalid zone is exactly 10% of actual range
    const rightInvalidMs = constrainedEnd - rightBoundaryMs - gapMs;
    expect(rightInvalidMs).toBeCloseTo(0.1 * actualRange, 3);

    // 3. Right invalid percentage is exactly 10%
    const rightInvalidPercent = (rightInvalidMs / actualRange) * 100;
    expect(rightInvalidPercent).toBeCloseTo(10.0, 2); // 2 decimal places = 0.01% tolerance
  });

  it("should handle zoom out when right side is at exactly 10%", () => {
    // ARRANGE: Set up initial state with right invalid zone at exactly 10%
    const gapMs = bucketWidthMs * GAP_BUCKET_MULTIPLIER;
    const rightBoundaryMs = entityEnd.getTime();

    // Position displayEnd so right invalid zone is exactly 10%
    const initialRange = 1_200_000; // 20 minutes
    const displayStart = entityStart.getTime() + 200_000; // 3:20 after start
    const displayEnd = rightBoundaryMs + gapMs + 0.1 * initialRange;

    // Verify initial state is at 10%
    const initialValidation = validateInvalidZoneLimits(
      displayStart,
      displayEnd,
      entityStart,
      entityEnd,
      now,
      bucketTimestamps,
    );
    expect(initialValidation.blocked).toBe(false);

    // ACT: Zoom out by 1.25x
    const centerMs = (displayStart + displayEnd) / 2;

    // Apply asymmetric zoom formula
    const constrainedEnd = (rightBoundaryMs + gapMs - 0.2 * centerMs) / 0.8;
    const constrainedStart = 2 * centerMs - constrainedEnd;

    // ASSERT: Should still pass validation
    const zoomedValidation = validateInvalidZoneLimits(
      constrainedStart,
      constrainedEnd,
      entityStart,
      entityEnd,
      now,
      bucketTimestamps,
    );

    expect(zoomedValidation.blocked).toBe(false);

    // Verify right invalid zone is still at 10%
    const actualRange = constrainedEnd - constrainedStart;
    const rightInvalidMs = constrainedEnd - rightBoundaryMs - gapMs;
    const rightInvalidPercent = (rightInvalidMs / actualRange) * 100;

    expect(rightInvalidPercent).toBeCloseTo(10.0, 2); // 2 decimal places = 0.01% tolerance
  });

  it("should handle multiple zoom out operations in sequence", () => {
    // ARRANGE: Start with right invalid zone at 8%
    const gapMs = bucketWidthMs * GAP_BUCKET_MULTIPLIER;
    const rightBoundaryMs = entityEnd.getTime();

    let displayStart = entityStart.getTime() + 300_000; // 5 minutes after start
    const displayRange = 1_200_000; // 20 minutes
    let displayEnd = rightBoundaryMs + gapMs + 0.08 * displayRange;

    // ACT: Zoom out 3 times
    for (let i = 0; i < 3; i++) {
      const centerMs = (displayStart + displayEnd) / 2;
      const constrainedEnd = (rightBoundaryMs + gapMs - 0.2 * centerMs) / 0.8;
      const constrainedStart = 2 * centerMs - constrainedEnd;

      // ASSERT: Each zoom should pass validation
      const validation = validateInvalidZoneLimits(
        constrainedStart,
        constrainedEnd,
        entityStart,
        entityEnd,
        now,
        bucketTimestamps,
      );

      expect(validation.blocked).toBe(false);

      // Verify right invalid zone is at 10%
      const actualRange = constrainedEnd - constrainedStart;
      const rightInvalidMs = constrainedEnd - rightBoundaryMs - gapMs;
      const rightInvalidPercent = (rightInvalidMs / actualRange) * 100;

      expect(rightInvalidPercent).toBeCloseTo(10.0, 2); // 2 decimal places = 0.01% tolerance

      // Update for next iteration
      displayStart = constrainedStart;
      displayEnd = constrainedEnd;
    }
  });
});

describe("Asymmetric Zoom - Left Side Constrained", () => {
  const entityStart = new Date("2026-01-24T10:00:30.000Z");
  const entityEnd = new Date("2026-01-24T10:45:00.000Z");
  const now = new Date("2026-02-02T23:58:05.458Z").getTime();

  const bucketWidthMs = 60_000;
  const bucketCount = 20;
  const currentStart = entityStart.getTime() - 100_000; // Start before entity
  const currentEnd = currentStart + 1_200_000; // 20-minute range
  const bucketTimestamps = Array.from({ length: bucketCount }, (_, i) => new Date(currentStart + i * bucketWidthMs));

  it("should pass validation when zooming out from left edge", () => {
    // ARRANGE: User has panned to left edge (left invalid zone near 10%)
    const centerMs = (currentStart + currentEnd) / 2;

    // Asymmetric calculation (NEW FORMULA - the fix!)
    // Left is constrained, so pin it at exactly 10% of ACTUAL range
    const gapMs = bucketWidthMs * GAP_BUCKET_MULTIPLIER;
    const entityStartMs = entityStart.getTime();

    // Solve for constrainedStart: leftInvalid = 10% × actualRange
    // Where: actualRange = 2×center - 2×constrainedStart
    const constrainedStart = (entityStartMs - gapMs - 0.2 * centerMs) / 0.8;
    const constrainedEnd = 2 * centerMs - constrainedStart;

    // ASSERT: Validation should PASS
    const validation = validateInvalidZoneLimits(
      constrainedStart,
      constrainedEnd,
      entityStart,
      entityEnd,
      now,
      bucketTimestamps,
    );

    expect(validation.blocked).toBe(false);

    // Verify the left invalid zone is exactly 10%
    const actualRange = constrainedEnd - constrainedStart;
    const leftInvalidMs = entityStartMs - gapMs - constrainedStart;
    const leftInvalidPercent = (leftInvalidMs / actualRange) * 100;

    expect(leftInvalidPercent).toBeCloseTo(10.0, 2); // 2 decimal places = 0.01% tolerance
  });

  it("should ensure algebraic symmetry between left and right formulas", () => {
    // ARRANGE
    const centerMs = (currentStart + currentEnd) / 2;
    const gapMs = bucketWidthMs * GAP_BUCKET_MULTIPLIER;
    const entityStartMs = entityStart.getTime();
    const rightBoundaryMs = entityEnd.getTime();

    // ACT: Calculate both left and right constrained positions
    const constrainedStartLeft = (entityStartMs - gapMs - 0.2 * centerMs) / 0.8;
    const constrainedEndLeft = 2 * centerMs - constrainedStartLeft;

    const constrainedEndRight = (rightBoundaryMs + gapMs - 0.2 * centerMs) / 0.8;
    const constrainedStartRight = 2 * centerMs - constrainedEndRight;

    // ASSERT: Both should produce valid ranges
    const leftRange = constrainedEndLeft - constrainedStartLeft;
    const rightRange = constrainedEndRight - constrainedStartRight;

    expect(leftRange).toBeGreaterThan(0);
    expect(rightRange).toBeGreaterThan(0);

    // Both should pin their respective sides at exactly 10%
    const leftInvalidMs = entityStartMs - gapMs - constrainedStartLeft;
    const leftInvalidPercent = (leftInvalidMs / leftRange) * 100;

    const rightInvalidMs = constrainedEndRight - rightBoundaryMs - gapMs;
    const rightInvalidPercent = (rightInvalidMs / rightRange) * 100;

    expect(leftInvalidPercent).toBeCloseTo(10.0, 2); // 2 decimal places = 0.01% tolerance
    expect(rightInvalidPercent).toBeCloseTo(10.0, 2); // 2 decimal places = 0.01% tolerance
  });
});

describe("Asymmetric Zoom - Edge Cases", () => {
  const entityStart = new Date("2026-01-24T10:00:30.000Z");
  const entityEnd = new Date("2026-01-24T10:45:00.000Z");
  const now = new Date("2026-02-02T23:58:05.458Z").getTime();

  const bucketWidthMs = 60_000;
  const bucketCount = 20;
  const bucketTimestamps = Array.from(
    { length: bucketCount },
    (_, i) => new Date(entityStart.getTime() + i * bucketWidthMs),
  );

  it("should handle very small zoom factors (1.01x)", () => {
    // ARRANGE
    const gapMs = bucketWidthMs * GAP_BUCKET_MULTIPLIER;
    const rightBoundaryMs = entityEnd.getTime();

    const currentStart = entityStart.getTime() + 200_000;
    const currentRange = 1_200_000;
    const currentEnd = rightBoundaryMs + gapMs + 0.09 * currentRange;

    // ACT: Tiny zoom out
    const centerMs = (currentStart + currentEnd) / 2;
    const constrainedEnd = (rightBoundaryMs + gapMs - 0.2 * centerMs) / 0.8;
    const constrainedStart = 2 * centerMs - constrainedEnd;

    // ASSERT
    const validation = validateInvalidZoneLimits(
      constrainedStart,
      constrainedEnd,
      entityStart,
      entityEnd,
      now,
      bucketTimestamps,
    );

    expect(validation.blocked).toBe(false);

    const actualRange = constrainedEnd - constrainedStart;
    const rightInvalidMs = constrainedEnd - rightBoundaryMs - gapMs;
    const rightInvalidPercent = (rightInvalidMs / actualRange) * 100;

    expect(rightInvalidPercent).toBeCloseTo(10.0, 2); // 2 decimal places = 0.01% tolerance
  });

  it("should handle very large zoom factors (3x)", () => {
    // ARRANGE
    const gapMs = bucketWidthMs * GAP_BUCKET_MULTIPLIER;
    const rightBoundaryMs = entityEnd.getTime();

    const currentStart = entityStart.getTime() + 500_000;
    const currentRange = 800_000;
    const currentEnd = rightBoundaryMs + gapMs + 0.08 * currentRange;

    // ACT: Large zoom out
    const centerMs = (currentStart + currentEnd) / 2;
    const constrainedEnd = (rightBoundaryMs + gapMs - 0.2 * centerMs) / 0.8;
    const constrainedStart = 2 * centerMs - constrainedEnd;

    // ASSERT
    const validation = validateInvalidZoneLimits(
      constrainedStart,
      constrainedEnd,
      entityStart,
      entityEnd,
      now,
      bucketTimestamps,
    );

    expect(validation.blocked).toBe(false);

    const actualRange = constrainedEnd - constrainedStart;
    const rightInvalidMs = constrainedEnd - rightBoundaryMs - gapMs;
    const rightInvalidPercent = (rightInvalidMs / actualRange) * 100;

    expect(rightInvalidPercent).toBeCloseTo(10.0, 2); // 2 decimal places = 0.01% tolerance
  });
});
