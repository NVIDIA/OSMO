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

import { describe, it, expect } from "vitest";
import { calculateBucketWidth, calculateInvalidZonePositions } from "./invalid-zones";

describe("calculateBucketWidth", () => {
  it("should return 0 for empty array", () => {
    expect(calculateBucketWidth([])).toBe(0);
  });

  it("should return 0 for single bucket", () => {
    expect(calculateBucketWidth([new Date(1000)])).toBe(0);
  });

  it("should calculate width from first two buckets", () => {
    const buckets = [new Date(1000), new Date(2000), new Date(3000)];
    expect(calculateBucketWidth(buckets)).toBe(1000);
  });
});

describe("calculateInvalidZonePositions", () => {
  // Test constants
  const ENTITY_START = 10000; // Entity starts at 10s
  const ENTITY_END = 50000; // Entity ends at 50s
  const NOW = 60000; // Current time is 60s
  const BUCKET_WIDTH = 1000; // 1 second buckets
  const RIGHT_GAP = BUCKET_WIDTH * 1.0; // 1.0s = 1000ms (right gap)

  describe("CONTRACT 1: Left zone ends at entityStart - 1.0 bucket width", () => {
    it("should show left zone with gap before entity start", () => {
      const result = calculateInvalidZonePositions(
        ENTITY_START, // 10s
        ENTITY_END,
        NOW,
        0, // Display starts at 0
        20000, // Display ends at 20s
        BUCKET_WIDTH,
      );

      // Left zone should span from 0 to (entityStart - 1.0s)
      // entityStart (10s) - gap (1.0s) = 9.0s
      // That's 9.0s out of 20s range = 45%
      expect(result.leftInvalidWidth).toBe(45);
    });

    it("should show NO left zone when display starts after gap", () => {
      const result = calculateInvalidZonePositions(
        ENTITY_START, // 10s
        ENTITY_END,
        NOW,
        10000, // Display starts at or after (entityStart - gap) = 9.0s, so starting at 10s means no left zone
        20000,
        BUCKET_WIDTH,
      );

      expect(result.leftInvalidWidth).toBe(0);
    });

    it("should show partial left zone when display includes part of gap", () => {
      const result = calculateInvalidZonePositions(
        ENTITY_START, // 10s
        ENTITY_END,
        NOW,
        7000, // Display starts at 7s, zone ends at 9.0s (entityStart - 1.0s)
        20000,
        BUCKET_WIDTH,
      );

      // Zone spans from 7s to 9.0s = 2.0s
      // Display range is 13s (7s to 20s)
      // (2.0s / 13s) * 100 ≈ 15.38%
      const expectedPercent = ((9000 - 7000) / (20000 - 7000)) * 100;
      expect(result.leftInvalidWidth).toBeCloseTo(expectedPercent, 2);
    });
  });

  describe("CONTRACT 2: Right zone starts at entityEnd + 1.0 bucket width", () => {
    it("should position right zone at entityEnd + 1.0 bucket", () => {
      const displayStart = 40000;
      const displayEnd = 60000;
      const displayRange = displayEnd - displayStart; // 20s

      const result = calculateInvalidZonePositions(
        ENTITY_START,
        ENTITY_END, // 50s
        NOW,
        displayStart,
        displayEnd,
        BUCKET_WIDTH,
      );

      // Zone should start at: entityEnd (50s) + gap (1.0s) = 51.0s
      // Relative to displayStart (40s): 51.0s - 40s = 11.0s
      // As percentage: (11.0s / 20s) * 100 = 55%
      const expectedZoneStartMs = ENTITY_END + RIGHT_GAP; // 51000
      const expectedPercent = ((expectedZoneStartMs - displayStart) / displayRange) * 100;
      expect(result.rightInvalidStart).toBeCloseTo(expectedPercent, 2);
    });

    it("should use NOW when entityEnd is undefined (running workflow)", () => {
      const displayStart = 50000;
      const displayEnd = 70000;
      const displayRange = displayEnd - displayStart; // 20s

      const result = calculateInvalidZonePositions(
        ENTITY_START,
        undefined, // Still running!
        NOW, // 60s
        displayStart,
        displayEnd,
        BUCKET_WIDTH,
      );

      // Zone should start at: NOW (60s) + gap (1.0s) = 61.0s
      // Relative to displayStart (50s): 61.0s - 50s = 11.0s
      // As percentage: (11.0s / 20s) * 100 = 55%
      const expectedZoneStartMs = NOW + RIGHT_GAP; // 61000
      const expectedPercent = ((expectedZoneStartMs - displayStart) / displayRange) * 100;
      expect(result.rightInvalidStart).toBeCloseTo(expectedPercent, 2);
    });
  });

  describe("CONTRACT 3: Gap remains constant in MILLISECONDS during pan/zoom", () => {
    it("CRITICAL: Right gap in pixels should remain constant when panning (same zoom level)", () => {
      // Scenario: User pans right by 10 seconds
      // Right gap in MILLISECONDS must stay 1.0 bucket width
      // Gap in PERCENTAGES will change because displayRange is the same but we shifted

      const displayRange = 20000; // 20s window
      const bucketWidth = 1000; // 1s buckets
      const expectedGapMs = bucketWidth * 1.0; // 1.0s (right gap)

      // Before pan: display 40s-60s
      const before = calculateInvalidZonePositions(
        ENTITY_START,
        ENTITY_END, // 50s
        NOW,
        40000,
        60000,
        bucketWidth,
      );

      // After pan: display 50s-70s (panned right by 10s)
      const after = calculateInvalidZonePositions(
        ENTITY_START,
        ENTITY_END, // 50s (same)
        NOW,
        50000,
        70000,
        bucketWidth,
      );

      // Convert percentages back to milliseconds
      const beforeGapMs = ENTITY_END + expectedGapMs - 40000; // Zone position relative to display start
      const beforeGapPercent = (beforeGapMs / displayRange) * 100;

      const afterGapMs = ENTITY_END + expectedGapMs - 50000; // Zone position relative to display start
      const afterGapPercent = (afterGapMs / displayRange) * 100;

      // The MILLISECOND gap from entityEnd to zone should be identical
      expect(before.rightInvalidStart).toBeCloseTo(beforeGapPercent, 2);
      expect(after.rightInvalidStart).toBeCloseTo(afterGapPercent, 2);

      // Verify gap in milliseconds is constant
      const beforeAbsoluteZoneStart = 40000 + (before.rightInvalidStart / 100) * displayRange;
      const afterAbsoluteZoneStart = 50000 + (after.rightInvalidStart / 100) * displayRange;

      expect(beforeAbsoluteZoneStart - ENTITY_END).toBeCloseTo(expectedGapMs, 1);
      expect(afterAbsoluteZoneStart - ENTITY_END).toBeCloseTo(expectedGapMs, 1);
    });

    it("CRITICAL: Right gap in milliseconds should remain constant when zooming", () => {
      const bucketWidth = 1000;
      const expectedGapMs = bucketWidth * 1.0; // 1.0s = 1000ms (right gap)

      // Before zoom: 20s window (40s-60s)
      const before = calculateInvalidZonePositions(
        ENTITY_START,
        ENTITY_END, // 50s
        NOW,
        40000,
        60000,
        bucketWidth,
      );

      // After zoom in: 10s window (45s-55s) - zoomed in 2x
      const after = calculateInvalidZonePositions(
        ENTITY_START,
        ENTITY_END, // 50s (same)
        NOW,
        45000,
        55000,
        bucketWidth,
      );

      // Convert back to absolute milliseconds
      const beforeAbsoluteZoneStart = 40000 + (before.rightInvalidStart / 100) * 20000;
      const afterAbsoluteZoneStart = 45000 + (after.rightInvalidStart / 100) * 10000;

      // Gap should be EXACTLY 1.0s in both cases
      expect(beforeAbsoluteZoneStart - ENTITY_END).toBeCloseTo(expectedGapMs, 1);
      expect(afterAbsoluteZoneStart - ENTITY_END).toBeCloseTo(expectedGapMs, 1);
    });
  });

  describe("CONTRACT 4: Right zone should not exist when display ends before gap", () => {
    it("should show NO right zone when display ends before gap starts", () => {
      const result = calculateInvalidZonePositions(
        ENTITY_START,
        ENTITY_END, // 50s
        NOW,
        40000,
        50000, // Display ends exactly at entityEnd (before gap)
        BUCKET_WIDTH,
      );

      // Zone starts at 51.0s, but display ends at 50s
      // So NO right zone should be visible
      expect(result.rightInvalidWidth).toBe(0);
    });

    it("should show partial right zone when display partially includes gap", () => {
      const displayStart = 40000;
      const displayEnd = 52000; // Ends after gap starts (51.0s) but before full gap
      const displayRange = displayEnd - displayStart;

      const result = calculateInvalidZonePositions(
        ENTITY_START,
        ENTITY_END, // 50s
        NOW,
        displayStart,
        displayEnd,
        BUCKET_WIDTH,
      );

      // Zone starts at 51.0s
      const zoneStartMs = ENTITY_END + RIGHT_GAP; // 51000
      const expectedStart = ((zoneStartMs - displayStart) / displayRange) * 100;
      const expectedWidth = ((displayEnd - zoneStartMs) / displayRange) * 100;

      expect(result.rightInvalidStart).toBeCloseTo(expectedStart, 2);
      expect(result.rightInvalidWidth).toBeCloseTo(expectedWidth, 2);
    });
  });

  describe("CONTRACT 5: Left and right gaps prevent bar clipping", () => {
    it("should use one bucket width gap on each side", () => {
      const bucketWidth = 1000;
      const expectedLeftGapMs = bucketWidth * 1.0; // Left gap is one bucket width
      const expectedRightGapMs = bucketWidth * 1.0; // Right gap is one bucket width

      const result = calculateInvalidZonePositions(
        ENTITY_START, // 10s
        ENTITY_END, // 50s
        NOW,
        0, // Display: 0-70s
        70000,
        bucketWidth,
      );

      // Left zone should end at: entityStart - gap = 10s - 1.0s = 9.0s
      const leftZoneEndMs = 0 + (result.leftInvalidWidth / 100) * 70000;
      expect(ENTITY_START - leftZoneEndMs).toBeCloseTo(expectedLeftGapMs, 1);

      // Right zone should start at: entityEnd + gap = 50s + 1.0s = 51.0s
      const rightZoneStartMs = 0 + (result.rightInvalidStart / 100) * 70000;
      expect(rightZoneStartMs - ENTITY_END).toBeCloseTo(expectedRightGapMs, 1);
    });
  });

  describe("CONTRACT 6: Explicit gap positions for rendering", () => {
    it("should calculate left gap position between invalid zone and entity start", () => {
      const displayStart = 0;
      const displayEnd = 20000;
      const displayRange = displayEnd - displayStart;

      const result = calculateInvalidZonePositions(
        ENTITY_START, // 10s
        ENTITY_END,
        NOW,
        displayStart,
        displayEnd,
        BUCKET_WIDTH,
      );

      // Left gap starts at entityStart - 1.0s = 9s
      // Left gap ends at entityStart = 10s
      // Gap width = 1s = 1 bucket
      const expectedGapStart = ((9000 - displayStart) / displayRange) * 100; // 45%
      const expectedGapWidth = (1000 / displayRange) * 100; // 5%

      expect(result.leftGapStart).toBeCloseTo(expectedGapStart, 2);
      expect(result.leftGapWidth).toBeCloseTo(expectedGapWidth, 2);
    });

    it("should calculate right gap position between entity end and invalid zone", () => {
      const displayStart = 40000;
      const displayEnd = 60000;
      const displayRange = displayEnd - displayStart;

      const result = calculateInvalidZonePositions(
        ENTITY_START,
        ENTITY_END, // 50s
        NOW,
        displayStart,
        displayEnd,
        BUCKET_WIDTH,
      );

      // Right gap starts at entityEnd = 50s
      // Right gap ends at entityEnd + 1.0s = 51s
      // Gap width = 1s = 1 bucket
      const expectedGapStart = ((50000 - displayStart) / displayRange) * 100; // 50%
      const expectedGapWidth = (1000 / displayRange) * 100; // 5%

      expect(result.rightGapStart).toBeCloseTo(expectedGapStart, 2);
      expect(result.rightGapWidth).toBeCloseTo(expectedGapWidth, 2);
    });

    it("should have zero gap width when gap is outside display range", () => {
      const result = calculateInvalidZonePositions(
        ENTITY_START, // 10s
        ENTITY_END, // 50s
        NOW,
        15000, // Display starts after entity start + gap
        45000, // Display ends before entity end
        BUCKET_WIDTH,
      );

      // Left gap (9s-10s) is outside display (15s-45s)
      expect(result.leftGapWidth).toBe(0);
      // Right gap (50s-51s) is outside display (15s-45s)
      expect(result.rightGapWidth).toBe(0);
    });

    it("should calculate partial gap when only part is visible", () => {
      const displayStart = 9500; // Starts in middle of left gap (9s-10s)
      const displayEnd = 20000;
      const displayRange = displayEnd - displayStart;

      const result = calculateInvalidZonePositions(
        ENTITY_START, // 10s
        ENTITY_END,
        NOW,
        displayStart,
        displayEnd,
        BUCKET_WIDTH,
      );

      // Left gap is 9s-10s, but display starts at 9.5s
      // Visible gap is 9.5s-10s = 0.5s
      const expectedGapStart = 0; // Starts at display start
      const expectedGapWidth = (500 / displayRange) * 100;

      expect(result.leftGapStart).toBeCloseTo(expectedGapStart, 2);
      expect(result.leftGapWidth).toBeCloseTo(expectedGapWidth, 2);
    });
  });

  describe("Edge cases", () => {
    it("should handle zero bucket width gracefully", () => {
      const result = calculateInvalidZonePositions(ENTITY_START, ENTITY_END, NOW, 0, 60000, 0);

      // With 0 bucket width, gap = 0 (0 * 1.0), so zone starts exactly at entityEnd
      expect(result.rightInvalidStart).toBeCloseTo((ENTITY_END / 60000) * 100, 2);
      // Gaps should have zero width
      expect(result.leftGapWidth).toBe(0);
      expect(result.rightGapWidth).toBe(0);
    });

    it("should handle invalid display range (start >= end)", () => {
      const result = calculateInvalidZonePositions(ENTITY_START, ENTITY_END, NOW, 50000, 40000, BUCKET_WIDTH);

      // Should return safe defaults
      expect(result.leftInvalidWidth).toBe(0);
      expect(result.rightInvalidStart).toBe(100);
      expect(result.rightInvalidWidth).toBe(0);
      expect(result.leftGapWidth).toBe(0);
      expect(result.rightGapWidth).toBe(0);
    });
  });
});
