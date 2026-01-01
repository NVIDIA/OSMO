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
 * DataTable Component
 *
 * Virtualized, sortable table with drag-to-reorder columns.
 * Optimized for large datasets with GPU-accelerated rendering.
 *
 * Pattern borrowed from workflow-explorer's GroupPanel/TaskTable.
 */

"use client";

import { memo, useRef, useMemo, useCallback } from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { cn } from "@/lib/utils";
import { useVirtualizerCompat } from "@/lib/hooks";
import { getGridTemplate, getMinTableWidth, type ColumnDef, type SortState } from "@/lib/table";
import type { DataTableProps, DataTableHeaderProps, DataTableRowProps } from "./types";

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_ROW_HEIGHT = 40;
const DEFAULT_OVERSCAN = 15;
const DEFAULT_GAP = 24;

// Horizontal-only modifier for DND
const restrictToHorizontalAxis = ({ transform }: { transform: { x: number; y: number; scaleX: number; scaleY: number } }) => ({
  ...transform,
  y: 0,
  scaleX: 1,
  scaleY: 1,
});

// =============================================================================
// DataTableRow Component
// =============================================================================

function DataTableRowInner<TData, TColumnId extends string>({
  item,
  columns,
  gridTemplate,
  minWidth,
  isSelected,
  onSelect,
  renderCell,
  gap = DEFAULT_GAP,
  className,
}: DataTableRowProps<TData, TColumnId>) {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelect();
      }
    },
    [onSelect],
  );

  return (
    <div
      role="row"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
      aria-selected={isSelected}
      className={cn(
        "grid cursor-pointer items-center border-b border-zinc-200 px-3 py-2 text-sm transition-colors duration-75 dark:border-zinc-800",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500",
        isSelected ? "bg-blue-100 dark:bg-blue-900/30" : "hover:bg-zinc-100 dark:hover:bg-zinc-800/50",
        className,
      )}
      style={{
        gridTemplateColumns: gridTemplate,
        minWidth,
        gap,
      }}
    >
      {columns.map((col) => (
        <div
          key={col.id}
          role="cell"
          className={cn("flex items-center overflow-hidden", col.align === "right" && "justify-end")}
        >
          {renderCell(item, col.id)}
        </div>
      ))}
    </div>
  );
}

export const DataTableRow = memo(DataTableRowInner) as typeof DataTableRowInner;

// =============================================================================
// SortableHeaderCell Component
// =============================================================================

function SortableHeaderCell<TColumnId extends string>({
  col,
  sort,
  onSort,
}: {
  col: ColumnDef<TColumnId>;
  sort: SortState<TColumnId>;
  onSort: (column: TColumnId) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, node } = useSortable({ id: col.id });
  const width = node.current?.offsetWidth;

  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, 0, 0)` : undefined,
    transition,
    zIndex: isDragging ? 10 : undefined,
    opacity: isDragging ? 0.8 : 1,
    width: isDragging && width ? width : undefined,
  };

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (col.sortable) onSort(col.id);
    },
    [col.id, col.sortable, onSort],
  );

  return (
    <div
      ref={setNodeRef}
      role="columnheader"
      style={style}
      className={cn(
        "flex cursor-grab items-center active:cursor-grabbing",
        isDragging && "rounded bg-zinc-200 px-2 shadow-md ring-1 ring-zinc-300 dark:bg-zinc-700 dark:ring-zinc-600",
        col.align === "right" && "justify-end",
      )}
      {...attributes}
      {...listeners}
    >
      <button
        onClick={handleClick}
        disabled={!col.sortable}
        aria-sort={sort.column === col.id ? (sort.direction === "asc" ? "ascending" : "descending") : undefined}
        className={cn(
          "flex items-center gap-1 truncate transition-colors",
          col.sortable && "hover:text-zinc-900 dark:hover:text-zinc-100",
        )}
      >
        <span className="truncate">{col.label}</span>
        {col.sortable &&
          (sort.column === col.id ? (
            sort.direction === "asc" ? (
              <ChevronUp className="size-3 shrink-0" aria-hidden="true" />
            ) : (
              <ChevronDown className="size-3 shrink-0" aria-hidden="true" />
            )
          ) : (
            <ChevronsUpDown className="size-3 shrink-0 opacity-30" aria-hidden="true" />
          ))}
      </button>
    </div>
  );
}

const MemoizedSortableHeaderCell = memo(SortableHeaderCell) as typeof SortableHeaderCell;

// =============================================================================
// DataTableHeader Component
// =============================================================================

function DataTableHeaderInner<TColumnId extends string>({
  columns,
  gridTemplate,
  minWidth,
  sort,
  onSort,
  optionalColumnIds,
  mandatoryColumnIds,
  onReorder,
  gap = DEFAULT_GAP,
}: DataTableHeaderProps<TColumnId>) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (over && active.id !== over.id) {
        const oldIndex = optionalColumnIds.indexOf(active.id as TColumnId);
        const newIndex = optionalColumnIds.indexOf(over.id as TColumnId);
        if (oldIndex !== -1 && newIndex !== -1) {
          onReorder(arrayMove(optionalColumnIds, oldIndex, newIndex));
        }
      }
    },
    [optionalColumnIds, onReorder],
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      modifiers={[restrictToHorizontalAxis]}
      autoScroll={false}
    >
      <div
        role="row"
        className="grid items-center border-b border-zinc-200 bg-zinc-100 px-3 py-2 text-xs font-medium text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400"
        style={{ gridTemplateColumns: gridTemplate, minWidth, gap }}
      >
        {/* Mandatory columns (not draggable) */}
        {columns
          .filter((c) => mandatoryColumnIds.has(c.id))
          .map((col) => (
            <div
              key={col.id}
              role="columnheader"
              className={cn("flex items-center overflow-hidden", col.align === "right" && "justify-end")}
            >
              <button
                onClick={() => col.sortable && onSort(col.id)}
                disabled={!col.sortable}
                aria-sort={sort.column === col.id ? (sort.direction === "asc" ? "ascending" : "descending") : undefined}
                className={cn(
                  "flex items-center gap-1 truncate transition-colors",
                  col.sortable && "hover:text-zinc-900 dark:hover:text-zinc-100",
                )}
              >
                <span className="truncate">{col.label}</span>
                {col.sortable &&
                  (sort.column === col.id ? (
                    sort.direction === "asc" ? (
                      <ChevronUp className="size-3 shrink-0" aria-hidden="true" />
                    ) : (
                      <ChevronDown className="size-3 shrink-0" aria-hidden="true" />
                    )
                  ) : (
                    <ChevronsUpDown className="size-3 shrink-0 opacity-30" aria-hidden="true" />
                  ))}
              </button>
            </div>
          ))}

        {/* Optional columns (draggable) */}
        <SortableContext items={optionalColumnIds} strategy={horizontalListSortingStrategy}>
          {columns
            .filter((c) => !mandatoryColumnIds.has(c.id))
            .map((col) => (
              <MemoizedSortableHeaderCell key={col.id} col={col} sort={sort} onSort={onSort} />
            ))}
        </SortableContext>
      </div>
    </DndContext>
  );
}

export const DataTableHeader = memo(DataTableHeaderInner) as typeof DataTableHeaderInner;

// =============================================================================
// DataTable Component
// =============================================================================

function DataTableInner<TData, TColumnId extends string>({
  data,
  columns,
  selectedKey,
  getRowKey,
  renderCell,
  onSelect,
  sort,
  onSort,
  optionalColumnIds,
  mandatoryColumnIds,
  onReorderColumns,
  rowHeight = DEFAULT_ROW_HEIGHT,
  overscan = DEFAULT_OVERSCAN,
  columnGap = DEFAULT_GAP,
  rowClassName,
  emptyMessage = "No items match your filters",
}: DataTableProps<TData, TColumnId>) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizerCompat({
    count: data.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan,
  });

  const gridTemplate = useMemo(() => getGridTemplate(columns), [columns]);
  const minWidth = useMemo(() => getMinTableWidth(columns, columnGap), [columns, columnGap]);

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  if (data.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-zinc-500 dark:text-zinc-400">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-auto overscroll-contain"
      role="table"
      aria-label="Data table"
      aria-rowcount={data.length}
    >
      <div style={{ minWidth }}>
        {/* Sticky header */}
        <div className="sticky top-0 z-10 touch-none" role="rowgroup">
          <DataTableHeader
            columns={columns}
            gridTemplate={gridTemplate}
            minWidth={minWidth}
            sort={sort}
            onSort={onSort}
            optionalColumnIds={optionalColumnIds}
            mandatoryColumnIds={mandatoryColumnIds}
            onReorder={onReorderColumns}
            gap={columnGap}
          />
        </div>

        {/* Virtualized rows */}
        <div className="relative" role="rowgroup" style={{ height: totalSize }}>
          {virtualItems.map((virtualRow) => {
            const item = data[virtualRow.index];
            const key = getRowKey(item);
            const isSelected = selectedKey === key;
            const className =
              typeof rowClassName === "function" ? rowClassName(item, isSelected) : rowClassName;

            return (
              <div
                key={key}
                className="absolute left-0 top-0 w-full"
                style={{
                  height: rowHeight,
                  transform: `translate3d(0, ${virtualRow.start}px, 0)`,
                }}
              >
                <DataTableRow
                  item={item}
                  columns={columns}
                  gridTemplate={gridTemplate}
                  minWidth={minWidth}
                  isSelected={isSelected}
                  onSelect={() => onSelect(item)}
                  renderCell={renderCell}
                  gap={columnGap}
                  className={className}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export const DataTable = memo(DataTableInner) as typeof DataTableInner;
