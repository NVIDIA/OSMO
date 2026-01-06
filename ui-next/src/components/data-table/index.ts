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
 * Data Table Components
 *
 * A high-performance, accessible table component built on TanStack Table.
 *
 * Features:
 * - Native <table> markup for accessibility
 * - Virtualized rendering via TanStack Virtual
 * - Sticky section headers
 * - Infinite scroll pagination
 * - Drag-and-drop column reordering
 * - Column resizing (TanStack native)
 */

// =============================================================================
// Components
// =============================================================================

export { DataTable, type DataTableProps } from "./DataTable";
export { VirtualTableBody, type VirtualTableBodyProps } from "./VirtualTableBody";
export { TableSkeleton, type TableSkeletonProps } from "./TableSkeleton";
export { TableToolbar, type TableToolbarProps, type ColumnDefinition } from "./TableToolbar";
export { SortButton } from "./SortButton";
export { SortableCell } from "./SortableCell";
export { ResizeHandle, type ResizeHandleProps } from "./ResizeHandle";

// =============================================================================
// Hooks
// =============================================================================

export {
  useTableDnd,
  restrictToHorizontalAxis,
  restrictToParentBounds,
  AUTO_SCROLL_CONFIG,
} from "./hooks/use-column-reordering";

export {
  useVirtualizedTable,
  type UseVirtualizedTableOptions,
  type UseVirtualizedTableResult,
  type VirtualizedRow,
} from "./hooks/use-virtualized-table";

export { useColumnSizing, type UseColumnSizingOptions, type UseColumnSizingResult } from "./hooks/use-column-sizing";

export {
  useRowNavigation,
  type UseRowNavigationOptions,
  type UseRowNavigationResult,
} from "./hooks/use-row-navigation";

// =============================================================================
// Types
// =============================================================================

export type { SortDirection, SortState, SortButtonProps, SortableCellProps, Section, ColumnSizeConfig } from "./types";

// Re-export TanStack Table types
export type {
  ColumnDef,
  SortingState,
  VisibilityState,
  ColumnOrderState,
  ColumnSizingState,
  ColumnSizingInfoState,
  Row,
  Cell,
  Header,
  HeaderGroup,
} from "@tanstack/react-table";

// =============================================================================
// Utilities
// =============================================================================

export { remToPx, getColumnCSSValue } from "./utils/column-sizing";
export { COLUMN_MIN_WIDTHS_REM } from "./utils/column-constants";
