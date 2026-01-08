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

// Pre-computed padding (cached on first use, invalidated with rem cache)
let _paddingCache: number | null = null;

function getCellPaddingTotal(): number {
  if (_paddingCache !== null) return _paddingCache;
  _paddingCache = CELL_PADDING_REM * getRemToPx() + RESIZE_HANDLE_WIDTH_PX + MEASUREMENT_BUFFER_PX;
  return _paddingCache;
}

// Invalidate padding cache when rem changes (piggyback on existing listener)
if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
  window.matchMedia("(resolution: 1dppx)").addEventListener("change", () => {
    _paddingCache = null;
  });
}

// Measurement style string (constant, never changes)
const MEASURE_STYLE = "flex:none;width:max-content;min-width:0";

/**
 * Measure the maximum content width of a column from visible DOM cells.
 *
 * Measures the INTRINSIC content width (minimum needed to display content
 * without truncation), not the current rendered width. This is important
 * for flex containers that grow to fill available space - we want to
 * measure what they NEED, not what they currently HAVE.
 *
 * Optimized for performance:
 * - Uses parallel arrays to avoid object allocation
 * - Single cssText write/restore for minimal style recalc
 * - Batched reads after writes for single reflow
 *
 * @param container - The scroll container element containing the table
 * @param columnId - The column ID to measure (matches `data-column-id` attribute)
 * @returns The measured width in pixels, including padding and buffer. Returns 0 if no cells found.
 */
export function measureColumnContentWidth(container: HTMLElement, columnId: string): number {
  const cells = container.querySelectorAll<HTMLElement>(`[data-column-id="${columnId}"]`);
  const len = cells.length;
  if (len === 0) return 0;

  // Parallel arrays - avoid object allocation overhead
  const contents: HTMLElement[] = [];
  const originals: string[] = [];

  // Phase 1: Collect elements and save original cssText (single property read)
  for (let i = 0; i < len; i++) {
    const content = cells[i].firstElementChild as HTMLElement | null;
    if (content) {
      contents.push(content);
      originals.push(content.style.cssText);
    }
  }

  const count = contents.length;
  if (count === 0) return 0;

  // Phase 2: Apply measurement styles (batch writes)
  for (let i = 0; i < count; i++) {
    contents[i].style.cssText = MEASURE_STYLE;
  }

  // Phase 3: Measure (batch reads - triggers single reflow)
  let max = 0;
  for (let i = 0; i < count; i++) {
    const w = contents[i].scrollWidth;
    if (w > max) max = w;
  }

  // Phase 4: Restore original styles (batch writes)
  for (let i = 0; i < count; i++) {
    contents[i].style.cssText = originals[i];
  }

  return max + getCellPaddingTotal();
}

/**
 * Batch measure multiple columns in a single reflow.
 *
 * More efficient than calling measureColumnContentWidth in a loop -
 * applies all measurement styles, measures everything, then restores.
 * This triggers only ONE reflow instead of one per column.
 *
 * @param container - The scroll container element
 * @param columnIds - Array of column IDs to measure
 * @returns Record of columnId -> measured width (only includes columns with width > 0)
 */
export function measureMultipleColumns(container: HTMLElement, columnIds: string[]): Record<string, number> {
  if (columnIds.length === 0) return {};

  // Collect all elements across all columns
  const allContents: HTMLElement[] = [];
  const allOriginals: string[] = [];
  const columnBoundaries: number[] = []; // Track where each column's elements start
  const validColumnIds: string[] = [];

  // Phase 1: Collect all elements from all columns
  for (const columnId of columnIds) {
    const cells = container.querySelectorAll<HTMLElement>(`[data-column-id="${columnId}"]`);
    const startIdx = allContents.length;

    for (let i = 0; i < cells.length; i++) {
      const content = cells[i].firstElementChild as HTMLElement | null;
      if (content) {
        allContents.push(content);
        allOriginals.push(content.style.cssText);
      }
    }

    // Only track columns that have elements
    if (allContents.length > startIdx) {
      columnBoundaries.push(startIdx);
      validColumnIds.push(columnId);
    }
  }

  if (allContents.length === 0) return {};

  // Mark final boundary
  columnBoundaries.push(allContents.length);

  // Phase 2: Apply measurement styles to ALL elements (single batch)
  for (let i = 0; i < allContents.length; i++) {
    allContents[i].style.cssText = MEASURE_STYLE;
  }

  // Phase 3: Measure ALL elements (single reflow for all columns)
  const result: Record<string, number> = {};
  const padding = getCellPaddingTotal();

  for (let col = 0; col < validColumnIds.length; col++) {
    const start = columnBoundaries[col];
    const end = columnBoundaries[col + 1];
    let max = 0;

    for (let i = start; i < end; i++) {
      const w = allContents[i].scrollWidth;
      if (w > max) max = w;
    }

    if (max > 0) {
      result[validColumnIds[col]] = max + padding;
    }
  }

  // Phase 4: Restore ALL original styles (single batch)
  for (let i = 0; i < allContents.length; i++) {
    allContents[i].style.cssText = allOriginals[i];
  }

  return result;
}
