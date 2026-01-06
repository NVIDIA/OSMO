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
 * Configuration for a column's minimum width.
 * Uses rem for accessibility (scales with user font size).
 */
export interface ColumnSizeConfig {
  /** Column identifier */
  id: string;
  /** Minimum width in rem units */
  minWidthRem: number;
}
