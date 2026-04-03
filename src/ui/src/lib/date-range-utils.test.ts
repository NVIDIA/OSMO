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
