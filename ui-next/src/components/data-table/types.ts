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
 * Type definitions for the DataTable component built on TanStack Table.
 */

// =============================================================================
// Sort Types
// =============================================================================

export type SortDirection = "asc" | "desc";

export interface SortState<TColumnId extends string = string> {
  column: TColumnId | null;
  direction: SortDirection;
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
// Column Sizing Types
// =============================================================================

/**
 * Configuration for a column's sizing behavior.
 * Uses rem for accessibility (scales with user font size).
 */
export interface ColumnSizeConfig<TData = unknown> {
  /** Column identifier */
  id: string;
  /** Minimum width in rem units (absolute floor) */
  minWidthRem: number;
  /**
   * Preferred width in rem units.
   * Used for initial sizing and as floor for no-truncate mode.
   * If not provided, defaults to minWidthRem × 1.5.
   */
  preferredWidthRem?: number;
  /**
   * Optional dynamic width calculation (overrides preferredWidthRem).
   * Used for text-based content width estimation.
   */
  widthConfig?: ColumnWidthConfig<TData>;
}

/**
 * Configuration for dynamically calculating a column's preferred width.
 * Used when preferred width depends on actual data content.
 */
export interface ColumnWidthConfig<TData = unknown> {
  /** Calculate from text content length */
  type: "text";
  /** Function to extract text from row data */
  accessor: (row: TData) => string;
  /** Average character width in rem (default: 0.55) */
  charWidthRem?: number;
  /** Cell padding in rem (default: 2 for px-4) */
  paddingRem?: number;
  /** Maximum width cap in rem */
  maxWidthRem?: number;
}

// =============================================================================
// Column Sizing Preference (Persisted)
// =============================================================================

/**
 * User's preference for a column's sizing behavior.
 * Persisted to localStorage for session continuity.
 *
 * ## Mode
 * - "truncate": User accepts truncation. Floor = persisted width.
 * - "no-truncate": User wants full content. Floor = preferred width (content-driven).
 *
 * ## How mode is determined
 * - User shrinks column below preferredWidth → "truncate" (accepts truncation)
 * - User expands/keeps column at or above preferredWidth → "no-truncate"
 * - Double-click auto-fit → "no-truncate"
 *
 * ## Columns without preference
 * - No floor lock, can shrink from preferred to min dynamically
 */
export interface ColumnSizingPreference {
  /** Persisted pixel width from last resize */
  width: number;
  /** Resize behavior mode */
  mode: "truncate" | "no-truncate";
}

/**
 * Map of column IDs to sizing preferences.
 */
export type ColumnSizingPreferences = Record<string, ColumnSizingPreference>;
