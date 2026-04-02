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
  describe("returns null for invalid input", () => {
    it("returns_null_for_empty_string", () => {
      const result = parseDateRangeValue("");
      expect(result).toBeNull();
    });

    it("returns_null_for_invalid_date_format", () => {
      const result = parseDateRangeValue("not-a-date");
      expect(result).toBeNull();
    });

    it("returns_null_for_partial_date", () => {
      const result = parseDateRangeValue("2024-01");
      expect(result).toBeNull();
    });

    it("returns_null_for_invalid_iso_date", () => {
      const result = parseDateRangeValue("2024-99-99");
      expect(result).toBeNull();
    });

    it("returns_null_for_whitespace_only_input", () => {
      const result = parseDateRangeValue("   ");
      expect(result).toBeNull();
    });

    it("returns_null_for_month_zero", () => {
      const result = parseDateRangeValue("2024-00-15");
      expect(result).toBeNull();
    });

    it("returns_null_for_month_thirteen", () => {
      const result = parseDateRangeValue("2024-13-15");
      expect(result).toBeNull();
    });

    it("returns_null_for_day_zero", () => {
      const result = parseDateRangeValue("2024-06-00");
      expect(result).toBeNull();
    });

    it("returns_null_for_day_thirty_two", () => {
      const result = parseDateRangeValue("2024-06-32");
      expect(result).toBeNull();
    });

    it("rolls_over_february_thirty_to_march_first", () => {
      // JavaScript Date is lenient and rolls over invalid day-of-month values
      // "2024-02-30" becomes "2024-03-01" (Feb has 29 days in 2024, so +1 day = Mar 1)
      const result = parseDateRangeValue("2024-02-30");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-03-01T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-03-02T00:00:00.000Z");
    });

    it("rolls_over_february_29_in_non_leap_year_to_march_first", () => {
      // JavaScript Date is lenient: 2023-02-29 becomes 2023-03-01
      const result = parseDateRangeValue("2023-02-29");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2023-03-01T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2023-03-02T00:00:00.000Z");
    });

    it("rolls_over_hour_24_to_next_day_midnight", () => {
      // JavaScript Date is lenient: T24:00 becomes next day T00:00
      const result = parseDateRangeValue("2024-06-15T24:00");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-06-16T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-06-16T00:01:00.000Z");
    });

    it("returns_null_for_minute_sixty", () => {
      // Unlike dates, JavaScript Date rejects invalid minutes (60+)
      const result = parseDateRangeValue("2024-06-15T14:60");
      expect(result).toBeNull();
    });

    it("returns_null_for_single_dot_separator", () => {
      const result = parseDateRangeValue("2024-01-01.2024-01-31");
      expect(result).toBeNull();
    });

    it("returns_null_for_date_with_trailing_characters", () => {
      const result = parseDateRangeValue("2024-06-15extra");
      expect(result).toBeNull();
    });

    it("returns_null_for_datetime_with_seconds", () => {
      const result = parseDateRangeValue("2024-06-15T14:30:00");
      expect(result).toBeNull();
    });
  });

  describe("parses single ISO date strings", () => {
    it("parses_date_only_as_full_utc_day", () => {
      const result = parseDateRangeValue("2024-06-15");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-06-15T00:00:00.000Z");
      // End is advanced to next midnight for exclusive upper bound
      expect(result!.end.toISOString()).toBe("2024-06-16T00:00:00.000Z");
    });

    it("parses_datetime_as_full_minute", () => {
      const result = parseDateRangeValue("2024-06-15T14:30");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-06-15T14:30:00.000Z");
      // End is advanced by 1 minute
      expect(result!.end.toISOString()).toBe("2024-06-15T14:31:00.000Z");
    });

    it("parses_midnight_datetime_correctly", () => {
      const result = parseDateRangeValue("2024-01-01T00:00");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-01-01T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-01-01T00:01:00.000Z");
    });

    it("parses_leap_year_february_29", () => {
      const result = parseDateRangeValue("2024-02-29");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-02-29T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-03-01T00:00:00.000Z");
    });

    it("parses_end_of_year_date_with_rollover", () => {
      const result = parseDateRangeValue("2024-12-31");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-12-31T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2025-01-01T00:00:00.000Z");
    });

    it("parses_end_of_month_date_with_rollover", () => {
      const result = parseDateRangeValue("2024-01-31");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-01-31T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-02-01T00:00:00.000Z");
    });

    it("parses_datetime_at_2359_with_minute_rollover", () => {
      const result = parseDateRangeValue("2024-06-15T23:59");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-06-15T23:59:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-06-16T00:00:00.000Z");
    });

    it("parses_end_of_year_datetime_with_rollover", () => {
      const result = parseDateRangeValue("2024-12-31T23:59");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-12-31T23:59:00.000Z");
      expect(result!.end.toISOString()).toBe("2025-01-01T00:00:00.000Z");
    });

    it("parses_february_28_in_non_leap_year", () => {
      const result = parseDateRangeValue("2023-02-28");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2023-02-28T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2023-03-01T00:00:00.000Z");
    });
  });

  describe("parses ISO range strings", () => {
    it("parses_date_only_range_with_inclusive_end", () => {
      const result = parseDateRangeValue("2024-01-01..2024-01-31");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-01-01T00:00:00.000Z");
      // End date is advanced to next midnight for inclusive behavior
      expect(result!.end.toISOString()).toBe("2024-02-01T00:00:00.000Z");
    });

    it("parses_datetime_range_with_explicit_end", () => {
      const result = parseDateRangeValue("2024-01-01T09:00..2024-01-01T17:00");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-01-01T09:00:00.000Z");
      // Datetime end is used as-is (explicit cutoff)
      expect(result!.end.toISOString()).toBe("2024-01-01T17:00:00.000Z");
    });

    it("parses_mixed_date_and_datetime_range", () => {
      const result = parseDateRangeValue("2024-01-01..2024-01-15T12:00");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-01-01T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-01-15T12:00:00.000Z");
    });

    it("returns_null_for_range_with_invalid_start", () => {
      const result = parseDateRangeValue("invalid..2024-01-31");
      expect(result).toBeNull();
    });

    it("returns_null_for_range_with_invalid_end", () => {
      const result = parseDateRangeValue("2024-01-01..invalid");
      expect(result).toBeNull();
    });

    it("returns_null_when_start_is_after_end", () => {
      const result = parseDateRangeValue("2024-12-31..2024-01-01");
      expect(result).toBeNull();
    });

    it("parses_same_day_range", () => {
      const result = parseDateRangeValue("2024-06-15..2024-06-15");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-06-15T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-06-16T00:00:00.000Z");
    });

    it("handles_whitespace_around_range_parts", () => {
      const result = parseDateRangeValue("  2024-01-01  ..  2024-01-31  ");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-01-01T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-02-01T00:00:00.000Z");
    });

    it("returns_null_for_malformed_range_with_multiple_separators", () => {
      const result = parseDateRangeValue("2024-01-01..2024-06-15..2024-12-31");
      expect(result).toBeNull();
    });

    it("returns_null_when_datetime_start_is_after_datetime_end", () => {
      const result = parseDateRangeValue("2024-06-15T18:00..2024-06-15T09:00");
      expect(result).toBeNull();
    });

    it("returns_null_for_range_with_empty_start", () => {
      const result = parseDateRangeValue("..2024-01-31");
      expect(result).toBeNull();
    });

    it("returns_null_for_range_with_empty_end", () => {
      const result = parseDateRangeValue("2024-01-01..");
      expect(result).toBeNull();
    });

    it("parses_year_boundary_crossing_range", () => {
      const result = parseDateRangeValue("2024-12-31..2025-01-01");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-12-31T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2025-01-02T00:00:00.000Z");
    });

    it("parses_leap_year_boundary_range", () => {
      const result = parseDateRangeValue("2024-02-28..2024-03-01");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-02-28T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-03-02T00:00:00.000Z");
    });

    it("parses_datetime_start_with_date_end", () => {
      const result = parseDateRangeValue("2024-01-01T09:00..2024-01-15");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-01-01T09:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-01-16T00:00:00.000Z");
    });

    it("parses_same_datetime_range", () => {
      const result = parseDateRangeValue("2024-06-15T12:00..2024-06-15T12:00");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-06-15T12:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-06-15T12:00:00.000Z");
    });

    it("returns_null_for_range_with_only_separators", () => {
      const result = parseDateRangeValue("..");
      expect(result).toBeNull();
    });

    it("handles_tabs_and_spaces_around_range_parts", () => {
      const result = parseDateRangeValue("\t2024-01-01\t..\t2024-01-31\t");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-01-01T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-02-01T00:00:00.000Z");
    });
  });

  describe("parses preset labels", () => {
    const fixedDate = new Date("2024-06-15T12:00:00.000Z");

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(fixedDate);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("parses_today_preset", () => {
      const result = parseDateRangeValue("today");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-06-15T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-06-16T00:00:00.000Z");
    });

    it("parses_today_preset_case_insensitive", () => {
      const result = parseDateRangeValue("TODAY");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-06-15T00:00:00.000Z");
    });

    it("parses_last_7_days_preset", () => {
      const result = parseDateRangeValue("last 7 days");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-06-08T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-06-16T00:00:00.000Z");
    });

    it("parses_last_7_days_preset_case_insensitive", () => {
      const result = parseDateRangeValue("Last 7 days");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-06-08T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-06-16T00:00:00.000Z");
    });

    it("parses_last_30_days_preset", () => {
      const result = parseDateRangeValue("last 30 days");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-05-16T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-06-16T00:00:00.000Z");
    });

    it("parses_last_90_days_preset", () => {
      const result = parseDateRangeValue("last 90 days");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-03-17T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-06-16T00:00:00.000Z");
    });

    it("parses_last_365_days_preset", () => {
      const result = parseDateRangeValue("last 365 days");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2023-06-16T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-06-16T00:00:00.000Z");
    });

    it("returns_null_for_unknown_preset", () => {
      const result = parseDateRangeValue("last 14 days");
      expect(result).toBeNull();
    });

    it("parses_today_preset_with_leading_whitespace", () => {
      const result = parseDateRangeValue("  today");
      expect(result).toBeNull();
    });

    it("parses_today_preset_with_trailing_whitespace", () => {
      const result = parseDateRangeValue("today  ");
      expect(result).toBeNull();
    });

    it("parses_preset_with_all_uppercase", () => {
      const result = parseDateRangeValue("LAST 7 DAYS");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-06-08T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-06-16T00:00:00.000Z");
    });

    it("parses_preset_with_mixed_case", () => {
      const result = parseDateRangeValue("LaSt 30 DaYs");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-05-16T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-06-16T00:00:00.000Z");
    });

    it("returns_null_for_similar_but_invalid_preset", () => {
      const result = parseDateRangeValue("last7days");
      expect(result).toBeNull();
    });

    it("returns_null_for_preset_with_extra_spaces", () => {
      const result = parseDateRangeValue("last  7  days");
      expect(result).toBeNull();
    });
  });

  describe("DATE_RANGE_PRESETS at year boundary", () => {
    const yearEndDate = new Date("2024-01-05T12:00:00.000Z");

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(yearEndDate);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("last_7_days_preset_crosses_year_boundary", () => {
      const result = parseDateRangeValue("last 7 days");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2023-12-29T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-01-06T00:00:00.000Z");
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

    it("contains_five_presets", () => {
      expect(DATE_RANGE_PRESETS).toHaveLength(5);
    });

    it("today_preset_returns_single_date", () => {
      const todayPreset = DATE_RANGE_PRESETS.find((p) => p.label === "today");
      expect(todayPreset).toBeDefined();
      expect(todayPreset!.getValue()).toBe("2024-06-15");
    });

    it("last_7_days_preset_returns_range", () => {
      const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 7 days");
      expect(preset).toBeDefined();
      expect(preset!.getValue()).toBe("2024-06-08..2024-06-15");
    });

    it("last_30_days_preset_returns_range", () => {
      const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 30 days");
      expect(preset).toBeDefined();
      expect(preset!.getValue()).toBe("2024-05-16..2024-06-15");
    });

    it("last_90_days_preset_returns_range", () => {
      const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 90 days");
      expect(preset).toBeDefined();
      expect(preset!.getValue()).toBe("2024-03-17..2024-06-15");
    });

    it("last_365_days_preset_returns_range", () => {
      const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 365 days");
      expect(preset).toBeDefined();
      expect(preset!.getValue()).toBe("2023-06-16..2024-06-15");
    });

    it("all_presets_have_label_and_getValue", () => {
      for (const preset of DATE_RANGE_PRESETS) {
        expect(typeof preset.label).toBe("string");
        expect(preset.label.length).toBeGreaterThan(0);
        expect(typeof preset.getValue).toBe("function");
        expect(typeof preset.getValue()).toBe("string");
      }
    });
  });
});
