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

describe("date-range-utils", () => {
  describe("parseDateRangeValue", () => {
    describe("invalid inputs", () => {
      it("returns null for empty string", () => {
        expect(parseDateRangeValue("")).toBeNull();
      });

      it("returns null for invalid date format", () => {
        expect(parseDateRangeValue("not-a-date")).toBeNull();
      });

      it("returns null for malformed ISO date", () => {
        expect(parseDateRangeValue("2024-13-45")).toBeNull();
      });
    });

    describe("single ISO date (YYYY-MM-DD)", () => {
      it("parses single date and returns full day range", () => {
        const result = parseDateRangeValue("2024-06-15");

        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-06-15T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2024-06-16T00:00:00.000Z");
      });

      it("handles first day of month", () => {
        const result = parseDateRangeValue("2024-01-01");

        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-01-01T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2024-01-02T00:00:00.000Z");
      });

      it("handles last day of month", () => {
        const result = parseDateRangeValue("2024-01-31");

        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-01-31T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2024-02-01T00:00:00.000Z");
      });
    });

    describe("single ISO datetime (YYYY-MM-DDTHH:mm)", () => {
      it("parses datetime and returns one-minute range", () => {
        const result = parseDateRangeValue("2024-06-15T14:30");

        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-06-15T14:30:00.000Z");
        expect(result!.end.toISOString()).toBe("2024-06-15T14:31:00.000Z");
      });

      it("handles midnight datetime", () => {
        const result = parseDateRangeValue("2024-06-15T00:00");

        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-06-15T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2024-06-15T00:01:00.000Z");
      });

      it("handles end of day datetime", () => {
        const result = parseDateRangeValue("2024-06-15T23:59");

        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-06-15T23:59:00.000Z");
        expect(result!.end.toISOString()).toBe("2024-06-16T00:00:00.000Z");
      });
    });

    describe("ISO range strings (YYYY-MM-DD..YYYY-MM-DD)", () => {
      it("parses date range and extends end to next midnight", () => {
        const result = parseDateRangeValue("2024-01-01..2024-01-31");

        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-01-01T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2024-02-01T00:00:00.000Z");
      });

      it("handles same-day range", () => {
        const result = parseDateRangeValue("2024-06-15..2024-06-15");

        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-06-15T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2024-06-16T00:00:00.000Z");
      });

      it("returns null when start is after end", () => {
        const result = parseDateRangeValue("2024-12-31..2024-01-01");

        expect(result).toBeNull();
      });

      it("returns null for invalid range format with extra parts", () => {
        const result = parseDateRangeValue("2024-01-01..2024-06-15..2024-12-31");

        expect(result).toBeNull();
      });

      it("handles whitespace around dates", () => {
        const result = parseDateRangeValue("2024-01-01 .. 2024-01-31");

        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-01-01T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2024-02-01T00:00:00.000Z");
      });
    });

    describe("datetime range strings (YYYY-MM-DDTHH:mm..YYYY-MM-DDTHH:mm)", () => {
      it("parses datetime range and keeps end as-is", () => {
        const result = parseDateRangeValue("2024-01-01T09:00..2024-01-31T17:00");

        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-01-01T09:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2024-01-31T17:00:00.000Z");
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

      it("is case-insensitive for preset labels", () => {
        const result = parseDateRangeValue("TODAY");

        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-06-15T00:00:00.000Z");
      });

      it("is case-insensitive for mixed case preset labels", () => {
        const result = parseDateRangeValue("Last 7 Days");

        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-06-08T00:00:00.000Z");
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

    it("contains five presets", () => {
      expect(DATE_RANGE_PRESETS).toHaveLength(5);
    });

    it("has 'today' preset that returns single date", () => {
      const preset = DATE_RANGE_PRESETS.find((p) => p.label === "today");

      expect(preset).toBeDefined();
      expect(preset!.getValue()).toBe("2024-06-15");
    });

    it("has 'last 7 days' preset that returns range", () => {
      const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 7 days");

      expect(preset).toBeDefined();
      expect(preset!.getValue()).toBe("2024-06-08..2024-06-15");
    });

    it("has 'last 30 days' preset that returns range", () => {
      const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 30 days");

      expect(preset).toBeDefined();
      expect(preset!.getValue()).toBe("2024-05-16..2024-06-15");
    });

    it("has 'last 90 days' preset that returns range", () => {
      const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 90 days");

      expect(preset).toBeDefined();
      expect(preset!.getValue()).toBe("2024-03-17..2024-06-15");
    });

    it("has 'last 365 days' preset that returns range", () => {
      const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 365 days");

      expect(preset).toBeDefined();
      expect(preset!.getValue()).toBe("2023-06-16..2024-06-15");
    });
  });
});
