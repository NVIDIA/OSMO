/**
 * Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

/**
 * Column Sizing Utilities
 *
 * Pure functions for calculating column widths.
 * No side effects, no React dependencies - easy to test.
 *
 * ## Two-Tier Model
 *
 * ### Tier 1: Config (defined in code)
 * - minWidthRem: Absolute floor - user can NEVER go below this
 * - share: Default proportional share for space distribution
 *
 * ### Tier 2: User Override (persisted)
 * - minWidthPx: User's set minimum (must be >= config min)
 * - share: Original share preserved for proportional participation
 *
 * ## Layout Algorithm
 *
 * 1. Every column meets min width first (effective min = override or config)
 * 2. Remaining space distributed by share until max (content-fit)
 * 3. Leftover space = whitespace on right
 * 4. Container < total min → horizontal scroll
 */

import type { ColumnSizeConfig, ColumnOverride, ColumnWidthsResult } from "../types";

// =============================================================================
// Constants
// =============================================================================

/**
 * Padding added to measured content width.
 * Accounts for cell padding, resize handle, sort icon, and buffer.
 */
export const DEFAULT_MEASUREMENT_PADDING = 48;

/**
 * Extra padding (in rem) allowing users to drag beyond content max.
 * This gives breathing room when manually resizing, while double-click
 * still snaps to the exact content-fit width.
 */
export const DRAG_OVERSHOOT_REM = 2;

/** Default base font size in pixels */
const DEFAULT_BASE_FONT_SIZE = 16;

// =============================================================================
// Rem ↔ Pixel Conversion
// =============================================================================

/** Get base font size from document (for rem → px conversion) */
export function getBaseFontSize(): number {
  if (typeof document === "undefined") return DEFAULT_BASE_FONT_SIZE;
  try {
    const fontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
    return fontSize > 0 ? fontSize : DEFAULT_BASE_FONT_SIZE;
  } catch {
    return DEFAULT_BASE_FONT_SIZE;
  }
}

/** Convert rem to pixels */
export function remToPx(rem: number, baseFontSize?: number): number {
  return rem * (baseFontSize ?? getBaseFontSize());
}

/** Convert pixels to rem */
export function pxToRem(px: number, baseFontSize?: number): number {
  return px / (baseFontSize ?? getBaseFontSize());
}

// =============================================================================
// Resolved Column
// =============================================================================

export interface ResolvedColumn {
  id: string;
  /** Effective minimum width in pixels (override min or config min) */
  minWidthPx: number;
  /** Maximum width in pixels (content-fit, Infinity if not measured) */
  maxWidthPx: number;
  /** Proportional share (override share or config share) */
  share: number;
}

/**
 * Resolve columns to pixel-based configs with overrides and natural widths applied.
 */
export function resolveColumns(
  columns: ColumnSizeConfig[],
  overrides: Record<string, ColumnOverride>,
  naturalWidths: Record<string, number>,
  baseFontSize?: number,
): ResolvedColumn[] {
  const base = baseFontSize ?? getBaseFontSize();

  return columns.map((col) => {
    const override = overrides[col.id];
    const natural = naturalWidths[col.id];

    // Effective min: override min if set, else config min
    const configMinPx = remToPx(col.minWidthRem, base);
    const minWidthPx = override?.minWidthPx ?? configMinPx;

    // Effective share: override share if set, else config share
    const share = override?.share ?? col.share;

    // Max: natural width if measured, else unlimited
    const maxWidthPx = natural != null && natural > 0 ? natural : Infinity;

    return { id: col.id, minWidthPx, maxWidthPx, share };
  });
}

// =============================================================================
// Core Calculation
// =============================================================================

/**
 * Calculate column widths using single-pass distribution.
 *
 * Algorithm:
 * 1. Assign minimum widths to all columns
 * 2. If container < total min → horizontal scroll (keep at mins)
 * 3. Distribute extra space by share, cap at max
 * 4. Any remaining space = whitespace on right
 */
export function calculateColumnWidths(columns: ResolvedColumn[], containerWidth: number): ColumnWidthsResult {
  if (columns.length === 0) {
    return { widths: {}, totalWidth: 0, needsScroll: false, whitespace: containerWidth };
  }

  // Step 1: Assign minimums
  const widths: Record<string, number> = {};
  let totalMin = 0;

  for (const col of columns) {
    widths[col.id] = col.minWidthPx;
    totalMin += col.minWidthPx;
  }

  // Step 2: Horizontal scroll check
  if (containerWidth <= totalMin) {
    return {
      widths,
      totalWidth: totalMin,
      needsScroll: totalMin > containerWidth,
      whitespace: 0,
    };
  }

  // Step 3: Single-pass distribution
  // Only distribute extra space if we have content measurements (maxWidthPx < Infinity)
  // This prevents columns from growing beyond content before measurement completes
  const hasContentMeasurements = columns.some((c) => c.maxWidthPx < Infinity);

  if (!hasContentMeasurements) {
    // No content measurements yet - stay at minimums, leave whitespace on right
    return {
      widths,
      totalWidth: totalMin,
      needsScroll: false,
      whitespace: containerWidth - totalMin,
    };
  }

  const extraSpace = containerWidth - totalMin;
  const totalShare = columns.reduce((sum, c) => sum + c.share, 0);

  if (totalShare > 0) {
    for (const col of columns) {
      // Proportional allocation, floored to avoid subpixel issues
      const allocation = Math.floor((col.share / totalShare) * extraSpace);
      // Cap at max (headroom from min to max)
      const headroom = col.maxWidthPx < Infinity ? col.maxWidthPx - col.minWidthPx : 0;
      const growth = Math.min(allocation, headroom);
      widths[col.id] += growth;
    }
  }

  // Step 4: Calculate totals
  const totalWidth = Object.values(widths).reduce((sum, w) => sum + w, 0);
  const whitespace = Math.max(0, containerWidth - totalWidth);

  return { widths, totalWidth, needsScroll: false, whitespace };
}

// =============================================================================
// Content Measurement
// =============================================================================

/**
 * Measure content width for a single column.
 * Temporarily removes width constraints to get true content width.
 */
/**
 * Measure content width for a column using native table API.
 * Uses table.rows and row.cells for efficient indexed access.
 *
 * @param columnIndex - 0-based column index
 * @param tableElement - The table element
 * @param padding - Additional padding
 * @returns Max content width in pixels
 */
export function measureColumnByIndex(
  columnIndex: number,
  tableElement: HTMLTableElement,
  padding: number = DEFAULT_MEASUREMENT_PADDING,
): number {
  let maxWidth = 0;
  const originals: {
    el: HTMLTableCellElement;
    w: string;
    min: string;
    max: string;
    overflow: string;
    whiteSpace: string;
  }[] = [];

  // Collect cells from header
  const headerRow = tableElement.tHead?.rows[0];
  if (headerRow && headerRow.cells[columnIndex]) {
    const cell = headerRow.cells[columnIndex];
    originals.push({
      el: cell,
      w: cell.style.width,
      min: cell.style.minWidth,
      max: cell.style.maxWidth,
      overflow: cell.style.overflow,
      whiteSpace: cell.style.whiteSpace,
    });
  }

  // Collect cells from all body rows
  const tbody = tableElement.tBodies[0];
  if (tbody) {
    for (let i = 0; i < tbody.rows.length; i++) {
      const row = tbody.rows[i];
      const cell = row.cells[columnIndex];
      if (cell) {
        originals.push({
          el: cell,
          w: cell.style.width,
          min: cell.style.minWidth,
          max: cell.style.maxWidth,
          overflow: cell.style.overflow,
          whiteSpace: cell.style.whiteSpace,
        });
      }
    }
  }

  if (originals.length === 0) return 0;

  // Remove ALL constraints that could truncate content
  for (const { el } of originals) {
    el.style.width = "auto";
    el.style.minWidth = "0";
    el.style.maxWidth = "none";
    el.style.overflow = "visible";
    el.style.whiteSpace = "nowrap";
  }

  // Measure
  for (const { el } of originals) {
    maxWidth = Math.max(maxWidth, el.scrollWidth);
  }

  // Restore original styles
  for (const { el, w, min, max, overflow, whiteSpace } of originals) {
    el.style.width = w;
    el.style.minWidth = min;
    el.style.maxWidth = max;
    el.style.overflow = overflow;
    el.style.whiteSpace = whiteSpace;
  }

  return maxWidth + padding;
}

/**
 * Measure content width for a column by ID (uses data-column-id attribute).
 * Fallback for when column index is not available.
 */
export function measureColumnContentWidth(
  columnId: string,
  tableElement: HTMLTableElement,
  padding: number = DEFAULT_MEASUREMENT_PADDING,
): number {
  // Try to find column index from header first (more efficient)
  const headerRow = tableElement.tHead?.rows[0];
  if (headerRow) {
    for (let i = 0; i < headerRow.cells.length; i++) {
      if (headerRow.cells[i].getAttribute("data-column-id") === columnId) {
        return measureColumnByIndex(i, tableElement, padding);
      }
    }
  }

  // Fallback: use querySelectorAll (slower)
  const cells = tableElement.querySelectorAll(`[data-column-id="${columnId}"]`);
  if (cells.length === 0) return 0;

  let maxWidth = 0;
  const originals: {
    el: HTMLElement;
    w: string;
    min: string;
    max: string;
    overflow: string;
    whiteSpace: string;
  }[] = [];

  // Remove ALL constraints that could truncate content
  cells.forEach((cell) => {
    const el = cell as HTMLElement;
    originals.push({
      el,
      w: el.style.width,
      min: el.style.minWidth,
      max: el.style.maxWidth,
      overflow: el.style.overflow,
      whiteSpace: el.style.whiteSpace,
    });
    el.style.width = "auto";
    el.style.minWidth = "0";
    el.style.maxWidth = "none";
    el.style.overflow = "visible";
    el.style.whiteSpace = "nowrap";
  });

  // Measure
  cells.forEach((cell) => {
    maxWidth = Math.max(maxWidth, (cell as HTMLElement).scrollWidth);
  });

  // Restore original styles
  originals.forEach(({ el, w, min, max, overflow, whiteSpace }) => {
    el.style.width = w;
    el.style.minWidth = min;
    el.style.maxWidth = max;
    el.style.overflow = overflow;
    el.style.whiteSpace = whiteSpace;
  });

  return maxWidth + padding;
}

/**
 * Measure all columns at once (more efficient than individual calls).
 */
/**
 * Fallback measurement using querySelectorAll (slower but works without indexed access)
 */
function measureAllColumnsFallback(
  tableElement: HTMLTableElement,
  columnIds: string[],
  padding: number,
): Record<string, number> {
  const result: Record<string, number> = {};
  const idSet = new Set(columnIds);
  const originals: {
    el: HTMLElement;
    w: string;
    min: string;
    max: string;
    overflow: string;
    whiteSpace: string;
  }[] = [];

  const cells = tableElement.querySelectorAll("[data-column-id]");
  const relevant: HTMLElement[] = [];

  cells.forEach((cell) => {
    const id = cell.getAttribute("data-column-id");
    if (!id || !idSet.has(id)) return;

    const el = cell as HTMLElement;
    relevant.push(el);
    originals.push({
      el,
      w: el.style.width,
      min: el.style.minWidth,
      max: el.style.maxWidth,
      overflow: el.style.overflow,
      whiteSpace: el.style.whiteSpace,
    });
    el.style.width = "auto";
    el.style.minWidth = "0";
    el.style.maxWidth = "none";
    el.style.overflow = "visible";
    el.style.whiteSpace = "nowrap";
  });

  relevant.forEach((el) => {
    const id = el.getAttribute("data-column-id")!;
    result[id] = Math.max(result[id] ?? 0, el.scrollWidth);
  });

  originals.forEach(({ el, w, min, max, overflow, whiteSpace }) => {
    el.style.width = w;
    el.style.minWidth = min;
    el.style.maxWidth = max;
    el.style.overflow = overflow;
    el.style.whiteSpace = whiteSpace;
  });

  for (const id of columnIds) {
    if (result[id] != null) {
      result[id] += padding;
    }
  }

  return result;
}

/**
 * Measure all columns at once using native table API.
 * More efficient than measuring one at a time.
 *
 * Uses table.rows and row.cells for indexed access,
 * with data-column-id for ID lookup.
 */
export function measureAllColumns(
  tableElement: HTMLTableElement,
  columnIds: string[],
  padding: number = DEFAULT_MEASUREMENT_PADDING,
): Record<string, number> {
  const result: Record<string, number> = {};
  const idSet = new Set(columnIds);

  // Build column index → ID map from header row (single pass)
  const columnIndexToId: Map<number, string> = new Map();
  const headerRow = tableElement.tHead?.rows[0];
  if (headerRow) {
    for (let i = 0; i < headerRow.cells.length; i++) {
      const id = headerRow.cells[i].getAttribute("data-column-id");
      if (id && idSet.has(id)) {
        columnIndexToId.set(i, id);
      }
    }
  }

  // If no header columns found, fall back to querySelectorAll
  if (columnIndexToId.size === 0) {
    return measureAllColumnsFallback(tableElement, columnIds, padding);
  }

  const originals: {
    el: HTMLTableCellElement;
    w: string;
    min: string;
    max: string;
    overflow: string;
    whiteSpace: string;
  }[] = [];

  // Collect header cells
  for (const [idx] of columnIndexToId) {
    const cell = headerRow!.cells[idx];
    if (cell) {
      originals.push({
        el: cell,
        w: cell.style.width,
        min: cell.style.minWidth,
        max: cell.style.maxWidth,
        overflow: cell.style.overflow,
        whiteSpace: cell.style.whiteSpace,
      });
    }
  }

  // Collect body cells using indexed access
  const tbody = tableElement.tBodies[0];
  if (tbody) {
    for (let r = 0; r < tbody.rows.length; r++) {
      const row = tbody.rows[r];
      for (const [idx] of columnIndexToId) {
        const cell = row.cells[idx];
        if (cell) {
          originals.push({
            el: cell,
            w: cell.style.width,
            min: cell.style.minWidth,
            max: cell.style.maxWidth,
            overflow: cell.style.overflow,
            whiteSpace: cell.style.whiteSpace,
          });
        }
      }
    }
  }

  // Remove constraints
  for (const { el } of originals) {
    el.style.width = "auto";
    el.style.minWidth = "0";
    el.style.maxWidth = "none";
    el.style.overflow = "visible";
    el.style.whiteSpace = "nowrap";
  }

  // Measure using indexed access
  if (headerRow) {
    for (const [idx, id] of columnIndexToId) {
      result[id] = Math.max(result[id] ?? 0, headerRow.cells[idx]?.scrollWidth ?? 0);
    }
  }
  if (tbody) {
    for (let r = 0; r < tbody.rows.length; r++) {
      const row = tbody.rows[r];
      for (const [idx, id] of columnIndexToId) {
        const cell = row.cells[idx];
        if (cell) {
          result[id] = Math.max(result[id] ?? 0, cell.scrollWidth);
        }
      }
    }
  }

  // Restore
  for (const { el, w, min, max, overflow, whiteSpace } of originals) {
    el.style.width = w;
    el.style.minWidth = min;
    el.style.maxWidth = max;
    el.style.overflow = overflow;
    el.style.whiteSpace = whiteSpace;
  }

  // Add padding
  for (const id of columnIds) {
    if (result[id] != null) {
      result[id] += padding;
    }
  }

  return result;
}

// =============================================================================
// Data-Based Content Width Measurement (Canvas)
// =============================================================================

// Cached canvas context for text measurement
let measureCanvas: CanvasRenderingContext2D | null = null;

/**
 * Get or create a canvas context for text measurement.
 * Reuses the same context for all measurements (much faster than DOM).
 */
function getMeasureContext(): CanvasRenderingContext2D | null {
  if (measureCanvas) return measureCanvas;
  if (typeof document === "undefined") return null;

  const canvas = document.createElement("canvas");
  measureCanvas = canvas.getContext("2d");
  return measureCanvas;
}

/**
 * Measure text width using Canvas API.
 * Much faster than DOM measurement - no reflows, no style computation.
 *
 * @param text - The text to measure
 * @param font - CSS font string (e.g., "14px Inter, sans-serif")
 * @returns Width in pixels
 */
export function measureTextWidth(text: string, font: string = "14px Inter, sans-serif"): number {
  const ctx = getMeasureContext();
  if (!ctx) return 0;

  ctx.font = font;
  return ctx.measureText(text).width;
}

/**
 * Measure max content width for a column using data directly.
 * Uses Canvas measureText() for text columns - extremely fast.
 *
 * @param data - Array of row data
 * @param getTextValue - Function to extract text from each row
 * @param headerText - Column header text (included in measurement)
 * @param font - CSS font string for cell content
 * @param headerFont - CSS font string for header (usually bolder)
 * @param padding - Additional padding for cell spacing
 * @returns Max width needed to fit all content
 */
export function measureColumnFromData<TData>(
  data: TData[],
  getTextValue: (row: TData) => string,
  headerText: string,
  font: string = "14px Inter, sans-serif",
  headerFont: string = "600 14px Inter, sans-serif",
  padding: number = DEFAULT_MEASUREMENT_PADDING,
): number {
  const ctx = getMeasureContext();
  if (!ctx) return 0;

  // Measure header
  ctx.font = headerFont;
  let maxWidth = ctx.measureText(headerText).width;

  // Measure all data rows
  ctx.font = font;
  for (const row of data) {
    const text = getTextValue(row);
    if (text) {
      maxWidth = Math.max(maxWidth, ctx.measureText(text).width);
    }
  }

  return Math.ceil(maxWidth) + padding;
}

/**
 * Measure max content widths for multiple columns using data.
 * Batch version for efficiency.
 */
export function measureColumnsFromData<TData>(
  data: TData[],
  columns: Array<{
    id: string;
    headerText: string;
    getTextValue?: (row: TData) => string;
  }>,
  font: string = "14px Inter, sans-serif",
  headerFont: string = "600 14px Inter, sans-serif",
  padding: number = DEFAULT_MEASUREMENT_PADDING,
): Record<string, number> {
  const result: Record<string, number> = {};
  const ctx = getMeasureContext();
  if (!ctx) return result;

  for (const col of columns) {
    if (!col.getTextValue) continue; // Skip columns without text accessor

    // Measure header
    ctx.font = headerFont;
    let maxWidth = ctx.measureText(col.headerText).width;

    // Measure all data rows
    ctx.font = font;
    for (const row of data) {
      const text = col.getTextValue(row);
      if (text) {
        maxWidth = Math.max(maxWidth, ctx.measureText(text).width);
      }
    }

    result[col.id] = Math.ceil(maxWidth) + padding;
  }

  return result;
}

// =============================================================================
// CSS Variable Helpers
// =============================================================================

/** Generate CSS variable name for a column */
export function getColumnCSSVariable(columnId: string): string {
  return `--col-${columnId.replace(/[^a-zA-Z0-9-_]/g, "-")}`;
}

/** Generate CSS var() reference for a column */
export function getColumnCSSValue(columnId: string, fallback: number = 100): string {
  return `var(${getColumnCSSVariable(columnId)}, ${fallback}px)`;
}

/** Generate CSS variables object for all columns */
export function generateCSSVariables(widths: Record<string, number>): React.CSSProperties {
  const vars: Record<string, string> = {};
  for (const [id, width] of Object.entries(widths)) {
    vars[getColumnCSSVariable(id)] = `${width}px`;
  }
  return vars as React.CSSProperties;
}
