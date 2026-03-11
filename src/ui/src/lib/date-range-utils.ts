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

  // Handle single date or datetime
  const singleDate = parseIsoDate(value);
  if (singleDate) {
    // Date-only ("YYYY-MM-DD"): treat as the full UTC day.
    // Use midnight of the *next* day as the exclusive upper bound so that
    // submit_time < end captures every event on this day including 23:59:59.999Z.
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const end = new Date(singleDate.getTime());
      end.setUTCDate(end.getUTCDate() + 1); // advance to next midnight
      return { start: singleDate, end };
    }
    // Datetime ("YYYY-MM-DDTHH:mm"): use the exact moment as both bounds
    return { start: singleDate, end: singleDate };
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

/** Parse "YYYY-MM-DD..YYYY-MM-DD" or "YYYY-MM-DDTHH:mm..YYYY-MM-DDTHH:mm" range strings */
function parseIsoRangeString(value: string): { start: Date; end: Date } | null {
  const parts = value.split("..");
  if (parts.length !== 2) return null;

  const endStr = parts[1].trim();
  const start = parseIsoDate(parts[0].trim());
  const end = parseIsoDate(endStr);
  if (!start || !end || start > end) return null;

  // Date-only end: advance to midnight of the next day so that the exclusive
  // submitted_before < end captures every event on the chosen end date (including 23:59:59.999Z).
  // Datetime end: the user chose an explicit exclusive cutoff — use it as-is.
  if (/^\d{4}-\d{2}-\d{2}$/.test(endStr)) {
    const endExclusive = new Date(end.getTime());
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1); // next midnight
    return { start, end: endExclusive };
  }

  return { start, end };
}

/**
 * Parse a date or datetime string to a Date, or null if invalid.
 * - "YYYY-MM-DD" → UTC midnight
 * - "YYYY-MM-DDTHH:mm" → local time (datetime-local input format)
 */
function parseIsoDate(str: string): Date | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const d = new Date(str + "T00:00:00.000Z");
    return isNaN(d.getTime()) ? null : d;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(str)) {
    const d = new Date(str); // interpreted as local time by the browser
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}
