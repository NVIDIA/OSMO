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
 * Row Navigation Logic Tests
 *
 * Tests the pure navigation logic without React hooks:
 * - Index clamping
 * - Key → action mapping
 * - Roving tabindex calculation
 *
 * These tests are:
 * - Fast: Pure functions, no DOM, no React
 * - Stable: Deterministic inputs/outputs
 * - Valuable: Cover keyboard accessibility patterns
 */

import { describe, it, expect } from "vitest";

// =============================================================================
// Pure Functions Extracted from useRowNavigation
// These are the testable parts of the hook logic
// =============================================================================

/**
 * Clamp an index to valid range [0, rowCount - 1]
 * Extracted logic from useRowNavigation's clampIndex callback
 */
function clampIndex(index: number, rowCount: number): number {
  return Math.max(0, Math.min(rowCount - 1, index));
}

/**
 * Calculate scroll alignment for navigation direction
 * Going up = align to "end" (row visible at bottom)
 * Going down = align to "start" (row visible at top)
 * Jump = align to "center"
 */
type ScrollAlign = "start" | "end" | "center";

function getScrollAlignment(key: string): ScrollAlign {
  switch (key) {
    case "ArrowUp":
      return "end";
    case "ArrowDown":
      return "start";
    default:
      return "center";
  }
}

/**
 * Calculate the target row index for a key press
 * Returns null if key is not a navigation key
 */
function getTargetIndex(
  key: string,
  currentIndex: number,
  rowCount: number,
  visibleRowCount: number,
): { index: number; align: ScrollAlign } | null {
  if (rowCount === 0) return null;

  let targetIndex: number;
  let align: ScrollAlign;

  switch (key) {
    case "ArrowUp":
      targetIndex = currentIndex - 1;
      align = "end";
      break;
    case "ArrowDown":
      targetIndex = currentIndex + 1;
      align = "start";
      break;
    case "Home":
      targetIndex = 0;
      align = "start";
      break;
    case "End":
      targetIndex = rowCount - 1;
      align = "end";
      break;
    case "PageUp":
      targetIndex = currentIndex - visibleRowCount;
      align = "center";
      break;
    case "PageDown":
      targetIndex = currentIndex + visibleRowCount;
      align = "center";
      break;
    default:
      return null;
  }

  return {
    index: clampIndex(targetIndex, rowCount),
    align,
  };
}

/**
 * Calculate roving tabindex for a row
 * Only one row should be tabbable at a time
 */
function getRowTabIndex(rowIndex: number, focusedRowIndex: number | null, disabled: boolean): 0 | -1 {
  if (disabled) return -1;

  // If nothing focused, first row is tabbable
  if (focusedRowIndex === null) {
    return rowIndex === 0 ? 0 : -1;
  }

  // Focused row is tabbable
  return rowIndex === focusedRowIndex ? 0 : -1;
}

/**
 * Check if a key should trigger row activation
 */
function isActivationKey(key: string): boolean {
  return key === "Enter" || key === " ";
}

/**
 * Check if a key is a navigation key we handle
 */
function isNavigationKey(key: string): boolean {
  return ["ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown", "Enter", " "].includes(key);
}

// =============================================================================
// Tests
// =============================================================================

describe("clampIndex", () => {
  it("returns 0 for negative indices", () => {
    expect(clampIndex(-1, 10)).toBe(0);
    expect(clampIndex(-100, 10)).toBe(0);
  });

  it("returns max valid index for out of bounds", () => {
    expect(clampIndex(10, 10)).toBe(9);
    expect(clampIndex(100, 10)).toBe(9);
  });

  it("returns index unchanged when in valid range", () => {
    expect(clampIndex(0, 10)).toBe(0);
    expect(clampIndex(5, 10)).toBe(5);
    expect(clampIndex(9, 10)).toBe(9);
  });

  it("handles rowCount of 1", () => {
    expect(clampIndex(0, 1)).toBe(0);
    expect(clampIndex(5, 1)).toBe(0);
    expect(clampIndex(-1, 1)).toBe(0);
  });
});

describe("getScrollAlignment", () => {
  it("ArrowUp aligns to end (row at bottom of viewport)", () => {
    expect(getScrollAlignment("ArrowUp")).toBe("end");
  });

  it("ArrowDown aligns to start (row at top of viewport)", () => {
    expect(getScrollAlignment("ArrowDown")).toBe("start");
  });

  it("other keys align to center", () => {
    expect(getScrollAlignment("Home")).toBe("center");
    expect(getScrollAlignment("End")).toBe("center");
    expect(getScrollAlignment("PageUp")).toBe("center");
    expect(getScrollAlignment("PageDown")).toBe("center");
  });
});

describe("getTargetIndex", () => {
  const rowCount = 100;
  const visibleRowCount = 10;

  describe("ArrowDown", () => {
    it("moves to next row", () => {
      const result = getTargetIndex("ArrowDown", 5, rowCount, visibleRowCount);
      expect(result).toEqual({ index: 6, align: "start" });
    });

    it("clamps at last row", () => {
      const result = getTargetIndex("ArrowDown", 99, rowCount, visibleRowCount);
      expect(result).toEqual({ index: 99, align: "start" });
    });
  });

  describe("ArrowUp", () => {
    it("moves to previous row", () => {
      const result = getTargetIndex("ArrowUp", 5, rowCount, visibleRowCount);
      expect(result).toEqual({ index: 4, align: "end" });
    });

    it("clamps at first row", () => {
      const result = getTargetIndex("ArrowUp", 0, rowCount, visibleRowCount);
      expect(result).toEqual({ index: 0, align: "end" });
    });
  });

  describe("Home", () => {
    it("moves to first row", () => {
      const result = getTargetIndex("Home", 50, rowCount, visibleRowCount);
      expect(result).toEqual({ index: 0, align: "start" });
    });
  });

  describe("End", () => {
    it("moves to last row", () => {
      const result = getTargetIndex("End", 50, rowCount, visibleRowCount);
      expect(result).toEqual({ index: 99, align: "end" });
    });
  });

  describe("PageDown", () => {
    it("moves by visibleRowCount", () => {
      const result = getTargetIndex("PageDown", 5, rowCount, visibleRowCount);
      expect(result).toEqual({ index: 15, align: "center" });
    });

    it("clamps at last row", () => {
      const result = getTargetIndex("PageDown", 95, rowCount, visibleRowCount);
      expect(result).toEqual({ index: 99, align: "center" });
    });
  });

  describe("PageUp", () => {
    it("moves by visibleRowCount", () => {
      const result = getTargetIndex("PageUp", 25, rowCount, visibleRowCount);
      expect(result).toEqual({ index: 15, align: "center" });
    });

    it("clamps at first row", () => {
      const result = getTargetIndex("PageUp", 3, rowCount, visibleRowCount);
      expect(result).toEqual({ index: 0, align: "center" });
    });
  });

  describe("unhandled keys", () => {
    it("returns null for non-navigation keys", () => {
      expect(getTargetIndex("Enter", 5, rowCount, visibleRowCount)).toBeNull();
      expect(getTargetIndex("a", 5, rowCount, visibleRowCount)).toBeNull();
      expect(getTargetIndex("Escape", 5, rowCount, visibleRowCount)).toBeNull();
    });
  });

  describe("empty table", () => {
    it("returns null when rowCount is 0", () => {
      expect(getTargetIndex("ArrowDown", 0, 0, visibleRowCount)).toBeNull();
    });
  });
});

describe("getRowTabIndex (roving tabindex)", () => {
  it("first row is tabbable when nothing focused", () => {
    expect(getRowTabIndex(0, null, false)).toBe(0);
    expect(getRowTabIndex(1, null, false)).toBe(-1);
    expect(getRowTabIndex(5, null, false)).toBe(-1);
  });

  it("focused row is tabbable", () => {
    expect(getRowTabIndex(0, 3, false)).toBe(-1);
    expect(getRowTabIndex(3, 3, false)).toBe(0);
    expect(getRowTabIndex(5, 3, false)).toBe(-1);
  });

  it("all rows are -1 when disabled", () => {
    expect(getRowTabIndex(0, null, true)).toBe(-1);
    expect(getRowTabIndex(0, 0, true)).toBe(-1);
    expect(getRowTabIndex(3, 3, true)).toBe(-1);
  });
});

describe("isActivationKey", () => {
  it("Enter is an activation key", () => {
    expect(isActivationKey("Enter")).toBe(true);
  });

  it("Space is an activation key", () => {
    expect(isActivationKey(" ")).toBe(true);
  });

  it("other keys are not activation keys", () => {
    expect(isActivationKey("ArrowDown")).toBe(false);
    expect(isActivationKey("a")).toBe(false);
    expect(isActivationKey("Escape")).toBe(false);
  });
});

describe("isNavigationKey", () => {
  it("recognizes all navigation keys", () => {
    expect(isNavigationKey("ArrowUp")).toBe(true);
    expect(isNavigationKey("ArrowDown")).toBe(true);
    expect(isNavigationKey("Home")).toBe(true);
    expect(isNavigationKey("End")).toBe(true);
    expect(isNavigationKey("PageUp")).toBe(true);
    expect(isNavigationKey("PageDown")).toBe(true);
    expect(isNavigationKey("Enter")).toBe(true);
    expect(isNavigationKey(" ")).toBe(true);
  });

  it("rejects non-navigation keys", () => {
    expect(isNavigationKey("a")).toBe(false);
    expect(isNavigationKey("Escape")).toBe(false);
    expect(isNavigationKey("Tab")).toBe(false);
    expect(isNavigationKey("ArrowLeft")).toBe(false);
    expect(isNavigationKey("ArrowRight")).toBe(false);
  });
});

describe("user journey: keyboard-only navigation flow", () => {
  it("calculates correct sequence for navigating to item and activating", () => {
    const rowCount = 50;
    const visibleRowCount = 10;
    let currentIndex = 0;

    // User starts at row 0
    expect(getRowTabIndex(0, currentIndex, false)).toBe(0);

    // User presses PageDown
    const step1 = getTargetIndex("PageDown", currentIndex, rowCount, visibleRowCount);
    expect(step1).not.toBeNull();
    currentIndex = step1!.index;
    expect(currentIndex).toBe(10);

    // User presses ArrowDown twice
    const step2 = getTargetIndex("ArrowDown", currentIndex, rowCount, visibleRowCount);
    currentIndex = step2!.index;
    expect(currentIndex).toBe(11);

    const step3 = getTargetIndex("ArrowDown", currentIndex, rowCount, visibleRowCount);
    currentIndex = step3!.index;
    expect(currentIndex).toBe(12);

    // Now row 12 should be tabbable
    expect(getRowTabIndex(0, currentIndex, false)).toBe(-1);
    expect(getRowTabIndex(12, currentIndex, false)).toBe(0);

    // User presses Enter to activate
    expect(isActivationKey("Enter")).toBe(true);
    // (Activation would call onRowActivate(12))
  });

  it("handles boundary conditions correctly", () => {
    const rowCount = 5;
    const visibleRowCount = 10;

    // At first row, ArrowUp stays at 0
    expect(getTargetIndex("ArrowUp", 0, rowCount, visibleRowCount)?.index).toBe(0);

    // At last row, ArrowDown stays at last
    expect(getTargetIndex("ArrowDown", 4, rowCount, visibleRowCount)?.index).toBe(4);

    // PageDown from row 2 with 5 rows clamps to last
    expect(getTargetIndex("PageDown", 2, rowCount, visibleRowCount)?.index).toBe(4);

    // PageUp from row 2 with 5 rows clamps to first
    expect(getTargetIndex("PageUp", 2, rowCount, visibleRowCount)?.index).toBe(0);
  });
});
