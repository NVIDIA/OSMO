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

import { describe, it, expect } from "vitest";

// =============================================================================
// Helper Function Tests
// =============================================================================

/**
 * Get the number of characters in "+N" for a given overflow count.
 * Extracted for testing.
 */
function getOverflowCharCount(overflow: number): number {
  return 1 + String(overflow).length;
}

describe("getOverflowCharCount", () => {
  it("returns 2 for single digit overflow (+1 to +9)", () => {
    expect(getOverflowCharCount(1)).toBe(2); // "+1"
    expect(getOverflowCharCount(5)).toBe(2); // "+5"
    expect(getOverflowCharCount(9)).toBe(2); // "+9"
  });

  it("returns 3 for double digit overflow (+10 to +99)", () => {
    expect(getOverflowCharCount(10)).toBe(3); // "+10"
    expect(getOverflowCharCount(50)).toBe(3); // "+50"
    expect(getOverflowCharCount(99)).toBe(3); // "+99"
  });

  it("returns 4 for triple digit overflow (+100 to +999)", () => {
    expect(getOverflowCharCount(100)).toBe(4); // "+100"
    expect(getOverflowCharCount(500)).toBe(4); // "+500"
    expect(getOverflowCharCount(999)).toBe(4); // "+999"
  });

  it("handles edge cases", () => {
    expect(getOverflowCharCount(0)).toBe(2); // "+0" (edge case)
    expect(getOverflowCharCount(1000)).toBe(5); // "+1000"
  });
});

// =============================================================================
// Sorting Logic Tests
// =============================================================================

describe("sorting behavior", () => {
  function isStringArray<T>(items: T[]): items is (T & string)[] {
    return items.length > 0 && typeof items[0] === "string";
  }

  function sortItems<T>(items: T[], sortAlphabetically: boolean, getKey?: (item: T) => string): T[] {
    if (!sortAlphabetically || items.length === 0) return items;
    if (isStringArray(items)) {
      return [...items].sort((a, b) => a.localeCompare(b));
    }
    if (getKey) {
      return [...items].sort((a, b) => getKey(a).localeCompare(getKey(b)));
    }
    return items;
  }

  describe("string arrays", () => {
    it("sorts strings alphabetically", () => {
      const items = ["zebra", "apple", "mango"];
      const sorted = sortItems(items, true);
      expect(sorted).toEqual(["apple", "mango", "zebra"]);
    });

    it("does not mutate original array", () => {
      const items = ["zebra", "apple", "mango"];
      sortItems(items, true);
      expect(items).toEqual(["zebra", "apple", "mango"]);
    });

    it("returns original array when sorting disabled", () => {
      const items = ["zebra", "apple", "mango"];
      const sorted = sortItems(items, false);
      expect(sorted).toBe(items); // Same reference
    });

    it("handles empty array", () => {
      const items: string[] = [];
      const sorted = sortItems(items, true);
      expect(sorted).toEqual([]);
    });

    it("handles single item", () => {
      const items = ["only"];
      const sorted = sortItems(items, true);
      expect(sorted).toEqual(["only"]);
    });

    it("uses locale-aware sorting", () => {
      const items = ["Éclair", "apple", "Banana"];
      const sorted = sortItems(items, true);
      // localeCompare handles accents and case
      expect(sorted[0]).toBe("apple");
    });
  });

  describe("object arrays with getKey", () => {
    interface Item {
      id: number;
      name: string;
    }

    it("sorts objects by key", () => {
      const items: Item[] = [
        { id: 1, name: "zebra" },
        { id: 2, name: "apple" },
        { id: 3, name: "mango" },
      ];
      const sorted = sortItems(items, true, (item) => item.name);
      expect(sorted.map((i) => i.name)).toEqual(["apple", "mango", "zebra"]);
    });

    it("returns original without getKey", () => {
      const items: Item[] = [
        { id: 1, name: "zebra" },
        { id: 2, name: "apple" },
      ];
      const sorted = sortItems(items, true);
      expect(sorted).toBe(items); // Same reference, no sorting
    });
  });
});

// =============================================================================
// Keyed State Reset Logic Tests
// =============================================================================

describe("keyed state reset behavior", () => {
  interface ExpandedState<T> {
    items: T[];
    value: boolean;
  }

  function deriveExpanded<T>(state: ExpandedState<T>, currentItems: T[]): boolean {
    return state.items === currentItems ? state.value : false;
  }

  it("returns stored value when items reference matches", () => {
    const items = ["a", "b", "c"];
    const state: ExpandedState<string> = { items, value: true };
    expect(deriveExpanded(state, items)).toBe(true);
  });

  it("returns false when items reference changes", () => {
    const items1 = ["a", "b", "c"];
    const items2 = ["a", "b", "c"]; // Same content, different reference
    const state: ExpandedState<string> = { items: items1, value: true };
    expect(deriveExpanded(state, items2)).toBe(false);
  });

  it("returns false when items content changes", () => {
    const items1 = ["a", "b", "c"];
    const items2 = ["a", "b", "d"];
    const state: ExpandedState<string> = { items: items1, value: true };
    expect(deriveExpanded(state, items2)).toBe(false);
  });
});

// =============================================================================
// Note: DOM-dependent tests
// =============================================================================

/**
 * The following behaviors require DOM measurement and would need
 * @testing-library/react with renderHook to test properly:
 *
 * 1. calculateVisibleCount - measures actual chip widths
 * 2. ResizeObserver integration - responds to container resize
 * 3. RAF throttling - smooth 60fps updates
 * 4. displayedItems/overflowCount - derived from visibleCount
 *
 * Consider adding integration tests or visual regression tests
 * for these DOM-dependent behaviors.
 */
