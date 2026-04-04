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

// =============================================================================
// parseDateRangeValue - empty and null values
// =============================================================================

describe("parseDateRangeValue", () => {
  describe("empty and null values", () => {
    it("returns null for empty string", () => {
      expect(parseDateRangeValue("")).toBeNull();
    });
  });

  // ===========================================================================
  // ISO range strings "YYYY-MM-DD..YYYY-MM-DD"
  // ===========================================================================

  describe("ISO range strings", () => {
    it("parses valid date range with start and end", () => {
      const result = parseDateRangeValue("2024-01-01..2024-12-31");
      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-01-01T00:00:00.000Z");
      // End is advanced to next midnight for inclusive behavior
      expect(result!.end.toISOString()).toBe("2025-01-01T00:00:00.000Z");
    });

    it("parses date range with same start and end date", () => {
      const result = parseDateRangeValue("2024-06-15..2024-06-15");
      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-06-15T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-06-16T00:00:00.000Z");
    });

    it("parses date range with consecutive days", () => {
      const result = parseDateRangeValue("2024-03-14..2024-03-15");
      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-03-14T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-03-16T00:00:00.000Z");
    });

    it("returns null when start date is after end date", () => {
      expect(parseDateRangeValue("2024-12-31..2024-01-01")).toBeNull();
    });

    it("returns null for invalid range format with only one part", () => {
      expect(parseDateRangeValue("2024-01-01..")).toBeNull();
    });

    it("parses datetime range with explicit times", () => {
      const result = parseDateRangeValue("2024-01-01T09:00..2024-01-01T17:00");
      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-01-01T09:00:00.000Z");
      // Datetime end is used as-is (explicit cutoff)
      expect(result!.end.toISOString()).toBe("2024-01-01T17:00:00.000Z");
    });

    it("handles whitespace around range parts", () => {
      const result = parseDateRangeValue("2024-01-01 .. 2024-01-31");
      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-01-01T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-02-01T00:00:00.000Z");
    });
  });

  // ===========================================================================
  // Single date strings "YYYY-MM-DD"
  // ===========================================================================

  describe("single date strings", () => {
    it("parses single date as full UTC day", () => {
      const result = parseDateRangeValue("2026-02-20");
      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2026-02-20T00:00:00.000Z");
      // End is midnight of next day for inclusive behavior
      expect(result!.end.toISOString()).toBe("2026-02-21T00:00:00.000Z");
    });

    it("parses date at year boundary", () => {
      const result = parseDateRangeValue("2024-12-31");
      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-12-31T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2025-01-01T00:00:00.000Z");
    });

    it("parses leap year date", () => {
      const result = parseDateRangeValue("2024-02-29");
      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-02-29T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-03-01T00:00:00.000Z");
    });
  });

  // ===========================================================================
  // Single datetime strings "YYYY-MM-DDTHH:mm"
  // ===========================================================================

  describe("single datetime strings", () => {
    it("parses datetime as full minute", () => {
      const result = parseDateRangeValue("2024-06-15T14:30");
      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-06-15T14:30:00.000Z");
      // End is 1 minute later
      expect(result!.end.toISOString()).toBe("2024-06-15T14:31:00.000Z");
    });

    it("parses datetime at midnight", () => {
      const result = parseDateRangeValue("2024-06-15T00:00");
      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-06-15T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-06-15T00:01:00.000Z");
    });

    it("parses datetime at end of day", () => {
      const result = parseDateRangeValue("2024-06-15T23:59");
      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-06-15T23:59:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-06-16T00:00:00.000Z");
    });
  });

  // ===========================================================================
  // Preset labels
  // ===========================================================================

  describe("preset labels", () => {
    const FIXED_DATE = new Date("2024-06-15T12:00:00.000Z");

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(FIXED_DATE);
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

    it("handles case-insensitive preset matching", () => {
      const result = parseDateRangeValue("TODAY");
      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-06-15T00:00:00.000Z");
    });

    it("handles mixed case preset", () => {
      const result = parseDateRangeValue("Last 7 Days");
      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-06-08T00:00:00.000Z");
    });
  });

  // ===========================================================================
  // Invalid values
  // ===========================================================================

  describe("invalid values", () => {
    it("returns null for random text", () => {
      expect(parseDateRangeValue("random text")).toBeNull();
    });

    it("returns null for invalid date format", () => {
      expect(parseDateRangeValue("2024/01/01")).toBeNull();
    });

    it("returns null for incomplete date", () => {
      expect(parseDateRangeValue("2024-01")).toBeNull();
    });

    it("returns null for invalid month", () => {
      expect(parseDateRangeValue("2024-13-01")).toBeNull();
    });

    it("returns null for malformed day value", () => {
      expect(parseDateRangeValue("2024-02-3")).toBeNull();
    });

    it("returns null for invalid datetime format", () => {
      expect(parseDateRangeValue("2024-01-01T25:00")).toBeNull();
    });
  });
});

// =============================================================================
// DATE_RANGE_PRESETS
// =============================================================================

describe("DATE_RANGE_PRESETS", () => {
  const FIXED_DATE = new Date("2024-06-15T12:00:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_DATE);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("contains expected preset labels", () => {
    const labels = DATE_RANGE_PRESETS.map((p) => p.label);
    expect(labels).toContain("today");
    expect(labels).toContain("last 7 days");
    expect(labels).toContain("last 30 days");
    expect(labels).toContain("last 90 days");
    expect(labels).toContain("last 365 days");
  });

  it("returns correct value for today preset", () => {
    const todayPreset = DATE_RANGE_PRESETS.find((p) => p.label === "today");
    expect(todayPreset).toBeDefined();
    expect(todayPreset!.getValue()).toBe("2024-06-15");
  });

  it("returns correct value for last 7 days preset", () => {
    const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 7 days");
    expect(preset).toBeDefined();
    expect(preset!.getValue()).toBe("2024-06-08..2024-06-15");
  });

  it("returns correct value for last 30 days preset", () => {
    const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 30 days");
    expect(preset).toBeDefined();
    expect(preset!.getValue()).toBe("2024-05-16..2024-06-15");
  });

  it("returns correct value for last 90 days preset", () => {
    const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 90 days");
    expect(preset).toBeDefined();
    expect(preset!.getValue()).toBe("2024-03-17..2024-06-15");
  });

  it("returns correct value for last 365 days preset", () => {
    const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 365 days");
    expect(preset).toBeDefined();
    expect(preset!.getValue()).toBe("2023-06-16..2024-06-15");
  });

  it("has exactly 5 presets", () => {
    expect(DATE_RANGE_PRESETS).toHaveLength(5);
  });
});
