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

/**
 * Date Range Utilities
 *
 * Generic date range parsing and preset definitions used across features
 * (datasets filtering, adapter layer shims, etc.).
 */

// =============================================================================
// Presets
// =============================================================================

interface DateRangePreset {
  /** Label shown in suggestions and stored as chip value */
  label: string;
  /** Returns current ISO range string — computed at filter time so "today" is always today */
  getValue: () => string;
}

/** Format a UTC-midnight Date as YYYY-MM-DD */
function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Build ISO range string: "YYYY-MM-DD..YYYY-MM-DD" */
function isoRange(start: Date, end: Date): string {
  return `${toIsoDate(start)}..${toIsoDate(end)}`;
}

/** Return a Date representing UTC midnight N days ago */
function daysAgo(n: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - n));
}

/** Return a Date representing UTC midnight today */
function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export const DATE_RANGE_PRESETS: DateRangePreset[] = [
  {
    label: "today",
    getValue: () => toIsoDate(todayUtc()),
  },
  {
    label: "last 7 days",
    getValue: () => isoRange(daysAgo(7), todayUtc()),
  },
  {
    label: "last 30 days",
    getValue: () => isoRange(daysAgo(30), todayUtc()),
  },
  {
    label: "last 90 days",
    getValue: () => isoRange(daysAgo(90), todayUtc()),
  },
  {
    label: "last 365 days",
    getValue: () => isoRange(daysAgo(365), todayUtc()),
  },
];

// =============================================================================
// Public API
// =============================================================================

/**
 * Parse a date range value to a { start, end } pair (inclusive), or null if invalid.
 *
 * Handles:
 * - ISO range strings: "2024-01-01..2024-12-31"
 * - ISO single dates:  "2026-02-20" (interpreted as full UTC day)
 * - Preset labels:     "last 7 days", "today", etc. (for backward compatibility)
 *
 * The end date is extended to the last millisecond of that UTC day (23:59:59.999Z),
 * making it inclusive of all events that occurred during that day.
 */
export function parseDateRangeValue(value: string): { start: Date; end: Date } | null {
  if (!value) return null;

  // Handle ISO range strings: "YYYY-MM-DD..YYYY-MM-DD"
  if (value.includes("..")) {
    return parseIsoRangeString(value);
  }

  // Handle single ISO date: "YYYY-MM-DD" — treated as full UTC day
  const singleDate = parseIsoDate(value);
  if (singleDate) {
    const end = new Date(singleDate.getTime());
    end.setUTCHours(23, 59, 59, 999);
    return { start: singleDate, end };
  }

  // Backward compat: check preset labels (e.g., "last 7 days")
  const preset = DATE_RANGE_PRESETS.find((p) => p.label === value.toLowerCase());
  if (preset) {
    return parseDateRangeValue(preset.getValue());
  }

  return null;
}

// =============================================================================
// Internal helpers
// =============================================================================

/** Parse "YYYY-MM-DD..YYYY-MM-DD" → { start, end } with end extended to 23:59:59.999Z */
function parseIsoRangeString(value: string): { start: Date; end: Date } | null {
  const parts = value.split("..");
  if (parts.length !== 2) return null;

  const start = parseIsoDate(parts[0].trim());
  const end = parseIsoDate(parts[1].trim());
  if (!start || !end || start > end) return null;

  // Make end inclusive: extend to last ms of the UTC day
  const endInclusive = new Date(end.getTime());
  endInclusive.setUTCHours(23, 59, 59, 999);

  return { start, end: endInclusive };
}

/** Parse "YYYY-MM-DD" as UTC midnight, or null if format is invalid */
function parseIsoDate(str: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
  const d = new Date(str + "T00:00:00.000Z");
  return isNaN(d.getTime()) ? null : d;
}
