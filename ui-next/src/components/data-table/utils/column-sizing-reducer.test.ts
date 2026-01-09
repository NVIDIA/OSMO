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
 * Column Sizing Reducer Tests
 *
 * Tests the state machine (sizingReducer) - all mode transitions and guards.
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
  INITIAL_STATE,
  DEFAULT_COLUMN_SIZING_INFO,
  type SizingState,
  type SizingEvent,
} from "./column-sizing-reducer";
import { SizingModes, SizingEventTypes } from "../constants";

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
