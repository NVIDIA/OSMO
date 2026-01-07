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
 * Column Sizing Utilities
 *
 * Minimal utilities for column sizing with TanStack Table.
 * TanStack handles the heavy lifting; we just provide:
 * - rem → px conversion (for accessibility-based min widths)
 * - CSS variable helpers (for performant column width application)
 * - DOM measurement for content width detection
 */

import { CELL_PADDING_REM, RESIZE_HANDLE_WIDTH_PX, MEASUREMENT_BUFFER_PX } from "./column-constants";

// =============================================================================
// Constants
// =============================================================================

/** Default base font size in pixels */
const DEFAULT_BASE_FONT_SIZE = 16;

// =============================================================================
// Module-Level rem-to-px Cache
// Single source of truth for rem ↔ px conversion
// Invalidates automatically on browser zoom changes
// =============================================================================

let _remToPxCache: number | null = null;

// SSR-safe: only set up listener in browser with matchMedia support
if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
  // matchMedia with resolution query fires on zoom changes
  window.matchMedia("(resolution: 1dppx)").addEventListener("change", () => {
    _remToPxCache = null;
  });
}

/**
 * Get the current rem-to-px ratio.
 * Cached at module level; invalidated on browser zoom.
 */
export function getRemToPx(): number {
  if (typeof document === "undefined") return DEFAULT_BASE_FONT_SIZE;

  if (_remToPxCache !== null) return _remToPxCache;

  try {
    const fontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
    _remToPxCache = fontSize > 0 ? fontSize : DEFAULT_BASE_FONT_SIZE;
    return _remToPxCache;
  } catch {
    return DEFAULT_BASE_FONT_SIZE;
  }
}

/**
 * Invalidate the rem-to-px cache. Exposed for testing.
 * @internal
 */
export function _invalidateRemToPxCache(): void {
  _remToPxCache = null;
}

/** Convert rem to pixels */
export function remToPx(rem: number, baseFontSize?: number): number {
  return rem * (baseFontSize ?? getRemToPx());
}

// =============================================================================
// CSS Variable Helpers
// =============================================================================

/** Generate CSS variable name for a column */
export function getColumnCSSVariable(columnId: string): string {
  return `--col-${columnId.replace(/[^a-zA-Z0-9-_]/g, "-")}`;
}

/** Generate CSS var() reference for a column */
export function getColumnCSSValue(columnId: string, fallback: number = 150): string {
  return `var(${getColumnCSSVariable(columnId)}, ${fallback}px)`;
}

// =============================================================================
// Truncation Threshold
// =============================================================================

/**
 * Get the truncation threshold for a column.
 * This is the width below which content will be truncated.
 *
 * Single source of truth used for:
 * - Mode detection in endResize (TRUNCATE vs NO_TRUNCATE)
 * - Floor calculation in calculateColumnWidths (NO_TRUNCATE mode)
 * - Auto-fit target validation
 * - Debug snapshot formatting
 *
 * @param contentWidth - Measured content width (0 if not measured)
 * @param configuredWidth - Default/preferred width from column config
 * @returns The larger of the two - ensures we don't truncate measured content
 */
export function getTruncationThreshold(contentWidth: number, configuredWidth: number): number {
  return Math.max(contentWidth, configuredWidth);
}

// =============================================================================
// DOM Content Width Measurement
// =============================================================================

/**
 * Measure the maximum content width of a column from visible DOM cells.
 *
 * Uses `scrollWidth` which returns the full content width even when
 * the content is truncated with CSS `overflow: hidden`.
 *
 * @param container - The scroll container element containing the table
 * @param columnId - The column ID to measure (matches `data-column-id` attribute)
 * @returns The measured width in pixels, including padding and buffer. Returns 0 if no cells found.
 *
 * @example
 * ```ts
 * const width = measureColumnContentWidth(scrollRef.current, "name");
 * if (width > 0) {
 *   setColumnWidth("name", width);
 * }
 * ```
 */
export function measureColumnContentWidth(container: HTMLElement, columnId: string): number {
  const selector = `[data-column-id="${columnId}"]`;
  const cells = container.querySelectorAll<HTMLElement>(selector);

  if (cells.length === 0) return 0;

  // Find the maximum content width across all visible cells
  let maxContentWidth = 0;
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    // Measure first child to get content width without cell padding
    const content = cell.firstElementChild as HTMLElement | null;
    const contentWidth = content?.scrollWidth ?? cell.scrollWidth;
    if (contentWidth > maxContentWidth) {
      maxContentWidth = contentWidth;
    }
  }

  // Add cell padding (converts from rem) + resize handle + visual buffer
  const cellPaddingPx = CELL_PADDING_REM * getRemToPx();
  return maxContentWidth + cellPaddingPx + RESIZE_HANDLE_WIDTH_PX + MEASUREMENT_BUFFER_PX;
}

/**
 * Batch measure multiple columns.
 * More efficient than calling measureColumnContentWidth in a loop
 * when you need to measure multiple columns at once.
 *
 * @param container - The scroll container element
 * @param columnIds - Array of column IDs to measure
 * @returns Record of columnId -> measured width (only includes columns with width > 0)
 */
export function measureMultipleColumns(container: HTMLElement, columnIds: string[]): Record<string, number> {
  const result: Record<string, number> = {};

  for (const columnId of columnIds) {
    const width = measureColumnContentWidth(container, columnId);
    if (width > 0) {
      result[columnId] = width;
    }
  }

  return result;
}
