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
import {
  calculatePositionPercent,
  calculateTimeFromPercent,
  clampTimeToRange,
  isZoomGesture,
  calculateDisplayRangeWithPadding,
  calculateOverlayPositions,
  isEndTimeNow,
} from "./timeline-utils";

describe("calculatePositionPercent", () => {
  it("should return 0% at start of range", () => {
    expect(calculatePositionPercent(1000, 1000, 2000)).toBe(0);
  });

  it("should return 50% at middle of range", () => {
    expect(calculatePositionPercent(1500, 1000, 2000)).toBe(50);
  });

  it("should return 100% at end of range", () => {
    expect(calculatePositionPercent(2000, 1000, 2000)).toBe(100);
  });

  it("should handle negative position (before start)", () => {
    expect(calculatePositionPercent(500, 1000, 2000)).toBe(-50);
  });

  it("should handle position beyond end", () => {
    expect(calculatePositionPercent(2500, 1000, 2000)).toBe(150);
  });

  it("should return 0 for zero range", () => {
    expect(calculatePositionPercent(1500, 1000, 1000)).toBe(0);
  });

  it("should return 0 for negative range", () => {
    expect(calculatePositionPercent(1500, 2000, 1000)).toBe(0);
  });
});

describe("calculateTimeFromPercent", () => {
  it("should return start time for 0%", () => {
    expect(calculateTimeFromPercent(0, 1000, 2000)).toBe(1000);
  });

  it("should return middle time for 50%", () => {
    expect(calculateTimeFromPercent(50, 1000, 2000)).toBe(1500);
  });

  it("should return end time for 100%", () => {
    expect(calculateTimeFromPercent(100, 1000, 2000)).toBe(2000);
  });

  it("should handle negative percentages", () => {
    expect(calculateTimeFromPercent(-50, 1000, 2000)).toBe(500);
  });

  it("should handle percentages beyond 100", () => {
    expect(calculateTimeFromPercent(150, 1000, 2000)).toBe(2500);
  });

  it("should handle 25% correctly", () => {
    expect(calculateTimeFromPercent(25, 1000, 2000)).toBe(1250);
  });

  it("should handle 75% correctly", () => {
    expect(calculateTimeFromPercent(75, 1000, 2000)).toBe(1750);
  });
});

describe("clampTimeToRange", () => {
  it("should return time within range unchanged", () => {
    expect(clampTimeToRange(1500, 1000, 2000)).toBe(1500);
  });

  it("should clamp to min when below range", () => {
    expect(clampTimeToRange(500, 1000, 2000)).toBe(1000);
  });

  it("should clamp to max when above range", () => {
    expect(clampTimeToRange(2500, 1000, 2000)).toBe(2000);
  });

  it("should return min when at min boundary", () => {
    expect(clampTimeToRange(1000, 1000, 2000)).toBe(1000);
  });

  it("should return max when at max boundary", () => {
    expect(clampTimeToRange(2000, 1000, 2000)).toBe(2000);
  });

  it("should handle negative numbers", () => {
    expect(clampTimeToRange(-500, -1000, 0)).toBe(-500);
    expect(clampTimeToRange(-1500, -1000, 0)).toBe(-1000);
  });
});

describe("isZoomGesture", () => {
  it("should return false for same range", () => {
    expect(isZoomGesture(1000, 1000)).toBe(false);
  });

  it("should return false for change within tolerance", () => {
    expect(isZoomGesture(1000, 1000.5, 1)).toBe(false);
  });

  it("should return true for change beyond tolerance", () => {
    expect(isZoomGesture(1000, 1002, 1)).toBe(true);
  });

  it("should return true for zoom in (smaller range)", () => {
    expect(isZoomGesture(800, 1000)).toBe(true);
  });

  it("should return true for zoom out (larger range)", () => {
    expect(isZoomGesture(1200, 1000)).toBe(true);
  });

  it("should respect custom tolerance", () => {
    expect(isZoomGesture(1005, 1000, 10)).toBe(false);
    expect(isZoomGesture(1015, 1000, 10)).toBe(true);
  });
});

describe("calculateDisplayRangeWithPadding", () => {
  it("should add padding to effective range", () => {
    const result = calculateDisplayRangeWithPadding(
      new Date(1000), // effectiveStart
      new Date(2000), // effectiveEnd
      new Date(0), // fallbackStart
      new Date(3000), // fallbackEnd
      0.1, // 10% padding
      0, // No min padding
    );

    // Range = 1000ms, padding = 100ms
    expect(result.displayStart.getTime()).toBe(900);
    expect(result.displayEnd.getTime()).toBe(2100);
  });

  it("should use minimum padding when calculated is too small", () => {
    const result = calculateDisplayRangeWithPadding(
      new Date(1000),
      new Date(1100), // Small 100ms range
      new Date(0),
      new Date(3000),
      0.1, // 10% would be 10ms
      50, // Min 50ms
    );

    expect(result.displayStart.getTime()).toBe(950); // 1000 - 50
    expect(result.displayEnd.getTime()).toBe(1150); // 1100 + 50
  });

  it("should use fallback when effective times undefined", () => {
    const result = calculateDisplayRangeWithPadding(
      undefined, // No effective start
      undefined, // No effective end
      new Date(1000), // fallbackStart
      new Date(2000), // fallbackEnd
      0.1,
      0,
    );

    // Range = 1000ms, padding = 100ms
    expect(result.displayStart.getTime()).toBe(900);
    expect(result.displayEnd.getTime()).toBe(2100);
  });

  it("should mix effective and fallback times", () => {
    const result = calculateDisplayRangeWithPadding(
      new Date(1000), // effectiveStart (used)
      undefined, // No effective end
      new Date(500), // fallbackStart (ignored)
      new Date(2000), // fallbackEnd (used)
      0.1,
      0,
    );

    // Range = 1000ms, padding = 100ms
    expect(result.displayStart.getTime()).toBe(900); // 1000 - 100
    expect(result.displayEnd.getTime()).toBe(2100); // 2000 + 100
  });

  it("should use default padding values", () => {
    const result = calculateDisplayRangeWithPadding(new Date(1000), new Date(2000), new Date(0), new Date(3000));

    // Default: 10% padding (DISPLAY_PADDING_RATIO), min 10s (MIN_PADDING_MS)
    // Range = 1000ms, 10% = 100ms, but min is 10000ms
    expect(result.displayStart.getTime()).toBe(1000 - 10000);
    expect(result.displayEnd.getTime()).toBe(2000 + 10000);
  });

  it("should handle large ranges with default padding", () => {
    const result = calculateDisplayRangeWithPadding(
      new Date(0),
      new Date(1_000_000), // 1000s range
      new Date(0),
      new Date(0),
    );

    // 10% of 1000000ms = 100000ms > 10000ms min
    expect(result.displayStart.getTime()).toBe(0 - 100000);
    expect(result.displayEnd.getTime()).toBe(1_000_000 + 100000);
  });
});

describe("calculateOverlayPositions", () => {
  it("should return null for zero display range", () => {
    const result = calculateOverlayPositions(1000, 1000, 1000, 1000);
    expect(result).toBeNull();
  });

  it("should return null for negative display range", () => {
    const result = calculateOverlayPositions(2000, 1000, 1000, 2000);
    expect(result).toBeNull();
  });

  it("should calculate positions when effective matches display", () => {
    const result = calculateOverlayPositions(1000, 2000, 1000, 2000);
    expect(result).toEqual({
      leftWidth: 0,
      rightStart: 100,
      rightWidth: 0,
    });
  });

  it("should calculate left overlay when effective starts after display", () => {
    const result = calculateOverlayPositions(1000, 2000, 1250, 2000);
    expect(result).toEqual({
      leftWidth: 25, // (1250-1000)/(2000-1000) * 100
      rightStart: 100,
      rightWidth: 0,
    });
  });

  it("should calculate right overlay when effective ends before display", () => {
    const result = calculateOverlayPositions(1000, 2000, 1000, 1750);
    expect(result).toEqual({
      leftWidth: 0,
      rightStart: 75, // (1750-1000)/(2000-1000) * 100
      rightWidth: 25,
    });
  });

  it("should calculate both overlays for narrow effective range", () => {
    const result = calculateOverlayPositions(1000, 2000, 1200, 1800);
    expect(result).toEqual({
      leftWidth: 20, // (1200-1000)/(2000-1000) * 100
      rightStart: 80, // (1800-1000)/(2000-1000) * 100
      rightWidth: 20,
    });
  });

  it("should clamp negative left width to 0", () => {
    // Effective start before display start
    const result = calculateOverlayPositions(1000, 2000, 800, 1800);
    expect(result?.leftWidth).toBe(0);
  });
});

describe("isEndTimeNow", () => {
  it("should return true for undefined end time", () => {
    const now = Date.now();
    expect(isEndTimeNow(undefined, now)).toBe(true);
  });

  it("should return true for time within threshold", () => {
    const now = Date.now();
    const recentTime = new Date(now - 30_000); // 30 seconds ago
    expect(isEndTimeNow(recentTime, now)).toBe(true);
  });

  it("should return false for time beyond threshold", () => {
    const now = Date.now();
    const oldTime = new Date(now - 120_000); // 2 minutes ago
    expect(isEndTimeNow(oldTime, now)).toBe(false);
  });

  it("should respect custom threshold", () => {
    const now = Date.now();
    const time = new Date(now - 5000); // 5 seconds ago
    expect(isEndTimeNow(time, now, 3000)).toBe(false); // 3s threshold
    expect(isEndTimeNow(time, now, 10000)).toBe(true); // 10s threshold
  });
});
