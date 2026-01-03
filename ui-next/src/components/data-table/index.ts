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
 *
 * @example
 * ```tsx
 * import { DataTable, type ColumnDef } from "@/components/data-table";
 *
 * const columns: ColumnDef<Pool>[] = [
 *   { accessorKey: "name", header: "Pool Name" },
 *   { accessorKey: "status", header: "Status" },
 * ];
 *
 * <DataTable
 *   data={pools}
 *   columns={columns}
 *   getRowId={(row) => row.name}
 * />
 * ```
 */

// =============================================================================
// Main DataTable Component
// =============================================================================

export { DataTable, type DataTableProps } from "./DataTable";

// =============================================================================
// Sub-components (for advanced/custom usage)
// =============================================================================

export { VirtualTableBody, type VirtualTableBodyProps } from "./VirtualTableBody";
export { SortButton } from "./SortButton";
export { SortableCell } from "./SortableCell";

// =============================================================================
// Hooks
// =============================================================================

export { useTableDnd, restrictToHorizontalAxis } from "./hooks/use-table-dnd";
export {
  useVirtualizedTable,
  type UseVirtualizedTableOptions,
  type UseVirtualizedTableResult,
  type VirtualizedRow,
} from "./hooks/use-virtualized-table";

// =============================================================================
// Types
// =============================================================================

export type {
  // Sort types
  SortDirection,
  SortState,
  SortButtonProps,
  SortableCellProps,
  // Section types
  Section,
} from "./types";

// Re-export useful TanStack Table types for consumers
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

// Export sort state helper
export { cycleSortState } from "./types";
