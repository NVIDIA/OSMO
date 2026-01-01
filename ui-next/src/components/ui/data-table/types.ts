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
 * DataTable Component Types
 */

import type { ColumnDef, SortState, SortDirection } from "@/lib/table";

export interface DataTableProps<TData, TColumnId extends string> {
  /** Data items to display */
  data: TData[];
  /** Visible columns in display order */
  columns: ColumnDef<TColumnId>[];
  /** Currently selected item key */
  selectedKey: string | null;
  /** Get unique key for each item */
  getRowKey: (item: TData) => string;
  /** Render cell content */
  renderCell: (item: TData, columnId: TColumnId) => React.ReactNode;
  /** Callback when item is selected */
  onSelect: (item: TData) => void;
  /** Current sort state */
  sort: SortState<TColumnId>;
  /** Callback when sort changes */
  onSort: (column: TColumnId) => void;
  /** Optional column IDs (for DND reordering) */
  optionalColumnIds: TColumnId[];
  /** Mandatory column IDs (not draggable) */
  mandatoryColumnIds: ReadonlySet<TColumnId>;
  /** Callback when columns are reordered */
  onReorderColumns: (newOrder: TColumnId[]) => void;
  /** Row height in pixels */
  rowHeight?: number;
  /** Virtualization overscan */
  overscan?: number;
  /** Gap between columns */
  columnGap?: number;
  /** Custom row className */
  rowClassName?: string | ((item: TData, isSelected: boolean) => string);
  /** Empty state message */
  emptyMessage?: string;
}

export interface DataTableHeaderProps<TColumnId extends string> {
  /** Columns to display */
  columns: ColumnDef<TColumnId>[];
  /** CSS grid template */
  gridTemplate: string;
  /** Minimum width */
  minWidth: number;
  /** Current sort state */
  sort: SortState<TColumnId>;
  /** Callback when sort changes */
  onSort: (column: TColumnId) => void;
  /** Optional column IDs (for DND reordering) */
  optionalColumnIds: TColumnId[];
  /** Mandatory column IDs (not draggable) */
  mandatoryColumnIds: ReadonlySet<TColumnId>;
  /** Callback when columns are reordered */
  onReorder: (newOrder: TColumnId[]) => void;
  /** Gap between columns */
  gap?: number;
}

export interface DataTableRowProps<TData, TColumnId extends string> {
  /** Data item */
  item: TData;
  /** Columns to display */
  columns: ColumnDef<TColumnId>[];
  /** CSS grid template */
  gridTemplate: string;
  /** Minimum width */
  minWidth: number;
  /** Whether row is selected */
  isSelected: boolean;
  /** Callback when row is selected */
  onSelect: () => void;
  /** Render cell content */
  renderCell: (item: TData, columnId: TColumnId) => React.ReactNode;
  /** Gap between columns */
  gap?: number;
  /** Custom className */
  className?: string;
}
