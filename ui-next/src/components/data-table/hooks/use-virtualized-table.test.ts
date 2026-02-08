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
 * Virtualized Table Logic Tests
 *
 * Tests the pure data transformation logic without React hooks:
 * - Section flattening
 * - Item lookup by virtual index
 * - Row count calculations
 *
 * These tests are:
 * - Fast: Pure functions, no DOM, no React
 * - Stable: Deterministic inputs/outputs
 * - Valuable: Cover section/flat data handling and accessibility counts
 *
 * Note: We don't test actual virtualization (that's TanStack Virtual's job).
 * We test our wrapper logic: data transformation, item lookup, section handling.
 */

import { describe, it, expect } from "vitest";
import type { Section } from "@/components/data-table/types";

// =============================================================================
// Pure Functions Extracted from useVirtualizedTable
// These are the testable parts of the hook logic
// =============================================================================

interface VirtualItem<T, TSectionMeta> {
  type: "section" | "row";
  section?: Section<T, TSectionMeta>;
  item?: T;
  height: number;
}

/**
 * Build flat list of virtual items from sections or flat data.
 * Extracted from useVirtualizedTable's useMemo.
 */
function buildVirtualItems<T, TSectionMeta>(
  items: T[] | undefined,
  sections: Section<T, TSectionMeta>[] | undefined,
  rowHeight: number,
  sectionHeight: number,
): VirtualItem<T, TSectionMeta>[] {
  if (sections && sections.length > 0) {
    const result: VirtualItem<T, TSectionMeta>[] = [];

    for (const section of sections) {
      result.push({ type: "section", section, height: sectionHeight });
      for (const item of section.items) {
        result.push({ type: "row", item, height: rowHeight });
      }
    }

    return result;
  }

  if (items && items.length > 0) {
    return items.map((item) => ({ type: "row" as const, item, height: rowHeight }));
  }

  return [];
}

/**
 * Get item at a virtual index.
 * Extracted from useVirtualizedTable's getItem callback.
 */
function getItem<T, TSectionMeta>(
  virtualItems: VirtualItem<T, TSectionMeta>[],
  index: number,
): { type: "section"; section: Section<T, TSectionMeta> } | { type: "row"; item: T } | null {
  const item = virtualItems[index];
  if (!item) return null;

  if (item.type === "section" && item.section) {
    return { type: "section", section: item.section };
  }
  if (item.type === "row" && item.item !== undefined) {
    return { type: "row", item: item.item };
  }
  return null;
}

/**
 * Count total data rows (excluding section headers).
 * Used for aria-rowcount accessibility attribute.
 */
function getTotalRowCount<T, TSectionMeta>(
  items: T[] | undefined,
  sections: Section<T, TSectionMeta>[] | undefined,
): number {
  if (sections && sections.length > 0) {
    return sections.reduce((sum, s) => sum + s.items.length, 0);
  }
  return items?.length ?? 0;
}

/**
 * Get virtual item count (sections + data rows).
 * Used for navigation indexing.
 */
function getVirtualItemCount<T, TSectionMeta>(virtualItems: VirtualItem<T, TSectionMeta>[]): number {
  return virtualItems.length;
}

/**
 * Generate item key for virtualizer.
 * Extracted from useVirtualizedTable's getItemKey callback.
 */
function getItemKey<T>(
  virtualItems: VirtualItem<T, unknown>[],
  index: number,
  getRowId: (item: T) => string,
): string | number {
  const item = virtualItems[index];
  if (!item) return index;
  if (item.type === "section" && item.section) return `section-${item.section.id}`;
  if (item.item) return getRowId(item.item);
  return index;
}

// =============================================================================
// Test Data
// =============================================================================

interface TestItem {
  id: string;
  name: string;
}

const flatItems: TestItem[] = [
  { id: "1", name: "Item 1" },
  { id: "2", name: "Item 2" },
  { id: "3", name: "Item 3" },
  { id: "4", name: "Item 4" },
  { id: "5", name: "Item 5" },
];

interface TestSectionMeta {
  priority: "high" | "medium" | "low";
}

const sections: Section<TestItem, TestSectionMeta>[] = [
  {
    id: "high",
    label: "High Priority",
    items: [
      { id: "1", name: "Task 1" },
      { id: "2", name: "Task 2" },
    ],
    metadata: { priority: "high" },
  },
  {
    id: "medium",
    label: "Medium Priority",
    items: [{ id: "3", name: "Task 3" }],
    metadata: { priority: "medium" },
  },
  {
    id: "low",
    label: "Low Priority",
    items: [
      { id: "4", name: "Task 4" },
      { id: "5", name: "Task 5" },
    ],
    metadata: { priority: "low" },
  },
];

const ROW_HEIGHT = 48;
const SECTION_HEIGHT = 36;

// =============================================================================
// Tests
// =============================================================================

describe("buildVirtualItems", () => {
  describe("flat data", () => {
    it("creates row items for each data item", () => {
      const result = buildVirtualItems(flatItems, undefined, ROW_HEIGHT, SECTION_HEIGHT);

      expect(result).toHaveLength(5);
      expect(result.every((item) => item.type === "row")).toBe(true);
      expect(result.every((item) => item.height === ROW_HEIGHT)).toBe(true);
    });

    it("preserves item references", () => {
      const result = buildVirtualItems(flatItems, undefined, ROW_HEIGHT, SECTION_HEIGHT);

      expect(result[0].item).toBe(flatItems[0]);
      expect(result[4].item).toBe(flatItems[4]);
    });

    it("returns empty array for empty items", () => {
      const result = buildVirtualItems([], undefined, ROW_HEIGHT, SECTION_HEIGHT);
      expect(result).toEqual([]);
    });

    it("returns empty array for undefined items", () => {
      const result = buildVirtualItems(undefined, undefined, ROW_HEIGHT, SECTION_HEIGHT);
      expect(result).toEqual([]);
    });
  });

  describe("sectioned data", () => {
    it("creates section + row items in correct order", () => {
      const result = buildVirtualItems<TestItem, TestSectionMeta>(undefined, sections, ROW_HEIGHT, SECTION_HEIGHT);

      // Expected order:
      // 0: section "high"
      // 1: row "Task 1"
      // 2: row "Task 2"
      // 3: section "medium"
      // 4: row "Task 3"
      // 5: section "low"
      // 6: row "Task 4"
      // 7: row "Task 5"
      expect(result).toHaveLength(8);

      expect(result[0].type).toBe("section");
      expect(result[0].section?.id).toBe("high");
      expect(result[0].height).toBe(SECTION_HEIGHT);

      expect(result[1].type).toBe("row");
      expect(result[1].item?.id).toBe("1");
      expect(result[1].height).toBe(ROW_HEIGHT);

      expect(result[3].type).toBe("section");
      expect(result[3].section?.id).toBe("medium");

      expect(result[5].type).toBe("section");
      expect(result[5].section?.id).toBe("low");
    });

    it("sections override items when both provided", () => {
      const result = buildVirtualItems<TestItem, TestSectionMeta>(flatItems, sections, ROW_HEIGHT, SECTION_HEIGHT);

      // Should use sections, not items
      expect(result).toHaveLength(8);
      expect(result[0].type).toBe("section");
    });

    it("returns empty array for empty sections", () => {
      const result = buildVirtualItems<TestItem, TestSectionMeta>(undefined, [], ROW_HEIGHT, SECTION_HEIGHT);
      expect(result).toEqual([]);
    });

    it("handles sections with no items", () => {
      const emptySections: Section<TestItem, TestSectionMeta>[] = [
        { id: "empty", label: "Empty Section", items: [], metadata: { priority: "low" } },
      ];

      const result = buildVirtualItems<TestItem, TestSectionMeta>(undefined, emptySections, ROW_HEIGHT, SECTION_HEIGHT);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("section");
    });
  });
});

describe("getItem", () => {
  describe("flat data", () => {
    const virtualItems = buildVirtualItems(flatItems, undefined, ROW_HEIGHT, SECTION_HEIGHT);

    it("returns row type with item data", () => {
      const result = getItem(virtualItems, 0);
      expect(result?.type).toBe("row");
      if (result?.type === "row") {
        expect(result.item.id).toBe("1");
        expect(result.item.name).toBe("Item 1");
      }
    });

    it("returns null for out of bounds index", () => {
      expect(getItem(virtualItems, -1)).toBeNull();
      expect(getItem(virtualItems, 100)).toBeNull();
    });
  });

  describe("sectioned data", () => {
    const virtualItems = buildVirtualItems<TestItem, TestSectionMeta>(undefined, sections, ROW_HEIGHT, SECTION_HEIGHT);

    it("returns section type for section indices", () => {
      const section0 = getItem(virtualItems, 0);
      expect(section0?.type).toBe("section");
      if (section0?.type === "section") {
        expect(section0.section.id).toBe("high");
        expect(section0.section.label).toBe("High Priority");
        expect(section0.section.metadata?.priority).toBe("high");
      }
    });

    it("returns row type for data row indices", () => {
      const row1 = getItem(virtualItems, 1);
      expect(row1?.type).toBe("row");
      if (row1?.type === "row") {
        expect(row1.item.name).toBe("Task 1");
      }
    });
  });
});

describe("getTotalRowCount", () => {
  it("counts flat items", () => {
    expect(getTotalRowCount(flatItems, undefined)).toBe(5);
  });

  it("counts sectioned items (excludes section headers)", () => {
    expect(getTotalRowCount<TestItem, TestSectionMeta>(undefined, sections)).toBe(5);
  });

  it("returns 0 for empty data", () => {
    expect(getTotalRowCount([], undefined)).toBe(0);
    expect(getTotalRowCount<TestItem, TestSectionMeta>(undefined, [])).toBe(0);
    expect(getTotalRowCount(undefined, undefined)).toBe(0);
  });
});

describe("getVirtualItemCount", () => {
  it("equals item count for flat data", () => {
    const virtualItems = buildVirtualItems(flatItems, undefined, ROW_HEIGHT, SECTION_HEIGHT);
    expect(getVirtualItemCount(virtualItems)).toBe(5);
  });

  it("equals sections + items for sectioned data", () => {
    const virtualItems = buildVirtualItems<TestItem, TestSectionMeta>(undefined, sections, ROW_HEIGHT, SECTION_HEIGHT);
    // 3 sections + 5 items = 8
    expect(getVirtualItemCount(virtualItems)).toBe(8);
  });
});

describe("getItemKey", () => {
  const getRowId = (item: TestItem) => item.id;

  it("returns row id for data rows", () => {
    const virtualItems = buildVirtualItems(flatItems, undefined, ROW_HEIGHT, SECTION_HEIGHT);
    expect(getItemKey(virtualItems, 0, getRowId)).toBe("1");
    expect(getItemKey(virtualItems, 4, getRowId)).toBe("5");
  });

  it("returns section-{id} for sections", () => {
    const virtualItems = buildVirtualItems<TestItem, TestSectionMeta>(undefined, sections, ROW_HEIGHT, SECTION_HEIGHT);
    expect(getItemKey(virtualItems, 0, getRowId)).toBe("section-high");
    expect(getItemKey(virtualItems, 3, getRowId)).toBe("section-medium");
    expect(getItemKey(virtualItems, 5, getRowId)).toBe("section-low");
  });

  it("returns index for out of bounds", () => {
    const virtualItems = buildVirtualItems(flatItems, undefined, ROW_HEIGHT, SECTION_HEIGHT);
    expect(getItemKey(virtualItems, 100, getRowId)).toBe(100);
  });
});

describe("user journey: navigating sectioned table", () => {
  it("virtual indices map correctly through sections", () => {
    const virtualItems = buildVirtualItems<TestItem, TestSectionMeta>(undefined, sections, ROW_HEIGHT, SECTION_HEIGHT);

    // Simulate iterating through virtual list
    const itemSequence: Array<{ type: string; id?: string; label?: string }> = [];

    for (let i = 0; i < getVirtualItemCount(virtualItems); i++) {
      const item = getItem(virtualItems, i);
      if (item?.type === "section") {
        itemSequence.push({ type: "section", label: item.section.label });
      } else if (item?.type === "row") {
        itemSequence.push({ type: "row", id: item.item.id });
      }
    }

    expect(itemSequence).toEqual([
      { type: "section", label: "High Priority" },
      { type: "row", id: "1" },
      { type: "row", id: "2" },
      { type: "section", label: "Medium Priority" },
      { type: "row", id: "3" },
      { type: "section", label: "Low Priority" },
      { type: "row", id: "4" },
      { type: "row", id: "5" },
    ]);
  });

  it("aria-rowcount calculation is correct for accessibility", () => {
    // aria-rowcount should only count data rows for screen readers
    // (sections are presentational, not data rows)
    expect(getTotalRowCount<TestItem, TestSectionMeta>(undefined, sections)).toBe(5);

    // But virtual navigation needs to account for sections
    const virtualItems = buildVirtualItems<TestItem, TestSectionMeta>(undefined, sections, ROW_HEIGHT, SECTION_HEIGHT);
    expect(getVirtualItemCount(virtualItems)).toBe(8);
  });
});

describe("edge cases", () => {
  it("handles single item", () => {
    const singleItem = [{ id: "only", name: "Only Item" }];
    const virtualItems = buildVirtualItems(singleItem, undefined, ROW_HEIGHT, SECTION_HEIGHT);

    expect(virtualItems).toHaveLength(1);
    expect(getItem(virtualItems, 0)?.type).toBe("row");
    expect(getTotalRowCount(singleItem, undefined)).toBe(1);
  });

  it("handles single section with single item", () => {
    const singleSection: Section<TestItem, TestSectionMeta>[] = [
      { id: "solo", label: "Solo Section", items: [{ id: "1", name: "Item 1" }], metadata: { priority: "high" } },
    ];
    const virtualItems = buildVirtualItems<TestItem, TestSectionMeta>(
      undefined,
      singleSection,
      ROW_HEIGHT,
      SECTION_HEIGHT,
    );

    expect(virtualItems).toHaveLength(2);
    expect(getItem(virtualItems, 0)?.type).toBe("section");
    expect(getItem(virtualItems, 1)?.type).toBe("row");
    expect(getTotalRowCount<TestItem, TestSectionMeta>(undefined, singleSection)).toBe(1);
  });

  it("handles very large dataset", () => {
    const largeItems = Array.from({ length: 10000 }, (_, i) => ({
      id: String(i),
      name: `Item ${i}`,
    }));

    const virtualItems = buildVirtualItems(largeItems, undefined, ROW_HEIGHT, SECTION_HEIGHT);

    expect(virtualItems).toHaveLength(10000);
    expect(getItem(virtualItems, 9999)?.type).toBe("row");
    expect(getTotalRowCount(largeItems, undefined)).toBe(10000);
  });
});
