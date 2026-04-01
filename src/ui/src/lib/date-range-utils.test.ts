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
    describe("empty and null input handling", () => {
      it("returns_null_when_value_is_empty_string", () => {
        const result = parseDateRangeValue("");
        expect(result).toBeNull();
      });
    });

    describe("ISO range string parsing", () => {
      it("parses_valid_date_range_string_with_date_only_format", () => {
        const result = parseDateRangeValue("2024-01-01..2024-01-31");

        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-01-01T00:00:00.000Z");
        // End date is advanced to next midnight for inclusive behavior
        expect(result!.end.toISOString()).toBe("2024-02-01T00:00:00.000Z");
      });

      it("parses_valid_datetime_range_string", () => {
        const result = parseDateRangeValue("2024-01-01T10:30..2024-01-31T18:45");

        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-01-01T10:30:00.000Z");
        // Datetime end is used as-is (explicit cutoff)
        expect(result!.end.toISOString()).toBe("2024-01-31T18:45:00.000Z");
      });

      it("returns_null_when_range_has_invalid_number_of_parts", () => {
        const result = parseDateRangeValue("2024-01-01..2024-01-15..2024-01-31");
        expect(result).toBeNull();
      });

      it("returns_null_when_start_date_is_invalid", () => {
        const result = parseDateRangeValue("invalid..2024-01-31");
        expect(result).toBeNull();
      });

      it("returns_null_when_end_date_is_invalid", () => {
        const result = parseDateRangeValue("2024-01-01..invalid");
        expect(result).toBeNull();
      });

      it("returns_null_when_start_date_is_after_end_date", () => {
        const result = parseDateRangeValue("2024-12-31..2024-01-01");
        expect(result).toBeNull();
      });

      it("parses_range_with_datetime_end_preserving_exact_time", () => {
        const result = parseDateRangeValue("2024-01-01..2024-01-31T23:59");

        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-01-01T00:00:00.000Z");
        // Datetime end is preserved exactly (not advanced to next day)
        expect(result!.end.toISOString()).toBe("2024-01-31T23:59:00.000Z");
      });
    });

    describe("single date parsing", () => {
      it("parses_single_date_as_full_utc_day", () => {
        const result = parseDateRangeValue("2024-06-15");

        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-06-15T00:00:00.000Z");
        // End is next midnight for full day coverage
        expect(result!.end.toISOString()).toBe("2024-06-16T00:00:00.000Z");
      });

      it("parses_single_datetime_as_full_minute", () => {
        const result = parseDateRangeValue("2024-06-15T14:30");

        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-06-15T14:30:00.000Z");
        // End is 1 minute later
        expect(result!.end.toISOString()).toBe("2024-06-15T14:31:00.000Z");
      });

      it("returns_null_for_invalid_single_date_format", () => {
        const result = parseDateRangeValue("2024/06/15");
        expect(result).toBeNull();
      });

      it("returns_null_for_completely_invalid_date_string", () => {
        const result = parseDateRangeValue("not-a-date");
        expect(result).toBeNull();
      });

      it("returns_null_for_partial_datetime_format", () => {
        const result = parseDateRangeValue("2024-06-15T14");
        expect(result).toBeNull();
      });
    });

    describe("preset label parsing", () => {
      beforeEach(() => {
        // Mock Date to ensure deterministic tests
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2024-06-15T12:00:00.000Z"));
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it("parses_today_preset_label", () => {
        const result = parseDateRangeValue("today");

        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-06-15T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2024-06-16T00:00:00.000Z");
      });

      it("parses_last_7_days_preset_label", () => {
        const result = parseDateRangeValue("last 7 days");

        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-06-08T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2024-06-16T00:00:00.000Z");
      });

      it("parses_last_30_days_preset_label", () => {
        const result = parseDateRangeValue("last 30 days");

        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-05-16T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2024-06-16T00:00:00.000Z");
      });

      it("parses_last_90_days_preset_label", () => {
        const result = parseDateRangeValue("last 90 days");

        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-03-17T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2024-06-16T00:00:00.000Z");
      });

      it("parses_last_365_days_preset_label", () => {
        const result = parseDateRangeValue("last 365 days");

        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2023-06-16T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2024-06-16T00:00:00.000Z");
      });

      it("parses_preset_label_case_insensitively", () => {
        const result = parseDateRangeValue("LAST 7 DAYS");

        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-06-08T00:00:00.000Z");
      });

      it("returns_null_for_unknown_preset_label", () => {
        const result = parseDateRangeValue("unknown preset");
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

    it("today_preset_returns_current_date", () => {
      const todayPreset = DATE_RANGE_PRESETS.find((p) => p.label === "today");

      expect(todayPreset).toBeDefined();
      expect(todayPreset!.getValue()).toBe("2024-06-15");
    });

    it("last_7_days_preset_returns_correct_range", () => {
      const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 7 days");

      expect(preset).toBeDefined();
      expect(preset!.getValue()).toBe("2024-06-08..2024-06-15");
    });

    it("last_30_days_preset_returns_correct_range", () => {
      const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 30 days");

      expect(preset).toBeDefined();
      expect(preset!.getValue()).toBe("2024-05-16..2024-06-15");
    });

    it("last_90_days_preset_returns_correct_range", () => {
      const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 90 days");

      expect(preset).toBeDefined();
      expect(preset!.getValue()).toBe("2024-03-17..2024-06-15");
    });

    it("last_365_days_preset_returns_correct_range", () => {
      const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 365 days");

      expect(preset).toBeDefined();
      expect(preset!.getValue()).toBe("2023-06-16..2024-06-15");
    });

    it("contains_five_presets", () => {
      expect(DATE_RANGE_PRESETS).toHaveLength(5);
    });
  });

  describe("edge cases", () => {
    it("handles_whitespace_in_range_string", () => {
      const result = parseDateRangeValue("2024-01-01 .. 2024-01-31");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-01-01T00:00:00.000Z");
    });

    it("handles_same_start_and_end_date", () => {
      const result = parseDateRangeValue("2024-06-15..2024-06-15");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-06-15T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-06-16T00:00:00.000Z");
    });

    it("handles_year_boundary_crossing", () => {
      const result = parseDateRangeValue("2023-12-25..2024-01-05");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2023-12-25T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-01-06T00:00:00.000Z");
    });

    it("handles_leap_year_date", () => {
      const result = parseDateRangeValue("2024-02-29");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-02-29T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-03-01T00:00:00.000Z");
    });

    it("handles_mixed_date_and_datetime_in_range", () => {
      const result = parseDateRangeValue("2024-01-01T08:00..2024-01-31");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-01-01T08:00:00.000Z");
      // Date-only end gets advanced to next midnight
      expect(result!.end.toISOString()).toBe("2024-02-01T00:00:00.000Z");
    });

    it("handles_datetime_at_midnight", () => {
      const result = parseDateRangeValue("2024-06-15T00:00");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-06-15T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-06-15T00:01:00.000Z");
    });

    it("handles_datetime_at_end_of_day", () => {
      const result = parseDateRangeValue("2024-06-15T23:59");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-06-15T23:59:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-06-16T00:00:00.000Z");
    });
  });
});
