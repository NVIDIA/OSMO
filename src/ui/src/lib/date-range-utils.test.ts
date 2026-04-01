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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { parseDateRangeValue, DATE_RANGE_PRESETS } from "@/lib/date-range-utils";

describe("date-range-utils", () => {
  describe("parseDateRangeValue", () => {
    describe("empty and null inputs", () => {
      it("returns null for empty string", () => {
        const result = parseDateRangeValue("");
        expect(result).toBeNull();
      });
    });

    describe("single date parsing", () => {
      it("parses single ISO date as full UTC day with end at next midnight", () => {
        const result = parseDateRangeValue("2024-06-15");

        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-06-15T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2024-06-16T00:00:00.000Z");
      });

      it("parses datetime string as full minute with end 1 minute later", () => {
        const result = parseDateRangeValue("2024-06-15T14:30");

        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-06-15T14:30:00.000Z");
        expect(result!.end.toISOString()).toBe("2024-06-15T14:31:00.000Z");
      });

      it("returns null for invalid date format", () => {
        const result = parseDateRangeValue("not-a-date");
        expect(result).toBeNull();
      });

      it("returns null for invalid date values", () => {
        const result = parseDateRangeValue("2024-13-45");
        expect(result).toBeNull();
      });
    });

    describe("ISO range string parsing", () => {
      it("parses date range with date-only end extending to next midnight", () => {
        const result = parseDateRangeValue("2024-01-01..2024-01-31");

        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-01-01T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2024-02-01T00:00:00.000Z");
      });

      it("parses datetime range keeping end as-is", () => {
        const result = parseDateRangeValue("2024-01-01T08:00..2024-01-31T18:00");

        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-01-01T08:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2024-01-31T18:00:00.000Z");
      });

      it("returns null when start date is after end date", () => {
        const result = parseDateRangeValue("2024-12-31..2024-01-01");
        expect(result).toBeNull();
      });

      it("returns null for range with invalid start date", () => {
        const result = parseDateRangeValue("invalid..2024-01-31");
        expect(result).toBeNull();
      });

      it("returns null for range with invalid end date", () => {
        const result = parseDateRangeValue("2024-01-01..invalid");
        expect(result).toBeNull();
      });

      it("returns null for range with more than two parts", () => {
        const result = parseDateRangeValue("2024-01-01..2024-06-15..2024-12-31");
        expect(result).toBeNull();
      });

      it("handles range with whitespace around dates", () => {
        const result = parseDateRangeValue("2024-01-01 .. 2024-01-31");

        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-01-01T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2024-02-01T00:00:00.000Z");
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

      it("parses preset labels case-insensitively", () => {
        const result = parseDateRangeValue("TODAY");

        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-06-15T00:00:00.000Z");
      });

      it("parses mixed case preset labels", () => {
        const result = parseDateRangeValue("Last 7 Days");

        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-06-08T00:00:00.000Z");
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

    it("today preset returns current date", () => {
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

    it("contains exactly 5 presets", () => {
      expect(DATE_RANGE_PRESETS).toHaveLength(5);
    });
  });

  describe("edge cases", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("handles year boundary correctly for daysAgo calculation", () => {
      vi.setSystemTime(new Date("2024-01-05T12:00:00.000Z"));

      const result = parseDateRangeValue("last 7 days");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2023-12-29T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-01-06T00:00:00.000Z");
    });

    it("handles month boundary correctly for daysAgo calculation", () => {
      vi.setSystemTime(new Date("2024-03-02T12:00:00.000Z"));

      const result = parseDateRangeValue("last 7 days");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-02-24T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-03-03T00:00:00.000Z");
    });

    it("handles leap year correctly", () => {
      vi.setSystemTime(new Date("2024-03-01T12:00:00.000Z"));

      const result = parseDateRangeValue("last 7 days");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-02-23T00:00:00.000Z");
    });

    it("parses same start and end date in range", () => {
      const result = parseDateRangeValue("2024-06-15..2024-06-15");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-06-15T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-06-16T00:00:00.000Z");
    });
  });
});
