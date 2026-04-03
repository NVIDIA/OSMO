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
