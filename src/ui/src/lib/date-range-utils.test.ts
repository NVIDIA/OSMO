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

import { DATE_RANGE_PRESETS, parseDateRangeValue } from "@/lib/date-range-utils";

describe("parseDateRangeValue", () => {
  describe("empty and invalid inputs", () => {
    it("returns null for empty string", () => {
      const result = parseDateRangeValue("");

      expect(result).toBeNull();
    });

    it("returns null for invalid date format", () => {
      const result = parseDateRangeValue("invalid-date");

      expect(result).toBeNull();
    });

    it("returns null for partial date string", () => {
      const result = parseDateRangeValue("2024-01");

      expect(result).toBeNull();
    });
  });

  describe("single date parsing", () => {
    it("parses date-only string as full UTC day", () => {
      const result = parseDateRangeValue("2024-06-15");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-06-15T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-06-16T00:00:00.000Z");
    });

    it("parses datetime string with minute precision", () => {
      const result = parseDateRangeValue("2024-06-15T14:30");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-06-15T14:30:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-06-15T14:31:00.000Z");
    });

    it("returns null for invalid single date", () => {
      const result = parseDateRangeValue("2024-13-45");

      expect(result).toBeNull();
    });

    it("returns null for invalid datetime format", () => {
      const result = parseDateRangeValue("2024-06-15T25:99");

      expect(result).toBeNull();
    });
  });

  describe("ISO range string parsing", () => {
    it("parses date range with both dates as date-only", () => {
      const result = parseDateRangeValue("2024-01-01..2024-12-31");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-01-01T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2025-01-01T00:00:00.000Z");
    });

    it("parses date range with datetime end", () => {
      const result = parseDateRangeValue("2024-01-01..2024-12-31T23:59");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-01-01T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-12-31T23:59:00.000Z");
    });

    it("parses date range with datetime start and end", () => {
      const result = parseDateRangeValue("2024-06-15T08:00..2024-06-15T17:00");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-06-15T08:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-06-15T17:00:00.000Z");
    });

    it("returns null for range with invalid start date", () => {
      const result = parseDateRangeValue("invalid..2024-12-31");

      expect(result).toBeNull();
    });

    it("returns null for range with invalid end date", () => {
      const result = parseDateRangeValue("2024-01-01..invalid");

      expect(result).toBeNull();
    });

    it("returns null for range where start is after end", () => {
      const result = parseDateRangeValue("2024-12-31..2024-01-01");

      expect(result).toBeNull();
    });

    it("returns null for range with more than two parts", () => {
      const result = parseDateRangeValue("2024-01-01..2024-06-15..2024-12-31");

      expect(result).toBeNull();
    });

    it("handles whitespace around range parts", () => {
      const result = parseDateRangeValue("2024-01-01 .. 2024-12-31");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-01-01T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2025-01-01T00:00:00.000Z");
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

    it("parses 'today' preset", () => {
      const result = parseDateRangeValue("today");

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

    it("parses preset labels case-insensitively", () => {
      const result = parseDateRangeValue("TODAY");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-06-15T00:00:00.000Z");
    });

    it("parses preset labels with mixed case", () => {
      const result = parseDateRangeValue("Last 7 Days");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-06-08T00:00:00.000Z");
    });
  });

  describe("time zone corner cases", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("handles date at UTC midnight boundary correctly", () => {
      const result = parseDateRangeValue("2024-03-10");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-03-10T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-03-11T00:00:00.000Z");
    });

    it("handles DST spring forward date (US March 2024)", () => {
      vi.setSystemTime(new Date("2024-03-10T12:00:00.000Z"));
      const result = parseDateRangeValue("today");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-03-10T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-03-11T00:00:00.000Z");
    });

    it("handles DST fall back date (US November 2024)", () => {
      vi.setSystemTime(new Date("2024-11-03T12:00:00.000Z"));
      const result = parseDateRangeValue("today");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-11-03T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-11-04T00:00:00.000Z");
    });

    it("handles leap year February 29", () => {
      const result = parseDateRangeValue("2024-02-29");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-02-29T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-03-01T00:00:00.000Z");
    });

    it("handles February 29 in non-leap year (JavaScript overflows to March 1)", () => {
      // Note: JavaScript Date doesn't reject invalid dates like Feb 29, 2023
      // Instead it overflows to the next valid date (March 1)
      const result = parseDateRangeValue("2023-02-29");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2023-03-01T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2023-03-02T00:00:00.000Z");
    });

    it("handles year boundary crossing in date range", () => {
      const result = parseDateRangeValue("2023-12-31..2024-01-01");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2023-12-31T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-01-02T00:00:00.000Z");
    });

    it("handles last day of December correctly", () => {
      const result = parseDateRangeValue("2024-12-31");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-12-31T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2025-01-01T00:00:00.000Z");
    });

    it("handles datetime at 23:59 UTC correctly", () => {
      const result = parseDateRangeValue("2024-06-15T23:59");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-06-15T23:59:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-06-16T00:00:00.000Z");
    });

    it("handles datetime at 00:00 UTC correctly", () => {
      const result = parseDateRangeValue("2024-06-15T00:00");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-06-15T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-06-15T00:01:00.000Z");
    });

    it("handles range spanning DST transition", () => {
      const result = parseDateRangeValue("2024-03-09..2024-03-11");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-03-09T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-03-12T00:00:00.000Z");
    });

    it("handles last 7 days preset crossing month boundary", () => {
      vi.setSystemTime(new Date("2024-03-03T12:00:00.000Z"));
      const result = parseDateRangeValue("last 7 days");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-02-25T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-03-04T00:00:00.000Z");
    });

    it("handles last 30 days preset crossing year boundary", () => {
      vi.setSystemTime(new Date("2024-01-15T12:00:00.000Z"));
      const result = parseDateRangeValue("last 30 days");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2023-12-16T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-01-16T00:00:00.000Z");
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

  it("has five presets", () => {
    expect(DATE_RANGE_PRESETS).toHaveLength(5);
  });

  it("has today preset with correct label", () => {
    const todayPreset = DATE_RANGE_PRESETS.find((p) => p.label === "today");

    expect(todayPreset).toBeDefined();
    expect(todayPreset!.getValue()).toBe("2024-06-15");
  });

  it("has last 7 days preset with correct value", () => {
    const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 7 days");

    expect(preset).toBeDefined();
    expect(preset!.getValue()).toBe("2024-06-08..2024-06-15");
  });

  it("has last 30 days preset with correct value", () => {
    const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 30 days");

    expect(preset).toBeDefined();
    expect(preset!.getValue()).toBe("2024-05-16..2024-06-15");
  });

  it("has last 90 days preset with correct value", () => {
    const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 90 days");

    expect(preset).toBeDefined();
    expect(preset!.getValue()).toBe("2024-03-17..2024-06-15");
  });

  it("has last 365 days preset with correct value", () => {
    const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 365 days");

    expect(preset).toBeDefined();
    expect(preset!.getValue()).toBe("2023-06-16..2024-06-15");
  });

  it("preset values are computed dynamically based on current date", () => {
    const todayPreset = DATE_RANGE_PRESETS.find((p) => p.label === "today");
    const firstValue = todayPreset!.getValue();

    vi.setSystemTime(new Date("2024-12-25T12:00:00.000Z"));
    const secondValue = todayPreset!.getValue();

    expect(firstValue).toBe("2024-06-15");
    expect(secondValue).toBe("2024-12-25");
  });
});
