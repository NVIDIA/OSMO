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

describe("parseDateRangeValue", () => {
  describe("empty or null input", () => {
    it("returns null for empty string", () => {
      const result = parseDateRangeValue("");
      expect(result).toBeNull();
    });
  });

  describe("timezone corner cases", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("parses date at UTC midnight boundary correctly", () => {
      // When it's 11:59 PM UTC on March 14, someone in UTC+2 sees March 15
      vi.setSystemTime(new Date("2026-03-14T23:59:00.000Z"));
      const result = parseDateRangeValue("2026-03-14");

      expect(result).not.toBeNull();
      // Should always use UTC midnight regardless of local time
      expect(result!.start.toISOString()).toBe("2026-03-14T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2026-03-15T00:00:00.000Z");
    });

    it("parses datetime input as UTC regardless of system timezone", () => {
      // Input is interpreted as UTC, not local time
      const result = parseDateRangeValue("2026-03-15T00:30");

      expect(result).not.toBeNull();
      // The :30 minutes should be preserved exactly as UTC
      expect(result!.start.toISOString()).toBe("2026-03-15T00:30:00.000Z");
      expect(result!.end.toISOString()).toBe("2026-03-15T00:31:00.000Z");
    });

    it("handles year boundary date correctly in UTC", () => {
      vi.setSystemTime(new Date("2025-12-31T23:00:00.000Z"));
      const result = parseDateRangeValue("2025-12-31");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2025-12-31T00:00:00.000Z");
      // End should be January 1st of next year
      expect(result!.end.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    });

    it("handles leap year February 29th correctly", () => {
      const result = parseDateRangeValue("2024-02-29");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-02-29T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-03-01T00:00:00.000Z");
    });

    it("returns null for invalid February 29th in non-leap year", () => {
      // 2025 is not a leap year, so Feb 29 doesn't exist
      const result = parseDateRangeValue("2025-02-29");
      expect(result).toBeNull();
    });

    it("handles range spanning DST transition correctly", () => {
      // March 8, 2026 is a DST transition date in US timezones
      // UTC-based calculation should be unaffected
      const result = parseDateRangeValue("2026-03-07..2026-03-09");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2026-03-07T00:00:00.000Z");
      // End should be March 10 UTC midnight (day after March 9)
      expect(result!.end.toISOString()).toBe("2026-03-10T00:00:00.000Z");
    });

    it("preset today uses UTC date even late in UTC day", () => {
      // Set time to 11:59 PM UTC
      vi.setSystemTime(new Date("2026-03-15T23:59:59.999Z"));
      const result = parseDateRangeValue("today");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2026-03-15T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2026-03-16T00:00:00.000Z");
    });

    it("preset today uses UTC date even early in UTC day", () => {
      // Set time to 12:00 AM UTC
      vi.setSystemTime(new Date("2026-03-15T00:00:00.001Z"));
      const result = parseDateRangeValue("today");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2026-03-15T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2026-03-16T00:00:00.000Z");
    });
  });

  describe("single date input", () => {
    it("returns full UTC day range for date-only string", () => {
      const result = parseDateRangeValue("2026-03-15");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2026-03-15T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2026-03-16T00:00:00.000Z");
    });

    it("returns one minute range for datetime string", () => {
      const result = parseDateRangeValue("2026-03-15T14:30");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2026-03-15T14:30:00.000Z");
      expect(result!.end.toISOString()).toBe("2026-03-15T14:31:00.000Z");
    });

    it("returns null for invalid date format", () => {
      const result = parseDateRangeValue("invalid-date");
      expect(result).toBeNull();
    });

    it("returns null for partial date format", () => {
      const result = parseDateRangeValue("2026-03");
      expect(result).toBeNull();
    });
  });

  describe("ISO range input", () => {
    it("parses date range string with date-only values", () => {
      const result = parseDateRangeValue("2026-01-01..2026-01-31");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2026-01-01T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2026-02-01T00:00:00.000Z");
    });

    it("parses date range string with datetime values", () => {
      const result = parseDateRangeValue("2026-01-01T09:00..2026-01-01T17:00");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2026-01-01T09:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2026-01-01T17:00:00.000Z");
    });

    it("returns null for range with invalid start date", () => {
      const result = parseDateRangeValue("invalid..2026-01-31");
      expect(result).toBeNull();
    });

    it("returns null for range with invalid end date", () => {
      const result = parseDateRangeValue("2026-01-01..invalid");
      expect(result).toBeNull();
    });

    it("returns null when start date is after end date", () => {
      const result = parseDateRangeValue("2026-12-31..2026-01-01");
      expect(result).toBeNull();
    });

    it("returns null for range with more than two parts", () => {
      const result = parseDateRangeValue("2026-01-01..2026-01-15..2026-01-31");
      expect(result).toBeNull();
    });
  });

  describe("preset labels", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-03-15T12:00:00.000Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("parses today preset label", () => {
      const result = parseDateRangeValue("today");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2026-03-15T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2026-03-16T00:00:00.000Z");
    });

    it("parses last 7 days preset label", () => {
      const result = parseDateRangeValue("last 7 days");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2026-03-08T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2026-03-16T00:00:00.000Z");
    });

    it("parses last 30 days preset label", () => {
      const result = parseDateRangeValue("last 30 days");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2026-02-13T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2026-03-16T00:00:00.000Z");
    });

    it("parses last 90 days preset label", () => {
      const result = parseDateRangeValue("last 90 days");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2025-12-15T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2026-03-16T00:00:00.000Z");
    });

    it("parses last 365 days preset label", () => {
      const result = parseDateRangeValue("last 365 days");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2025-03-15T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2026-03-16T00:00:00.000Z");
    });

    it("parses preset label case-insensitively", () => {
      const result = parseDateRangeValue("TODAY");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2026-03-15T00:00:00.000Z");
    });

    it("returns null for unknown preset label", () => {
      const result = parseDateRangeValue("last 999 days");
      expect(result).toBeNull();
    });
  });
});

describe("DATE_RANGE_PRESETS", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T12:00:00.000Z"));
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

  it("today preset returns single date string", () => {
    const preset = DATE_RANGE_PRESETS.find((p) => p.label === "today");

    expect(preset).toBeDefined();
    expect(preset!.getValue()).toBe("2026-03-15");
  });

  it("last 7 days preset returns range string", () => {
    const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 7 days");

    expect(preset).toBeDefined();
    expect(preset!.getValue()).toBe("2026-03-08..2026-03-15");
  });

  it("last 30 days preset returns range string", () => {
    const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 30 days");

    expect(preset).toBeDefined();
    expect(preset!.getValue()).toBe("2026-02-13..2026-03-15");
  });

  it("last 90 days preset returns range string", () => {
    const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 90 days");

    expect(preset).toBeDefined();
    expect(preset!.getValue()).toBe("2025-12-15..2026-03-15");
  });

  it("last 365 days preset returns range string", () => {
    const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 365 days");

    expect(preset).toBeDefined();
    expect(preset!.getValue()).toBe("2025-03-15..2026-03-15");
  });
});
