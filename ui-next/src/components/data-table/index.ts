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
 * Data Table Components
 *
 * A high-performance, accessible table component system built on TanStack Table.
 *
 * Features:
 * - Native <table> markup for accessibility
 * - Virtualized rendering via TanStack Virtual
 * - Sticky section headers (for grouped data)
 * - Infinite scroll pagination
 * - Drag-and-drop column reordering
 * - Sortable column headers
 * - Share-based proportional column sizing
 */

// =============================================================================
// Main Components
// =============================================================================

export { DataTable, type DataTableProps } from "./DataTable";
export { VirtualTableBody, type VirtualTableBodyProps } from "./VirtualTableBody";
export { TableSkeleton, type TableSkeletonProps } from "./TableSkeleton";
export { SortButton } from "./SortButton";
export { SortableCell } from "./SortableCell";
export { ResizeHandle, type ResizeHandleProps as ResizeHandleComponentProps } from "./ResizeHandle";

// =============================================================================
// Hooks
// =============================================================================

export {
  useTableDnd,
  restrictToHorizontalAxis,
  restrictToParentBounds,
  AUTO_SCROLL_CONFIG,
} from "./hooks/use-table-dnd";

export {
  useVirtualizedTable,
  type UseVirtualizedTableOptions,
  type UseVirtualizedTableResult,
  type VirtualizedRow,
} from "./hooks/use-virtualized-table";

export {
  useUnifiedColumnSizing,
  type UseUnifiedColumnSizingOptions,
  type UseUnifiedColumnSizingResult,
} from "./hooks/use-unified-column-sizing";

export {
  useOptimizedColumnSizing,
  type UseOptimizedColumnSizingOptions,
  type UseOptimizedColumnSizingResult,
} from "./hooks/use-optimized-column-sizing";

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
  ColumnOverride,
  ColumnWidthsResult,
  ResizeHandleProps,
} from "./types";

export { cycleSortState } from "./types";

// Re-export TanStack Table types
export type {
  ColumnDef,
  SortingState,
  VisibilityState,
  ColumnOrderState,
  Row,
  Cell,
  Header,
  HeaderGroup,
} from "@tanstack/react-table";

// =============================================================================
// Column Sizing Utilities
// =============================================================================

export {
  // Rem ↔ Pixel conversion
  getBaseFontSize,
  remToPx,
  pxToRem,
  // Column resolution
  resolveColumns,
  type ResolvedColumn,
  // Core calculation
  calculateColumnWidths,
  // DOM-based content measurement (native table API)
  measureColumnByIndex,
  measureColumnContentWidth,
  measureAllColumns,
  DEFAULT_MEASUREMENT_PADDING,
  // Data-based content measurement (fast, for text columns)
  measureTextWidth,
  measureColumnFromData,
  measureColumnsFromData,
  // CSS variable helpers
  generateCSSVariables,
  getColumnCSSVariable,
  getColumnCSSValue,
} from "./utils/column-sizing";

// =============================================================================
// High-Performance Utilities
// =============================================================================

// Measurement Cache (Canvas-based, no DOM reflows)
export {
  MeasurementCache,
  getMeasurementCache,
  clearAllCaches,
  measureText,
  measureTexts,
  type MeasurementCacheConfig,
  type ColumnMeasurement,
} from "./utils/measurement-cache";

// Fast Layout Engine (Typed Arrays)
export {
  createFastLayout,
  updateLayoutInputs,
  calculateFastLayout,
  updateSingleColumnWidth,
  getColumnWidth,
  exportWidths,
  generateCSSString,
  applyWidthsToElement,
  type FastColumnLayout,
  type LayoutResult,
} from "./utils/fast-layout";
