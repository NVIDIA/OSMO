/**
 * Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

"use client";

import { memo, useCallback } from "react";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
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
import type { ColumnDef, SortState } from "@/lib/table";
import { MANDATORY_COLUMN_IDS, type PoolColumnId } from "../../lib";

const restrictToHorizontalAxis = ({ transform }: { transform: { x: number; y: number; scaleX: number; scaleY: number } }) => ({
  ...transform,
  y: 0,
  scaleX: 1,
  scaleY: 1,
});

interface SortableHeaderCellProps {
  col: ColumnDef<PoolColumnId>;
  sort: SortState<PoolColumnId>;
  onSort: (column: PoolColumnId) => void;
}

function SortableHeaderCell({ col, sort, onSort }: SortableHeaderCellProps) {
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
      {...attributes}
      {...listeners}
      role="columnheader"
      style={style}
      className={cn(
        "flex cursor-grab items-center active:cursor-grabbing",
        isDragging && "rounded bg-zinc-200 px-2 shadow-md ring-1 ring-zinc-300 dark:bg-zinc-700 dark:ring-zinc-600",
        col.align === "right" && "justify-end",
      )}
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

const MemoizedSortableHeaderCell = memo(SortableHeaderCell);

export interface TableHeaderProps {
  columns: ColumnDef<PoolColumnId>[];
  gridTemplate: string;
  minWidth: number;
  gap: number;
  headerHeight: number;
  sort: SortState<PoolColumnId>;
  onSort: (column: PoolColumnId) => void;
  optionalColumnIds: PoolColumnId[];
  onReorder: (newOrder: PoolColumnId[]) => void;
}

export const TableHeader = memo(function TableHeader({
  columns,
  gridTemplate,
  minWidth,
  gap,
  headerHeight,
  sort,
  onSort,
  optionalColumnIds,
  onReorder,
}: TableHeaderProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (over && active.id !== over.id) {
        const oldIndex = optionalColumnIds.indexOf(active.id as PoolColumnId);
        const newIndex = optionalColumnIds.indexOf(over.id as PoolColumnId);
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
        style={{ gridTemplateColumns: gridTemplate, minWidth, gap, height: headerHeight }}
      >
        {columns
          .filter((c) => MANDATORY_COLUMN_IDS.has(c.id))
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

        <SortableContext items={optionalColumnIds} strategy={horizontalListSortingStrategy}>
          {columns
            .filter((c) => !MANDATORY_COLUMN_IDS.has(c.id))
            .map((col) => (
              <MemoizedSortableHeaderCell key={col.id} col={col} sort={sort} onSort={onSort} />
            ))}
        </SortableContext>
      </div>
    </DndContext>
  );
});
