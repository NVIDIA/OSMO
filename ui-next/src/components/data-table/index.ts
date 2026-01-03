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
 * A high-performance, generic table component system that supports:
 * - Virtualized rendering for large datasets
 * - Optional section grouping (e.g., by status)
 * - Infinite scroll pagination
 * - Drag-and-drop column reordering
 * - Sortable column headers
 * - CSS Grid layout
 *
 * @example
 * ```tsx
 * import {
 *   DataTable,
 *   type ColumnConfig,
 *   type SortState,
 * } from "@/components/data-table";
 *
 * const columns: ColumnConfig<"name" | "status">[] = [
 *   { id: "name", label: "Name", minWidth: 140, flex: 2, mandatory: true },
 *   { id: "status", label: "Status", minWidth: 80, flex: 1 },
 * ];
 *
 * <DataTable
 *   items={data}
 *   getRowKey={(item) => item.id}
 *   columns={columns}
 *   visibleColumnIds={["name", "status"]}
 *   renderCell={(item, columnId) => <Cell {...} />}
 *   rowHeight={48}
 * />
 * ```
 */

// Main component
export { DataTable } from "./DataTable";

// Sub-components (for advanced customization)
export { TableHeader } from "./TableHeader";
export { TableBody } from "./TableBody";
export { SortButton } from "./SortButton";
export { SortableCell } from "./SortableCell";

// Hooks
export { useTableDnd, restrictToHorizontalAxis } from "./hooks/use-table-dnd";

// Types
export type {
  ColumnConfig,
  SortDirection,
  SortState,
  Section,
  VirtualItem,
  DataTableProps,
  TableHeaderProps,
  SortButtonProps,
  SortableCellProps,
} from "./types";

// Utilities
export {
  columnsToGridTemplate,
  getVisibleColumns,
  partitionColumns,
  cycleSortState,
  sectionsToVirtualItems,
  itemsToVirtualItems,
} from "./types";
