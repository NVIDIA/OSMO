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

import { SortableCell } from "./SortableCell";
import { SortButton } from "./SortButton";
import { VirtualTableBody } from "./VirtualTableBody";
import { ResizeHandle } from "./ResizeHandle";
import { TableSkeleton } from "./TableSkeleton";
import { useVirtualizedTable } from "./hooks/use-virtualized-table";
import { useTableDnd } from "./hooks/use-column-reordering";
import { useUnifiedColumnSizing } from "./hooks/use-column-resizing";
import { useRowNavigation } from "./hooks/use-row-navigation";
import type { Section, SortState, ColumnSizeConfig, ColumnOverride } from "./types";
import { getColumnCSSValue, pxToRem } from "./utils/column-sizing";

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
  /** Render custom section header (index and stickyTop only available in non-virtualized mode) */
  renderSectionHeader?: (
    section: Section<TData, TSectionMeta>,
    sectionIndex?: number,
    stickyTop?: number,
  ) => React.ReactNode;
  /** Enable sticky section headers */
  stickyHeaders?: boolean;
  /**
   * CSS class for section rows (non-virtualized mode only).
   * Used to apply status-specific styling.
   */
  sectionRowClassName?: string | ((section: Section<TData, TSectionMeta>, sectionIndex: number) => string);

  // === Virtualization ===
  /**
   * Enable virtualization (default: true).
   * Set to false for small datasets (<100 items) that need CSS sticky section headers.
   * When false, all rows are rendered in normal document flow, enabling CSS sticky.
   */
  virtualized?: boolean;

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

  // === Column Sizing ===
  /** Column size configuration for proportional sizing and resizing (rem-based) */
  columnSizeConfig?: ColumnSizeConfig[];
  /** Column overrides from manual resizing (simplified: just share) */
  columnOverrides?: Record<string, ColumnOverride>;
  /** Callback when column overrides change (for persistence) */
  onColumnOverridesChange?: (overrides: Record<string, ColumnOverride>) => void;
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
  isLoading,
  emptyContent,
  onRowClick,
  selectedRowId,
  rowClassName,
  columnSizeConfig,
  columnOverrides,
  onColumnOverridesChange,
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
    return [{ id: sorting.column, desc: sorting.direction === "desc" }];
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

  // Create TanStack table instance
  // manualSorting: true means we control sorting via props (server-side or external)
  // No getSortedRowModel needed since we don't use TanStack's sorting
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
    },
    onColumnVisibilityChange,
    manualSorting: true,
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

  // Build column size config from visible columns (TanStack table is source of truth)
  // This ensures width calculation only considers actually-rendered columns
  const effectiveColumnSizeConfig = useMemo<ColumnSizeConfig[]>(() => {
    // Create a lookup from provided config
    const configById = new Map((columnSizeConfig ?? []).map((c) => [c.id, c]));

    // Build config for each visible column, in order
    return visibleColumnIds.map((id) => {
      const provided = configById.get(id);
      if (provided) {
        return provided;
      }
      // Fallback: find column definition and extract sizing info
      const colDef = columns.find((c) => {
        const colId = c.id ?? ("accessorKey" in c && c.accessorKey ? String(c.accessorKey) : "");
        return colId === id;
      });
      // Convert pixel minSize to rem (default 80px = 5rem)
      const minSizePx = colDef?.minSize ?? 80;
      return {
        id,
        minWidthRem: pxToRem(minSizePx),
        share: 1,
      };
    });
  }, [visibleColumnIds, columnSizeConfig, columns]);

  // Column sizing - single source of truth for all column widths
  const columnSizing = useUnifiedColumnSizing({
    columns: effectiveColumnSizeConfig,
    containerRef: scrollRef,
    tableRef: tableElementRef,
    initialOverrides: columnOverrides,
    onOverridesChange: onColumnOverridesChange,
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
  const { virtualRows, totalHeight, totalRowCount, virtualItemCount, getItem, scrollToIndex } = useVirtualizedTable<
    TData,
    TSectionMeta
  >({
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

  // Row click and load more are accessed via refs (set above)

  // Keyboard navigation for rows (uses virtual indices which include sections)
  const rowNavigation = useRowNavigation({
    rowCount: virtualItemCount, // Use virtual count (sections + data rows)
    visibleRowCount: Math.floor(600 / rowHeight), // Approximate visible rows
    onRowActivate: useCallback(
      (virtualIndex: number) => {
        const item = getItem(virtualIndex);
        if (item?.type === "row") {
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

  // Loading state - show skeleton only during actual data loading
  const showSkeleton = isLoading && allItems.length === 0;

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
              style={columnSizing.cssVariables}
            >
              {/* Table Header */}
              <thead
                role="rowgroup"
                className={cn(
                  "bg-zinc-100 text-left text-xs font-medium text-zinc-500 uppercase dark:bg-zinc-900 dark:text-zinc-400",
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
                      headerGroup.headers.map((header) => {
                        const isFixed = fixedColumns.includes(header.id);
                        const isSortable = header.column.getCanSort();
                        const isSorted = header.column.getIsSorted();

                        // Use our controlled sort handler, not TanStack's toggleSorting
                        const handleHeaderSort = () => {
                          if (!isSortable) return;

                          // Cycle: none -> asc -> desc -> none
                          if (!isSorted) {
                            onSortingChangeRef.current?.({ column: header.id, direction: "asc" });
                          } else if (isSorted === "asc") {
                            onSortingChangeRef.current?.({ column: header.id, direction: "desc" });
                          } else {
                            onSortingChangeRef.current?.({ column: null, direction: "asc" });
                          }
                        };

                        const cellContent = (
                          <>
                            <SortButton
                              label={String(header.column.columnDef.header ?? header.id)}
                              sortable={isSortable}
                              isActive={Boolean(isSorted)}
                              direction={isSorted === "asc" ? "asc" : isSorted === "desc" ? "desc" : undefined}
                              onSort={handleHeaderSort}
                            />
                            {/* Resize handle */}
                            <ResizeHandle
                              columnId={header.id}
                              isResizing={columnSizing.isResizing}
                              onPointerDown={columnSizing.resize.handlePointerDown}
                              onPointerMove={columnSizing.resize.handlePointerMove}
                              onPointerUp={columnSizing.resize.handlePointerUp}
                              onPointerCancel={columnSizing.resize.handlePointerCancel}
                              onAutoFit={columnSizing.actions.autoFitColumn}
                              onReset={columnSizing.actions.resetColumn}
                            />
                          </>
                        );

                        // Style for column width - always use CSS variable
                        // flexShrink: 0 prevents cells from shrinking below their width
                        const widthStyle: React.CSSProperties = {
                          width: getColumnCSSValue(header.id),
                          minWidth: getColumnCSSValue(header.id),
                          flexShrink: 0,
                        };

                        if (isFixed) {
                          return (
                            <th
                              key={header.id}
                              role="columnheader"
                              scope="col"
                              aria-colindex={headerGroup.headers.indexOf(header) + 1}
                              data-column-id={header.id}
                              style={widthStyle}
                              className="relative flex items-center px-4 py-3"
                            >
                              {cellContent}
                            </th>
                          );
                        }

                        // For SortableCell, use CSS variable (same as body cells)
                        const sortableCellWidth = getColumnCSSValue(header.id);

                        return (
                          <SortableCell
                            key={header.id}
                            id={header.id}
                            as="th"
                            width={sortableCellWidth}
                            colIndex={headerGroup.headers.indexOf(header) + 1}
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
