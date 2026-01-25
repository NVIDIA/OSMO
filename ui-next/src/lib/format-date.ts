/**
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SSR-Safe Date Formatting Utilities
 *
 * These formatters are designed to produce consistent output between
 * server and client to avoid hydration mismatches.
 *
 * Key Design Principles:
 * 1. Use explicit UTC or fixed formats to avoid locale/timezone differences
 * 2. Avoid relative time comparisons (like "today") during SSR
 * 3. Provide explicit timezone indicators when showing times
 *
 * For components that need locale-aware formatting (like "today" vs date),
 * use the ClientDate component which defers to client-only rendering.
 */

// =============================================================================
// Constants
// =============================================================================

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

// =============================================================================
// SSR-Safe Formatters (no locale dependency)
// =============================================================================

/**
 * Format a date in a consistent, locale-independent format.
 * Output: "Jan 15, 2026, 2:30:45 PM"
 *
 * Uses explicit formatting to avoid server/client locale differences.
 */
export function formatDateTimeFull(date: Date | string | null): string {
  if (!date) return "";

  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "";

  const month = MONTHS_SHORT[d.getMonth()];
  const day = d.getDate();
  const year = d.getFullYear();
  const hours = d.getHours();
  const minutes = d.getMinutes().toString().padStart(2, "0");
  const seconds = d.getSeconds().toString().padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 || 12;

  return `${month} ${day}, ${year}, ${hour12}:${minutes}:${seconds} ${ampm}`;
}

/**
 * Format a date in a consistent, locale-independent format (UTC).
 * Output: "Jan 15, 2026, 2:30:45 PM UTC"
 *
 * UTC version for debugging - matches raw log format timezone.
 */
export function formatDateTimeFullUTC(date: Date | string | null): string {
  if (!date) return "";

  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "";

  const month = MONTHS_SHORT[d.getUTCMonth()];
  const day = d.getUTCDate();
  const year = d.getUTCFullYear();
  const hours = d.getUTCHours();
  const minutes = d.getUTCMinutes().toString().padStart(2, "0");
  const seconds = d.getUTCSeconds().toString().padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 || 12;

  return `${month} ${day}, ${year}, ${hour12}:${minutes}:${seconds} ${ampm} UTC`;
}

/**
 * Format a date in a succinct format for table cells.
 * Output: "1/15 2:30p" (same year) or "1/15/26 2:30p" (different year)
 *
 * Note: This compares against a reference year, not "now", to ensure
 * consistent output between server and client renders.
 *
 * @param date - The date to format
 * @param referenceYear - The year to compare against (pass from useTick for consistency)
 */
export function formatDateTimeSuccinct(date: Date | string | null, referenceYear?: number): string {
  if (!date) return "";

  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "";

  const month = d.getMonth() + 1;
  const day = d.getDate();
  const year = d.getFullYear();
  const hours = d.getHours();
  const minutes = d.getMinutes().toString().padStart(2, "0");
  const ampm = hours >= 12 ? "p" : "a";
  const hour12 = hours % 12 || 12;

  // If no reference year provided, always show the full year for SSR safety
  if (referenceYear === undefined) {
    return `${month}/${day}/${year % 100} ${hour12}:${minutes}${ampm}`;
  }

  // Compare against reference year
  if (year === referenceYear) {
    return `${month}/${day} ${hour12}:${minutes}${ampm}`;
  }

  return `${month}/${day}/${year % 100} ${hour12}:${minutes}${ampm}`;
}

/**
 * Format just the time portion.
 * Output: "2:30 PM"
 */
export function formatTimeShort(date: Date | string | null): string {
  if (!date) return "";

  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "";

  const hours = d.getHours();
  const minutes = d.getMinutes().toString().padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 || 12;

  return `${hour12}:${minutes} ${ampm}`;
}

/**
 * Format date without time.
 * Output: "Jan 15, 2026"
 */
export function formatDateShort(date: Date | string | null): string {
  if (!date) return "";

  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "";

  const month = MONTHS_SHORT[d.getMonth()];
  const day = d.getDate();
  const year = d.getFullYear();

  return `${month} ${day}, ${year}`;
}

/**
 * Format date in ISO format (always consistent).
 * Output: "2026-01-15T14:30:45.000Z"
 */
export function formatDateISO(date: Date | string | null): string {
  if (!date) return "";

  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "";

  return d.toISOString();
}

// =============================================================================
// 24-Hour Time Formatters (for logs, timestamps, technical displays)
// =============================================================================

/**
 * Format time in 24-hour format with seconds.
 * Output: "14:30:45"
 *
 * SSR-safe: Uses explicit formatting, no locale dependency.
 * Ideal for log timestamps where precision matters.
 */
export function formatTime24(date: Date | string | null): string {
  if (!date) return "";

  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "";

  const hours = d.getHours().toString().padStart(2, "0");
  const minutes = d.getMinutes().toString().padStart(2, "0");
  const seconds = d.getSeconds().toString().padStart(2, "0");

  return `${hours}:${minutes}:${seconds}`;
}

/**
 * Format time in 24-hour format with seconds (UTC).
 * Output: "14:30:45"
 *
 * UTC version for debugging - matches raw log format exactly.
 * Useful when you want to see the same timezone as the backend logs.
 */
export function formatTime24UTC(date: Date | string | null): string {
  if (!date) return "";

  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "";

  const hours = d.getUTCHours().toString().padStart(2, "0");
  const minutes = d.getUTCMinutes().toString().padStart(2, "0");
  const seconds = d.getUTCSeconds().toString().padStart(2, "0");

  return `${hours}:${minutes}:${seconds}`;
}

/**
 * Format time in 24-hour format with milliseconds.
 * Output: "14:30:45.123"
 *
 * SSR-safe: Uses explicit formatting, no locale dependency.
 * Ideal for detailed log context where sub-second precision matters.
 */
export function formatTime24WithMs(date: Date | string | null): string {
  if (!date) return "";

  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "";

  const hours = d.getHours().toString().padStart(2, "0");
  const minutes = d.getMinutes().toString().padStart(2, "0");
  const seconds = d.getSeconds().toString().padStart(2, "0");
  const ms = d.getMilliseconds().toString().padStart(3, "0");

  return `${hours}:${minutes}:${seconds}.${ms}`;
}

/**
 * Format time in 24-hour format without seconds.
 * Output: "14:30"
 *
 * SSR-safe: Uses explicit formatting, no locale dependency.
 * Ideal for histogram time axis labels.
 */
export function formatTime24Short(date: Date | string | null): string {
  if (!date) return "";

  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "";

  const hours = d.getHours().toString().padStart(2, "0");
  const minutes = d.getMinutes().toString().padStart(2, "0");

  return `${hours}:${minutes}`;
}

/**
 * Format time in 24-hour format without seconds (UTC).
 * Output: "14:30"
 *
 * UTC version for debugging - matches raw log format timezone.
 * Ideal for histogram time axis labels when debugging.
 */
export function formatTime24ShortUTC(date: Date | string | null): string {
  if (!date) return "";

  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "";

  const hours = d.getUTCHours().toString().padStart(2, "0");
  const minutes = d.getUTCMinutes().toString().padStart(2, "0");

  return `${hours}:${minutes}`;
}

// =============================================================================
// Relative Time (Client-Only)
// =============================================================================

/**
 * Check if two dates are the same calendar day.
 * This should only be used on the client side.
 *
 * @param date1 - First date to compare
 * @param date2 - Second date to compare (defaults to now)
 */
export function isSameDay(date1: Date, date2: Date = new Date()): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
}

/**
 * Format a date with relative context (e.g., "2:30 PM" for today, "Jan 15, 2:30 PM" for other days).
 *
 * ⚠️ WARNING: This function should ONLY be used in components that are:
 * 1. Wrapped with useMounted() / useIsHydrated()
 * 2. Rendered only on the client (inside a conditional)
 * 3. Using suppressHydrationWarning
 *
 * For SSR-safe rendering, use formatDateTimeFull or formatDateTimeSuccinct instead.
 *
 * @param date - The date to format
 * @param now - Current time reference (for testing or synchronized timestamps)
 */
export function formatDateTimeRelative(date: Date | string | null, now: Date = new Date()): string {
  if (!date) return "";

  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "";

  const isToday = isSameDay(d, now);
  const hours = d.getHours();
  const minutes = d.getMinutes().toString().padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 || 12;

  if (isToday) {
    return `${hour12}:${minutes} ${ampm}`;
  }

  const month = MONTHS_SHORT[d.getMonth()];
  const day = d.getDate();

  // If same year, omit year
  if (d.getFullYear() === now.getFullYear()) {
    return `${month} ${day}, ${hour12}:${minutes} ${ampm}`;
  }

  return `${month} ${day}, ${d.getFullYear()}, ${hour12}:${minutes} ${ampm}`;
}
