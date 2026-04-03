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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseDateRangeValue, DATE_RANGE_PRESETS } from "@/lib/date-range-utils";

describe("date-range-utils", () => {
  describe("parseDateRangeValue", () => {
    describe("empty and invalid values", () => {
      it("returns null for empty string", () => {
        expect(parseDateRangeValue("")).toBeNull();
      });

      it("returns null for invalid format", () => {
        expect(parseDateRangeValue("not-a-date")).toBeNull();
      });

      it("returns null for partial date format", () => {
        expect(parseDateRangeValue("2024-01")).toBeNull();
      });

      it("returns null for whitespace-only string", () => {
        expect(parseDateRangeValue("   ")).toBeNull();
      });

      it("returns null for year-only string", () => {
        expect(parseDateRangeValue("2024")).toBeNull();
      });

      it("returns null for date with extra characters", () => {
        expect(parseDateRangeValue("2024-06-15abc")).toBeNull();
      });

      it("returns null for datetime with seconds", () => {
        expect(parseDateRangeValue("2024-06-15T14:30:00")).toBeNull();
      });

      it("returns null for invalid month 13", () => {
        expect(parseDateRangeValue("2024-13-01")).toBeNull();
      });

      it("returns null for invalid day 32", () => {
        expect(parseDateRangeValue("2024-06-32")).toBeNull();
      });

      it("auto-corrects February 30 to March 1 (JavaScript Date behavior)", () => {
        const result = parseDateRangeValue("2024-02-30");
        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-03-01T00:00:00.000Z");
      });

      it("auto-corrects February 29 in non-leap year to March 1 (JavaScript Date behavior)", () => {
        const result = parseDateRangeValue("2023-02-29");
        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2023-03-01T00:00:00.000Z");
      });

      it("returns null for unknown preset label", () => {
        expect(parseDateRangeValue("last week")).toBeNull();
      });
    });

    describe("single date parsing", () => {
      it("parses YYYY-MM-DD as full UTC day", () => {
        const result = parseDateRangeValue("2024-06-15");
        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-06-15T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2024-06-16T00:00:00.000Z");
      });

      it("parses datetime YYYY-MM-DDTHH:mm as full minute", () => {
        const result = parseDateRangeValue("2024-06-15T14:30");
        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-06-15T14:30:00.000Z");
        expect(result!.end.toISOString()).toBe("2024-06-15T14:31:00.000Z");
      });

      it("returns null for invalid single date", () => {
        expect(parseDateRangeValue("9999-99-99")).toBeNull();
      });

      it("parses leap year February 29", () => {
        const result = parseDateRangeValue("2024-02-29");
        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-02-29T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2024-03-01T00:00:00.000Z");
      });

      it("parses year boundary December 31", () => {
        const result = parseDateRangeValue("2024-12-31");
        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-12-31T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2025-01-01T00:00:00.000Z");
      });

      it("parses year boundary January 1", () => {
        const result = parseDateRangeValue("2024-01-01");
        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-01-01T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2024-01-02T00:00:00.000Z");
      });

      it("parses datetime at midnight boundary", () => {
        const result = parseDateRangeValue("2024-06-15T00:00");
        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-06-15T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2024-06-15T00:01:00.000Z");
      });

      it("parses datetime at end of day boundary", () => {
        const result = parseDateRangeValue("2024-06-15T23:59");
        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-06-15T23:59:00.000Z");
        expect(result!.end.toISOString()).toBe("2024-06-16T00:00:00.000Z");
      });

      it("returns null for date with leading whitespace only", () => {
        expect(parseDateRangeValue("  2024-06-15")).toBeNull();
      });

      it("returns null for date with trailing whitespace only", () => {
        expect(parseDateRangeValue("2024-06-15  ")).toBeNull();
      });
    });

    describe("ISO range string parsing", () => {
      it("parses YYYY-MM-DD..YYYY-MM-DD range", () => {
        const result = parseDateRangeValue("2024-01-01..2024-12-31");
        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-01-01T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2025-01-01T00:00:00.000Z");
      });

      it("parses datetime range YYYY-MM-DDTHH:mm..YYYY-MM-DDTHH:mm", () => {
        const result = parseDateRangeValue("2024-06-01T09:00..2024-06-30T17:00");
        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-06-01T09:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2024-06-30T17:00:00.000Z");
      });

      it("parses range with whitespace around parts", () => {
        const result = parseDateRangeValue("  2024-01-01  ..  2024-01-31  ");
        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-01-01T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2024-02-01T00:00:00.000Z");
      });

      it("returns null for range with invalid start date", () => {
        expect(parseDateRangeValue("invalid..2024-12-31")).toBeNull();
      });

      it("returns null for range with invalid end date", () => {
        expect(parseDateRangeValue("2024-01-01..invalid")).toBeNull();
      });

      it("returns null for range where start is after end", () => {
        expect(parseDateRangeValue("2024-12-31..2024-01-01")).toBeNull();
      });

      it("returns null for range with too many parts", () => {
        expect(parseDateRangeValue("2024-01-01..2024-06-15..2024-12-31")).toBeNull();
      });

      it("parses range where start equals end date", () => {
        const result = parseDateRangeValue("2024-06-15..2024-06-15");
        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-06-15T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2024-06-16T00:00:00.000Z");
      });

      it("parses mixed format range with date start and datetime end", () => {
        const result = parseDateRangeValue("2024-06-01..2024-06-30T17:00");
        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-06-01T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2024-06-30T17:00:00.000Z");
      });

      it("parses mixed format range with datetime start and date end", () => {
        const result = parseDateRangeValue("2024-06-01T09:00..2024-06-30");
        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-06-01T09:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2024-07-01T00:00:00.000Z");
      });

      it("parses range spanning year boundary", () => {
        const result = parseDateRangeValue("2024-12-25..2025-01-05");
        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-12-25T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2025-01-06T00:00:00.000Z");
      });

      it("parses range spanning leap year February", () => {
        const result = parseDateRangeValue("2024-02-28..2024-03-01");
        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-02-28T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2024-03-02T00:00:00.000Z");
      });

      it("returns null for range with empty start", () => {
        expect(parseDateRangeValue("..2024-12-31")).toBeNull();
      });

      it("returns null for range with empty end", () => {
        expect(parseDateRangeValue("2024-01-01..")).toBeNull();
      });

      it("returns null for range with only separator", () => {
        expect(parseDateRangeValue("..")).toBeNull();
      });

      it("returns null when datetime start is after datetime end on same day", () => {
        expect(parseDateRangeValue("2024-06-15T18:00..2024-06-15T09:00")).toBeNull();
      });
    });

    describe("preset label parsing", () => {
      let mockDate: Date;

      beforeEach(() => {
        mockDate = new Date("2024-06-15T12:00:00.000Z");
        vi.useFakeTimers();
        vi.setSystemTime(mockDate);
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it("parses 'today' preset (case insensitive)", () => {
        const result = parseDateRangeValue("Today");
        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-06-15T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2024-06-16T00:00:00.000Z");
      });

      it("parses 'last 7 days' preset", () => {
        const result = parseDateRangeValue("last 7 days");
        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-06-08T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2024-06-16T00:00:00.000Z");
      });

      it("parses 'last 30 days' preset", () => {
        const result = parseDateRangeValue("last 30 days");
        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-05-16T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2024-06-16T00:00:00.000Z");
      });

      it("parses 'last 90 days' preset", () => {
        const result = parseDateRangeValue("last 90 days");
        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-03-17T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2024-06-16T00:00:00.000Z");
      });

      it("parses 'last 365 days' preset", () => {
        const result = parseDateRangeValue("last 365 days");
        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2023-06-16T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2024-06-16T00:00:00.000Z");
      });

      it("parses 'TODAY' preset (all caps)", () => {
        const result = parseDateRangeValue("TODAY");
        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-06-15T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2024-06-16T00:00:00.000Z");
      });

      it("parses 'LAST 7 DAYS' preset (all caps)", () => {
        const result = parseDateRangeValue("LAST 7 DAYS");
        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-06-08T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2024-06-16T00:00:00.000Z");
      });

      it("parses 'Last 30 Days' preset (title case)", () => {
        const result = parseDateRangeValue("Last 30 Days");
        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-05-16T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2024-06-16T00:00:00.000Z");
      });

      it("returns null for preset with extra whitespace", () => {
        expect(parseDateRangeValue("last  7  days")).toBeNull();
      });

      it("returns null for partial preset match", () => {
        expect(parseDateRangeValue("last 7")).toBeNull();
      });
    });
  });

  describe("DATE_RANGE_PRESETS", () => {
    let mockDate: Date;

    beforeEach(() => {
      mockDate = new Date("2024-06-15T12:00:00.000Z");
      vi.useFakeTimers();
      vi.setSystemTime(mockDate);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("has five presets", () => {
      expect(DATE_RANGE_PRESETS).toHaveLength(5);
    });

    it("today preset returns current date", () => {
      const todayPreset = DATE_RANGE_PRESETS.find((p) => p.label === "today");
      expect(todayPreset).toBeDefined();
      expect(todayPreset!.getValue()).toBe("2024-06-15");
    });

    it("last 7 days preset returns 7-day range", () => {
      const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 7 days");
      expect(preset).toBeDefined();
      expect(preset!.getValue()).toBe("2024-06-08..2024-06-15");
    });

    it("last 30 days preset returns 30-day range", () => {
      const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 30 days");
      expect(preset).toBeDefined();
      expect(preset!.getValue()).toBe("2024-05-16..2024-06-15");
    });

    it("last 90 days preset returns 90-day range", () => {
      const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 90 days");
      expect(preset).toBeDefined();
      expect(preset!.getValue()).toBe("2024-03-17..2024-06-15");
    });

    it("last 365 days preset returns 365-day range", () => {
      const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 365 days");
      expect(preset).toBeDefined();
      expect(preset!.getValue()).toBe("2023-06-16..2024-06-15");
    });

    it("all presets have label and getValue function", () => {
      DATE_RANGE_PRESETS.forEach((preset) => {
        expect(preset.label).toBeTruthy();
        expect(typeof preset.getValue).toBe("function");
        expect(typeof preset.getValue()).toBe("string");
      });
    });
  });
});
