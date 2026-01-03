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
 * DataTable
 *
 * Canonical data table component built on TanStack Table.
 * Features:
 * - Native <table> markup for accessibility
 * - Virtualization for large datasets
 * - DnD column reordering
 * - Optional section grouping with sticky headers
 * - Infinite scroll pagination
 */

"use client";

import { useMemo, useRef, useCallback } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  type ColumnDef,
  type SortingState,
  type OnChangeFn,
  type VisibilityState,
  type Row,
} from "@tanstack/react-table";
import { DndContext, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { cn } from "@/lib/utils";

import { SortableCell } from "./SortableCell";
import { SortButton } from "./SortButton";
import { VirtualTableBody } from "./VirtualTableBody";
import { useVirtualizedTable } from "./hooks/use-virtualized-table";
import { useTableDnd } from "./hooks/use-table-dnd";
import type { Section, SortState, SortDirection } from "./types";

// =============================================================================
// Types
// =============================================================================

export interface DataTableProps<TData, TSectionMeta = unknown> {
  // === Data ===
  /** Flat data items (used when not using sections) */
  data: TData[];
  /** Column definitions */
  columns: ColumnDef<TData, unknown>[];
  /** Get unique row ID */
  getRowId: (row: TData) => string;

  // === Sections (optional) ===
  /** Sectioned data (overrides data prop if provided) */
  sections?: Section<TData, TSectionMeta>[];
  /** Render custom section header */
  renderSectionHeader?: (section: Section<TData, TSectionMeta>) => React.ReactNode;
  /** Enable sticky section headers */
  stickyHeaders?: boolean;

  // === Column Management ===
  /** Column order (controlled) */
  columnOrder?: string[];
  /** Column order change handler */
  onColumnOrderChange?: (order: string[]) => void;
  /** Column visibility (controlled) */
  columnVisibility?: VisibilityState;
  /** Column visibility change handler */
  onColumnVisibilityChange?: OnChangeFn<VisibilityState>;
  /** Columns that cannot be reordered (stay at start) */
  fixedColumns?: string[];

  // === Sorting ===
  /** Current sort state */
  sorting?: SortState<string>;
  /** Sort change handler */
  onSortingChange?: (sorting: SortState<string>) => void;

  // === Pagination ===
  /** Has more data to load */
  hasNextPage?: boolean;
  /** Load more callback */
  onLoadMore?: () => void;
  /** Is currently fetching next page */
  isFetchingNextPage?: boolean;
  /** Total row count (for aria-rowcount) */
  totalCount?: number;

  // === Layout ===
  /** Row height in pixels */
  rowHeight?: number;
  /** Section header height in pixels */
  sectionHeight?: number;
  /** Table container class name */
  className?: string;
  /** Scroll container class name */
  scrollClassName?: string;

  // === State ===
  /** Is loading initial data */
  isLoading?: boolean;
  /** Empty state content */
  emptyContent?: React.ReactNode;

  // === Interaction ===
  /** Row click handler */
  onRowClick?: (row: TData) => void;
  /** Selected row ID */
  selectedRowId?: string;
  /** Custom row class name */
  rowClassName?: string | ((item: TData) => string);
}

// =============================================================================
// Component
// =============================================================================

export function DataTable<TData, TSectionMeta = unknown>({
  data,
  columns,
  getRowId,
  sections,
  renderSectionHeader,
  stickyHeaders = true,
  columnOrder: controlledColumnOrder,
  onColumnOrderChange,
  columnVisibility,
  onColumnVisibilityChange,
  fixedColumns = [],
  sorting,
  onSortingChange,
  hasNextPage,
  onLoadMore,
  isFetchingNextPage,
  totalCount,
  rowHeight = 48,
  sectionHeight = 36,
  className,
  scrollClassName,
  isLoading,
  emptyContent,
  onRowClick,
  selectedRowId,
  rowClassName,
}: DataTableProps<TData, TSectionMeta>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  
  // Stable callback refs to prevent re-render loops
  const onSortingChangeRef = useRef(onSortingChange);
  onSortingChangeRef.current = onSortingChange;

  // Get all data items (from sections or flat data)
  const allItems = useMemo(() => {
    if (sections && sections.length > 0) {
      return sections.flatMap((s) => s.items);
    }
    return data;
  }, [data, sections]);

  // Convert our SortState to TanStack SortingState
  const tanstackSorting = useMemo<SortingState>(() => {
    if (!sorting?.column) return [];
    return [{ id: sorting.column, desc: sorting.direction === "desc" }];
  }, [sorting]);

  // Column order with fallback
  const columnOrder = useMemo(() => {
    if (controlledColumnOrder) return controlledColumnOrder;
    return columns.map((c) => {
      if (typeof c.id === "string") return c.id;
      // AccessorKeyColumnDef has accessorKey property
      if ("accessorKey" in c && c.accessorKey) return String(c.accessorKey);
      return "";
    }).filter(Boolean);
  }, [controlledColumnOrder, columns]);

  // Create TanStack table instance
  // Use manualSorting to prevent TanStack from sorting - we handle it ourselves
  const table = useReactTable({
    data: allItems,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId,
    state: {
      sorting: tanstackSorting,
      columnVisibility: columnVisibility ?? {},
      columnOrder,
    },
    onColumnVisibilityChange,
    manualSorting: true, // Always manual - we control sorting via props
  });

  // Get visible column IDs for DnD - derive from props to avoid re-render loops
  // Don't use table.getState() in dependencies as it returns new object each render
  const visibleColumnIds = useMemo(() => {
    if (!columnVisibility) {
      return columnOrder;
    }
    return columnOrder.filter((id) => columnVisibility[id] !== false);
  }, [columnOrder, columnVisibility]);
  
  const sortableColumnIds = useMemo(
    () => visibleColumnIds.filter((id) => !fixedColumns.includes(id)),
    [visibleColumnIds, fixedColumns],
  );
  
  const visibleColumnCount = visibleColumnIds.length;

  // DnD setup
  const { sensors, modifiers } = useTableDnd();

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (!onColumnOrderChange) return;
      
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = columnOrder.indexOf(String(active.id));
      const newIndex = columnOrder.indexOf(String(over.id));
      
      if (oldIndex !== -1 && newIndex !== -1) {
        const newOrder = arrayMove(columnOrder, oldIndex, newIndex);
        onColumnOrderChange(newOrder);
      }
    },
    [columnOrder, onColumnOrderChange],
  );

  // Virtualization
  const {
    virtualRows,
    totalHeight,
    totalRowCount,
    getItem,
  } = useVirtualizedTable<TData, TSectionMeta>({
    items: sections ? undefined : data,
    sections,
    getRowId,
    scrollRef,
    rowHeight,
    sectionHeight,
    hasNextPage,
    onLoadMore,
    isFetchingNextPage,
  });

  // Store table ref to avoid dependency issues in callbacks
  const tableRef = useRef(table);
  tableRef.current = table;
  
  // Map virtual row index to TanStack table row
  const getTableRow = useCallback(
    (virtualIndex: number): Row<TData> | undefined => {
      const item = getItem(virtualIndex);
      if (!item || item.type === "section") return undefined;
      
      // Find the row in TanStack table by ID
      const rowId = getRowId(item.item);
      return tableRef.current.getRowModel().rowsById[rowId];
    },
    [getItem, getRowId],
  );

  // Compute aria-rowcount
  const ariaRowCount = totalCount ?? totalRowCount;

  // Empty state
  if (!isLoading && allItems.length === 0 && emptyContent) {
    return (
      <div className={cn("flex min-h-[200px] items-center justify-center", className)}>
        {emptyContent}
      </div>
    );
  }

  // Loading state
  if (isLoading && allItems.length === 0) {
    return (
      <div className={cn("flex min-h-[200px] items-center justify-center", className)}>
        <span className="text-sm text-zinc-500 dark:text-zinc-400">Loading...</span>
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      modifiers={modifiers}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <div
        ref={scrollRef}
        className={cn("overflow-auto", scrollClassName)}
      >
        <table
          aria-rowcount={ariaRowCount}
          className={cn(
            "w-full border-collapse text-sm",
            className,
          )}
          style={{
            // CSS containment for performance
            contain: "layout style",
          }}
        >
          {/* Table Header */}
          <thead
            className={cn(
              "bg-zinc-100 text-left text-xs font-medium uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400",
              stickyHeaders && "sticky top-0 z-20",
            )}
          >
            <tr style={{ display: "flex" }}>
              <SortableContext items={sortableColumnIds} strategy={horizontalListSortingStrategy}>
                {table.getHeaderGroups().map((headerGroup) =>
                  headerGroup.headers.map((header) => {
                    const isFixed = fixedColumns.includes(header.id);
                    const isSortable = header.column.getCanSort();
                    const isSorted = header.column.getIsSorted();
                    
                    // Use our controlled sort handler, not TanStack's toggleSorting
                    const handleHeaderSort = () => {
                      const callback = onSortingChangeRef.current;
                      if (!callback || !isSortable) return;
                      
                      // Cycle: none -> asc -> desc -> none
                      if (!isSorted) {
                        callback({ column: header.id, direction: "asc" });
                      } else if (isSorted === "asc") {
                        callback({ column: header.id, direction: "desc" });
                      } else {
                        callback({ column: null, direction: "asc" });
                      }
                    };
                    
                    const cellContent = (
                      <SortButton
                        id={header.id}
                        label={String(header.column.columnDef.header ?? header.id)}
                        sortable={isSortable}
                        isActive={Boolean(isSorted)}
                        direction={isSorted === "asc" ? "asc" : isSorted === "desc" ? "desc" : undefined}
                        onSort={handleHeaderSort}
                      />
                    );

                    if (isFixed) {
                      return (
                        <th
                          key={header.id}
                          style={{
                            width: header.getSize(),
                            minWidth: header.getSize(),
                            maxWidth: header.getSize(),
                          }}
                          className="flex items-center px-4 py-3"
                        >
                          {cellContent}
                        </th>
                      );
                    }

                    return (
                      <SortableCell
                        key={header.id}
                        id={header.id}
                        as="th"
                        width={header.getSize()}
                        className="flex items-center px-4 py-3"
                      >
                        {cellContent}
                      </SortableCell>
                    );
                  }),
                )}
              </SortableContext>
            </tr>
          </thead>

          {/* Virtualized Table Body */}
          <VirtualTableBody<TData, TSectionMeta>
            virtualRows={virtualRows}
            totalHeight={totalHeight}
            getTableRow={getTableRow}
            getItem={getItem}
            columnCount={visibleColumnCount}
            onRowClick={onRowClick}
            selectedRowId={selectedRowId}
            getRowId={getRowId}
            rowClassName={rowClassName}
            renderSectionHeader={renderSectionHeader}
          />
        </table>
        
        {/* Floating loading indicator for pagination */}
        {isFetchingNextPage && (
          <div className="sticky bottom-0 left-0 right-0 flex items-center justify-center bg-gradient-to-t from-white via-white to-transparent py-4 dark:from-zinc-950 dark:via-zinc-950">
            <div className="flex items-center gap-2 rounded-full bg-zinc-100 px-4 py-2 text-sm text-zinc-600 shadow-sm dark:bg-zinc-800 dark:text-zinc-300">
              <svg
                className="h-4 w-4 animate-spin"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              <span>Loading more...</span>
            </div>
          </div>
        )}
      </div>
    </DndContext>
  );
}
