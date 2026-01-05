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
 * Data Table Types
 *
 * Type definitions for the canonical DataTable component.
 * Built on TanStack Table with extensions for:
 * - Native <table> markup
 * - Virtualization
 * - Section grouping
 * - Sticky headers
 */

// =============================================================================
// Sort Types
// =============================================================================

export type SortDirection = "asc" | "desc";

export interface SortState<TColumnId extends string = string> {
  column: TColumnId | null;
  direction: SortDirection;
}

/**
 * Cycle sort state: asc -> desc -> none
 */
export function cycleSortState<TColumnId extends string>(
  current: SortState<TColumnId>,
  columnId: TColumnId,
): SortState<TColumnId> {
  if (current.column !== columnId) {
    return { column: columnId, direction: "asc" };
  }
  if (current.direction === "asc") {
    return { column: columnId, direction: "desc" };
  }
  return { column: null, direction: "asc" };
}

// =============================================================================
// Sort Button Props
// =============================================================================

export interface SortButtonProps {
  id: string;
  label: string;
  align?: "left" | "right";
  sortable?: boolean;
  isActive: boolean;
  direction?: SortDirection;
  onSort: () => void;
}

// =============================================================================
// Sortable Cell Props
// =============================================================================

export interface SortableCellProps {
  id: string;
  children: React.ReactNode;
  className?: string;
  as?: "th" | "div";
  width?: string;
  /** Column index for aria-colindex (1-based) */
  colIndex?: number;
}

// =============================================================================
// Section Types
// =============================================================================

export interface Section<T, TMetadata = unknown> {
  id: string;
  label: string;
  items: T[];
  metadata?: TMetadata;
}

// =============================================================================
// Column Sizing Types - Simplified Model
// =============================================================================

/**
 * Configuration for a column's sizing behavior.
 *
 * Uses rem for design-time (accessibility), converted to px at runtime.
 */
export interface ColumnSizeConfig<TData = unknown> {
  /** Column identifier */
  id: string;

  /**
   * Minimum width in rem.
   * Floor - column cannot shrink below this.
   */
  minWidthRem: number;

  /**
   * Proportional share for space distribution.
   * Higher = larger share of extra space.
   * Like CSS flex-grow.
   */
  share: number;

  /**
   * Optional: Extract text value from row data for content width measurement.
   * If provided, uses fast Canvas measureText() instead of DOM inspection.
   * For complex cells (icons, badges), omit this and fall back to DOM measurement.
   */
  getTextValue?: (row: TData) => string;
}

/**
 * User override for a column from manual resizing.
 *
 * When user resizes:
 * - minWidthPx = the resized width (new floor for this column)
 * - share = preserved from config (for proportional participation)
 *
 * maxWidth still comes from content measurement.
 */
export interface ColumnOverride {
  /** New minimum width in pixels (the resized width becomes the floor) */
  minWidthPx: number;
  /** Original share preserved (column still participates in proportional growth) */
  share: number;
}

/**
 * Result of column width calculation.
 */
export interface ColumnWidthsResult {
  /** Computed width for each column in pixels */
  widths: Record<string, number>;
  /** Total width of all columns */
  totalWidth: number;
  /** Whether horizontal scroll is needed (container < total min) */
  needsScroll: boolean;
  /** Remaining whitespace on right (0 if scrolling or all columns at max) */
  whitespace: number;
}

// =============================================================================
// Resize Handle Props
// =============================================================================

export interface ResizeHandleProps {
  columnId: string;
  onPointerDown: (e: React.PointerEvent, columnId: string) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
  onDoubleClick: (columnId: string) => void;
}
