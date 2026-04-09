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
  beforeEach(() => {
    // Mock Date to 2026-03-15T12:30:00.000Z for deterministic tests
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T12:30:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("parseDateRangeValue", () => {
    describe("empty and invalid inputs", () => {
      it("should return null for empty string", () => {
        const result = parseDateRangeValue("");

        expect(result).toBeNull();
      });

      it("should return null for invalid format", () => {
        const result = parseDateRangeValue("not-a-date");

        expect(result).toBeNull();
      });

      it("should return null for malformed date string", () => {
        const result = parseDateRangeValue("2026-13-45");

        expect(result).toBeNull();
      });
    });

    describe("single date parsing", () => {
      it("should parse single ISO date as full UTC day", () => {
        const result = parseDateRangeValue("2026-02-20");

        expect(result).not.toBeNull();
        expect(result!.start).toEqual(new Date("2026-02-20T00:00:00.000Z"));
        expect(result!.end).toEqual(new Date("2026-02-21T00:00:00.000Z"));
      });

      it("should parse datetime as full minute range", () => {
        const result = parseDateRangeValue("2026-02-20T14:30");

        expect(result).not.toBeNull();
        expect(result!.start).toEqual(new Date("2026-02-20T14:30:00.000Z"));
        expect(result!.end).toEqual(new Date("2026-02-20T14:31:00.000Z"));
      });

      it("should return null for invalid single date", () => {
        const result = parseDateRangeValue("2026-99-99");

        expect(result).toBeNull();
      });
    });

    describe("ISO range string parsing", () => {
      it("should parse date-only range with inclusive end", () => {
        const result = parseDateRangeValue("2026-01-01..2026-01-31");

        expect(result).not.toBeNull();
        expect(result!.start).toEqual(new Date("2026-01-01T00:00:00.000Z"));
        expect(result!.end).toEqual(new Date("2026-02-01T00:00:00.000Z"));
      });

      it("should parse datetime range preserving exact times", () => {
        const result = parseDateRangeValue("2026-01-01T09:00..2026-01-01T17:00");

        expect(result).not.toBeNull();
        expect(result!.start).toEqual(new Date("2026-01-01T09:00:00.000Z"));
        expect(result!.end).toEqual(new Date("2026-01-01T17:00:00.000Z"));
      });

      it("should return null when start is after end", () => {
        const result = parseDateRangeValue("2026-12-31..2026-01-01");

        expect(result).toBeNull();
      });

      it("should return null for malformed range with too many parts", () => {
        const result = parseDateRangeValue("2026-01-01..2026-01-15..2026-01-31");

        expect(result).toBeNull();
      });

      it("should return null when start date is invalid", () => {
        const result = parseDateRangeValue("invalid..2026-01-31");

        expect(result).toBeNull();
      });

      it("should return null when end date is invalid", () => {
        const result = parseDateRangeValue("2026-01-01..invalid");

        expect(result).toBeNull();
      });

      it("should handle whitespace around range parts", () => {
        const result = parseDateRangeValue("2026-01-01 .. 2026-01-31");

        expect(result).not.toBeNull();
        expect(result!.start).toEqual(new Date("2026-01-01T00:00:00.000Z"));
        expect(result!.end).toEqual(new Date("2026-02-01T00:00:00.000Z"));
      });
    });

    describe("preset label parsing", () => {
      it("should parse 'today' preset", () => {
        const result = parseDateRangeValue("today");

        expect(result).not.toBeNull();
        expect(result!.start).toEqual(new Date("2026-03-15T00:00:00.000Z"));
        expect(result!.end).toEqual(new Date("2026-03-16T00:00:00.000Z"));
      });

      it("should parse 'last 7 days' preset", () => {
        const result = parseDateRangeValue("last 7 days");

        expect(result).not.toBeNull();
        expect(result!.start).toEqual(new Date("2026-03-08T00:00:00.000Z"));
        expect(result!.end).toEqual(new Date("2026-03-16T00:00:00.000Z"));
      });

      it("should parse 'last 30 days' preset", () => {
        const result = parseDateRangeValue("last 30 days");

        expect(result).not.toBeNull();
        expect(result!.start).toEqual(new Date("2026-02-13T00:00:00.000Z"));
        expect(result!.end).toEqual(new Date("2026-03-16T00:00:00.000Z"));
      });

      it("should parse 'last 90 days' preset", () => {
        const result = parseDateRangeValue("last 90 days");

        expect(result).not.toBeNull();
        expect(result!.start).toEqual(new Date("2025-12-15T00:00:00.000Z"));
        expect(result!.end).toEqual(new Date("2026-03-16T00:00:00.000Z"));
      });

      it("should parse 'last 365 days' preset", () => {
        const result = parseDateRangeValue("last 365 days");

        expect(result).not.toBeNull();
        expect(result!.start).toEqual(new Date("2025-03-15T00:00:00.000Z"));
        expect(result!.end).toEqual(new Date("2026-03-16T00:00:00.000Z"));
      });

      it("should be case insensitive for preset labels", () => {
        const result = parseDateRangeValue("TODAY");

        expect(result).not.toBeNull();
        expect(result!.start).toEqual(new Date("2026-03-15T00:00:00.000Z"));
      });

      it("should return null for unknown preset", () => {
        const result = parseDateRangeValue("last 10 days");

        expect(result).toBeNull();
      });
    });
  });

  describe("DATE_RANGE_PRESETS", () => {
    it("should have 5 presets", () => {
      expect(DATE_RANGE_PRESETS).toHaveLength(5);
    });

    it("should have 'today' preset that returns single date", () => {
      const preset = DATE_RANGE_PRESETS.find((p) => p.label === "today");

      expect(preset).toBeDefined();
      expect(preset!.getValue()).toBe("2026-03-15");
    });

    it("should have 'last 7 days' preset that returns range", () => {
      const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 7 days");

      expect(preset).toBeDefined();
      expect(preset!.getValue()).toBe("2026-03-08..2026-03-15");
    });

    it("should have 'last 30 days' preset that returns range", () => {
      const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 30 days");

      expect(preset).toBeDefined();
      expect(preset!.getValue()).toBe("2026-02-13..2026-03-15");
    });

    it("should have 'last 90 days' preset that returns range", () => {
      const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 90 days");

      expect(preset).toBeDefined();
      expect(preset!.getValue()).toBe("2025-12-15..2026-03-15");
    });

    it("should have 'last 365 days' preset that returns range", () => {
      const preset = DATE_RANGE_PRESETS.find((p) => p.label === "last 365 days");

      expect(preset).toBeDefined();
      expect(preset!.getValue()).toBe("2025-03-15..2026-03-15");
    });
  });
});
