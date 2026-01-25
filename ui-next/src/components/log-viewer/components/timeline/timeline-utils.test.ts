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
  shouldBlockPan,
  validatePanConstraint,
  calculateDisplayRangeWithPadding,
  type TimelineBounds,
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

describe("shouldBlockPan", () => {
  it("should block right pan at boundary", () => {
    const result = shouldBlockPan(
      2001, // newEndMs (panning right)
      2000, // currentEndMs
      2000, // boundaryEndMs
      1000, // newRangeMs
      1000, // currentRangeMs (same = pan, not zoom)
    );
    expect(result).toBe(true);
  });

  it("should not block left pan at boundary", () => {
    const result = shouldBlockPan(
      1999, // newEndMs (panning left)
      2000, // currentEndMs
      2000, // boundaryEndMs
      1000, // newRangeMs
      1000, // currentRangeMs
    );
    expect(result).toBe(false);
  });

  it("should not block zoom at boundary", () => {
    const result = shouldBlockPan(
      2001, // newEndMs
      2000, // currentEndMs
      2000, // boundaryEndMs
      800, // newRangeMs (zoom in)
      1000, // currentRangeMs
    );
    expect(result).toBe(false);
  });

  it("should not block pan when not at boundary", () => {
    const result = shouldBlockPan(
      901, // newEndMs (panning right)
      900, // currentEndMs (1100ms away from boundary)
      2000, // boundaryEndMs
      1000, // newRangeMs
      1000, // currentRangeMs
    );
    expect(result).toBe(false);
  });

  it("should respect boundary threshold", () => {
    const result = shouldBlockPan(
      2001, // newEndMs
      1995, // currentEndMs (within 5ms of boundary)
      2000, // boundaryEndMs
      1000, // newRangeMs
      1000, // currentRangeMs
      10, // thresholdMs = 10
    );
    expect(result).toBe(true);
  });
});

describe("validatePanConstraint", () => {
  const bounds: TimelineBounds = {
    minTime: new Date(1000),
    maxTime: new Date(10000),
  };

  it("should allow pan within boundaries", () => {
    const result = validatePanConstraint(
      new Date(2000), // newDisplayStart
      new Date(3000), // newDisplayEnd (range = 1000)
      new Date(1900), // currentDisplayStart
      new Date(2900), // currentDisplayEnd (range = 1000)
      bounds,
      undefined,
      undefined,
    );
    expect(result.blocked).toBe(false);
  });

  it("should block right pan at boundary", () => {
    const result = validatePanConstraint(
      new Date(9100), // newDisplayStart
      new Date(10100), // newDisplayEnd (past boundary, range = 1000)
      new Date(9000), // currentDisplayStart
      new Date(10000), // currentDisplayEnd (at boundary, range = 1000)
      bounds,
      undefined,
      undefined,
    );
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe("right-boundary");
  });

  it("should allow zoom at boundary", () => {
    const result = validatePanConstraint(
      new Date(9500), // newDisplayStart
      new Date(10500), // newDisplayEnd (past boundary, range = 1000)
      new Date(9500), // currentDisplayStart
      new Date(10000), // currentDisplayEnd (at boundary, range = 500)
      bounds,
      undefined,
      undefined,
    );
    // Range changed from 500 to 1000, so it's a zoom
    expect(result.blocked).toBe(false);
  });

  it("should block pan violating effective start constraint", () => {
    const result = validatePanConstraint(
      new Date(400), // newDisplayStart (would put boundary past effective start)
      new Date(1400), // newDisplayEnd (range = 1000)
      new Date(2000), // currentDisplayStart
      new Date(3000), // currentDisplayEnd (range = 1000)
      bounds,
      0.5, // currentStartPercent (dragger at 50%)
      new Date(1800), // effectiveStartTime
    );
    // New effective start would be: 400 + 0.5 * 1000 = 900
    // But boundary start is 1000, so boundary > effective start (violation!)
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe("effective-start-violation");
  });

  it("should allow zoom violating effective start constraint", () => {
    const result = validatePanConstraint(
      new Date(500), // newDisplayStart
      new Date(2500), // newDisplayEnd (range = 2000, zoom)
      new Date(500), // currentDisplayStart
      new Date(2000), // currentDisplayEnd (range = 1500)
      bounds,
      0.5,
      new Date(1800),
    );
    // This is a zoom operation (range changed from 1500 to 2000), so allow it
    expect(result.blocked).toBe(false);
  });

  it("should allow pan when no effective start set", () => {
    const result = validatePanConstraint(
      new Date(500), // newDisplayStart (before boundary)
      new Date(1500), // newDisplayEnd (range = 1000)
      new Date(2000), // currentDisplayStart
      new Date(3000), // currentDisplayEnd (range = 1000)
      bounds,
      undefined, // No dragger set
      undefined, // No effective start
    );
    expect(result.blocked).toBe(false);
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

    // Default: 7.5% padding, min 30s
    // Range = 1000ms, 7.5% = 75ms, but min is 30000ms
    expect(result.displayStart.getTime()).toBe(1000 - 30000);
    expect(result.displayEnd.getTime()).toBe(2000 + 30000);
  });

  it("should handle large ranges with default padding", () => {
    const result = calculateDisplayRangeWithPadding(
      new Date(0),
      new Date(1_000_000), // 1000s range
      new Date(0),
      new Date(0),
    );

    // 7.5% of 1000000ms = 75000ms > 30000ms min
    expect(result.displayStart.getTime()).toBe(0 - 75000);
    expect(result.displayEnd.getTime()).toBe(1_000_000 + 75000);
  });
});
