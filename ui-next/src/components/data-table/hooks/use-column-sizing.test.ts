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
 * Column Sizing Tests
 *
 * Tests the core column sizing logic:
 * 1. State machine (sizingReducer) - all mode transitions and guards
 * 2. Width calculation algorithm (calculateColumnWidths) - shrink/expand behavior
 *
 * These tests are:
 * - Fast: Pure functions, no DOM, no React
 * - Stable: Deterministic inputs/outputs
 * - Valuable: Cover real user scenarios (resize, container change, preferences)
 * - Self-documenting: Each test describes expected behavior
 */

import { describe, it, expect } from "vitest";
import {
  sizingReducer,
  calculateColumnWidths,
  INITIAL_STATE,
  DEFAULT_COLUMN_SIZING_INFO,
  type SizingState,
  type SizingEvent,
} from "./use-column-sizing";
import type { ColumnSizingPreferences } from "../types";
import { PreferenceModes, SizingModes, SizingEventTypes } from "../constants";

// =============================================================================
// Test Helpers
// =============================================================================

/** Create a state in IDLE mode with given sizing */
function idleState(sizing: Record<string, number>, isInitialized = true): SizingState {
  return {
    mode: SizingModes.IDLE,
    sizing,
    isInitialized,
    columnSizingInfo: DEFAULT_COLUMN_SIZING_INFO,
    resizing: null,
  };
}

/** Create a state in RESIZING mode */
function resizingState(
  sizing: Record<string, number>,
  columnId: string,
  startWidth: number,
  beforeResize?: Record<string, number>,
): SizingState {
  return {
    mode: SizingModes.RESIZING,
    sizing,
    isInitialized: true,
    columnSizingInfo: {
      startOffset: 0,
      startSize: startWidth,
      deltaOffset: 0,
      deltaPercentage: 0,
      isResizingColumn: columnId,
      columnSizingStart: [[columnId, startWidth]],
    },
    resizing: {
      columnId,
      startWidth,
      beforeResize: beforeResize ?? { ...sizing },
    },
  };
}

// =============================================================================
// sizingReducer - State Machine Tests
// =============================================================================

describe("sizingReducer", () => {
  describe("IDLE mode", () => {
    it("INIT → sets sizing and marks initialized", () => {
      const state = INITIAL_STATE;
      const event: SizingEvent = {
        type: SizingEventTypes.INIT,
        sizing: { col1: 100, col2: 200 },
      };

      const result = sizingReducer(state, event);

      expect(result.mode).toBe(SizingModes.IDLE);
      expect(result.sizing).toEqual({ col1: 100, col2: 200 });
      expect(result.isInitialized).toBe(true);
    });

    it("CONTAINER_RESIZE → updates sizing", () => {
      const state = idleState({ col1: 100, col2: 200 });
      const event: SizingEvent = {
        type: SizingEventTypes.CONTAINER_RESIZE,
        sizing: { col1: 150, col2: 250 },
      };

      const result = sizingReducer(state, event);

      expect(result.mode).toBe(SizingModes.IDLE);
      expect(result.sizing).toEqual({ col1: 150, col2: 250 });
    });

    it("RESIZE_START → transitions to RESIZING mode", () => {
      const state = idleState({ col1: 100, col2: 200 });
      const event: SizingEvent = {
        type: SizingEventTypes.RESIZE_START,
        columnId: "col1",
        startWidth: 100,
        currentSizing: { col1: 100, col2: 200 },
      };

      const result = sizingReducer(state, event);

      expect(result.mode).toBe(SizingModes.RESIZING);
      expect(result.resizing).toEqual({
        columnId: "col1",
        startWidth: 100,
        beforeResize: { col1: 100, col2: 200 },
      });
      expect(result.columnSizingInfo.isResizingColumn).toBe("col1");
    });

    it("AUTO_FIT → updates single column width", () => {
      const state = idleState({ col1: 100, col2: 200 });
      const event: SizingEvent = {
        type: SizingEventTypes.AUTO_FIT,
        columnId: "col1",
        width: 180,
      };

      const result = sizingReducer(state, event);

      expect(result.mode).toBe(SizingModes.IDLE);
      expect(result.sizing).toEqual({ col1: 180, col2: 200 });
    });

    it("SET_SIZE → updates single column width", () => {
      const state = idleState({ col1: 100, col2: 200 });
      const event: SizingEvent = {
        type: SizingEventTypes.SET_SIZE,
        columnId: "col2",
        width: 300,
      };

      const result = sizingReducer(state, event);

      expect(result.sizing).toEqual({ col1: 100, col2: 300 });
    });

    it("TANSTACK_SIZING_CHANGE → accepts external sizing updates", () => {
      const state = idleState({ col1: 100 });
      const event: SizingEvent = {
        type: "TANSTACK_SIZING_CHANGE",
        sizing: { col1: 120, col2: 180 },
      };

      const result = sizingReducer(state, event);

      expect(result.sizing).toEqual({ col1: 120, col2: 180 });
    });

    it("ignores RESIZE_MOVE (no-op)", () => {
      const state = idleState({ col1: 100 });
      const event: SizingEvent = {
        type: SizingEventTypes.RESIZE_MOVE,
        columnId: "col1",
        newWidth: 200,
      };

      const result = sizingReducer(state, event);

      expect(result).toBe(state); // Same reference = no change
    });

    it("ignores RESIZE_END (no-op)", () => {
      const state = idleState({ col1: 100 });
      const event: SizingEvent = { type: SizingEventTypes.RESIZE_END };

      const result = sizingReducer(state, event);

      expect(result).toBe(state);
    });
  });

  describe("RESIZING mode", () => {
    it("RESIZE_MOVE → updates column width", () => {
      const state = resizingState({ col1: 100, col2: 200 }, "col1", 100);
      const event: SizingEvent = {
        type: SizingEventTypes.RESIZE_MOVE,
        columnId: "col1",
        newWidth: 150,
      };

      const result = sizingReducer(state, event);

      expect(result.mode).toBe(SizingModes.RESIZING);
      expect(result.sizing).toEqual({ col1: 150, col2: 200 });
    });

    it("RESIZE_END → transitions back to IDLE", () => {
      const state = resizingState({ col1: 150, col2: 200 }, "col1", 100);
      const event: SizingEvent = { type: SizingEventTypes.RESIZE_END };

      const result = sizingReducer(state, event);

      expect(result.mode).toBe(SizingModes.IDLE);
      expect(result.resizing).toBeNull();
      expect(result.columnSizingInfo).toEqual(DEFAULT_COLUMN_SIZING_INFO);
      expect(result.sizing).toEqual({ col1: 150, col2: 200 }); // Preserves final size
    });

    it("TANSTACK_SIZING_CHANGE → accepts sizing updates during drag", () => {
      const state = resizingState({ col1: 100 }, "col1", 100);
      const event: SizingEvent = {
        type: "TANSTACK_SIZING_CHANGE",
        sizing: { col1: 130 },
      };

      const result = sizingReducer(state, event);

      expect(result.mode).toBe(SizingModes.RESIZING); // Stays in RESIZING
      expect(result.sizing).toEqual({ col1: 130 });
    });

    // ==========================================================================
    // CRITICAL GUARDS - These protect user's resize from being overwritten
    // ==========================================================================

    it("IGNORES CONTAINER_RESIZE during drag (critical guard)", () => {
      const state = resizingState({ col1: 150, col2: 200 }, "col1", 100);
      const event: SizingEvent = {
        type: SizingEventTypes.CONTAINER_RESIZE,
        sizing: { col1: 80, col2: 160 }, // Would shrink columns
      };

      const result = sizingReducer(state, event);

      expect(result).toBe(state); // No change - guards user's resize
      expect(result.sizing).toEqual({ col1: 150, col2: 200 });
    });

    it("IGNORES INIT during drag", () => {
      const state = resizingState({ col1: 150 }, "col1", 100);
      const event: SizingEvent = {
        type: SizingEventTypes.INIT,
        sizing: { col1: 80 },
      };

      const result = sizingReducer(state, event);

      expect(result).toBe(state);
    });

    it("IGNORES AUTO_FIT during drag", () => {
      const state = resizingState({ col1: 150 }, "col1", 100);
      const event: SizingEvent = {
        type: SizingEventTypes.AUTO_FIT,
        columnId: "col1",
        width: 200,
      };

      const result = sizingReducer(state, event);

      expect(result).toBe(state);
    });

    it("IGNORES SET_SIZE during drag", () => {
      const state = resizingState({ col1: 150 }, "col1", 100);
      const event: SizingEvent = {
        type: SizingEventTypes.SET_SIZE,
        columnId: "col1",
        width: 200,
      };

      const result = sizingReducer(state, event);

      expect(result).toBe(state);
    });

    it("IGNORES RESIZE_START during drag (prevents concurrent resizes)", () => {
      const state = resizingState({ col1: 150, col2: 200 }, "col1", 100);
      const event: SizingEvent = {
        type: SizingEventTypes.RESIZE_START,
        columnId: "col2",
        startWidth: 200,
        currentSizing: { col1: 150, col2: 200 },
      };

      const result = sizingReducer(state, event);

      expect(result).toBe(state);
      expect(result.resizing?.columnId).toBe("col1"); // Still resizing col1
    });
  });

  describe("user journey: complete resize flow", () => {
    it("user drags column from 100px to 180px", () => {
      // Start in IDLE
      let state = idleState({ name: 100, status: 150 });

      // 1. User starts dragging "name" column
      state = sizingReducer(state, {
        type: SizingEventTypes.RESIZE_START,
        columnId: "name",
        startWidth: 100,
        currentSizing: { name: 100, status: 150 },
      });
      expect(state.mode).toBe(SizingModes.RESIZING);

      // 2. User drags right (multiple move events)
      state = sizingReducer(state, { type: SizingEventTypes.RESIZE_MOVE, columnId: "name", newWidth: 120 });
      state = sizingReducer(state, { type: SizingEventTypes.RESIZE_MOVE, columnId: "name", newWidth: 150 });
      state = sizingReducer(state, { type: SizingEventTypes.RESIZE_MOVE, columnId: "name", newWidth: 180 });
      expect(state.sizing.name).toBe(180);

      // 3. Container resize fires during drag (should be IGNORED)
      const beforeContainerResize = state;
      state = sizingReducer(state, {
        type: SizingEventTypes.CONTAINER_RESIZE,
        sizing: { name: 80, status: 120 },
      });
      expect(state).toBe(beforeContainerResize); // No change

      // 4. User releases mouse
      state = sizingReducer(state, { type: SizingEventTypes.RESIZE_END });
      expect(state.mode).toBe(SizingModes.IDLE);
      expect(state.sizing).toEqual({ name: 180, status: 150 });
    });
  });
});

// =============================================================================
// calculateColumnWidths - Algorithm Tests
// =============================================================================

describe("calculateColumnWidths", () => {
  // Standard test configuration
  const minSizes = { col1: 80, col2: 80, col3: 80 };
  const preferredSizes = { col1: 150, col2: 200, col3: 150 };
  // Total preferred = 500px

  describe("when container >= total preferred widths (surplus space)", () => {
    it("distributes surplus proportionally", () => {
      const containerWidth = 600; // 100px surplus
      const result = calculateColumnWidths(["col1", "col2", "col3"], containerWidth, minSizes, preferredSizes, {});

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
      const result = calculateColumnWidths(["col1", "col2", "col3"], containerWidth, minSizes, preferredSizes, {});

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
      const result = calculateColumnWidths(["col1", "col2", "col3"], containerWidth, minSizes, preferredSizes, {});

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
      const result = calculateColumnWidths(["col1", "col2", "col3"], containerWidth, minSizes, preferredSizes, {});

      expect(result.col1).toBeGreaterThanOrEqual(80);
      expect(result.col2).toBeGreaterThanOrEqual(80);
      expect(result.col3).toBeGreaterThanOrEqual(80);
    });
  });

  describe("when container < total floors (overflow)", () => {
    it("all columns at floor widths (scrollable overflow)", () => {
      const containerWidth = 200; // Less than total min (240)
      const result = calculateColumnWidths(["col1", "col2", "col3"], containerWidth, minSizes, preferredSizes, {});

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

      const result = calculateColumnWidths(["col1", "col2", "col3"], containerWidth, minSizes, preferredSizes, prefs);

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

      const result = calculateColumnWidths(["col1", "col2", "col3"], containerWidth, minSizes, preferredSizes, prefs);

      // col1 should stay at least at preferred (150) or width (180)
      expect(result.col1).toBeGreaterThanOrEqual(150);
    });

    it("columns without preference can shrink from preferred to min", () => {
      const prefs: ColumnSizingPreferences = {}; // No preferences
      const containerWidth = 300; // Forces shrinking

      const result = calculateColumnWidths(["col1", "col2", "col3"], containerWidth, minSizes, preferredSizes, prefs);

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
});
