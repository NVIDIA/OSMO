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
 * All dimensions use rem for accessibility (scales with user font preferences).
 *
 * Pattern borrowed from workflow-explorer's GroupPanel.
 */

import type { ColumnDef, ColumnWidth } from "./types";

// =============================================================================
// Grid Template Generation
// =============================================================================

const gridTemplateCache = new Map<string, string>();

/**
 * Generate CSS grid-template-columns from column definitions.
 * Uses rem units for accessibility.
 *
 * @param columns - Array of visible column definitions
 * @returns CSS grid-template-columns value
 *
 * @example
 * ```tsx
 * const columns = [
 *   { id: 'name', width: { min: 10, share: 2.8 } },
 *   { id: 'status', width: 5 },
 * ];
 * getGridTemplate(columns); // "minmax(10rem, 2.8fr) 5rem"
 * ```
 */
export function getGridTemplate<TColumnId extends string>(columns: ColumnDef<TColumnId>[]): string {
  const key = columns.map((c) => c.id).join(",");
  let cached = gridTemplateCache.get(key);
  if (cached) return cached;

  cached = columns
    .map((col) => {
      if (typeof col.width === "number") return `${col.width}rem`;
      if ("fit" in col.width) return `minmax(max-content, ${col.width.share}fr)`;
      return `minmax(${col.width.min}rem, ${col.width.share}fr)`;
    })
    .join(" ");

  gridTemplateCache.set(key, cached);
  return cached;
}

/**
 * Calculate minimum table width from column definitions.
 * Returns value in rem for use with CSS.
 *
 * @param columns - Array of visible column definitions
 * @param gapRem - Gap between columns in rem (default 0)
 * @returns Minimum width in rem
 */
export function getMinTableWidth<TColumnId extends string>(
  columns: ColumnDef<TColumnId>[],
  gapRem: number = 0,
): number {
  const fixedWidth = columns.reduce((sum, col) => {
    if (typeof col.width === "number") return sum + col.width;
    if ("fit" in col.width) return sum; // fit columns are content-sized
    return sum + col.width.min;
  }, 0);

  // Add gap spacing
  return fixedWidth + (columns.length - 1) * gapRem;
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
// Recommended Widths (in rem)
// =============================================================================

/**
 * Recommended minimum widths for common content types (in rem).
 * These scale with user font preferences for accessibility.
 */
export const MIN_WIDTHS = {
  /** Text that truncates (names, descriptions) */
  TEXT_TRUNCATE: 9,
  /** Short text labels (status, type) */
  TEXT_SHORT: 5,
  /** Short numbers: "128/256" */
  NUMBER_SHORT: 5,
  /** Numbers with units: "512/1,024 Gi" */
  NUMBER_WITH_UNIT: 7,
  /** Timestamps */
  TIMESTAMP: 9,
  /** Icon-only column */
  ICON: 1.5,
  /** Small actions */
  ACTIONS_SMALL: 3,
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
