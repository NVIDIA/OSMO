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
import { getDateKey, fullFlatten } from "./use-incremental-flatten";
import type { LogEntry } from "@/lib/api/log-adapter";

/**
 * Create a mock log entry for testing.
 */
function createMockEntry(id: string, timestamp: Date): LogEntry {
  return {
    id,
    timestamp,
    message: `Message for ${id}`,
    labels: {
      workflow: "test-workflow",
      task: "test-task",
      level: "info",
      source: "user",
    },
  };
}

/**
 * Helper to create a local date (avoids timezone issues in tests).
 * @param year - Full year
 * @param month - 1-indexed month (1=Jan, 12=Dec)
 * @param day - Day of month
 * @param hour - Hour (default 12 to stay away from day boundaries)
 */
function localDate(year: number, month: number, day: number, hour = 12): Date {
  return new Date(year, month - 1, day, hour, 0, 0);
}

// =============================================================================
// getDateKey Tests
// =============================================================================

describe("getDateKey", () => {
  it("formats date as YYYY-MM-DD", () => {
    // Using midday to avoid timezone boundary issues
    const date = new Date(2024, 0, 15, 12, 30, 0); // Jan 15, 2024, 12:30 local
    expect(getDateKey(date)).toBe("2024-01-15");
  });

  it("pads single-digit month and day with zeros", () => {
    const date = new Date(2024, 4, 9, 12, 30, 0); // May 9, 2024, 12:30 local
    expect(getDateKey(date)).toBe("2024-05-09");
  });

  it("handles December correctly", () => {
    const date = new Date(2024, 11, 31, 12, 30, 0); // Dec 31, 2024, 12:30 local
    expect(getDateKey(date)).toBe("2024-12-31");
  });

  it("handles January correctly (month index 0)", () => {
    const date = new Date(2024, 0, 1, 12, 0, 0); // Jan 1, 2024, noon local
    expect(getDateKey(date)).toBe("2024-01-01");
  });
});

// =============================================================================
// fullFlatten Tests
// =============================================================================

describe("fullFlatten", () => {
  describe("empty entries", () => {
    it("returns empty result for empty array", () => {
      const result = fullFlatten([]);

      expect(result.items).toHaveLength(0);
      expect(result.separators).toHaveLength(0);
    });
  });

  describe("single day entries", () => {
    it("creates single separator for entries from same day", () => {
      const entries: LogEntry[] = [
        createMockEntry("1", localDate(2024, 1, 15, 10)),
        createMockEntry("2", localDate(2024, 1, 15, 11)),
        createMockEntry("3", localDate(2024, 1, 15, 12)),
      ];

      const result = fullFlatten(entries);

      expect(result.separators).toHaveLength(1);
      expect(result.items).toHaveLength(4); // 1 separator + 3 entries
    });

    it("separator has correct date key", () => {
      const entries: LogEntry[] = [createMockEntry("1", localDate(2024, 1, 15))];

      const result = fullFlatten(entries);

      expect(result.separators[0].dateKey).toBe("2024-01-15");
      expect(result.separators[0].index).toBe(0);
    });
  });

  describe("multi-day entries", () => {
    it("creates date separators for entries from different days", () => {
      const entries: LogEntry[] = [
        createMockEntry("1", localDate(2024, 1, 15, 10)),
        createMockEntry("2", localDate(2024, 1, 15, 11)),
        createMockEntry("3", localDate(2024, 1, 16, 10)),
      ];

      const result = fullFlatten(entries);

      // 2 separators (one for each day)
      expect(result.separators).toHaveLength(2);

      // 5 items total: 2 separators + 3 entries
      expect(result.items).toHaveLength(5);

      // First item should be a separator for Jan 15
      expect(result.items[0].type).toBe("separator");
      if (result.items[0].type === "separator") {
        expect(result.items[0].dateKey).toBe("2024-01-15");
      }

      // Second and third items should be entries
      expect(result.items[1].type).toBe("entry");
      expect(result.items[2].type).toBe("entry");

      // Fourth item should be a separator for Jan 16
      expect(result.items[3].type).toBe("separator");
      if (result.items[3].type === "separator") {
        expect(result.items[3].dateKey).toBe("2024-01-16");
      }

      // Fifth item should be an entry
      expect(result.items[4].type).toBe("entry");
    });

    it("tracks correct indices for separators", () => {
      const entries: LogEntry[] = [
        createMockEntry("1", localDate(2024, 1, 15, 10)),
        createMockEntry("2", localDate(2024, 1, 15, 11)),
        createMockEntry("3", localDate(2024, 1, 16, 10)),
        createMockEntry("4", localDate(2024, 1, 17, 10)),
      ];

      const result = fullFlatten(entries);

      expect(result.separators).toHaveLength(3);

      // Separator indices should match their positions in items array
      expect(result.separators[0].index).toBe(0);
      expect(result.separators[0].dateKey).toBe("2024-01-15");

      expect(result.separators[1].index).toBe(3); // After 1 sep + 2 entries
      expect(result.separators[1].dateKey).toBe("2024-01-16");

      expect(result.separators[2].index).toBe(5); // After 2 seps + 3 entries
      expect(result.separators[2].dateKey).toBe("2024-01-17");
    });
  });

  describe("entry references", () => {
    it("preserves entry object references in items", () => {
      const entry1 = createMockEntry("1", localDate(2024, 1, 15, 10));
      const entry2 = createMockEntry("2", localDate(2024, 1, 15, 11));
      const entries: LogEntry[] = [entry1, entry2];

      const result = fullFlatten(entries);

      // Entry items should reference the original objects
      if (result.items[1].type === "entry") {
        expect(result.items[1].entry).toBe(entry1);
      }
      if (result.items[2].type === "entry") {
        expect(result.items[2].entry).toBe(entry2);
      }
    });
  });

  describe("separator metadata consistency", () => {
    it("separator info matches separator items", () => {
      const entries: LogEntry[] = [
        createMockEntry("1", localDate(2024, 1, 15)),
        createMockEntry("2", localDate(2024, 1, 16)),
      ];

      const result = fullFlatten(entries);

      // Each separator info should correspond to a separator item
      for (const separatorInfo of result.separators) {
        const item = result.items[separatorInfo.index];
        expect(item.type).toBe("separator");
        if (item.type === "separator") {
          expect(item.dateKey).toBe(separatorInfo.dateKey);
          expect(item.index).toBe(separatorInfo.index);
        }
      }
    });
  });
});
