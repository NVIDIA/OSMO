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
 * Used for mode detection in endResize (TRUNCATE vs NO_TRUNCATE).
 * When user resizes a column:
 * - If newWidth < contentWidth → user accepts truncation (TRUNCATE mode)
 * - If newWidth >= contentWidth → user wants full content (NO_TRUNCATE mode)
 *
 * @param contentWidth - Measured content width (0 if not measured)
 * @returns The content width - this is what we're protecting from truncation
 */
export function getTruncationThreshold(contentWidth: number): number {
  return contentWidth;
}

// =============================================================================
// Column Width Calculation Algorithm
// =============================================================================

import type { ColumnSizingState } from "@tanstack/react-table";
import type { ColumnSizingPreferences } from "../types";
import { PreferenceModes, assertNever } from "../constants";

/**
 * Calculate column widths based on container width and preferences.
 * Pure function - no side effects.
 *
 * Algorithm:
 * 1. Each column has: min (absolute floor), target (preferred), floor (mode-dependent)
 * 2. If container >= totalTarget: distribute surplus proportionally (excluding non-resizable columns)
 * 3. If container >= totalFloor but < totalTarget: shrink columns with "give" (target - floor)
 * 4. If container < totalFloor: all columns at floor (overflow, scrollable)
 *
 * Non-resizable columns (enableResizing: false) are kept at their target width and excluded
 * from surplus distribution, preventing auto-sizing from changing their width.
 */
export function calculateColumnWidths(
  columnIds: string[],
  containerWidth: number,
  minSizes: Record<string, number>,
  configuredSizes: Record<string, number>,
  preferences: ColumnSizingPreferences,
  contentWidths: Record<string, number> = {},
  columnResizability: Record<string, boolean> = {},
): ColumnSizingState {
  if (columnIds.length === 0 || containerWidth <= 0) {
    return {};
  }

  const columns = columnIds.map((id) => {
    const min = minSizes[id] ?? 80;
    const configuredWidth = configuredSizes[id] ?? min * 1.5;
    const pref = preferences[id];
    const contentWidth = contentWidths[id];
    const resizable = columnResizability[id] ?? true; // default to resizable

    let target: number;
    let floor: number;

    if (pref) {
      switch (pref.mode) {
        case PreferenceModes.NO_TRUNCATE: {
          // NO_TRUNCATE: protect content from truncation
          // Floor = measured contentWidth, or pref.width (from auto-fit) as fallback
          // This ensures we honor the user's explicit "show full content" intent
          const protectedWidth = (contentWidth ?? 0) > 0 ? contentWidth : pref.width;
          floor = Math.max(protectedWidth, min);
          break;
        }
        case PreferenceModes.TRUNCATE:
          // TRUNCATE: user accepts truncation, can shrink to min
          floor = min;
          break;
        default:
          assertNever(pref.mode);
      }
      target = pref.width;
    } else {
      floor = min;
      target = configuredWidth;
    }

    target = Math.max(target, min);
    floor = Math.max(floor, min);

    return { id, min, target, floor, resizable };
  });

  const totalTarget = columns.reduce((sum, c) => sum + c.target, 0);
  const totalFloor = columns.reduce((sum, c) => sum + c.floor, 0);

  // Case 1: Container fits all targets
  if (containerWidth >= totalTarget) {
    const surplus = containerWidth - totalTarget;
    if (surplus > 0) {
      // Separate resizable and non-resizable columns
      const resizableColumns = columns.filter((c) => c.resizable);
      const nonResizableColumns = columns.filter((c) => !c.resizable);

      // Distribute surplus only among resizable columns
      const resizableTotal = resizableColumns.reduce((sum, c) => sum + c.target, 0);

      const result: ColumnSizingState = {};

      // Non-resizable columns stay at target
      for (const c of nonResizableColumns) {
        result[c.id] = c.target;
      }

      // Resizable columns share the surplus proportionally
      if (resizableTotal > 0) {
        for (const c of resizableColumns) {
          const shareOfSurplus = (c.target / resizableTotal) * surplus;
          result[c.id] = c.target + shareOfSurplus;
        }
      }

      return result;
    }
    return Object.fromEntries(columns.map((c) => [c.id, c.target]));
  }

  // Case 2: Container smaller than targets but larger than floors
  if (containerWidth >= totalFloor) {
    // Separate resizable and non-resizable columns
    const resizableColumns = columns.filter((c) => c.resizable);
    const nonResizableColumns = columns.filter((c) => !c.resizable);

    // Non-resizable columns stay at target, resizable columns absorb the deficit
    const nonResizableTotal = nonResizableColumns.reduce((sum, c) => sum + c.target, 0);
    const resizableTarget = resizableColumns.reduce((sum, c) => sum + c.target, 0);
    const resizableFloor = resizableColumns.reduce((sum, c) => sum + c.floor, 0);

    // Available space for resizable columns after non-resizable take their target
    const availableForResizable = containerWidth - nonResizableTotal;

    const result: ColumnSizingState = {};

    // Non-resizable columns keep their target
    for (const c of nonResizableColumns) {
      result[c.id] = c.target;
    }

    // Shrink only resizable columns
    if (availableForResizable >= resizableFloor) {
      // Proportional shrink among resizable columns
      const deficit = resizableTarget - availableForResizable;
      const columnsWithGive = resizableColumns.map((c) => ({
        ...c,
        give: Math.max(0, c.target - c.floor),
      }));

      const totalGive = columnsWithGive.reduce((sum, c) => sum + c.give, 0);
      if (totalGive <= 0) {
        for (const c of columnsWithGive) {
          result[c.id] = c.floor;
        }
      } else {
        const shrinkRatio = Math.min(1, deficit / totalGive);
        for (const c of columnsWithGive) {
          const shrinkAmount = c.give * shrinkRatio;
          result[c.id] = Math.max(c.floor, c.target - shrinkAmount);
        }
      }
    } else {
      // Not enough space even at floor - resizable columns at floor
      for (const c of resizableColumns) {
        result[c.id] = c.floor;
      }
    }

    return result;
  }

  // Case 3: Container smaller than total floors
  // Non-resizable columns still keep target, resizable columns at floor
  const result: ColumnSizingState = {};
  for (const c of columns) {
    result[c.id] = c.resizable ? c.floor : c.target;
  }
  return result;
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
