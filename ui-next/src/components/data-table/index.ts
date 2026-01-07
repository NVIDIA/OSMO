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

export {
  useColumnSizing,
  type UseColumnSizingOptions,
  type UseColumnSizingResult,
  // Pure functions and types for testing
  sizingReducer,
  calculateColumnWidths,
  getRemToPx,
  type SizingState,
  type SizingEvent,
  type SizingMode,
  type ResizingContext,
  INITIAL_STATE,
  DEFAULT_COLUMN_SIZING_INFO,
} from "./hooks/use-column-sizing";

export {
  useRowNavigation,
  type UseRowNavigationOptions,
  type UseRowNavigationResult,
} from "./hooks/use-row-navigation";

// =============================================================================
// Types
// =============================================================================

export type {
  SortDirection,
  SortState,
  SortButtonProps,
  SortableCellProps,
  Section,
  ColumnSizeConfig,
  ColumnWidthConfig,
  ColumnSizingPreference,
  ColumnSizingPreferences,
} from "./types";

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
export {
  COLUMN_MIN_WIDTHS_REM,
  COLUMN_PREFERRED_WIDTHS_REM,
  AVG_CHAR_WIDTH_REM,
  CELL_PADDING_REM,
  CELL_BUFFER_REM,
} from "./utils/column-constants";

// Debug utilities (enable via localStorage.setItem('DEBUG_COLUMN_SIZING', 'true'))
export { logColumnSizingDebug, flushDebugBuffer, type DebugEventType, type DebugSnapshot } from "./utils/debug";

// =============================================================================
// Constants
// =============================================================================

export {
  // Exhaustive switch helper
  assertNever,
  // Preference modes
  PreferenceModes,
  type PreferenceMode,
  PREFERENCE_MODE_VALUES,
  // Sort directions
  SortDirections,
  SORT_DIRECTION_VALUES,
  // Sizing state machine modes
  SizingModes,
  SIZING_MODE_VALUES,
  // Sizing events
  SizingEventTypes,
  type SizingEventType,
  SIZING_EVENT_TYPE_VALUES,
  // Debug event types
  DebugEventTypes,
  DEBUG_EVENT_TYPE_VALUES,
  // Column width config types
  ColumnWidthConfigTypes,
  type ColumnWidthConfigType,
  COLUMN_WIDTH_CONFIG_TYPE_VALUES,
  // Virtual item types
  VirtualItemTypes,
  type VirtualItemType,
  VIRTUAL_ITEM_TYPE_VALUES,
  // Scroll alignment
  ScrollAlignments,
  type ScrollAlignment,
  SCROLL_ALIGNMENT_VALUES,
  // Text alignment
  TextAlignments,
  type TextAlignment,
  TEXT_ALIGNMENT_VALUES,
  // Element types
  ElementTypes,
  type ElementType,
  ELEMENT_TYPE_VALUES,
} from "./constants";
