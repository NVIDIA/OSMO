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
  SortableContext,
  useSortable,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { cn } from "@/lib/utils";
import type { ColumnDef, SortState } from "@/lib/table";
import { MANDATORY_COLUMN_IDS, type PoolColumnId } from "../../lib";

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
    <th
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      scope="col"
      style={style}
      className={cn(
        "pools-th cursor-grab px-3 py-2 text-left text-xs font-medium text-zinc-500 active:cursor-grabbing dark:text-zinc-400",
        isDragging && "rounded bg-zinc-200 shadow-md ring-1 ring-zinc-300 dark:bg-zinc-700 dark:ring-zinc-600",
        col.align === "right" && "text-right",
      )}
    >
      <button
        onClick={handleClick}
        disabled={!col.sortable}
        aria-sort={sort.column === col.id ? (sort.direction === "asc" ? "ascending" : "descending") : undefined}
        className={cn(
          "flex items-center gap-1 truncate transition-colors",
          col.sortable && "hover:text-zinc-900 dark:hover:text-zinc-100",
          col.align === "right" && "ml-auto",
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
    </th>
  );
}

const MemoizedSortableHeaderCell = memo(SortableHeaderCell);

export interface TableHeaderProps {
  columns: ColumnDef<PoolColumnId>[];
  sort: SortState<PoolColumnId>;
  onSort: (column: PoolColumnId) => void;
  optionalColumnIds: PoolColumnId[];
}

export const TableHeader = memo(function TableHeader({
  columns,
  sort,
  onSort,
  optionalColumnIds,
}: TableHeaderProps) {
  return (
    <thead className="pools-thead sticky top-0 z-20 border-b border-zinc-200 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800">
      <tr>
        {columns
          .filter((c) => MANDATORY_COLUMN_IDS.has(c.id))
          .map((col) => (
            <th
              key={col.id}
              scope="col"
              className={cn(
                "pools-th px-3 py-2 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400",
                col.align === "right" && "text-right",
              )}
            >
              <button
                onClick={() => col.sortable && onSort(col.id)}
                disabled={!col.sortable}
                aria-sort={sort.column === col.id ? (sort.direction === "asc" ? "ascending" : "descending") : undefined}
                className={cn(
                  "flex items-center gap-1 truncate transition-colors",
                  col.sortable && "hover:text-zinc-900 dark:hover:text-zinc-100",
                  col.align === "right" && "ml-auto",
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
            </th>
          ))}

        <SortableContext items={optionalColumnIds} strategy={horizontalListSortingStrategy}>
          {columns
            .filter((c) => !MANDATORY_COLUMN_IDS.has(c.id))
            .map((col) => (
              <MemoizedSortableHeaderCell key={col.id} col={col} sort={sort} onSort={onSort} />
            ))}
        </SortableContext>
      </tr>
    </thead>
  );
});
