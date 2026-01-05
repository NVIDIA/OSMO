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
import { filterByChips, type SearchField, type SearchChip } from "./types";

// =============================================================================
// Test Fixtures
// =============================================================================

interface TestItem {
  id: string;
  name: string;
  status: string;
  platform: string;
  count: number;
}

const testItems: TestItem[] = [
  { id: "1", name: "alpha", status: "ONLINE", platform: "dgx", count: 10 },
  { id: "2", name: "beta", status: "ONLINE", platform: "base", count: 20 },
  { id: "3", name: "gamma", status: "OFFLINE", platform: "dgx", count: 30 },
  { id: "4", name: "delta", status: "OFFLINE", platform: "base", count: 40 },
  { id: "5", name: "epsilon", status: "MAINTENANCE", platform: "dgx", count: 50 },
];

const testFields: SearchField<TestItem>[] = [
  {
    id: "name",
    label: "Name",
    prefix: "name:",
    getValues: (items) => items.map((i) => i.name),
    match: (item, value) => item.name.toLowerCase().includes(value.toLowerCase()),
  },
  {
    id: "status",
    label: "Status",
    prefix: "status:",
    getValues: (items) => [...new Set(items.map((i) => i.status))],
    match: (item, value) => item.status.toLowerCase() === value.toLowerCase(),
  },
  {
    id: "platform",
    label: "Platform",
    prefix: "platform:",
    getValues: (items) => [...new Set(items.map((i) => i.platform))],
    match: (item, value) => item.platform.toLowerCase() === value.toLowerCase(),
  },
  {
    id: "count",
    label: "Count",
    prefix: "count:",
    getValues: () => [],
    match: (item, value) => item.count >= parseInt(value, 10),
  },
];

// Helper to create a chip
function chip(field: string, value: string): SearchChip {
  return { field, value, label: `${field}: ${value}` };
}

// =============================================================================
// filterByChips Tests
// =============================================================================

describe("filterByChips", () => {
  describe("no filters", () => {
    it("returns all items when chips array is empty", () => {
      const result = filterByChips(testItems, [], testFields);
      expect(result).toHaveLength(5);
      expect(result).toEqual(testItems);
    });
  });

  describe("single field filtering", () => {
    it("filters by single chip", () => {
      const chips = [chip("status", "ONLINE")];
      const result = filterByChips(testItems, chips, testFields);

      expect(result).toHaveLength(2);
      expect(result.map((i) => i.name)).toEqual(["alpha", "beta"]);
    });

    it("handles case-insensitive matching", () => {
      const chips = [chip("status", "online")];
      const result = filterByChips(testItems, chips, testFields);

      expect(result).toHaveLength(2);
    });

    it("returns empty array when no matches", () => {
      const chips = [chip("status", "UNKNOWN")];
      const result = filterByChips(testItems, chips, testFields);

      expect(result).toHaveLength(0);
    });
  });

  describe("OR logic within same field", () => {
    it("ORs multiple chips for the same field", () => {
      const chips = [chip("status", "ONLINE"), chip("status", "OFFLINE")];
      const result = filterByChips(testItems, chips, testFields);

      expect(result).toHaveLength(4);
      expect(result.map((i) => i.name)).toEqual(["alpha", "beta", "gamma", "delta"]);
    });

    it("ORs three chips for the same field", () => {
      const chips = [
        chip("status", "ONLINE"),
        chip("status", "OFFLINE"),
        chip("status", "MAINTENANCE"),
      ];
      const result = filterByChips(testItems, chips, testFields);

      expect(result).toHaveLength(5); // All items
    });

    it("ORs platform chips", () => {
      const chips = [chip("platform", "dgx"), chip("platform", "base")];
      const result = filterByChips(testItems, chips, testFields);

      expect(result).toHaveLength(5); // All items
    });
  });

  describe("AND logic across different fields", () => {
    it("ANDs chips from different fields", () => {
      const chips = [chip("status", "ONLINE"), chip("platform", "dgx")];
      const result = filterByChips(testItems, chips, testFields);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("alpha");
    });

    it("ANDs three different fields", () => {
      const chips = [
        chip("status", "ONLINE"),
        chip("platform", "dgx"),
        chip("name", "alpha"),
      ];
      const result = filterByChips(testItems, chips, testFields);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("alpha");
    });

    it("returns empty when AND conditions have no overlap", () => {
      const chips = [
        chip("status", "ONLINE"), // alpha, beta
        chip("platform", "dgx"), // alpha, gamma, epsilon
        chip("name", "gamma"), // gamma
      ];
      const result = filterByChips(testItems, chips, testFields);

      expect(result).toHaveLength(0);
    });
  });

  describe("combined OR and AND logic", () => {
    it("ORs within field, ANDs across fields", () => {
      // (ONLINE OR OFFLINE) AND dgx
      const chips = [
        chip("status", "ONLINE"),
        chip("status", "OFFLINE"),
        chip("platform", "dgx"),
      ];
      const result = filterByChips(testItems, chips, testFields);

      // ONLINE+dgx=alpha, OFFLINE+dgx=gamma
      expect(result).toHaveLength(2);
      expect(result.map((i) => i.name)).toEqual(["alpha", "gamma"]);
    });

    it("handles complex multi-field OR+AND", () => {
      // (dgx OR base) AND (ONLINE)
      const chips = [
        chip("platform", "dgx"),
        chip("platform", "base"),
        chip("status", "ONLINE"),
      ];
      const result = filterByChips(testItems, chips, testFields);

      // Both platforms, but only ONLINE status
      expect(result).toHaveLength(2);
      expect(result.map((i) => i.name)).toEqual(["alpha", "beta"]);
    });
  });

  describe("unknown field handling", () => {
    it("ignores chips with unknown field IDs", () => {
      const chips = [chip("unknown", "value"), chip("status", "ONLINE")];
      const result = filterByChips(testItems, chips, testFields);

      // Should still filter by status, ignore unknown
      expect(result).toHaveLength(2);
    });

    it("returns all items if only unknown fields", () => {
      const chips = [chip("unknown", "value")];
      const result = filterByChips(testItems, chips, testFields);

      expect(result).toHaveLength(5);
    });
  });

  describe("substring matching", () => {
    it("supports substring matching for name field", () => {
      const chips = [chip("name", "a")];
      const result = filterByChips(testItems, chips, testFields);

      // alpha, beta, gamma, delta all contain 'a'
      expect(result).toHaveLength(4);
      expect(result.map((i) => i.name)).toEqual(["alpha", "beta", "gamma", "delta"]);
    });

    it("supports partial name matching", () => {
      const chips = [chip("name", "pha")];
      const result = filterByChips(testItems, chips, testFields);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("alpha");
    });
  });

  describe("numeric matching", () => {
    it("matches numeric threshold", () => {
      const chips = [chip("count", "30")];
      const result = filterByChips(testItems, chips, testFields);

      // count >= 30: gamma(30), delta(40), epsilon(50)
      expect(result).toHaveLength(3);
      expect(result.map((i) => i.name)).toEqual(["gamma", "delta", "epsilon"]);
    });
  });

  describe("empty data", () => {
    it("returns empty array for empty items", () => {
      const chips = [chip("status", "ONLINE")];
      const result = filterByChips([], chips, testFields);

      expect(result).toHaveLength(0);
    });
  });

  describe("edge cases", () => {
    it("handles duplicate chips gracefully", () => {
      const chips = [chip("status", "ONLINE"), chip("status", "ONLINE")];
      const result = filterByChips(testItems, chips, testFields);

      // Should dedupe effectively (OR of same value = same result)
      expect(result).toHaveLength(2);
    });

    it("handles empty value in chip", () => {
      const chips = [chip("name", "")];
      const result = filterByChips(testItems, chips, testFields);

      // Empty string matches all (contains "")
      expect(result).toHaveLength(5);
    });
  });
});
