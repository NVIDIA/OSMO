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

import { describe, it, expect } from "vitest";

import {
  MONTHS_SHORT,
  formatDateTimeFull,
  formatDateTimeFullUTC,
  formatDateTimeSuccinct,
  formatTimeShort,
  formatDateShort,
  formatDateISO,
  formatTime24,
  formatTime24UTC,
  formatDateTimeSuccinctWithSeconds,
  formatTime24WithMs,
  formatTime24Short,
  formatTime24ShortUTC,
  formatDuration,
  isSameDay,
  formatDateTimeRelative,
} from "@/lib/format-date";

describe("MONTHS_SHORT", () => {
  it("should contain all 12 months in correct order", () => {
    expect(MONTHS_SHORT).toHaveLength(12);
    expect(MONTHS_SHORT[0]).toBe("Jan");
    expect(MONTHS_SHORT[5]).toBe("Jun");
    expect(MONTHS_SHORT[11]).toBe("Dec");
  });
});

describe("formatDateTimeFull", () => {
  it("should return empty string for null input", () => {
    expect(formatDateTimeFull(null)).toBe("");
  });

  it("should return empty string for invalid date string", () => {
    expect(formatDateTimeFull("invalid-date")).toBe("");
  });

  it("should format Date object correctly in PM", () => {
    const date = new Date(2026, 0, 15, 14, 30, 45); // Jan 15, 2026, 2:30:45 PM
    expect(formatDateTimeFull(date)).toBe("Jan 15, 2026, 2:30:45 PM");
  });

  it("should format Date object correctly in AM", () => {
    const date = new Date(2026, 0, 15, 9, 5, 3); // Jan 15, 2026, 9:05:03 AM
    expect(formatDateTimeFull(date)).toBe("Jan 15, 2026, 9:05:03 AM");
  });

  it("should handle midnight correctly", () => {
    const date = new Date(2026, 5, 20, 0, 0, 0); // Jun 20, 2026, 12:00:00 AM
    expect(formatDateTimeFull(date)).toBe("Jun 20, 2026, 12:00:00 AM");
  });

  it("should handle noon correctly", () => {
    const date = new Date(2026, 11, 25, 12, 0, 0); // Dec 25, 2026, 12:00:00 PM
    expect(formatDateTimeFull(date)).toBe("Dec 25, 2026, 12:00:00 PM");
  });

  it("should format date string input correctly", () => {
    const dateString = "2026-03-10T16:45:30";
    const result = formatDateTimeFull(dateString);
    expect(result).toMatch(/Mar 10, 2026, 4:45:30 PM/);
  });
});

describe("formatDateTimeFullUTC", () => {
  it("should return empty string for null input", () => {
    expect(formatDateTimeFullUTC(null)).toBe("");
  });

  it("should return empty string for invalid date string", () => {
    expect(formatDateTimeFullUTC("not-a-date")).toBe("");
  });

  it("should format Date object in UTC with UTC suffix", () => {
    const date = new Date(Date.UTC(2026, 0, 15, 14, 30, 45));
    expect(formatDateTimeFullUTC(date)).toBe("Jan 15, 2026, 2:30:45 PM UTC");
  });

  it("should handle midnight UTC correctly", () => {
    const date = new Date(Date.UTC(2026, 6, 4, 0, 0, 0));
    expect(formatDateTimeFullUTC(date)).toBe("Jul 4, 2026, 12:00:00 AM UTC");
  });

  it("should handle noon UTC correctly", () => {
    const date = new Date(Date.UTC(2026, 8, 1, 12, 0, 0));
    expect(formatDateTimeFullUTC(date)).toBe("Sep 1, 2026, 12:00:00 PM UTC");
  });

  it("should format ISO date string input correctly", () => {
    const dateString = "2026-02-28T23:59:59.000Z";
    expect(formatDateTimeFullUTC(dateString)).toBe("Feb 28, 2026, 11:59:59 PM UTC");
  });
});

describe("formatDateTimeSuccinct", () => {
  it("should return empty string for null input", () => {
    expect(formatDateTimeSuccinct(null)).toBe("");
  });

  it("should return empty string for invalid date string", () => {
    expect(formatDateTimeSuccinct("bad-date")).toBe("");
  });

  it("should format with year when no referenceYear provided", () => {
    const date = new Date(2026, 0, 15, 14, 30);
    expect(formatDateTimeSuccinct(date)).toBe("1/15/26 2:30p");
  });

  it("should omit year when date matches referenceYear", () => {
    const date = new Date(2026, 0, 15, 14, 30);
    expect(formatDateTimeSuccinct(date, 2026)).toBe("1/15 2:30p");
  });

  it("should include year when date differs from referenceYear", () => {
    const date = new Date(2025, 0, 15, 14, 30);
    expect(formatDateTimeSuccinct(date, 2026)).toBe("1/15/25 2:30p");
  });

  it("should use lowercase a for AM times", () => {
    const date = new Date(2026, 3, 20, 9, 5);
    expect(formatDateTimeSuccinct(date, 2026)).toBe("4/20 9:05a");
  });

  it("should handle midnight correctly", () => {
    const date = new Date(2026, 11, 31, 0, 0);
    expect(formatDateTimeSuccinct(date, 2026)).toBe("12/31 12:00a");
  });

  it("should format date string input correctly", () => {
    const dateString = "2026-07-04T16:30:00";
    const result = formatDateTimeSuccinct(dateString, 2026);
    expect(result).toMatch(/7\/4 4:30p/);
  });
});

describe("formatTimeShort", () => {
  it("should return empty string for null input", () => {
    expect(formatTimeShort(null)).toBe("");
  });

  it("should return empty string for invalid date string", () => {
    expect(formatTimeShort("invalid")).toBe("");
  });

  it("should format PM time correctly", () => {
    const date = new Date(2026, 0, 1, 14, 30);
    expect(formatTimeShort(date)).toBe("2:30 PM");
  });

  it("should format AM time correctly", () => {
    const date = new Date(2026, 0, 1, 9, 5);
    expect(formatTimeShort(date)).toBe("9:05 AM");
  });

  it("should handle midnight correctly", () => {
    const date = new Date(2026, 0, 1, 0, 0);
    expect(formatTimeShort(date)).toBe("12:00 AM");
  });

  it("should handle noon correctly", () => {
    const date = new Date(2026, 0, 1, 12, 0);
    expect(formatTimeShort(date)).toBe("12:00 PM");
  });

  it("should format date string input correctly", () => {
    const dateString = "2026-01-01T23:45:00";
    const result = formatTimeShort(dateString);
    expect(result).toMatch(/11:45 PM/);
  });
});

describe("formatDateShort", () => {
  it("should return empty string for null input", () => {
    expect(formatDateShort(null)).toBe("");
  });

  it("should return empty string for invalid date string", () => {
    expect(formatDateShort("nope")).toBe("");
  });

  it("should format date without time", () => {
    const date = new Date(2026, 0, 15, 14, 30, 45);
    expect(formatDateShort(date)).toBe("Jan 15, 2026");
  });

  it("should format date string input correctly", () => {
    const dateString = "2026-12-25T00:00:00";
    const result = formatDateShort(dateString);
    expect(result).toMatch(/Dec 25, 2026/);
  });
});

describe("formatDateISO", () => {
  it("should return empty string for null input", () => {
    expect(formatDateISO(null)).toBe("");
  });

  it("should return empty string for invalid date string", () => {
    expect(formatDateISO("garbage")).toBe("");
  });

  it("should return ISO string for valid Date", () => {
    const date = new Date(Date.UTC(2026, 0, 15, 14, 30, 45, 123));
    expect(formatDateISO(date)).toBe("2026-01-15T14:30:45.123Z");
  });

  it("should parse and return ISO string for valid date string", () => {
    const dateString = "2026-06-15T10:00:00.000Z";
    expect(formatDateISO(dateString)).toBe("2026-06-15T10:00:00.000Z");
  });
});

describe("formatTime24", () => {
  it("should return empty string for null input", () => {
    expect(formatTime24(null)).toBe("");
  });

  it("should return empty string for invalid date string", () => {
    expect(formatTime24("xyz")).toBe("");
  });

  it("should format time in 24-hour format with seconds", () => {
    const date = new Date(2026, 0, 1, 14, 30, 45);
    expect(formatTime24(date)).toBe("14:30:45");
  });

  it("should pad single-digit values", () => {
    const date = new Date(2026, 0, 1, 9, 5, 3);
    expect(formatTime24(date)).toBe("09:05:03");
  });

  it("should handle midnight correctly", () => {
    const date = new Date(2026, 0, 1, 0, 0, 0);
    expect(formatTime24(date)).toBe("00:00:00");
  });

  it("should format date string input correctly", () => {
    const dateString = "2026-01-01T23:59:59";
    const result = formatTime24(dateString);
    expect(result).toMatch(/23:59:59/);
  });
});

describe("formatTime24UTC", () => {
  it("should return empty string for null input", () => {
    expect(formatTime24UTC(null)).toBe("");
  });

  it("should return empty string for invalid date string", () => {
    expect(formatTime24UTC("abc")).toBe("");
  });

  it("should format time in 24-hour UTC format", () => {
    const date = new Date(Date.UTC(2026, 0, 1, 14, 30, 45));
    expect(formatTime24UTC(date)).toBe("14:30:45");
  });

  it("should pad single-digit UTC values", () => {
    const date = new Date(Date.UTC(2026, 0, 1, 1, 2, 3));
    expect(formatTime24UTC(date)).toBe("01:02:03");
  });

  it("should format ISO date string input correctly", () => {
    const dateString = "2026-01-01T08:15:30.000Z";
    expect(formatTime24UTC(dateString)).toBe("08:15:30");
  });
});

describe("formatDateTimeSuccinctWithSeconds", () => {
  it("should return empty string for null input", () => {
    expect(formatDateTimeSuccinctWithSeconds(null)).toBe("");
  });

  it("should return empty string for invalid date string", () => {
    expect(formatDateTimeSuccinctWithSeconds("invalid")).toBe("");
  });

  it("should format with year and seconds when no referenceYear provided", () => {
    const date = new Date(2026, 0, 15, 14, 30, 45);
    expect(formatDateTimeSuccinctWithSeconds(date)).toBe("1/15/26 2:30:45p");
  });

  it("should omit year when date matches referenceYear", () => {
    const date = new Date(2026, 0, 15, 14, 30, 45);
    expect(formatDateTimeSuccinctWithSeconds(date, 2026)).toBe("1/15 2:30:45p");
  });

  it("should include year when date differs from referenceYear", () => {
    const date = new Date(2025, 0, 15, 14, 30, 45);
    expect(formatDateTimeSuccinctWithSeconds(date, 2026)).toBe("1/15/25 2:30:45p");
  });

  it("should use lowercase a for AM times", () => {
    const date = new Date(2026, 3, 20, 9, 5, 30);
    expect(formatDateTimeSuccinctWithSeconds(date, 2026)).toBe("4/20 9:05:30a");
  });

  it("should format date string input correctly", () => {
    const dateString = "2026-02-14T12:00:00";
    const result = formatDateTimeSuccinctWithSeconds(dateString, 2026);
    expect(result).toMatch(/2\/14 12:00:00p/);
  });
});

describe("formatTime24WithMs", () => {
  it("should return empty string for null input", () => {
    expect(formatTime24WithMs(null)).toBe("");
  });

  it("should return empty string for invalid date string", () => {
    expect(formatTime24WithMs("bad")).toBe("");
  });

  it("should format time with milliseconds", () => {
    const date = new Date(2026, 0, 1, 14, 30, 45, 123);
    expect(formatTime24WithMs(date)).toBe("14:30:45.123");
  });

  it("should pad milliseconds to 3 digits", () => {
    const date = new Date(2026, 0, 1, 14, 30, 45, 5);
    expect(formatTime24WithMs(date)).toBe("14:30:45.005");
  });

  it("should handle zero milliseconds", () => {
    const date = new Date(2026, 0, 1, 14, 30, 45, 0);
    expect(formatTime24WithMs(date)).toBe("14:30:45.000");
  });

  it("should format date string input correctly", () => {
    const dateString = "2026-01-01T10:20:30.456";
    const result = formatTime24WithMs(dateString);
    expect(result).toMatch(/10:20:30\.456/);
  });
});

describe("formatTime24Short", () => {
  it("should return empty string for null input", () => {
    expect(formatTime24Short(null)).toBe("");
  });

  it("should return empty string for invalid date string", () => {
    expect(formatTime24Short("nope")).toBe("");
  });

  it("should format time without seconds", () => {
    const date = new Date(2026, 0, 1, 14, 30, 45);
    expect(formatTime24Short(date)).toBe("14:30");
  });

  it("should pad single-digit values", () => {
    const date = new Date(2026, 0, 1, 9, 5, 0);
    expect(formatTime24Short(date)).toBe("09:05");
  });

  it("should format date string input correctly", () => {
    const dateString = "2026-01-01T23:45:00";
    const result = formatTime24Short(dateString);
    expect(result).toMatch(/23:45/);
  });
});

describe("formatTime24ShortUTC", () => {
  it("should return empty string for null input", () => {
    expect(formatTime24ShortUTC(null)).toBe("");
  });

  it("should return empty string for invalid date string", () => {
    expect(formatTime24ShortUTC("invalid")).toBe("");
  });

  it("should format UTC time without seconds", () => {
    const date = new Date(Date.UTC(2026, 0, 1, 14, 30, 45));
    expect(formatTime24ShortUTC(date)).toBe("14:30");
  });

  it("should pad single-digit UTC values", () => {
    const date = new Date(Date.UTC(2026, 0, 1, 1, 2, 0));
    expect(formatTime24ShortUTC(date)).toBe("01:02");
  });

  it("should format ISO date string input correctly", () => {
    const dateString = "2026-01-01T08:15:30.000Z";
    expect(formatTime24ShortUTC(dateString)).toBe("08:15");
  });
});

describe("formatDuration", () => {
  it("should return dash for null input", () => {
    expect(formatDuration(null)).toBe("-");
  });

  it("should format seconds only", () => {
    expect(formatDuration(45)).toBe("45s");
  });

  it("should format zero seconds", () => {
    expect(formatDuration(0)).toBe("0s");
  });

  it("should format minutes and seconds", () => {
    expect(formatDuration(125)).toBe("2m 5s");
  });

  it("should format minutes only when no remainder", () => {
    expect(formatDuration(120)).toBe("2m");
  });

  it("should format hours and minutes", () => {
    expect(formatDuration(3725)).toBe("1h 2m");
  });

  it("should format hours and seconds when minutes are zero", () => {
    expect(formatDuration(3629)).toBe("1h 29s");
  });

  it("should format hours only when no remainder", () => {
    expect(formatDuration(7200)).toBe("2h");
  });

  it("should format days and hours", () => {
    expect(formatDuration(90000)).toBe("1d 1h");
  });

  it("should format days and minutes when hours are zero", () => {
    expect(formatDuration(86460)).toBe("1d 1m");
  });

  it("should format days only when no remainder", () => {
    expect(formatDuration(172800)).toBe("2d");
  });

  it("should format weeks and days", () => {
    expect(formatDuration(777600)).toBe("1w 2d");
  });

  it("should format weeks and hours when days are zero", () => {
    expect(formatDuration(608400)).toBe("1w 1h");
  });

  it("should format weeks only when no remainder", () => {
    expect(formatDuration(604800)).toBe("1w");
  });

  it("should format months and weeks", () => {
    expect(formatDuration(3196800)).toBe("1mo 1w");
  });

  it("should format months and days when weeks are zero", () => {
    // 2678400 seconds: mo=1, w=0, d=(2678400 % 604800)/86400 = 3
    expect(formatDuration(2678400)).toBe("1mo 3d");
  });

  it("should format months only when no remainder", () => {
    // 3024000 = 5 * WEEK, mo=1, w=0, d=0 (since seconds % WEEK = 0)
    expect(formatDuration(3024000)).toBe("1mo");
  });
});

describe("isSameDay", () => {
  it("should return true for same day same time", () => {
    const date1 = new Date(2026, 0, 15, 10, 0, 0);
    const date2 = new Date(2026, 0, 15, 10, 0, 0);
    expect(isSameDay(date1, date2)).toBe(true);
  });

  it("should return true for same day different times", () => {
    const date1 = new Date(2026, 0, 15, 0, 0, 0);
    const date2 = new Date(2026, 0, 15, 23, 59, 59);
    expect(isSameDay(date1, date2)).toBe(true);
  });

  it("should return false for different days", () => {
    const date1 = new Date(2026, 0, 15, 10, 0, 0);
    const date2 = new Date(2026, 0, 16, 10, 0, 0);
    expect(isSameDay(date1, date2)).toBe(false);
  });

  it("should return false for different months", () => {
    const date1 = new Date(2026, 0, 15, 10, 0, 0);
    const date2 = new Date(2026, 1, 15, 10, 0, 0);
    expect(isSameDay(date1, date2)).toBe(false);
  });

  it("should return false for different years", () => {
    const date1 = new Date(2026, 0, 15, 10, 0, 0);
    const date2 = new Date(2027, 0, 15, 10, 0, 0);
    expect(isSameDay(date1, date2)).toBe(false);
  });
});

describe("formatDateTimeRelative", () => {
  it("should return empty string for null input", () => {
    expect(formatDateTimeRelative(null)).toBe("");
  });

  it("should return empty string for invalid date string", () => {
    expect(formatDateTimeRelative("invalid")).toBe("");
  });

  it("should show only time for today", () => {
    const now = new Date(2026, 0, 15, 16, 0, 0);
    const date = new Date(2026, 0, 15, 14, 30, 0);
    expect(formatDateTimeRelative(date, now)).toBe("2:30 PM");
  });

  it("should show month day and time for different day same year", () => {
    const now = new Date(2026, 0, 15, 16, 0, 0);
    const date = new Date(2026, 0, 10, 9, 15, 0);
    expect(formatDateTimeRelative(date, now)).toBe("Jan 10, 9:15 AM");
  });

  it("should show full date with year for different year", () => {
    const now = new Date(2026, 0, 15, 16, 0, 0);
    const date = new Date(2025, 11, 25, 12, 0, 0);
    expect(formatDateTimeRelative(date, now)).toBe("Dec 25, 2025, 12:00 PM");
  });

  it("should handle midnight for today", () => {
    const now = new Date(2026, 5, 20, 10, 0, 0);
    const date = new Date(2026, 5, 20, 0, 0, 0);
    expect(formatDateTimeRelative(date, now)).toBe("12:00 AM");
  });

  it("should format date string input correctly", () => {
    const now = new Date(2026, 0, 15, 16, 0, 0);
    const dateString = "2026-01-15T14:30:00";
    const result = formatDateTimeRelative(dateString, now);
    expect(result).toMatch(/2:30 PM/);
  });
});
