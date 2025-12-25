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
 * Column configuration for responsive CSS Grid tables.
 *
 * Each column has a minimum width (prevents content overflow) and a flex value
 * (proportional scaling when space is available).
 *
 * ## Basic Usage
 * ```tsx
 * const columns = defineColumns([
 *   { id: 'name', minWidth: 140, flex: 3 },      // Wide column for names
 *   { id: 'status', minWidth: 80, flex: 1 },     // Narrow for short text
 *   { id: 'memory', minWidth: 115, flex: 1.4 },  // Medium for "512/1,024 Gi"
 * ]);
 * ```
 *
 * ## CSS Custom Property Pattern (Recommended)
 *
 * For tables with sticky headers, set the grid template once via CSS custom property
 * so header and body rows automatically align:
 *
 * ```tsx
 * // Container sets the variable once
 * <div
 *   style={{
 *     '--table-grid-columns': columns.gridTemplate,
 *     minWidth: columns.minWidth,
 *   } as React.CSSProperties}
 * >
 *   <TableHeader />  // Uses var(--table-grid-columns)
 *   <TableBody />    // Uses var(--table-grid-columns)
 * </div>
 *
 * // Header and rows reference the variable
 * <div style={{ gridTemplateColumns: 'var(--table-grid-columns)' }}>
 *   {cells}
 * </div>
 * ```
 *
 * This ensures header and body columns are always aligned without passing
 * the same config to multiple components.
 */

export interface ColumnDef {
  /** Unique identifier for the column */
  id: string;
  /** Minimum width in pixels - prevents content from being cut off */
  minWidth: number;
  /** Flex value (fr units) - how much of remaining space this column gets */
  flex: number;
}

export interface ColumnConfig {
  /** CSS grid-template-columns value */
  gridTemplate: string;
  /** Minimum table width (sum of all column minimums) */
  minWidth: number;
  /** Column definitions for reference */
  columns: ColumnDef[];
}

/**
 * Define table columns with proportional sizing.
 *
 * Generates a CSS Grid template where each column:
 * - Has a minimum width to prevent content overflow
 * - Scales proportionally using fr units when extra space is available
 *
 * @param columns - Array of column definitions
 * @returns Configuration object with gridTemplate and calculated minWidth
 *
 * @example
 * ```tsx
 * // Resource table columns
 * const resourceColumns = defineColumns([
 *   { id: 'name', minWidth: 140, flex: 3 },      // Resource names are long
 *   { id: 'platform', minWidth: 80, flex: 1.5 }, // Medium text
 *   { id: 'gpu', minWidth: 80, flex: 1 },        // Short numbers: "128/256"
 *   { id: 'memory', minWidth: 115, flex: 1.4 },  // Numbers + unit: "512/1,024 Gi"
 * ]);
 *
 * // In your table header/row:
 * <div
 *   style={{
 *     display: 'grid',
 *     gridTemplateColumns: resourceColumns.gridTemplate,
 *     minWidth: resourceColumns.minWidth,
 *   }}
 * >
 * ```
 */
export function defineColumns(columns: ColumnDef[]): ColumnConfig {
  const gridTemplate = columns.map((col) => `minmax(${col.minWidth}px, ${col.flex}fr)`).join(" ");

  const minWidth = columns.reduce((sum, col) => sum + col.minWidth, 0);

  return {
    gridTemplate,
    minWidth,
    columns,
  };
}

/**
 * Create a subset of columns (e.g., hide a column conditionally).
 *
 * @param config - Original column configuration
 * @param columnIds - IDs of columns to include
 * @returns New configuration with only specified columns
 *
 * @example
 * ```tsx
 * const allColumns = defineColumns([...]);
 * const withoutPools = selectColumns(allColumns, ['name', 'platform', 'gpu']);
 * ```
 */
export function selectColumns(config: ColumnConfig, columnIds: string[]): ColumnConfig {
  const selectedColumns = columnIds
    .map((id) => config.columns.find((col) => col.id === id))
    .filter((col): col is ColumnDef => col !== undefined);

  return defineColumns(selectedColumns);
}

// =============================================================================
// Pre-calculated minimum widths for common content types
// =============================================================================

/**
 * Recommended minimum widths for common column content types.
 *
 * These are calculated based on:
 * - Typical content length
 * - 14px font with tabular-nums (~8px per character)
 * - px-4 padding (32px total)
 *
 * Use these as starting points and adjust based on your actual content.
 */
export const COLUMN_MIN_WIDTHS = {
  /** Text that truncates with ellipsis (names, descriptions) */
  TEXT_TRUNCATE: 140,

  /** Short text labels (status, type) */
  TEXT_SHORT: 80,

  /** Short numbers: "128/256", "1.5K/2K" (7 chars) */
  NUMBER_SHORT: 80,

  /** Numbers with units: "512/1,024 Gi" (12 chars) */
  NUMBER_WITH_UNIT: 115,

  /** Timestamps: "2024-01-15 14:30" */
  TIMESTAMP: 140,

  /** Actions column (icon buttons) */
  ACTIONS_SMALL: 50,
  ACTIONS_MEDIUM: 80,
} as const;

/**
 * Recommended flex values for proportional scaling.
 */
export const COLUMN_FLEX = {
  /** Primary/main column (e.g., name) - gets most space */
  PRIMARY: 3,

  /** Secondary text columns */
  SECONDARY: 1.5,

  /** Numeric columns with units */
  NUMERIC_WIDE: 1.4,

  /** Short numeric columns */
  NUMERIC: 1,

  /** Fixed-width columns (actions, icons) */
  FIXED: 0,
} as const;
