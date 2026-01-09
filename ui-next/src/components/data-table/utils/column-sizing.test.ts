// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Column Sizing Algorithm Tests
 *
 * Tests the width calculation algorithm (calculateColumnWidths) - shrink/expand behavior.
 *
 * These tests are:
 * - Fast: Pure functions, no DOM, no React
 * - Stable: Deterministic inputs/outputs
 * - Valuable: Cover real user scenarios (responsive tables, user preferences)
 * - Self-documenting: Each test describes expected behavior
 */

import { describe, it, expect } from "vitest";
import { calculateColumnWidths } from "./column-sizing";
import type { ColumnSizingPreferences } from "../types";
import { PreferenceModes } from "../constants";

// =============================================================================
// calculateColumnWidths - Algorithm Tests
// =============================================================================

describe("calculateColumnWidths", () => {
  // Standard test configuration
  const minSizes = { col1: 80, col2: 80, col3: 80 };
  const configuredSizes = { col1: 150, col2: 200, col3: 150 };
  // Total preferred = 500px

  describe("when container >= total preferred widths (surplus space)", () => {
    it("distributes surplus proportionally", () => {
      const containerWidth = 600; // 100px surplus
      const result = calculateColumnWidths(["col1", "col2", "col3"], containerWidth, minSizes, configuredSizes, {});

      // Each column should get its preferred + proportional share of surplus
      // Total preferred = 500, surplus = 100
      // col1: 150 + (150/500)*100 = 150 + 30 = 180
      // col2: 200 + (200/500)*100 = 200 + 40 = 240
      // col3: 150 + (150/500)*100 = 150 + 30 = 180
      expect(result.col1).toBeCloseTo(180, 1);
      expect(result.col2).toBeCloseTo(240, 1);
      expect(result.col3).toBeCloseTo(180, 1);

      // Total should equal container width
      const total = Object.values(result).reduce((sum, w) => sum + w, 0);
      expect(total).toBeCloseTo(containerWidth, 1);
    });

    it("uses exact preferred widths when container exactly matches", () => {
      const containerWidth = 500; // Exact match
      const result = calculateColumnWidths(["col1", "col2", "col3"], containerWidth, minSizes, configuredSizes, {});

      expect(result.col1).toBe(150);
      expect(result.col2).toBe(200);
      expect(result.col3).toBe(150);
    });
  });

  describe("when container < preferred but >= total floors (shrink)", () => {
    it("shrinks columns proportionally to their give", () => {
      // Total preferred = 500, total min = 240
      // Container = 400, deficit = 100
      const containerWidth = 400;
      const result = calculateColumnWidths(["col1", "col2", "col3"], containerWidth, minSizes, configuredSizes, {});

      // Each column has "give" = preferred - floor (min in this case)
      // col1: give = 150 - 80 = 70
      // col2: give = 200 - 80 = 120
      // col3: give = 150 - 80 = 70
      // Total give = 260
      // Shrink ratio = min(1, 100/260) ≈ 0.385

      // All columns should shrink but stay above minimum
      expect(result.col1).toBeGreaterThan(80);
      expect(result.col2).toBeGreaterThan(80);
      expect(result.col3).toBeGreaterThan(80);

      // Total should equal container width
      const total = Object.values(result).reduce((sum, w) => sum + w, 0);
      expect(total).toBeCloseTo(containerWidth, 1);
    });

    it("respects minimum sizes during shrink", () => {
      // Shrink aggressively but not below min
      const containerWidth = 280; // Just above total min (240)
      const result = calculateColumnWidths(["col1", "col2", "col3"], containerWidth, minSizes, configuredSizes, {});

      expect(result.col1).toBeGreaterThanOrEqual(80);
      expect(result.col2).toBeGreaterThanOrEqual(80);
      expect(result.col3).toBeGreaterThanOrEqual(80);
    });
  });

  describe("when container < total floors (overflow)", () => {
    it("all columns at floor widths (scrollable overflow)", () => {
      const containerWidth = 200; // Less than total min (240)
      const result = calculateColumnWidths(["col1", "col2", "col3"], containerWidth, minSizes, configuredSizes, {});

      // Columns should be at their floor values (min in this case)
      expect(result.col1).toBe(80);
      expect(result.col2).toBe(80);
      expect(result.col3).toBe(80);
    });
  });

  describe("user preferences", () => {
    it("truncate mode: floor = persisted width (can shrink to persisted size)", () => {
      const prefs: ColumnSizingPreferences = {
        col1: { mode: PreferenceModes.TRUNCATE, width: 100 }, // User shrunk col1 to 100
      };
      const containerWidth = 400;

      const result = calculateColumnWidths(["col1", "col2", "col3"], containerWidth, minSizes, configuredSizes, prefs);

      // col1's floor is now 100 (persisted width), clamped to min
      // col2, col3 have no preference, floor = min = 80
      // Algorithm should respect col1 being locked at 100+
      expect(result.col1).toBeGreaterThanOrEqual(100);
    });

    it("no-truncate mode: floor = max(preferred, min)", () => {
      const prefs: ColumnSizingPreferences = {
        col1: { mode: PreferenceModes.NO_TRUNCATE, width: 180 }, // User expanded col1
      };
      const containerWidth = 400;

      const result = calculateColumnWidths(["col1", "col2", "col3"], containerWidth, minSizes, configuredSizes, prefs);

      // col1 should stay at least at preferred (150) or width (180)
      expect(result.col1).toBeGreaterThanOrEqual(150);
    });

    it("columns without preference can shrink from preferred to min", () => {
      const prefs: ColumnSizingPreferences = {}; // No preferences
      const containerWidth = 300; // Forces shrinking

      const result = calculateColumnWidths(["col1", "col2", "col3"], containerWidth, minSizes, configuredSizes, prefs);

      // All columns should shrink (no locked floors)
      expect(result.col1).toBeLessThan(150);
      expect(result.col2).toBeLessThan(200);
      expect(result.col3).toBeLessThan(150);

      // But not below minimum
      expect(result.col1).toBeGreaterThanOrEqual(80);
      expect(result.col2).toBeGreaterThanOrEqual(80);
      expect(result.col3).toBeGreaterThanOrEqual(80);
    });
  });

  describe("edge cases", () => {
    it("empty column list returns empty object", () => {
      const result = calculateColumnWidths([], 500, {}, {}, {});
      expect(result).toEqual({});
    });

    it("zero container width returns empty object", () => {
      const result = calculateColumnWidths(["col1"], 0, { col1: 80 }, { col1: 150 }, {});
      expect(result).toEqual({});
    });

    it("negative container width returns empty object", () => {
      const result = calculateColumnWidths(["col1"], -100, { col1: 80 }, { col1: 150 }, {});
      expect(result).toEqual({});
    });

    it("single column fills container", () => {
      const result = calculateColumnWidths(["col1"], 500, { col1: 80 }, { col1: 150 }, {});
      expect(result.col1).toBe(500);
    });

    it("uses default min size (80) when not specified", () => {
      const result = calculateColumnWidths(["col1"], 100, {}, { col1: 150 }, {});
      // Should use default min of 80
      expect(result.col1).toBe(100);
    });

    it("uses default preferred size (min * 1.5) when not specified", () => {
      const result = calculateColumnWidths(["col1"], 500, { col1: 100 }, {}, {});
      // Default preferred = 100 * 1.5 = 150
      // Container > preferred, so gets full container
      expect(result.col1).toBe(500);
    });
  });

  describe("user journey: responsive table resize", () => {
    it("table shrinks gracefully as window narrows", () => {
      const cols = ["name", "status", "date"];
      const mins = { name: 100, status: 80, date: 80 };
      const prefs = { name: 200, status: 120, date: 150 };
      // Total preferred = 470, total min = 260

      // Wide viewport
      let result = calculateColumnWidths(cols, 600, mins, prefs, {});
      expect(Object.values(result).reduce((a, b) => a + b, 0)).toBeCloseTo(600, 1);

      // Medium viewport - columns shrink but above min
      result = calculateColumnWidths(cols, 400, mins, prefs, {});
      expect(result.name).toBeGreaterThanOrEqual(100);
      expect(result.status).toBeGreaterThanOrEqual(80);
      expect(result.date).toBeGreaterThanOrEqual(80);
      expect(Object.values(result).reduce((a, b) => a + b, 0)).toBeCloseTo(400, 1);

      // Narrow viewport - at minimums (overflow)
      result = calculateColumnWidths(cols, 250, mins, prefs, {});
      expect(result.name).toBe(100);
      expect(result.status).toBe(80);
      expect(result.date).toBe(80);
    });
  });

  describe("contentWidths (measured content for NO_TRUNCATE)", () => {
    const cols = ["name", "description", "status"];
    const mins = { name: 80, description: 100, status: 60 };
    const configured = { name: 150, description: 200, status: 100 };

    it("NO_TRUNCATE uses max(contentWidth, configuredWidth) as floor", () => {
      // Description has measured content wider than configured
      const prefs: ColumnSizingPreferences = {
        description: { mode: PreferenceModes.NO_TRUNCATE, width: 400 },
      };
      const contentWidths = { description: 350 }; // Content is 350px wide

      // Total targets: name=150, description=400, status=100 = 650
      // Container = 450, which forces shrinking
      // Without contentWidths, floor = max(configured=200, min=100) = 200
      // With contentWidths, floor = max(350, 200) = 350 (content is wider)
      // Algorithm: shrink from target (400) but not below floor (350)
      const result = calculateColumnWidths(cols, 450, mins, configured, prefs, contentWidths);

      // Description should not go below contentWidth (350)
      expect(result.description).toBeGreaterThanOrEqual(350);
    });

    it("NO_TRUNCATE uses configuredWidth as floor when contentWidth is smaller", () => {
      const prefs: ColumnSizingPreferences = {
        description: { mode: PreferenceModes.NO_TRUNCATE, width: 250 },
      };
      const contentWidths = { description: 150 }; // Content is smaller than configured

      // floor = max(150, 200) = 200 (configuredWidth wins)
      const result = calculateColumnWidths(cols, 600, mins, configured, prefs, contentWidths);

      expect(result.description).toBeGreaterThanOrEqual(200);
    });

    it("NO_TRUNCATE with unmeasured content (0) uses configuredWidth as floor", () => {
      const prefs: ColumnSizingPreferences = {
        description: { mode: PreferenceModes.NO_TRUNCATE, width: 250 },
      };
      // No contentWidths entry = unmeasured = 0

      // floor = max(0, 200) = 200
      const result = calculateColumnWidths(cols, 600, mins, configured, prefs, {});

      expect(result.description).toBeGreaterThanOrEqual(200);
    });

    it("TRUNCATE mode ignores contentWidths", () => {
      const prefs: ColumnSizingPreferences = {
        description: { mode: PreferenceModes.TRUNCATE, width: 120 },
      };
      const contentWidths = { description: 350 }; // Content is wide

      // TRUNCATE mode: floor = max(pref.width, min) = max(120, 100) = 120
      // contentWidths should be ignored
      const result = calculateColumnWidths(cols, 400, mins, configured, prefs, contentWidths);

      // Description can shrink below contentWidth (120 < 350)
      expect(result.description).toBeLessThan(350);
      expect(result.description).toBeGreaterThanOrEqual(120);
    });

    it("columns without preference ignore contentWidths", () => {
      const prefs: ColumnSizingPreferences = {}; // No preferences
      const contentWidths = { name: 300 }; // Content measured for name

      // No preference = floor is just min (80)
      // contentWidths should be ignored
      const result = calculateColumnWidths(cols, 300, mins, configured, prefs, contentWidths);

      // Name can shrink below contentWidth
      expect(result.name).toBeLessThan(300);
      expect(result.name).toBeGreaterThanOrEqual(80);
    });

    it("multiple NO_TRUNCATE columns respect floor when container forces shrinking", () => {
      const prefs: ColumnSizingPreferences = {
        name: { mode: PreferenceModes.NO_TRUNCATE, width: 250 },
        description: { mode: PreferenceModes.NO_TRUNCATE, width: 350 },
      };
      const contentWidths = {
        name: 180, // Smaller than configured (150), floor = max(180, 150) = 180
        description: 400, // Larger than configured (200), floor = max(400, 200) = 400
      };

      // Total targets: 250 + 350 + 100 = 700
      // Total floors: 180 + 400 + 60 = 640
      // Container = 500 forces shrinking below targets but above floors
      const result = calculateColumnWidths(cols, 640, mins, configured, prefs, contentWidths);

      // When container = totalFloor, all columns get their floor
      expect(result.name).toBeGreaterThanOrEqual(180);
      expect(result.description).toBeGreaterThanOrEqual(400);
      expect(result.status).toBeGreaterThanOrEqual(60);
    });
  });
});
