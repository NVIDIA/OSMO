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
  describe("DATE_RANGE_PRESETS", () => {
    beforeEach(() => {
      // Mock Date to 2026-03-15T12:00:00.000Z
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-03-15T12:00:00.000Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("returns five presets with expected labels", () => {
      expect(DATE_RANGE_PRESETS).toHaveLength(5);
      expect(DATE_RANGE_PRESETS.map((p) => p.label)).toEqual([
        "today",
        "last 7 days",
        "last 30 days",
        "last 90 days",
        "last 365 days",
      ]);
    });

    it("preset_today_returns_current_date", () => {
      const todayPreset = DATE_RANGE_PRESETS.find((p) => p.label === "today");
      expect(todayPreset?.getValue()).toBe("2026-03-15");
    });

    it("preset_last_7_days_crosses_year_boundary_correctly", () => {
      vi.setSystemTime(new Date("2026-01-03T12:00:00.000Z"));
      const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 7 days");
      expect(preset?.getValue()).toBe("2025-12-27..2026-01-03");
    });

    it("preset_last_30_days_handles_month_boundary", () => {
      vi.setSystemTime(new Date("2026-03-05T12:00:00.000Z"));
      const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 30 days");
      expect(preset?.getValue()).toBe("2026-02-03..2026-03-05");
    });

    it("preset_handles_leap_year_february_29", () => {
      vi.setSystemTime(new Date("2028-02-29T12:00:00.000Z"));
      const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 7 days");
      expect(preset?.getValue()).toBe("2028-02-22..2028-02-29");
    });

    it("preset_handles_end_of_year", () => {
      vi.setSystemTime(new Date("2026-12-31T23:59:59.999Z"));
      const todayPreset = DATE_RANGE_PRESETS.find((p) => p.label === "today");
      expect(todayPreset?.getValue()).toBe("2026-12-31");
    });

    it("preset_last_7_days_returns_range_from_7_days_ago_to_today", () => {
      const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 7 days");
      expect(preset?.getValue()).toBe("2026-03-08..2026-03-15");
    });

    it("preset_last_30_days_returns_range_from_30_days_ago_to_today", () => {
      const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 30 days");
      expect(preset?.getValue()).toBe("2026-02-13..2026-03-15");
    });

    it("preset_last_90_days_returns_range_from_90_days_ago_to_today", () => {
      const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 90 days");
      expect(preset?.getValue()).toBe("2025-12-15..2026-03-15");
    });

    it("preset_last_365_days_returns_range_from_365_days_ago_to_today", () => {
      const preset = DATE_RANGE_PRESETS.find(
        (p) => p.label === "last 365 days"
      );
      expect(preset?.getValue()).toBe("2025-03-15..2026-03-15");
    });
  });

  describe("parseDateRangeValue", () => {
    describe("empty and invalid input", () => {
      it("returns_null_for_empty_string", () => {
        expect(parseDateRangeValue("")).toBeNull();
      });

      it("returns_null_for_invalid_format", () => {
        expect(parseDateRangeValue("not-a-date")).toBeNull();
      });

      it("returns_null_for_partial_date", () => {
        expect(parseDateRangeValue("2026-03")).toBeNull();
      });
    });

    describe("single date parsing", () => {
      it("parses_single_date_as_full_utc_day", () => {
        const result = parseDateRangeValue("2026-03-15");

        expect(result).not.toBeNull();
        expect(result?.start.toISOString()).toBe("2026-03-15T00:00:00.000Z");
        // End is next midnight (exclusive upper bound)
        expect(result?.end.toISOString()).toBe("2026-03-16T00:00:00.000Z");
      });

      it("parses_single_datetime_as_full_minute", () => {
        const result = parseDateRangeValue("2026-03-15T14:30");

        expect(result).not.toBeNull();
        expect(result?.start.toISOString()).toBe("2026-03-15T14:30:00.000Z");
        // End is one minute later
        expect(result?.end.toISOString()).toBe("2026-03-15T14:31:00.000Z");
      });

      it("returns_null_for_invalid_single_date", () => {
        expect(parseDateRangeValue("2026-13-45")).toBeNull();
      });

      it("returns_null_for_invalid_single_datetime", () => {
        expect(parseDateRangeValue("2026-03-15T25:99")).toBeNull();
      });

      it("parses_leap_year_february_29", () => {
        const result = parseDateRangeValue("2028-02-29");

        expect(result).not.toBeNull();
        expect(result?.start.toISOString()).toBe("2028-02-29T00:00:00.000Z");
        expect(result?.end.toISOString()).toBe("2028-03-01T00:00:00.000Z");
      });

      it("parses_datetime_at_midnight", () => {
        const result = parseDateRangeValue("2026-03-15T00:00");

        expect(result).not.toBeNull();
        expect(result?.start.toISOString()).toBe("2026-03-15T00:00:00.000Z");
        expect(result?.end.toISOString()).toBe("2026-03-15T00:01:00.000Z");
      });

      it("parses_datetime_at_end_of_day", () => {
        const result = parseDateRangeValue("2026-03-15T23:59");

        expect(result).not.toBeNull();
        expect(result?.start.toISOString()).toBe("2026-03-15T23:59:00.000Z");
        expect(result?.end.toISOString()).toBe("2026-03-16T00:00:00.000Z");
      });

      it("parses_end_of_year_date", () => {
        const result = parseDateRangeValue("2026-12-31");

        expect(result).not.toBeNull();
        expect(result?.start.toISOString()).toBe("2026-12-31T00:00:00.000Z");
        expect(result?.end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
      });
    });

    describe("ISO range string parsing", () => {
      it("parses_date_only_range_with_end_advanced_to_next_midnight", () => {
        const result = parseDateRangeValue("2026-01-01..2026-12-31");

        expect(result).not.toBeNull();
        expect(result?.start.toISOString()).toBe("2026-01-01T00:00:00.000Z");
        // End date-only advances to next midnight
        expect(result?.end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
      });

      it("parses_datetime_range_without_advancing_end", () => {
        const result = parseDateRangeValue(
          "2026-01-01T08:00..2026-01-01T17:00"
        );

        expect(result).not.toBeNull();
        expect(result?.start.toISOString()).toBe("2026-01-01T08:00:00.000Z");
        // Datetime end used as-is
        expect(result?.end.toISOString()).toBe("2026-01-01T17:00:00.000Z");
      });

      it("parses_mixed_date_and_datetime_range", () => {
        const result = parseDateRangeValue("2026-01-01..2026-01-15T12:00");

        expect(result).not.toBeNull();
        expect(result?.start.toISOString()).toBe("2026-01-01T00:00:00.000Z");
        // Datetime end used as-is
        expect(result?.end.toISOString()).toBe("2026-01-15T12:00:00.000Z");
      });

      it("returns_null_when_start_is_after_end", () => {
        expect(parseDateRangeValue("2026-12-31..2026-01-01")).toBeNull();
      });

      it("returns_null_when_start_is_invalid", () => {
        expect(parseDateRangeValue("invalid..2026-12-31")).toBeNull();
      });

      it("returns_null_when_end_is_invalid", () => {
        expect(parseDateRangeValue("2026-01-01..invalid")).toBeNull();
      });

      it("returns_null_for_malformed_range_with_too_many_parts", () => {
        expect(
          parseDateRangeValue("2026-01-01..2026-06-15..2026-12-31")
        ).toBeNull();
      });

      it("handles_whitespace_around_range_parts", () => {
        const result = parseDateRangeValue("  2026-01-01  ..  2026-12-31  ");

        expect(result).not.toBeNull();
        expect(result?.start.toISOString()).toBe("2026-01-01T00:00:00.000Z");
        expect(result?.end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
      });

      it("parses_same_start_and_end_date", () => {
        const result = parseDateRangeValue("2026-05-15..2026-05-15");

        expect(result).not.toBeNull();
        expect(result?.start.toISOString()).toBe("2026-05-15T00:00:00.000Z");
        expect(result?.end.toISOString()).toBe("2026-05-16T00:00:00.000Z");
      });

      it("parses_range_crossing_year_boundary", () => {
        const result = parseDateRangeValue("2025-12-15..2026-01-15");

        expect(result).not.toBeNull();
        expect(result?.start.toISOString()).toBe("2025-12-15T00:00:00.000Z");
        expect(result?.end.toISOString()).toBe("2026-01-16T00:00:00.000Z");
      });

      it("parses_range_including_leap_year_february", () => {
        const result = parseDateRangeValue("2028-02-28..2028-03-01");

        expect(result).not.toBeNull();
        expect(result?.start.toISOString()).toBe("2028-02-28T00:00:00.000Z");
        expect(result?.end.toISOString()).toBe("2028-03-02T00:00:00.000Z");
      });

      it("parses_range_with_datetime_at_exact_boundaries", () => {
        const result = parseDateRangeValue("2026-01-01T00:00..2026-01-01T23:59");

        expect(result).not.toBeNull();
        expect(result?.start.toISOString()).toBe("2026-01-01T00:00:00.000Z");
        expect(result?.end.toISOString()).toBe("2026-01-01T23:59:00.000Z");
      });

      it("returns_null_for_range_with_only_start", () => {
        expect(parseDateRangeValue("2026-01-01..")).toBeNull();
      });

      it("returns_null_for_range_with_only_end", () => {
        expect(parseDateRangeValue("..2026-12-31")).toBeNull();
      });

      it("returns_null_for_whitespace_only_input", () => {
        expect(parseDateRangeValue("   ")).toBeNull();
      });
    });

    describe("preset label parsing", () => {
      beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-03-15T12:00:00.000Z"));
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it("parses_today_preset_label", () => {
        const result = parseDateRangeValue("today");

        expect(result).not.toBeNull();
        expect(result?.start.toISOString()).toBe("2026-03-15T00:00:00.000Z");
        expect(result?.end.toISOString()).toBe("2026-03-16T00:00:00.000Z");
      });

      it("parses_last_7_days_preset_label", () => {
        const result = parseDateRangeValue("last 7 days");

        expect(result).not.toBeNull();
        expect(result?.start.toISOString()).toBe("2026-03-08T00:00:00.000Z");
        expect(result?.end.toISOString()).toBe("2026-03-16T00:00:00.000Z");
      });

      it("parses_last_30_days_preset_label", () => {
        const result = parseDateRangeValue("last 30 days");

        expect(result).not.toBeNull();
        expect(result?.start.toISOString()).toBe("2026-02-13T00:00:00.000Z");
        expect(result?.end.toISOString()).toBe("2026-03-16T00:00:00.000Z");
      });

      it("parses_preset_label_case_insensitively", () => {
        const result = parseDateRangeValue("LAST 7 DAYS");

        expect(result).not.toBeNull();
        expect(result?.start.toISOString()).toBe("2026-03-08T00:00:00.000Z");
      });

      it("parses_preset_label_with_mixed_case", () => {
        const result = parseDateRangeValue("Today");

        expect(result).not.toBeNull();
        expect(result?.start.toISOString()).toBe("2026-03-15T00:00:00.000Z");
      });

      it("parses_last_90_days_preset_label", () => {
        const result = parseDateRangeValue("last 90 days");

        expect(result).not.toBeNull();
        expect(result?.start.toISOString()).toBe("2025-12-15T00:00:00.000Z");
        expect(result?.end.toISOString()).toBe("2026-03-16T00:00:00.000Z");
      });

      it("parses_last_365_days_preset_label", () => {
        const result = parseDateRangeValue("last 365 days");

        expect(result).not.toBeNull();
        expect(result?.start.toISOString()).toBe("2025-03-15T00:00:00.000Z");
        expect(result?.end.toISOString()).toBe("2026-03-16T00:00:00.000Z");
      });

      it("returns_null_for_unknown_preset_label", () => {
        expect(parseDateRangeValue("last week")).toBeNull();
      });

      it("returns_null_for_preset_with_extra_whitespace", () => {
        expect(parseDateRangeValue("last  7  days")).toBeNull();
      });

      it("parses_today_at_year_boundary", () => {
        vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
        const result = parseDateRangeValue("today");

        expect(result).not.toBeNull();
        expect(result?.start.toISOString()).toBe("2026-01-01T00:00:00.000Z");
        expect(result?.end.toISOString()).toBe("2026-01-02T00:00:00.000Z");
      });

      it("parses_last_7_days_crossing_into_previous_year", () => {
        vi.setSystemTime(new Date("2026-01-05T12:00:00.000Z"));
        const result = parseDateRangeValue("last 7 days");

        expect(result).not.toBeNull();
        expect(result?.start.toISOString()).toBe("2025-12-29T00:00:00.000Z");
        expect(result?.end.toISOString()).toBe("2026-01-06T00:00:00.000Z");
      });
    });
  });
});
