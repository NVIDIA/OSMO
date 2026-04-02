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
  const FIXED_DATE = new Date("2026-03-15T12:00:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_DATE);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("DATE_RANGE_PRESETS", () => {
    it("contains_expected_preset_labels", () => {
      const labels = DATE_RANGE_PRESETS.map((p) => p.label);
      expect(labels).toContain("today");
      expect(labels).toContain("last 7 days");
      expect(labels).toContain("last 30 days");
      expect(labels).toContain("last 90 days");
      expect(labels).toContain("last 365 days");
    });

    it("today_preset_returns_current_date_in_iso_format", () => {
      const todayPreset = DATE_RANGE_PRESETS.find((p) => p.label === "today");
      expect(todayPreset).toBeDefined();
      expect(todayPreset!.getValue()).toBe("2026-03-15");
    });

    it("last_7_days_preset_returns_range_from_7_days_ago_to_today", () => {
      const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 7 days");
      expect(preset).toBeDefined();
      expect(preset!.getValue()).toBe("2026-03-08..2026-03-15");
    });

    it("last_30_days_preset_returns_range_from_30_days_ago_to_today", () => {
      const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 30 days");
      expect(preset).toBeDefined();
      expect(preset!.getValue()).toBe("2026-02-13..2026-03-15");
    });

    it("last_90_days_preset_returns_range_from_90_days_ago_to_today", () => {
      const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 90 days");
      expect(preset).toBeDefined();
      expect(preset!.getValue()).toBe("2025-12-15..2026-03-15");
    });

    it("last_365_days_preset_returns_range_from_365_days_ago_to_today", () => {
      const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 365 days");
      expect(preset).toBeDefined();
      expect(preset!.getValue()).toBe("2025-03-15..2026-03-15");
    });
  });

  describe("parseDateRangeValue", () => {
    describe("returns_null_for_invalid_input", () => {
      it("returns_null_for_empty_string", () => {
        expect(parseDateRangeValue("")).toBeNull();
      });

      it("returns_null_for_invalid_date_format", () => {
        expect(parseDateRangeValue("not-a-date")).toBeNull();
      });

      it("returns_null_for_malformed_range", () => {
        expect(parseDateRangeValue("2026-01-01..2026-01-02..2026-01-03")).toBeNull();
      });

      it("returns_null_when_start_is_after_end", () => {
        expect(parseDateRangeValue("2026-12-31..2026-01-01")).toBeNull();
      });

      it("returns_null_for_invalid_date_in_range", () => {
        expect(parseDateRangeValue("invalid..2026-01-01")).toBeNull();
      });
    });

    describe("parses_iso_range_strings", () => {
      it("parses_date_only_range_with_end_extended_to_next_midnight", () => {
        const result = parseDateRangeValue("2026-01-01..2026-01-31");
        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2026-01-01T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2026-02-01T00:00:00.000Z");
      });

      it("parses_datetime_range_with_exact_end_time", () => {
        const result = parseDateRangeValue("2026-01-01T00:00..2026-01-31T23:59");
        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2026-01-01T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2026-01-31T23:59:00.000Z");
      });

      it("parses_range_with_trimmed_whitespace", () => {
        const result = parseDateRangeValue(" 2026-01-01 .. 2026-01-31 ");
        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2026-01-01T00:00:00.000Z");
      });
    });

    describe("parses_single_dates", () => {
      it("parses_date_only_as_full_day_range", () => {
        const result = parseDateRangeValue("2026-02-20");
        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2026-02-20T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2026-02-21T00:00:00.000Z");
      });

      it("parses_datetime_as_one_minute_range", () => {
        const result = parseDateRangeValue("2026-02-20T14:30");
        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2026-02-20T14:30:00.000Z");
        expect(result!.end.toISOString()).toBe("2026-02-20T14:31:00.000Z");
      });
    });

    describe("parses_preset_labels", () => {
      it("parses_today_preset_label", () => {
        const result = parseDateRangeValue("today");
        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2026-03-15T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2026-03-16T00:00:00.000Z");
      });

      it("parses_last_7_days_preset_label", () => {
        const result = parseDateRangeValue("last 7 days");
        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2026-03-08T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2026-03-16T00:00:00.000Z");
      });

      it("parses_preset_label_case_insensitively", () => {
        const result = parseDateRangeValue("LAST 7 DAYS");
        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2026-03-08T00:00:00.000Z");
      });
    });
  });
});
