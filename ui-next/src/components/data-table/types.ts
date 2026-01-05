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
