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
 * Tests asymmetric zoom out functionality with marker-based constraints.
 * When zooming with one side constrained, the marker on that side stays at
 * exactly 50% of the viewport while the other side expands.
 *
 * Key insight: When zooming out with one side constrained at 50%, we need
 * to ensure the marker is exactly 50% of the ACTUAL new range, not
 * the INTENDED new range (which would be symmetric).
 */

import { describe, it, expect } from "vitest";
import { validateInvalidZoneLimits } from "@/components/log-viewer/components/timeline/lib/timeline-utils";
import { MAX_MARKER_POSITION_PERCENT } from "@/components/log-viewer/components/timeline/lib/timeline-constants";

describe("Asymmetric Zoom - Right Side Constrained", () => {
  const entityStart = new Date("2026-01-24T10:00:30.000Z");
  const entityEnd = new Date("2026-01-24T10:45:00.000Z");
  const now = new Date("2026-02-02T23:58:05.458Z").getTime();

  const bucketWidthMs = 60_000;
  const bucketCount = 20;
  const currentStart = new Date("2026-01-24T10:26:18.876Z").getTime();
  const currentEnd = new Date("2026-01-24T10:48:11.235Z").getTime();
  const bucketTimestamps = Array.from({ length: bucketCount }, (_, i) => new Date(currentStart + i * bucketWidthMs));

  it("should pass validation when zooming out from right edge", () => {
    const rightBoundaryMs = entityEnd.getTime();
    const currentRange = currentEnd - currentStart;
    const zoomFactor = 1.25;
    const targetRange = currentRange * zoomFactor;

    // Pin end marker at 50% from right edge
    const markerOffsetMs = (MAX_MARKER_POSITION_PERCENT / 100) * targetRange;
    const constrainedEnd = rightBoundaryMs + markerOffsetMs;
    const constrainedStart = constrainedEnd - targetRange;

    const validation = validateInvalidZoneLimits(
      constrainedStart,
      constrainedEnd,
      entityStart,
      entityEnd,
      now,
      bucketTimestamps,
    );

    expect(validation.blocked).toBe(false);

    // Verify end marker is at 50% from right edge
    const actualRange = constrainedEnd - constrainedStart;
    const endMarkerPositionMs = rightBoundaryMs - constrainedStart;
    const endMarkerPositionPercent = (endMarkerPositionMs / actualRange) * 100;
    const endMarkerFromRightPercent = 100 - endMarkerPositionPercent;

    expect(endMarkerFromRightPercent).toBeCloseTo(MAX_MARKER_POSITION_PERCENT, 2);
  });

  it("should achieve the target zoom range", () => {
    const currentRange = currentEnd - currentStart;
    const zoomFactor = 1.25;
    const targetRange = currentRange * zoomFactor;
    const rightBoundaryMs = entityEnd.getTime();

    const markerOffsetMs = (MAX_MARKER_POSITION_PERCENT / 100) * targetRange;
    const constrainedEnd = rightBoundaryMs + markerOffsetMs;
    const constrainedStart = constrainedEnd - targetRange;
    const actualRange = constrainedEnd - constrainedStart;

    expect(actualRange).toBeCloseTo(targetRange, 1);
  });

  it("should handle zoom out when right marker is at exactly 50%", () => {
    const rightBoundaryMs = entityEnd.getTime();
    const initialRange = 1_200_000; // 20 minutes
    const displayStart = entityStart.getTime() + 200_000;
    const displayEnd = rightBoundaryMs + (MAX_MARKER_POSITION_PERCENT / 100) * initialRange;

    const initialValidation = validateInvalidZoneLimits(
      displayStart,
      displayEnd,
      entityStart,
      entityEnd,
      now,
      bucketTimestamps,
    );
    expect(initialValidation.blocked).toBe(false);

    // Zoom out
    const zoomFactor = 1.25;
    const newRange = initialRange * zoomFactor;
    const markerOffsetMs = (MAX_MARKER_POSITION_PERCENT / 100) * newRange;
    const constrainedEnd = rightBoundaryMs + markerOffsetMs;
    const constrainedStart = constrainedEnd - newRange;

    const zoomedValidation = validateInvalidZoneLimits(
      constrainedStart,
      constrainedEnd,
      entityStart,
      entityEnd,
      now,
      bucketTimestamps,
    );

    expect(zoomedValidation.blocked).toBe(false);
  });
});

describe("Asymmetric Zoom - Left Side Constrained", () => {
  const entityStart = new Date("2026-01-24T10:00:30.000Z");
  const entityEnd = new Date("2026-01-24T10:45:00.000Z");
  const now = new Date("2026-02-02T23:58:05.458Z").getTime();

  const bucketWidthMs = 60_000;
  const bucketCount = 20;
  const entityStartMs = entityStart.getTime();
  const currentStart = entityStartMs - 100_000;
  const currentEnd = currentStart + 1_200_000;
  const bucketTimestamps = Array.from({ length: bucketCount }, (_, i) => new Date(currentStart + i * bucketWidthMs));

  it("should pass validation when zooming out from left edge", () => {
    const currentRange = currentEnd - currentStart;
    const zoomFactor = 1.25;
    const targetRange = currentRange * zoomFactor;

    // Pin start marker at 50% from left edge
    const markerOffsetMs = (MAX_MARKER_POSITION_PERCENT / 100) * targetRange;
    const constrainedStart = entityStartMs - markerOffsetMs;
    const constrainedEnd = constrainedStart + targetRange;

    const validation = validateInvalidZoneLimits(
      constrainedStart,
      constrainedEnd,
      entityStart,
      entityEnd,
      now,
      bucketTimestamps,
    );

    expect(validation.blocked).toBe(false);

    // Verify start marker is at 50% from left edge
    const actualRange = constrainedEnd - constrainedStart;
    const startMarkerPositionMs = entityStartMs - constrainedStart;
    const startMarkerPositionPercent = (startMarkerPositionMs / actualRange) * 100;

    expect(startMarkerPositionPercent).toBeCloseTo(MAX_MARKER_POSITION_PERCENT, 2);
  });

  it("should ensure symmetry between left and right formulas", () => {
    const targetRange = 1_500_000;
    const markerOffsetMs = (MAX_MARKER_POSITION_PERCENT / 100) * targetRange;

    // Left constrained
    const constrainedStartLeft = entityStartMs - markerOffsetMs;
    const constrainedEndLeft = constrainedStartLeft + targetRange;

    // Right constrained
    const rightBoundaryMs = entityEnd.getTime();
    const constrainedEndRight = rightBoundaryMs + markerOffsetMs;
    const constrainedStartRight = constrainedEndRight - targetRange;

    // Both should produce valid ranges
    const leftRange = constrainedEndLeft - constrainedStartLeft;
    const rightRange = constrainedEndRight - constrainedStartRight;

    expect(leftRange).toBeCloseTo(targetRange, 1);
    expect(rightRange).toBeCloseTo(targetRange, 1);
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

  it("should handle small zoom factors (1.1x)", () => {
    const rightBoundaryMs = entityEnd.getTime();
    const currentRange = 1_200_000;
    const targetRange = currentRange * 1.1;

    const markerOffsetMs = (MAX_MARKER_POSITION_PERCENT / 100) * targetRange;
    const constrainedEnd = rightBoundaryMs + markerOffsetMs;
    const constrainedStart = constrainedEnd - targetRange;

    const validation = validateInvalidZoneLimits(
      constrainedStart,
      constrainedEnd,
      entityStart,
      entityEnd,
      now,
      bucketTimestamps,
    );

    expect(validation.blocked).toBe(false);
  });

  it("should handle large zoom factors (3x)", () => {
    const rightBoundaryMs = entityEnd.getTime();
    const currentRange = 800_000;
    const targetRange = currentRange * 3;

    const markerOffsetMs = (MAX_MARKER_POSITION_PERCENT / 100) * targetRange;
    const constrainedEnd = rightBoundaryMs + markerOffsetMs;
    const constrainedStart = constrainedEnd - targetRange;

    const validation = validateInvalidZoneLimits(
      constrainedStart,
      constrainedEnd,
      entityStart,
      entityEnd,
      now,
      bucketTimestamps,
    );

    expect(validation.blocked).toBe(false);
  });
});
