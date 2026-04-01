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

describe("date-range-utils", () => {
  describe("parseDateRangeValue", () => {
    describe("empty or null input", () => {
      it("returns_null_when_value_is_empty_string", () => {
        const result = parseDateRangeValue("");
        expect(result).toBeNull();
      });
    });

    describe("single date parsing", () => {
      it("parses_single_date_as_full_utc_day_with_end_at_next_midnight", () => {
        const result = parseDateRangeValue("2024-06-15");

        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-06-15T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2024-06-16T00:00:00.000Z");
      });

      it("parses_datetime_as_full_minute_with_end_one_minute_later", () => {
        const result = parseDateRangeValue("2024-06-15T14:30");

        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-06-15T14:30:00.000Z");
        expect(result!.end.toISOString()).toBe("2024-06-15T14:31:00.000Z");
      });

      it("returns_null_for_invalid_date_format", () => {
        const result = parseDateRangeValue("not-a-date");
        expect(result).toBeNull();
      });

      it("returns_null_for_partial_date_format", () => {
        const result = parseDateRangeValue("2024-06");
        expect(result).toBeNull();
      });
    });

    describe("ISO range string parsing", () => {
      it("parses_date_range_with_end_extended_to_next_midnight", () => {
        const result = parseDateRangeValue("2024-01-01..2024-01-31");

        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-01-01T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2024-02-01T00:00:00.000Z");
      });

      it("parses_datetime_range_with_exact_end_time", () => {
        const result = parseDateRangeValue("2024-01-01T08:00..2024-01-01T17:00");

        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-01-01T08:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2024-01-01T17:00:00.000Z");
      });

      it("returns_null_when_start_date_is_after_end_date", () => {
        const result = parseDateRangeValue("2024-12-31..2024-01-01");
        expect(result).toBeNull();
      });

      it("returns_null_when_range_has_invalid_start_date", () => {
        const result = parseDateRangeValue("invalid..2024-01-31");
        expect(result).toBeNull();
      });

      it("returns_null_when_range_has_invalid_end_date", () => {
        const result = parseDateRangeValue("2024-01-01..invalid");
        expect(result).toBeNull();
      });

      it("returns_null_when_range_has_more_than_two_parts", () => {
        const result = parseDateRangeValue("2024-01-01..2024-06-15..2024-12-31");
        expect(result).toBeNull();
      });

      it("handles_whitespace_around_range_parts", () => {
        const result = parseDateRangeValue("2024-01-01 .. 2024-01-31");

        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-01-01T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2024-02-01T00:00:00.000Z");
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

      it("parses_today_preset_as_single_day", () => {
        const result = parseDateRangeValue("today");

        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-06-15T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2024-06-16T00:00:00.000Z");
      });

      it("parses_last_7_days_preset_as_range", () => {
        const result = parseDateRangeValue("last 7 days");

        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-06-08T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2024-06-16T00:00:00.000Z");
      });

      it("parses_last_30_days_preset_as_range", () => {
        const result = parseDateRangeValue("last 30 days");

        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-05-16T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2024-06-16T00:00:00.000Z");
      });

      it("parses_last_90_days_preset_as_range", () => {
        const result = parseDateRangeValue("last 90 days");

        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-03-17T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2024-06-16T00:00:00.000Z");
      });

      it("parses_last_365_days_preset_as_range", () => {
        const result = parseDateRangeValue("last 365 days");

        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2023-06-16T00:00:00.000Z");
        expect(result!.end.toISOString()).toBe("2024-06-16T00:00:00.000Z");
      });

      it("parses_preset_label_case_insensitively", () => {
        const result = parseDateRangeValue("TODAY");

        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-06-15T00:00:00.000Z");
      });

      it("parses_preset_label_with_mixed_case", () => {
        const result = parseDateRangeValue("Last 7 Days");

        expect(result).not.toBeNull();
        expect(result!.start.toISOString()).toBe("2024-06-08T00:00:00.000Z");
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

    it("today_preset_returns_current_date_string", () => {
      const todayPreset = DATE_RANGE_PRESETS.find((p) => p.label === "today");

      expect(todayPreset).toBeDefined();
      expect(todayPreset!.getValue()).toBe("2024-06-15");
    });

    it("last_7_days_preset_returns_range_string", () => {
      const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 7 days");

      expect(preset).toBeDefined();
      expect(preset!.getValue()).toBe("2024-06-08..2024-06-15");
    });

    it("last_30_days_preset_returns_range_string", () => {
      const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 30 days");

      expect(preset).toBeDefined();
      expect(preset!.getValue()).toBe("2024-05-16..2024-06-15");
    });

    it("last_90_days_preset_returns_range_string", () => {
      const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 90 days");

      expect(preset).toBeDefined();
      expect(preset!.getValue()).toBe("2024-03-17..2024-06-15");
    });

    it("last_365_days_preset_returns_range_string", () => {
      const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 365 days");

      expect(preset).toBeDefined();
      expect(preset!.getValue()).toBe("2023-06-16..2024-06-15");
    });

    it("contains_exactly_five_presets", () => {
      expect(DATE_RANGE_PRESETS).toHaveLength(5);
    });
  });

  describe("edge cases", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("handles_year_boundary_correctly_for_daysAgo", () => {
      vi.setSystemTime(new Date("2024-01-05T12:00:00.000Z"));

      const result = parseDateRangeValue("last 7 days");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2023-12-29T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-01-06T00:00:00.000Z");
    });

    it("handles_month_boundary_correctly_for_daysAgo", () => {
      vi.setSystemTime(new Date("2024-03-02T12:00:00.000Z"));

      const result = parseDateRangeValue("last 7 days");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-02-24T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-03-03T00:00:00.000Z");
    });

    it("parses_same_start_and_end_date_as_valid_range", () => {
      const result = parseDateRangeValue("2024-06-15..2024-06-15");

      expect(result).not.toBeNull();
      expect(result!.start.toISOString()).toBe("2024-06-15T00:00:00.000Z");
      expect(result!.end.toISOString()).toBe("2024-06-16T00:00:00.000Z");
    });

    it("returns_null_for_invalid_iso_date_that_matches_format", () => {
      const result = parseDateRangeValue("2024-13-45");
      expect(result).toBeNull();
    });

    it("returns_null_for_invalid_iso_datetime_that_matches_format", () => {
      const result = parseDateRangeValue("2024-06-15T25:99");
      expect(result).toBeNull();
    });
  });
});
