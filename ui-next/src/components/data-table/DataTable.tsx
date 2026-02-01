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

"use client";

import { useMemo, useRef, useCallback, useId } from "react";
import { useSyncedRef } from "@react-hookz/web";
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

import type { ColumnSizingPreference, ColumnSizingPreferences } from "@/stores";
import { TABLE_ROW_HEIGHTS } from "@/lib/config";
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

import "./styles.css";

export interface DataTableProps<TData, TSectionMeta = unknown> {
  data: TData[];
  columns: ColumnDef<TData, unknown>[];
  getRowId: (row: TData) => string;
  sections?: Section<TData, TSectionMeta>[];
  renderSectionHeader?: (section: Section<TData, TSectionMeta>) => React.ReactNode;
  stickyHeaders?: boolean;
  columnOrder?: string[];
  onColumnOrderChange?: (order: string[]) => void;
  columnVisibility?: VisibilityState;
  onColumnVisibilityChange?: OnChangeFn<VisibilityState>;
  fixedColumns?: string[];
  sorting?: SortState<string>;
  onSortingChange?: (sorting: SortState<string>) => void;
  hasNextPage?: boolean;
  onLoadMore?: () => void;
  isFetchingNextPage?: boolean;
  totalCount?: number;
  rowHeight?: number;
  sectionHeight?: number;
  className?: string;
  scrollClassName?: string;
  compact?: boolean;
  isLoading?: boolean;
  emptyContent?: React.ReactNode;
  onRowClick?: (row: TData) => void;
  /** For middle-click: returns URL for new tab, or undefined to call onRowClick */
  getRowHref?: (row: TData) => string | undefined;
  selectedRowId?: string;
  rowClassName?: string | ((item: TData) => string);
  sectionClassName?: string | ((section: Section<TData, TSectionMeta>) => string);
  columnSizeConfigs?: readonly ColumnSizeConfig[];
  columnSizingPreferences?: ColumnSizingPreferences;
  onColumnSizingPreferenceChange?: (columnId: string, preference: ColumnSizingPreference) => void;
  /** Suspend column resize calculations (for external panel transitions) */
  suspendResize?: boolean;
}

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
  // Row heights use canonical constants from @/lib/config
  rowHeight = TABLE_ROW_HEIGHTS.NORMAL,
  sectionHeight = TABLE_ROW_HEIGHTS.SECTION,
  className,
  scrollClassName,
  compact = false,
  isLoading,
  emptyContent,
  onRowClick,
  getRowHref,
  selectedRowId,
  rowClassName,
  sectionClassName,
  columnSizeConfigs,
  columnSizingPreferences,
  onColumnSizingPreferenceChange,
  suspendResize,
}: DataTableProps<TData, TSectionMeta>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const tableElementRef = useRef<HTMLTableElement>(null);
  const dndContextId = useId();

  const onSortingChangeRef = useSyncedRef(onSortingChange);
  const onRowClickRef = useSyncedRef(onRowClick);
  const onLoadMoreRef = useSyncedRef(onLoadMore);

  const allItems = useMemo(() => {
    if (sections && sections.length > 0) {
      return sections.flatMap((s) => s.items);
    }
    return data;
  }, [data, sections]);

  const tanstackSorting = useMemo<SortingState>(() => {
    if (!sorting?.column) return [];
    return [{ id: sorting.column, desc: sorting.direction === SortDirections.DESC }];
  }, [sorting]);

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

  const columnInitialSizes = useMemo(() => {
    const sizes: Record<string, number> = {};
    for (const col of columns) {
      const colId = col.id ?? ("accessorKey" in col && col.accessorKey ? String(col.accessorKey) : "");
      if (colId && col.size != null) {
        sizes[colId] = col.size;
      }
    }
    return sizes;
  }, [columns]);

  const columnResizability = useMemo(() => {
    const resizability: Record<string, boolean> = {};
    for (const col of columns) {
      const colId = col.id ?? ("accessorKey" in col && col.accessorKey ? String(col.accessorKey) : "");
      if (colId) {
        // enableResizing defaults to true if not specified
        resizability[colId] = col.enableResizing !== false;
      }
    }
    return resizability;
  }, [columns]);

  const showSkeleton = isLoading && allItems.length === 0;

  const columnSizingHook = useColumnSizing({
    columnIds: visibleColumnIds,
    containerRef: scrollRef,
    tableRef: tableElementRef,
    columnConfigs: columnSizeConfigs,
    sizingPreferences: columnSizingPreferences,
    onPreferenceChange: onColumnSizingPreferenceChange,
    minSizes: columnMinSizes,
    configuredSizes: columnInitialSizes,
    columnResizability,
    dataLength: allItems.length,
    isLoading: showSkeleton,
    suspendResize,
  });

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table returns unstable functions by design
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

  const { sensors, modifiers, autoScrollConfig } = useTableDnd();

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (!onColumnOrderChange) return;

      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = columnOrder.indexOf(String(active.id));
      const newIndex = columnOrder.indexOf(String(over.id));

      if (oldIndex === -1 || newIndex === -1) return;

      const firstMovableIndex = columnOrder.findIndex((id) => !fixedColumns.includes(id));
      if (firstMovableIndex > 0 && newIndex < firstMovableIndex) {
        return;
      }

      const newOrder = arrayMove(columnOrder, oldIndex, newIndex);
      onColumnOrderChange(newOrder);
    },
    [columnOrder, onColumnOrderChange, fixedColumns],
  );

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

  const tableRef = useSyncedRef(table);

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

  const ariaRowCount = totalCount ?? totalRowCount;

  const handleAutoFit = useCallback(
    (columnId: string) => {
      const container = scrollRef.current;
      if (!container) return;

      const targetWidth = measureColumnContentWidth(container, columnId);
      if (targetWidth === 0) return;

      columnSizingHook.autoFit(columnId, targetWidth);
    },
    [columnSizingHook],
  );

  const handleHeaderSort = useCallback(
    (columnId: string, isSortable: boolean, currentSortDirection: false | "asc" | "desc") => {
      if (!isSortable) return;

      if (!currentSortDirection || currentSortDirection === SortDirections.DESC) {
        onSortingChangeRef.current?.({ column: columnId, direction: SortDirections.ASC });
      } else {
        onSortingChangeRef.current?.({ column: columnId, direction: SortDirections.DESC });
      }
    },
    [onSortingChangeRef],
  );

  const rowNavigation = useRowNavigation({
    rowCount: virtualItemCount,
    visibleRowCount: Math.floor(600 / rowHeight),
    onRowActivate: useCallback(
      (virtualIndex: number) => {
        const item = getItem(virtualIndex);
        if (item?.type === VirtualItemTypes.ROW) {
          onRowClickRef.current?.(item.item);
        }
      },
      [getItem, onRowClickRef],
    ),
    onScrollToRow: useCallback(
      (virtualIndex: number, align: "start" | "end" | "center") => {
        scrollToIndex(virtualIndex, { align });

        if (hasNextPage && !isFetchingNextPage && virtualIndex >= virtualItemCount - 5) {
          onLoadMoreRef.current?.();
        }
      },
      [scrollToIndex, hasNextPage, isFetchingNextPage, virtualItemCount, onLoadMoreRef],
    ),
    disabled: !onRowClick,
    containerRef: scrollRef,
  });

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

  if (!isLoading && allItems.length === 0 && emptyContent) {
    return <div className={cn("flex min-h-[200px] items-center justify-center", className)}>{emptyContent}</div>;
  }

  return (
    <DndContext
      id={dndContextId}
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
                        const cssWidth = getColumnCSSValue(header.id);
                        const onSort = () => handleHeaderSort(header.id, isSortable, isSorted);
                        const isResizable = header.column.getCanResize();

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
                            {isResizable && (
                              <ResizeHandle
                                header={header}
                                onResizeStart={columnSizingHook.startResize}
                                onResizeUpdate={columnSizingHook.updateResize}
                                onResizeEnd={columnSizingHook.endResize}
                                onAutoFit={handleAutoFit}
                              />
                            )}
                          </>
                        );

                        const colIndex = headerIndex + 1;

                        // Get custom header className from column meta (dependency injection)
                        const headerClassName = header.column.columnDef.meta?.headerClassName;

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
                              className={cn("relative flex items-center", headerClassName ?? "px-4 py-3")}
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
                            className={cn("relative flex items-center", headerClassName ?? "px-4 py-3")}
                          >
                            {cellContent}
                          </SortableCell>
                        );
                      }),
                    )}
                  </SortableContext>
                </tr>
              </thead>

              <VirtualTableBody<TData, TSectionMeta>
                virtualRows={virtualRows}
                totalHeight={totalHeight}
                getTableRow={getTableRow}
                getItem={getItem}
                columnCount={visibleColumnCount}
                onRowClick={onRowClick}
                getRowHref={getRowHref}
                selectedRowId={selectedRowId}
                getRowId={getRowId}
                rowClassName={rowClassName}
                sectionClassName={sectionClassName}
                renderSectionHeader={renderSectionHeader}
                getRowTabIndex={rowNavigation.getRowTabIndex}
                onRowFocus={rowNavigation.handleRowFocus}
                onRowKeyDown={rowNavigation.handleRowKeyDown}
                measureElement={measureElement}
                compact={compact}
              />
            </table>

            {isFetchingNextPage && (
              <div className="sticky right-0 bottom-0 left-0 flex items-center justify-center bg-linear-to-t from-white via-white to-transparent py-4 dark:from-zinc-950 dark:via-zinc-950">
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
