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
import { DATE_RANGE_PRESETS, parseDateRangeValue } from "@/lib/date-range-utils";

describe("date-range-utils", () => {
  describe("parseDateRangeValue", () => {
    describe("empty and null values", () => {
      it("returns null for empty string", () => {
        const result = parseDateRangeValue("");
        expect(result).toBeNull();
      });
    });

    describe("ISO range strings (YYYY-MM-DD..YYYY-MM-DD)", () => {
      it("parses valid date range with date-only end", () => {
        const result = parseDateRangeValue("2024-01-15..2024-01-20");
        expect(result).not.toBeNull();
        expect(result!.start).toEqual(new Date("2024-01-15T00:00:00.000Z"));
        // End is advanced to next midnight for inclusive range
        expect(result!.end).toEqual(new Date("2024-01-21T00:00:00.000Z"));
      });

      it("parses datetime range string", () => {
        const result = parseDateRangeValue("2024-01-15T10:30..2024-01-20T18:45");
        expect(result).not.toBeNull();
        expect(result!.start).toEqual(new Date("2024-01-15T10:30:00.000Z"));
        // Datetime end is used as-is (exclusive cutoff)
        expect(result!.end).toEqual(new Date("2024-01-20T18:45:00.000Z"));
      });

      it("returns null for invalid range with more than two parts", () => {
        const result = parseDateRangeValue("2024-01-01..2024-01-15..2024-01-20");
        expect(result).toBeNull();
      });

      it("returns null for range where start is after end", () => {
        const result = parseDateRangeValue("2024-12-31..2024-01-01");
        expect(result).toBeNull();
      });

      it("returns null for range with invalid start date", () => {
        const result = parseDateRangeValue("invalid..2024-01-15");
        expect(result).toBeNull();
      });

      it("returns null for range with invalid end date", () => {
        const result = parseDateRangeValue("2024-01-15..invalid");
        expect(result).toBeNull();
      });
    });

    describe("single date values (YYYY-MM-DD)", () => {
      it("parses single date as full UTC day", () => {
        const result = parseDateRangeValue("2024-06-15");
        expect(result).not.toBeNull();
        expect(result!.start).toEqual(new Date("2024-06-15T00:00:00.000Z"));
        // End is advanced to next midnight for inclusive day
        expect(result!.end).toEqual(new Date("2024-06-16T00:00:00.000Z"));
      });
    });

    describe("single datetime values (YYYY-MM-DDTHH:mm)", () => {
      it("parses datetime as full minute range", () => {
        const result = parseDateRangeValue("2024-06-15T14:30");
        expect(result).not.toBeNull();
        expect(result!.start).toEqual(new Date("2024-06-15T14:30:00.000Z"));
        // End is advanced by 1 minute
        expect(result!.end).toEqual(new Date("2024-06-15T14:31:00.000Z"));
      });
    });

    describe("preset labels", () => {
      const fixedDate = new Date("2024-06-15T12:00:00.000Z");

      beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(fixedDate);
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it("parses 'today' preset label", () => {
        const result = parseDateRangeValue("today");
        expect(result).not.toBeNull();
        expect(result!.start).toEqual(new Date("2024-06-15T00:00:00.000Z"));
        // Single date advances to next midnight
        expect(result!.end).toEqual(new Date("2024-06-16T00:00:00.000Z"));
      });

      it("parses 'last 7 days' preset label", () => {
        const result = parseDateRangeValue("last 7 days");
        expect(result).not.toBeNull();
        expect(result!.start).toEqual(new Date("2024-06-08T00:00:00.000Z"));
        expect(result!.end).toEqual(new Date("2024-06-16T00:00:00.000Z"));
      });

      it("parses 'last 30 days' preset label", () => {
        const result = parseDateRangeValue("last 30 days");
        expect(result).not.toBeNull();
        expect(result!.start).toEqual(new Date("2024-05-16T00:00:00.000Z"));
        expect(result!.end).toEqual(new Date("2024-06-16T00:00:00.000Z"));
      });

      it("parses 'last 90 days' preset label", () => {
        const result = parseDateRangeValue("last 90 days");
        expect(result).not.toBeNull();
        expect(result!.start).toEqual(new Date("2024-03-17T00:00:00.000Z"));
        expect(result!.end).toEqual(new Date("2024-06-16T00:00:00.000Z"));
      });

      it("parses 'last 365 days' preset label", () => {
        const result = parseDateRangeValue("last 365 days");
        expect(result).not.toBeNull();
        expect(result!.start).toEqual(new Date("2023-06-16T00:00:00.000Z"));
        expect(result!.end).toEqual(new Date("2024-06-16T00:00:00.000Z"));
      });

      it("handles case-insensitive preset labels", () => {
        const result = parseDateRangeValue("LAST 7 DAYS");
        expect(result).not.toBeNull();
        expect(result!.start).toEqual(new Date("2024-06-08T00:00:00.000Z"));
      });
    });

    describe("invalid values", () => {
      it("returns null for completely invalid string", () => {
        const result = parseDateRangeValue("not a date");
        expect(result).toBeNull();
      });

      it("returns null for partial date format", () => {
        const result = parseDateRangeValue("2024-06");
        expect(result).toBeNull();
      });

      it("returns null for invalid date values", () => {
        const result = parseDateRangeValue("2024-13-45");
        expect(result).toBeNull();
      });
    });

    describe("time zone corner cases", () => {
      afterEach(() => {
        vi.useRealTimers();
      });

      it("handles preset calculation at UTC midnight boundary", () => {
        vi.useFakeTimers();
        // Set time to exactly UTC midnight - edge case for day boundary
        vi.setSystemTime(new Date("2024-03-10T00:00:00.000Z"));
        const result = parseDateRangeValue("last 7 days");
        expect(result).not.toBeNull();
        // At midnight, "today" is 2024-03-10, so 7 days ago is 2024-03-03
        expect(result!.start).toEqual(new Date("2024-03-03T00:00:00.000Z"));
        expect(result!.end).toEqual(new Date("2024-03-11T00:00:00.000Z"));
      });

      it("handles preset calculation at UTC just before midnight", () => {
        vi.useFakeTimers();
        // Set time to 23:59:59 UTC - still same calendar day
        vi.setSystemTime(new Date("2024-03-10T23:59:59.999Z"));
        const result = parseDateRangeValue("today");
        expect(result).not.toBeNull();
        // Should still be March 10th since we're using UTC
        expect(result!.start).toEqual(new Date("2024-03-10T00:00:00.000Z"));
        expect(result!.end).toEqual(new Date("2024-03-11T00:00:00.000Z"));
      });

      it("handles DST spring forward date (March) for preset calculations", () => {
        vi.useFakeTimers();
        // March 10, 2024 is DST spring forward in US - but UTC is unaffected
        vi.setSystemTime(new Date("2024-03-10T12:00:00.000Z"));
        const result = parseDateRangeValue("last 7 days");
        expect(result).not.toBeNull();
        // UTC calculations should be unaffected by DST
        expect(result!.start).toEqual(new Date("2024-03-03T00:00:00.000Z"));
        expect(result!.end).toEqual(new Date("2024-03-11T00:00:00.000Z"));
      });

      it("handles DST fall back date (November) for preset calculations", () => {
        vi.useFakeTimers();
        // November 3, 2024 is DST fall back in US - but UTC is unaffected
        vi.setSystemTime(new Date("2024-11-03T12:00:00.000Z"));
        const result = parseDateRangeValue("last 7 days");
        expect(result).not.toBeNull();
        // UTC calculations should be unaffected by DST
        expect(result!.start).toEqual(new Date("2024-10-27T00:00:00.000Z"));
        expect(result!.end).toEqual(new Date("2024-11-04T00:00:00.000Z"));
      });

      it("parses date-only range consistently regardless of system time", () => {
        vi.useFakeTimers();
        // Set system time to a different timezone-like offset
        vi.setSystemTime(new Date("2024-06-15T04:00:00.000Z"));
        const result = parseDateRangeValue("2024-01-15..2024-01-20");
        expect(result).not.toBeNull();
        // Should always parse as UTC midnight regardless of when parsing occurs
        expect(result!.start).toEqual(new Date("2024-01-15T00:00:00.000Z"));
        expect(result!.end).toEqual(new Date("2024-01-21T00:00:00.000Z"));
      });

      it("parses datetime range at UTC midnight boundary", () => {
        const result = parseDateRangeValue("2024-01-15T00:00..2024-01-15T23:59");
        expect(result).not.toBeNull();
        expect(result!.start).toEqual(new Date("2024-01-15T00:00:00.000Z"));
        expect(result!.end).toEqual(new Date("2024-01-15T23:59:00.000Z"));
      });

      it("parses single date at year boundary (Dec 31)", () => {
        const result = parseDateRangeValue("2024-12-31");
        expect(result).not.toBeNull();
        expect(result!.start).toEqual(new Date("2024-12-31T00:00:00.000Z"));
        // End should be Jan 1 of next year
        expect(result!.end).toEqual(new Date("2025-01-01T00:00:00.000Z"));
      });

      it("parses single date at year boundary (Jan 1)", () => {
        const result = parseDateRangeValue("2024-01-01");
        expect(result).not.toBeNull();
        expect(result!.start).toEqual(new Date("2024-01-01T00:00:00.000Z"));
        expect(result!.end).toEqual(new Date("2024-01-02T00:00:00.000Z"));
      });

      it("parses leap year date (Feb 29)", () => {
        const result = parseDateRangeValue("2024-02-29");
        expect(result).not.toBeNull();
        expect(result!.start).toEqual(new Date("2024-02-29T00:00:00.000Z"));
        expect(result!.end).toEqual(new Date("2024-03-01T00:00:00.000Z"));
      });

      it("rolls over Feb 29 on non-leap year to March 1 (JavaScript Date behavior)", () => {
        const result = parseDateRangeValue("2023-02-29");
        // JavaScript Date rolls over invalid dates - Feb 29, 2023 becomes March 1, 2023
        // This is expected behavior from the Date constructor
        expect(result).not.toBeNull();
        expect(result!.start).toEqual(new Date("2023-03-01T00:00:00.000Z"));
        expect(result!.end).toEqual(new Date("2023-03-02T00:00:00.000Z"));
      });

      it("handles datetime at UTC midnight exactly", () => {
        const result = parseDateRangeValue("2024-06-15T00:00");
        expect(result).not.toBeNull();
        expect(result!.start).toEqual(new Date("2024-06-15T00:00:00.000Z"));
        // Datetime advances by 1 minute
        expect(result!.end).toEqual(new Date("2024-06-15T00:01:00.000Z"));
      });

      it("handles datetime at end of day (23:59)", () => {
        const result = parseDateRangeValue("2024-06-15T23:59");
        expect(result).not.toBeNull();
        expect(result!.start).toEqual(new Date("2024-06-15T23:59:00.000Z"));
        // Advancing by 1 minute crosses to next day
        expect(result!.end).toEqual(new Date("2024-06-16T00:00:00.000Z"));
      });
    });
  });

  describe("DATE_RANGE_PRESETS", () => {
    const fixedDate = new Date("2024-06-15T12:00:00.000Z");

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(fixedDate);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("contains expected preset labels", () => {
      const labels = DATE_RANGE_PRESETS.map((p) => p.label);
      expect(labels).toEqual([
        "today",
        "last 7 days",
        "last 30 days",
        "last 90 days",
        "last 365 days",
      ]);
    });

    it("'today' preset returns current date", () => {
      const preset = DATE_RANGE_PRESETS.find((p) => p.label === "today");
      expect(preset).toBeDefined();
      expect(preset!.getValue()).toBe("2024-06-15");
    });

    it("'last 7 days' preset returns range from 7 days ago to today", () => {
      const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 7 days");
      expect(preset).toBeDefined();
      expect(preset!.getValue()).toBe("2024-06-08..2024-06-15");
    });

    it("'last 30 days' preset returns range from 30 days ago to today", () => {
      const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 30 days");
      expect(preset).toBeDefined();
      expect(preset!.getValue()).toBe("2024-05-16..2024-06-15");
    });

    it("'last 90 days' preset returns range from 90 days ago to today", () => {
      const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 90 days");
      expect(preset).toBeDefined();
      expect(preset!.getValue()).toBe("2024-03-17..2024-06-15");
    });

    it("'last 365 days' preset returns range from 365 days ago to today", () => {
      const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 365 days");
      expect(preset).toBeDefined();
      expect(preset!.getValue()).toBe("2023-06-16..2024-06-15");
    });
  });
});
