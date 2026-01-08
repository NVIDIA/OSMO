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
import { useStableValue } from "@/hooks";
import {
  useReactTable,
  getCoreRowModel,
  type ColumnDef,
  type SortingState,
  type OnChangeFn,
  type VisibilityState,
  type Row,
} from "@tanstack/react-table";
import { DndContext, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { cn } from "@/lib/utils";

import type { ColumnSizingPreference, ColumnSizingPreferences } from "@/stores/types";
import { SortableCell } from "./SortableCell";
import { SortButton } from "./SortButton";
import { VirtualTableBody } from "./VirtualTableBody";
import { ResizeHandle } from "./ResizeHandle";
import { TableSkeleton } from "./TableSkeleton";
import { useVirtualizedTable } from "./hooks/use-virtualized-table";
import { useTableDnd } from "./hooks/use-column-reordering";
import { useColumnSizing } from "./hooks/use-column-sizing";
import { useRowNavigation } from "./hooks/use-row-navigation";
import type { Section, SortState, ColumnSizeConfig } from "./types";
import { getColumnCSSValue, measureColumnContentWidth } from "./utils/column-sizing";
import { SortDirections, VirtualItemTypes } from "./constants";

// Component-specific styles (resize handles, table layout, etc.)
import "./styles.css";

// =============================================================================
// Types
// =============================================================================

/**
 * DataTable props.
 *
 * @template TData - The data item type for rows
 * @template TSectionMeta - Optional metadata type for section grouping.
 *   Only needed when using the `sections` prop with custom section headers.
 *   Defaults to `unknown` for flat data tables without sections.
 *
 * @example
 * // Flat table (no sections) - TSectionMeta defaults to unknown
 * <DataTable<Pool> data={pools} columns={columns} getRowId={p => p.name} />
 *
 * @example
 * // Sectioned table with custom metadata
 * interface SectionMeta { priority: number; color: string }
 * <DataTable<Task, SectionMeta>
 *   sections={[{ id: 'high', label: 'High Priority', items: tasks, meta: { priority: 1, color: 'red' } }]}
 *   renderSectionHeader={(section) => <Header color={section.meta.color}>{section.label}</Header>}
 * />
 */
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
  /** Compact mode - reduces cell padding for denser display */
  compact?: boolean;

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

  // === Column Sizing ===
  /**
   * Column size configurations (min and preferred widths in rem).
   * Used for initial sizing and shrink/expand algorithm.
   */
  columnSizeConfigs?: ColumnSizeConfig[];
  /**
   * User sizing preferences from persistence.
   * Contains mode (proportional/no-truncate) and multiplier for each column.
   */
  columnSizingPreferences?: ColumnSizingPreferences;
  /** Callback when user manually resizes a column or auto-fits */
  onColumnSizingPreferenceChange?: (columnId: string, preference: ColumnSizingPreference) => void;
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
  // Row heights in pixels (virtualizer requires px, CSS vars define rem for styling)
  // 48px = 3rem at 16px base - standard table row height for touch targets
  rowHeight = 48,
  // 36px = 2.25rem at 16px base - compact section header
  sectionHeight = 36,
  className,
  scrollClassName,
  compact = false,
  isLoading,
  emptyContent,
  onRowClick,
  selectedRowId,
  rowClassName,
  columnSizeConfigs,
  columnSizingPreferences,
  onColumnSizingPreferenceChange,
}: DataTableProps<TData, TSectionMeta>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const tableElementRef = useRef<HTMLTableElement>(null);

  // Stable refs for optional callbacks to prevent re-render loops
  const onSortingChangeRef = useStableValue(onSortingChange);
  const onRowClickRef = useStableValue(onRowClick);
  const onLoadMoreRef = useStableValue(onLoadMore);

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
    return [{ id: sorting.column, desc: sorting.direction === SortDirections.DESC }];
  }, [sorting]);

  // Column order with fallback
  const columnOrder = useMemo(() => {
    if (controlledColumnOrder) return controlledColumnOrder;
    return columns
      .map((c) => {
        if (typeof c.id === "string") return c.id;
        // AccessorKeyColumnDef has accessorKey property
        if ("accessorKey" in c && c.accessorKey) return String(c.accessorKey);
        return "";
      })
      .filter(Boolean);
  }, [controlledColumnOrder, columns]);

  // Get visible column IDs for DnD - derive from props to avoid re-render loops
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

  // Extract minSizes from column definitions for enforcement
  // TanStack only enforces minSize on read (column.getSize()), not in state
  const columnMinSizes = useMemo(() => {
    const sizes: Record<string, number> = {};
    for (const col of columns) {
      const colId = col.id ?? ("accessorKey" in col && col.accessorKey ? String(col.accessorKey) : "");
      if (colId && col.minSize != null) {
        sizes[colId] = col.minSize;
      }
    }
    return sizes;
  }, [columns]);

  // Column sizing - handles initial sizing, container resize, and user preferences
  // TanStack handles: drag, min/max enforcement, size state
  // Hook adds:
  // - Initial sizing based on container width and preferred widths
  // - Container resize handling (via ResizeObserver)
  // - User preference detection (proportional vs no-truncate mode)
  // - Persistence via callbacks
  // - CSS variables for performance
  // - minSize enforcement
  // Loading state - show skeleton only during actual data loading
  const showSkeleton = isLoading && allItems.length === 0;

  const columnSizingHook = useColumnSizing({
    columnIds: visibleColumnIds,
    containerRef: scrollRef,
    tableRef: tableElementRef,
    columnConfigs: columnSizeConfigs,
    sizingPreferences: columnSizingPreferences,
    onPreferenceChange: onColumnSizingPreferenceChange,
    minSizes: columnMinSizes,
    dataLength: allItems.length,
    isLoading: showSkeleton,
  });

  // Create TanStack table instance
  // manualSorting: true means we control sorting via props (server-side or external)
  // enableColumnResizing: true enables TanStack's native resize handling
  // columnResizeMode: 'onChange' updates size during drag (smoother UX)
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table returns unstable functions by design. React Compiler skips optimization. See: https://github.com/facebook/react/issues/33057
  const table = useReactTable({
    data: allItems,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId,
    state: {
      sorting: tanstackSorting,
      columnVisibility: columnVisibility ?? {},
      columnOrder,
      columnSizing: columnSizingHook.columnSizing,
      columnSizingInfo: columnSizingHook.columnSizingInfo,
    },
    onColumnVisibilityChange,
    onColumnSizingChange: columnSizingHook.onColumnSizingChange,
    onColumnSizingInfoChange: columnSizingHook.onColumnSizingInfoChange,
    manualSorting: true,
    enableColumnResizing: true,
    columnResizeMode: "onChange",
  });

  // DnD setup - with bounds restriction to prevent dragging beyond table width
  const { sensors, modifiers, autoScrollConfig } = useTableDnd();

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (!onColumnOrderChange) return;

      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = columnOrder.indexOf(String(active.id));
      const newIndex = columnOrder.indexOf(String(over.id));

      if (oldIndex === -1 || newIndex === -1) return;

      // Find the boundary: fixed columns must stay at the start
      const firstMovableIndex = columnOrder.findIndex((id) => !fixedColumns.includes(id));

      // If there are fixed columns, ensure we don't move anything before them
      if (firstMovableIndex > 0) {
        // Cannot drop at an index before the first movable column
        if (newIndex < firstMovableIndex) {
          return; // Reject this drop
        }
      }

      const newOrder = arrayMove(columnOrder, oldIndex, newIndex);
      onColumnOrderChange(newOrder);
    },
    [columnOrder, onColumnOrderChange, fixedColumns],
  );

  // Virtualization
  const { virtualRows, totalHeight, totalRowCount, virtualItemCount, getItem, scrollToIndex, measureElement } =
    useVirtualizedTable<TData, TSectionMeta>({
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

  // Stable access to table instance in callbacks
  const tableRef = useStableValue(table);

  // Map virtual row index to TanStack table row
  const getTableRow = useCallback(
    (virtualIndex: number): Row<TData> | undefined => {
      const item = getItem(virtualIndex);
      if (!item || item.type === "section") return undefined;

      // Find the row in TanStack table by ID
      const rowId = getRowId(item.item);
      return tableRef.current.getRowModel().rowsById[rowId];
    },
    [getItem, getRowId, tableRef],
  );

  // Compute aria-rowcount
  const ariaRowCount = totalCount ?? totalRowCount;

  // ==========================================================================
  // Auto-fit column width (double-click on resize handle)
  // Uses shared measureColumnContentWidth utility for single source of truth
  // ==========================================================================
  const handleAutoFit = useCallback(
    (columnId: string) => {
      const container = scrollRef.current;
      if (!container) return;

      // Use shared utility for consistent measurement across all operations
      const targetWidth = measureColumnContentWidth(container, columnId);
      if (targetWidth === 0) return;

      // Hook handles: set size + save "no-truncate" preference
      columnSizingHook.autoFit(columnId, targetWidth);
    },
    [columnSizingHook],
  );

  // ==========================================================================
  // Stable sort handler (avoids creating functions in render loop)
  // Takes columnId and current sort state to determine next sort action
  // ==========================================================================
  const handleHeaderSort = useCallback(
    (columnId: string, isSortable: boolean, currentSortDirection: false | "asc" | "desc") => {
      if (!isSortable) return;

      // Cycle: none -> asc -> desc -> asc (toggle between asc/desc once sorted)
      if (!currentSortDirection || currentSortDirection === SortDirections.DESC) {
        onSortingChangeRef.current?.({ column: columnId, direction: SortDirections.ASC });
      } else {
        onSortingChangeRef.current?.({ column: columnId, direction: SortDirections.DESC });
      }
    },
    [onSortingChangeRef],
  );

  // Row click and load more are accessed via refs (set above)

  // Keyboard navigation for rows (uses virtual indices which include sections)
  const rowNavigation = useRowNavigation({
    rowCount: virtualItemCount, // Use virtual count (sections + data rows)
    visibleRowCount: Math.floor(600 / rowHeight), // Approximate visible rows
    onRowActivate: useCallback(
      (virtualIndex: number) => {
        const item = getItem(virtualIndex);
        if (item?.type === VirtualItemTypes.ROW) {
          onRowClickRef.current?.(item.item);
        }
        // If it's a section, do nothing (or could expand/collapse)
      },
      [getItem, onRowClickRef],
    ),
    onScrollToRow: useCallback(
      (virtualIndex: number, align: "start" | "end" | "center") => {
        // Scroll virtualizer to bring row into view with proper alignment
        scrollToIndex(virtualIndex, { align });

        // Trigger pagination if near the end
        if (hasNextPage && !isFetchingNextPage && virtualIndex >= virtualItemCount - 5) {
          onLoadMoreRef.current?.();
        }
      },
      [scrollToIndex, hasNextPage, isFetchingNextPage, virtualItemCount, onLoadMoreRef],
    ),
    disabled: !onRowClick, // Only enable if rows are clickable
    containerRef: scrollRef, // For finding and focusing row elements
  });

  // Extract header labels for skeleton (memoized)
  // NOTE: This must be called BEFORE any early returns to comply with React's rules of hooks
  const headerLabels = useMemo(() => {
    return visibleColumnIds.map((id) => {
      const col = columns.find((c) => {
        const colId = c.id ?? ("accessorKey" in c && c.accessorKey ? String(c.accessorKey) : "");
        return colId === id;
      });
      const header = col?.header;
      if (typeof header === "string") return header;
      if (typeof header === "function") return id;
      return id;
    });
  }, [visibleColumnIds, columns]);

  // ==========================================================================
  // Ready State Management
  // ==========================================================================
  // Readiness is simple: we have data or we're loading
  // Column sizing uses fallbacks, so no "sizing ready" state needed

  // Empty state
  if (!isLoading && allItems.length === 0 && emptyContent) {
    return <div className={cn("flex min-h-[200px] items-center justify-center", className)}>{emptyContent}</div>;
  }

  return (
    <DndContext
      sensors={sensors}
      modifiers={modifiers}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      autoScroll={autoScrollConfig}
    >
      <div
        ref={scrollRef}
        className={cn("data-table-scroll overflow-auto", scrollClassName)}
      >
        {/* Skeleton only during initial data loading */}
        {showSkeleton && (
          <TableSkeleton
            columnCount={visibleColumnCount}
            rowCount={10}
            rowHeight={rowHeight}
            headers={headerLabels}
            className={className}
            showHeader={stickyHeaders}
          />
        )}
        {/* Table renders immediately - sizing uses fallbacks until measured */}
        {!showSkeleton && (
          <>
            <table
              ref={tableElementRef}
              role="grid"
              aria-rowcount={ariaRowCount}
              aria-colcount={visibleColumnCount}
              className={cn("contain-layout-style data-table min-w-full border-collapse text-sm", className)}
              style={columnSizingHook.cssVariables}
            >
              {/* Table Header */}
              <thead
                role="rowgroup"
                className={cn(
                  "table-header text-left text-xs font-medium text-zinc-500 uppercase dark:text-zinc-400",
                  stickyHeaders && "sticky top-0 z-20",
                )}
              >
                <tr
                  role="row"
                  aria-rowindex={1}
                  className="data-table-header-row"
                >
                  <SortableContext
                    items={sortableColumnIds}
                    strategy={horizontalListSortingStrategy}
                  >
                    {table.getHeaderGroups().map((headerGroup) =>
                      headerGroup.headers.map((header, headerIndex) => {
                        const isFixed = fixedColumns.includes(header.id);
                        const isSortable = header.column.getCanSort();
                        const isSorted = header.column.getIsSorted();

                        // Cache CSS variable string (avoid multiple getColumnCSSValue calls)
                        const cssWidth = getColumnCSSValue(header.id);

                        // Use stable handler - no function allocation per render
                        const onSort = () => handleHeaderSort(header.id, isSortable, isSorted);

                        const cellContent = (
                          <>
                            <SortButton
                              label={String(header.column.columnDef.header ?? header.id)}
                              sortable={isSortable}
                              isActive={Boolean(isSorted)}
                              direction={
                                isSorted === SortDirections.ASC
                                  ? SortDirections.ASC
                                  : isSorted === SortDirections.DESC
                                    ? SortDirections.DESC
                                    : undefined
                              }
                              onSort={onSort}
                            />
                            {/* Resize handle - uses @use-gesture/react for gesture handling */}
                            <ResizeHandle
                              header={header}
                              onResizeStart={columnSizingHook.startResize}
                              onResizeUpdate={columnSizingHook.updateResize}
                              onResizeEnd={columnSizingHook.endResize}
                              onAutoFit={handleAutoFit}
                            />
                          </>
                        );

                        // Use headerIndex from map (O(1)) instead of indexOf (O(n))
                        const colIndex = headerIndex + 1;

                        if (isFixed) {
                          return (
                            <th
                              key={header.id}
                              role="columnheader"
                              scope="col"
                              aria-colindex={colIndex}
                              data-column-id={header.id}
                              style={{
                                width: cssWidth,
                                minWidth: cssWidth,
                                flexShrink: 0,
                              }}
                              className="relative flex items-center px-4 py-3"
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
                            width={cssWidth}
                            colIndex={colIndex}
                            className="relative flex items-center px-4 py-3"
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
                getRowTabIndex={rowNavigation.getRowTabIndex}
                onRowFocus={rowNavigation.handleRowFocus}
                onRowKeyDown={rowNavigation.handleRowKeyDown}
                measureElement={measureElement}
                compact={compact}
              />
            </table>

            {/* Floating loading indicator for pagination */}
            {isFetchingNextPage && (
              <div className="sticky right-0 bottom-0 left-0 flex items-center justify-center bg-gradient-to-t from-white via-white to-transparent py-4 dark:from-zinc-950 dark:via-zinc-950">
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

            {/* End of results indicator - show when all data loaded and not fetching */}
            {!hasNextPage && !isFetchingNextPage && allItems.length > 0 && (
              <div
                className="flex items-center justify-center gap-1.5 text-xs text-zinc-400 dark:text-zinc-500"
                style={{ height: rowHeight }}
              >
                <svg
                  className="h-3.5 w-3.5"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>You&apos;ve reached the end</span>
              </div>
            )}
          </>
        )}
      </div>
    </DndContext>
  );
}
