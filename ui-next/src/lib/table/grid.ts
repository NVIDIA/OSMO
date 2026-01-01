/**
 * Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

/**
 * CSS Grid Template Utilities
 *
 * Generate responsive grid templates from column definitions.
 * Uses minmax(min, share fr) for flexible, aligned columns.
 *
 * Pattern borrowed from workflow-explorer's GroupPanel.
 */

import type { ColumnDef, ColumnWidth } from "./types";

// =============================================================================
// Grid Template Generation
// =============================================================================

const gridTemplateCache = new Map<string, string>();
const minWidthCache = new Map<string, number>();

/**
 * Generate CSS grid-template-columns from column definitions.
 *
 * @param columns - Array of visible column definitions
 * @returns CSS grid-template-columns value
 *
 * @example
 * ```tsx
 * const columns = [
 *   { id: 'name', width: { min: 150, share: 2.8 } },
 *   { id: 'status', width: 80 },
 * ];
 * getGridTemplate(columns); // "minmax(150px, 2.8fr) 80px"
 * ```
 */
export function getGridTemplate<TColumnId extends string>(columns: ColumnDef<TColumnId>[]): string {
  const key = columns.map((c) => c.id).join(",");
  let cached = gridTemplateCache.get(key);
  if (cached) return cached;

  cached = columns
    .map((col) => {
      if (typeof col.width === "number") return `${col.width}px`;
      return `minmax(${col.width.min}px, ${col.width.share}fr)`;
    })
    .join(" ");

  gridTemplateCache.set(key, cached);
  return cached;
}

/**
 * Calculate minimum table width from column definitions.
 *
 * @param columns - Array of visible column definitions
 * @param gap - Gap between columns in pixels (default 24)
 * @returns Minimum width in pixels
 */
export function getMinTableWidth<TColumnId extends string>(
  columns: ColumnDef<TColumnId>[],
  gap: number = 0,
): number {
  const key = `${columns.map((c) => c.id).join(",")}-${gap}`;
  let cached = minWidthCache.get(key);
  if (cached) return cached;

  const fixedWidth = columns.reduce((sum, col) => {
    if (typeof col.width === "number") return sum + col.width;
    return sum + col.width.min;
  }, 0);

  // Add gap spacing
  cached = fixedWidth + (columns.length - 1) * gap;

  minWidthCache.set(key, cached);
  return cached;
}

/**
 * Get ordered visible columns from column map and order array.
 *
 * @param columnMap - Map of column ID to column definition
 * @param columnOrder - Array of column IDs in display order
 * @param visibleColumnIds - Array of visible column IDs
 * @returns Array of column definitions in display order
 */
export function getOrderedColumns<TColumnId extends string>(
  columnMap: Map<TColumnId, ColumnDef<TColumnId>>,
  columnOrder: TColumnId[],
  visibleColumnIds: TColumnId[],
): ColumnDef<TColumnId>[] {
  return columnOrder
    .filter((id) => visibleColumnIds.includes(id))
    .map((id) => columnMap.get(id))
    .filter((col): col is ColumnDef<TColumnId> => col !== undefined);
}

// =============================================================================
// Recommended Widths
// =============================================================================

/**
 * Recommended minimum widths for common content types.
 */
export const MIN_WIDTHS = {
  /** Text that truncates (names, descriptions) */
  TEXT_TRUNCATE: 140,
  /** Short text labels (status, type) */
  TEXT_SHORT: 80,
  /** Short numbers: "128/256" */
  NUMBER_SHORT: 80,
  /** Numbers with units: "512/1,024 Gi" */
  NUMBER_WITH_UNIT: 115,
  /** Timestamps */
  TIMESTAMP: 140,
  /** Icon-only column */
  ICON: 24,
  /** Small actions */
  ACTIONS_SMALL: 50,
} as const;

/**
 * Recommended share values for proportional scaling.
 */
export const SHARES = {
  /** Primary column (name) - gets most space */
  PRIMARY: 3,
  /** Secondary text columns */
  SECONDARY: 1.5,
  /** Numeric columns */
  NUMERIC: 1,
  /** Narrow columns */
  NARROW: 0.8,
  /** Fixed width (no scaling) */
  FIXED: 0,
} as const;
