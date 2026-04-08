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
  beforeEach(() => {
    // Mock Date to 2026-03-15T12:00:00.000Z for deterministic tests
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("parseDateRangeValue", () => {
    describe("empty and invalid input", () => {
      it("returns null for empty string", () => {
        expect(parseDateRangeValue("")).toBeNull();
      });

      it("returns null for invalid format", () => {
        expect(parseDateRangeValue("not-a-date")).toBeNull();
      });

      it("returns null for partial date format", () => {
        expect(parseDateRangeValue("2026-03")).toBeNull();
      });

      it("returns null for invalid date values", () => {
        expect(parseDateRangeValue("2026-13-45")).toBeNull();
      });
    });

    describe("single date parsing (YYYY-MM-DD)", () => {
      it("parses single date as full UTC day", () => {
        const result = parseDateRangeValue("2026-02-20");
        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2026-02-20T00:00:00.000Z");
        // End is next day midnight (exclusive)
        expect(result!.end.toISOString()).toBe("2026-02-21T00:00:00.000Z");
      });

      it("parses first day of year", () => {
        const result = parseDateRangeValue("2026-01-01");
        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2026-01-01T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2026-01-02T00:00:00.000Z");
      });

      it("parses last day of year", () => {
        const result = parseDateRangeValue("2026-12-31");
        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2026-12-31T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
      });
    });

    describe("single datetime parsing (YYYY-MM-DDTHH:mm)", () => {
      it("parses datetime and adds 1 minute for end", () => {
        const result = parseDateRangeValue("2026-02-20T14:30");
        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2026-02-20T14:30:00.000Z");
        // End is 1 minute later
        expect(result!.end.toISOString()).toBe("2026-02-20T14:31:00.000Z");
      });

      it("parses midnight datetime", () => {
        const result = parseDateRangeValue("2026-02-20T00:00");
        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2026-02-20T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2026-02-20T00:01:00.000Z");
      });

      it("parses end-of-day datetime", () => {
        const result = parseDateRangeValue("2026-02-20T23:59");
        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2026-02-20T23:59:00.000Z");
        expect(result!.end.toISOString()).toBe("2026-02-21T00:00:00.000Z");
      });
    });

    describe("ISO range string parsing (YYYY-MM-DD..YYYY-MM-DD)", () => {
      it("parses date range with date-only end", () => {
        const result = parseDateRangeValue("2026-01-01..2026-01-31");
        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2026-01-01T00:00:00.000Z");
        // Date-only end advances to next day midnight
        expect(result!.end.toISOString()).toBe("2026-02-01T00:00:00.000Z");
      });

      it("parses single-day range", () => {
        const result = parseDateRangeValue("2026-03-15..2026-03-15");
        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2026-03-15T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2026-03-16T00:00:00.000Z");
      });

      it("returns null when start is after end", () => {
        const result = parseDateRangeValue("2026-12-31..2026-01-01");
        expect(result).toBeNull();
      });

      it("returns null for malformed range with too many parts", () => {
        const result = parseDateRangeValue("2026-01-01..2026-01-15..2026-01-31");
        expect(result).toBeNull();
      });

      it("returns null for range with invalid dates", () => {
        const result = parseDateRangeValue("invalid..2026-01-31");
        expect(result).toBeNull();
      });

      it("handles range with whitespace around dates", () => {
        const result = parseDateRangeValue(" 2026-01-01 .. 2026-01-31 ");
        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2026-01-01T00:00:00.000Z");
      });
    });

    describe("ISO range with datetime end", () => {
      it("parses range with datetime end as-is", () => {
        const result = parseDateRangeValue("2026-01-01..2026-01-31T14:30");
        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2026-01-01T00:00:00.000Z");
        // Datetime end is used as-is (no advance)
        expect(result!.end.toISOString()).toBe("2026-01-31T14:30:00.000Z");
      });
    });

    describe("preset labels", () => {
      it("parses 'today' preset", () => {
        const result = parseDateRangeValue("today");
        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2026-03-15T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2026-03-16T00:00:00.000Z");
      });

      it("parses 'last 7 days' preset", () => {
        const result = parseDateRangeValue("last 7 days");
        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2026-03-08T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2026-03-16T00:00:00.000Z");
      });

      it("parses 'last 30 days' preset", () => {
        const result = parseDateRangeValue("last 30 days");
        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2026-02-13T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2026-03-16T00:00:00.000Z");
      });

      it("parses 'last 90 days' preset", () => {
        const result = parseDateRangeValue("last 90 days");
        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2025-12-15T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2026-03-16T00:00:00.000Z");
      });

      it("parses 'last 365 days' preset", () => {
        const result = parseDateRangeValue("last 365 days");
        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2025-03-15T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2026-03-16T00:00:00.000Z");
      });

      it("parses preset labels case-insensitively", () => {
        const result = parseDateRangeValue("TODAY");
        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2026-03-15T00:00:00.000Z");
      });

      it("parses mixed case preset label", () => {
        const result = parseDateRangeValue("Last 7 Days");
        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2026-03-08T00:00:00.000Z");
      });
    });
  });

  describe("DATE_RANGE_PRESETS", () => {
    it("has 5 presets", () => {
      expect(DATE_RANGE_PRESETS).toHaveLength(5);
    });

    it("has 'today' preset that returns current date", () => {
      const todayPreset = DATE_RANGE_PRESETS.find((p) => p.label === "today");
      expect(todayPreset).toBeDefined();
      expect(todayPreset!.getValue()).toBe("2026-03-15");
    });

    it("has 'last 7 days' preset that returns correct range", () => {
      const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 7 days");
      expect(preset).toBeDefined();
      expect(preset!.getValue()).toBe("2026-03-08..2026-03-15");
    });

    it("has 'last 30 days' preset that returns correct range", () => {
      const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 30 days");
      expect(preset).toBeDefined();
      expect(preset!.getValue()).toBe("2026-02-13..2026-03-15");
    });

    it("has 'last 90 days' preset that returns correct range", () => {
      const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 90 days");
      expect(preset).toBeDefined();
      expect(preset!.getValue()).toBe("2025-12-15..2026-03-15");
    });

    it("has 'last 365 days' preset that returns correct range", () => {
      const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 365 days");
      expect(preset).toBeDefined();
      expect(preset!.getValue()).toBe("2025-03-15..2026-03-15");
    });

    it("preset labels are unique", () => {
      const labels = DATE_RANGE_PRESETS.map((p) => p.label);
      const uniqueLabels = new Set(labels);
      expect(uniqueLabels.size).toBe(labels.length);
    });
  });
});
