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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DATE_RANGE_PRESETS, parseDateRangeValue } from "@/lib/date-range-utils";

describe("parseDateRangeValue", () => {
  describe("empty and invalid input", () => {
    it("returns null for empty string", () => {
      const result = parseDateRangeValue("");

      expect(result).toBeNull();
    });

    it("returns null for invalid date format", () => {
      const result = parseDateRangeValue("not-a-date");

      expect(result).toBeNull();
    });

    it("returns null for partial date format", () => {
      const result = parseDateRangeValue("2024-01");

      expect(result).toBeNull();
    });

    it("returns null for whitespace-only input", () => {
      const result = parseDateRangeValue("   ");

      expect(result).toBeNull();
    });

    it("returns null for wrong date separator format", () => {
      const result = parseDateRangeValue("2024/01/15");

      expect(result).toBeNull();
    });

    it("returns null for date with seconds", () => {
      const result = parseDateRangeValue("2024-06-15T14:30:00");

      expect(result).toBeNull();
    });

    it("returns null for date with timezone suffix", () => {
      const result = parseDateRangeValue("2024-06-15T14:30Z");

      expect(result).toBeNull();
    });
  });

  describe("single ISO date parsing", () => {
    it("parses YYYY-MM-DD as full UTC day with end at next midnight", () => {
      const result = parseDateRangeValue("2024-06-15");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-06-15T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-06-16T00:00:00.000Z");
    });

    it("parses datetime YYYY-MM-DDTHH:mm with end 1 minute later", () => {
      const result = parseDateRangeValue("2024-06-15T14:30");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-06-15T14:30:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-06-15T14:31:00.000Z");
    });

    it("returns null for invalid date values", () => {
      const result = parseDateRangeValue("2024-13-45");

      expect(result).toBeNull();
    });

    it("returns null for invalid datetime values", () => {
      const result = parseDateRangeValue("2024-06-15T25:99");

      expect(result).toBeNull();
    });

    it("parses leap year date February 29", () => {
      const result = parseDateRangeValue("2024-02-29");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-02-29T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-03-01T00:00:00.000Z");
    });

    it("normalizes February 29 in non-leap year to March 1", () => {
      const result = parseDateRangeValue("2023-02-29");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2023-03-01T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2023-03-02T00:00:00.000Z");
    });

    it("parses year boundary date December 31", () => {
      const result = parseDateRangeValue("2024-12-31");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-12-31T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2025-01-01T00:00:00.000Z");
    });

    it("parses midnight time boundary", () => {
      const result = parseDateRangeValue("2024-06-15T00:00");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-06-15T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-06-15T00:01:00.000Z");
    });

    it("parses end of day time boundary", () => {
      const result = parseDateRangeValue("2024-06-15T23:59");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-06-15T23:59:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-06-16T00:00:00.000Z");
    });

    it("parses first day of year", () => {
      const result = parseDateRangeValue("2024-01-01");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-01-01T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-01-02T00:00:00.000Z");
    });
  });

  describe("ISO range string parsing", () => {
    it("parses date range with .. separator", () => {
      const result = parseDateRangeValue("2024-01-01..2024-12-31");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-01-01T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2025-01-01T00:00:00.000Z");
    });

    it("parses datetime range with .. separator", () => {
      const result = parseDateRangeValue("2024-01-01T09:00..2024-01-01T17:00");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-01-01T09:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-01-01T17:00:00.000Z");
    });

    it("handles whitespace around dates in range", () => {
      const result = parseDateRangeValue("2024-01-01 .. 2024-12-31");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-01-01T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2025-01-01T00:00:00.000Z");
    });

    it("returns null when start date is after end date", () => {
      const result = parseDateRangeValue("2024-12-31..2024-01-01");

      expect(result).toBeNull();
    });

    it("returns null for range with invalid start date", () => {
      const result = parseDateRangeValue("invalid..2024-12-31");

      expect(result).toBeNull();
    });

    it("returns null for range with invalid end date", () => {
      const result = parseDateRangeValue("2024-01-01..invalid");

      expect(result).toBeNull();
    });

    it("returns null for range with too many separators", () => {
      const result = parseDateRangeValue("2024-01-01..2024-06-15..2024-12-31");

      expect(result).toBeNull();
    });

    it("parses same start and end date", () => {
      const result = parseDateRangeValue("2024-06-15..2024-06-15");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-06-15T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-06-16T00:00:00.000Z");
    });

    it("returns null for range with empty start", () => {
      const result = parseDateRangeValue("..2024-12-31");

      expect(result).toBeNull();
    });

    it("returns null for range with empty end", () => {
      const result = parseDateRangeValue("2024-01-01..");

      expect(result).toBeNull();
    });

    it("parses mixed format range with date start and datetime end", () => {
      const result = parseDateRangeValue("2024-01-01..2024-01-01T17:00");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-01-01T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-01-01T17:00:00.000Z");
    });

    it("parses mixed format range with datetime start and date end", () => {
      const result = parseDateRangeValue("2024-01-01T09:00..2024-01-15");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-01-01T09:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-01-16T00:00:00.000Z");
    });

    it("parses same datetime for start and end", () => {
      const result = parseDateRangeValue("2024-06-15T14:30..2024-06-15T14:30");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-06-15T14:30:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-06-15T14:30:00.000Z");
    });

    it("returns null when datetime start is after datetime end", () => {
      const result = parseDateRangeValue("2024-06-15T18:00..2024-06-15T09:00");

      expect(result).toBeNull();
    });

    it("parses range spanning leap year boundary", () => {
      const result = parseDateRangeValue("2024-02-28..2024-03-01");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-02-28T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-03-02T00:00:00.000Z");
    });

    it("parses range spanning year boundary", () => {
      const result = parseDateRangeValue("2024-12-30..2025-01-02");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-12-30T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2025-01-03T00:00:00.000Z");
    });

    it("returns null for range with only separator", () => {
      const result = parseDateRangeValue("..");

      expect(result).toBeNull();
    });

    it("returns null for range with whitespace-only parts", () => {
      const result = parseDateRangeValue("   ..   ");

      expect(result).toBeNull();
    });
  });

  describe("preset label parsing", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-06-15T12:00:00.000Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("parses 'today' preset label", () => {
      const result = parseDateRangeValue("today");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-06-15T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-06-16T00:00:00.000Z");
    });

    it("parses 'last 7 days' preset label", () => {
      const result = parseDateRangeValue("last 7 days");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-06-08T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-06-16T00:00:00.000Z");
    });

    it("parses 'last 30 days' preset label", () => {
      const result = parseDateRangeValue("last 30 days");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-05-16T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-06-16T00:00:00.000Z");
    });

    it("parses 'last 90 days' preset label", () => {
      const result = parseDateRangeValue("last 90 days");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-03-17T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-06-16T00:00:00.000Z");
    });

    it("parses 'last 365 days' preset label", () => {
      const result = parseDateRangeValue("last 365 days");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2023-06-16T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-06-16T00:00:00.000Z");
    });

    it("handles preset labels case-insensitively", () => {
      const result = parseDateRangeValue("TODAY");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-06-15T00:00:00.000Z");
    });

    it("handles mixed case preset labels", () => {
      const result = parseDateRangeValue("Last 7 Days");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-06-08T00:00:00.000Z");
    });

    it("returns null for unknown preset label", () => {
      const result = parseDateRangeValue("last week");

      expect(result).toBeNull();
    });

    it("handles preset label with leading whitespace", () => {
      const result = parseDateRangeValue("  today");

      expect(result).toBeNull();
    });

    it("handles preset label with trailing whitespace", () => {
      const result = parseDateRangeValue("today  ");

      expect(result).toBeNull();
    });

    it("returns null for preset-like but invalid label", () => {
      const result = parseDateRangeValue("last 5 days");

      expect(result).toBeNull();
    });

    it("returns null for preset label with extra words", () => {
      const result = parseDateRangeValue("last 7 days ago");

      expect(result).toBeNull();
    });
  });

  describe("time zone handling", () => {
    it("parses date-only strings as UTC midnight regardless of local time zone", () => {
      // Date-only strings are always interpreted as UTC midnight
      // This ensures consistent behavior across Pacific, Eastern, UTC, etc.
      const result = parseDateRangeValue("2024-06-15");

      expect(result).not.toBeNull();
      // Start should be UTC midnight
      expect(result!.start.getUTCHours()).toBe(0);
      expect(result!.start.getUTCMinutes()).toBe(0);
      expect(result!.start.getUTCSeconds()).toBe(0);
      expect(result!.start.getUTCMilliseconds()).toBe(0);
      // Verify the full ISO string to confirm UTC
      expect(result!.start.toISOString()).toBe("2024-06-15T00:00:00.000Z");
    });

    it("parses datetime strings as UTC regardless of local time zone", () => {
      // "T14:30" is interpreted as 14:30 UTC, not local time
      const result = parseDateRangeValue("2024-06-15T14:30");

      expect(result).not.toBeNull();
      expect(result!.start.getUTCHours()).toBe(14);
      expect(result!.start.getUTCMinutes()).toBe(30);
      expect(result!.start.toISOString()).toBe("2024-06-15T14:30:00.000Z");
    });

    it("parses date range with dates as UTC midnight on both ends", () => {
      const result = parseDateRangeValue("2024-01-15..2024-06-15");

      expect(result).not.toBeNull();
      // Start: UTC midnight Jan 15
      expect(result!.start.getUTCFullYear()).toBe(2024);
      expect(result!.start.getUTCMonth()).toBe(0); // January is 0
      expect(result!.start.getUTCDate()).toBe(15);
      expect(result!.start.getUTCHours()).toBe(0);
      // End: UTC midnight June 16 (next day for inclusive end)
      expect(result!.end.getUTCFullYear()).toBe(2024);
      expect(result!.end.getUTCMonth()).toBe(5); // June is 5
      expect(result!.end.getUTCDate()).toBe(16);
      expect(result!.end.getUTCHours()).toBe(0);
    });

    it("parses datetime range with times as UTC", () => {
      // A user in PT (UTC-7) entering 09:00 gets 09:00 UTC, not 09:00 PT
      const result = parseDateRangeValue("2024-06-15T09:00..2024-06-15T17:00");

      expect(result).not.toBeNull();
      expect(result!.start.getUTCHours()).toBe(9);
      expect(result!.end.getUTCHours()).toBe(17);
      expect(result!.start.toISOString()).toBe("2024-06-15T09:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-06-15T17:00:00.000Z");
    });

    it("handles midnight boundary consistently in UTC", () => {
      // 00:00 should be parsed as midnight UTC
      const result = parseDateRangeValue("2024-06-15T00:00");

      expect(result).not.toBeNull();
      expect(result!.start.getUTCHours()).toBe(0);
      expect(result!.start.getUTCMinutes()).toBe(0);
      expect(result!.start.toISOString()).toBe("2024-06-15T00:00:00.000Z");
    });

    it("handles late night time consistently in UTC", () => {
      // 23:59 should be parsed as 23:59 UTC
      const result = parseDateRangeValue("2024-06-15T23:59");

      expect(result).not.toBeNull();
      expect(result!.start.getUTCHours()).toBe(23);
      expect(result!.start.getUTCMinutes()).toBe(59);
      expect(result!.start.toISOString()).toBe("2024-06-15T23:59:00.000Z");
    });
  });

  describe("year boundary scenarios", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("calculates last 7 days correctly at start of year", () => {
      vi.setSystemTime(new Date("2024-01-03T12:00:00.000Z"));

      const result = parseDateRangeValue("last 7 days");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2023-12-27T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-01-04T00:00:00.000Z");
    });

    it("calculates last 30 days correctly spanning year boundary", () => {
      vi.setSystemTime(new Date("2024-01-15T12:00:00.000Z"));

      const result = parseDateRangeValue("last 30 days");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2023-12-16T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-01-16T00:00:00.000Z");
    });

    it("calculates today preset on January 1", () => {
      vi.setSystemTime(new Date("2024-01-01T00:30:00.000Z"));

      const result = parseDateRangeValue("today");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-01-01T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-01-02T00:00:00.000Z");
    });

    it("calculates today preset on December 31", () => {
      vi.setSystemTime(new Date("2024-12-31T23:30:00.000Z"));

      const result = parseDateRangeValue("today");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-12-31T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2025-01-01T00:00:00.000Z");
    });

    it("calculates last 365 days on leap year", () => {
      vi.setSystemTime(new Date("2024-03-01T12:00:00.000Z"));

      const result = parseDateRangeValue("last 365 days");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2023-03-02T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-03-02T00:00:00.000Z");
    });
  });
});

describe("DATE_RANGE_PRESETS", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("contains expected preset labels", () => {
    const labels = DATE_RANGE_PRESETS.map((preset) => preset.label);

    expect(labels).toContain("today");
    expect(labels).toContain("last 7 days");
    expect(labels).toContain("last 30 days");
    expect(labels).toContain("last 90 days");
    expect(labels).toContain("last 365 days");
  });

  it("today preset returns current date in ISO format", () => {
    const todayPreset = DATE_RANGE_PRESETS.find((p) => p.label === "today");

    expect(todayPreset).toBeDefined();
    expect(todayPreset!.getValue()).toBe("2024-06-15");
  });

  it("last 7 days preset returns correct range", () => {
    const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 7 days");

    expect(preset).toBeDefined();
    expect(preset!.getValue()).toBe("2024-06-08..2024-06-15");
  });

  it("last 30 days preset returns correct range", () => {
    const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 30 days");

    expect(preset).toBeDefined();
    expect(preset!.getValue()).toBe("2024-05-16..2024-06-15");
  });

  it("last 90 days preset returns correct range", () => {
    const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 90 days");

    expect(preset).toBeDefined();
    expect(preset!.getValue()).toBe("2024-03-17..2024-06-15");
  });

  it("last 365 days preset returns correct range", () => {
    const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 365 days");

    expect(preset).toBeDefined();
    expect(preset!.getValue()).toBe("2023-06-16..2024-06-15");
  });

  it("presets compute values dynamically based on current time", () => {
    const todayPreset = DATE_RANGE_PRESETS.find((p) => p.label === "today");
    const firstValue = todayPreset!.getValue();

    vi.setSystemTime(new Date("2024-12-25T12:00:00.000Z"));
    const secondValue = todayPreset!.getValue();

    expect(firstValue).toBe("2024-06-15");
    expect(secondValue).toBe("2024-12-25");
  });
});
