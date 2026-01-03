/**
 * Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

"use client";

import { memo, useMemo } from "react";
import { SortableContext, horizontalListSortingStrategy } from "@dnd-kit/sortable";
import { cn } from "@/lib/utils";
import type { TableHeaderProps, ColumnConfig, SortState } from "./types";
import { SortButton } from "./SortButton";
import { SortableCell } from "./SortableCell";

/**
 * Table header with sortable columns and DnD reordering.
 *
 * Features:
 * - Mandatory columns are static (not draggable)
 * - Optional columns are draggable via DnD
 * - Sort indicators on sortable columns
 * - Sticky positioning with shadow on scroll
 * - CSS Grid layout matching table body
 */
export const TableHeader = memo(function TableHeader<TColumnId extends string>({
  columns,
  visibleColumnIds,
  optionalColumnIds,
  sort,
  onSort,
  compact = false,
  gridTemplate,
  isScrolled = false,
}: TableHeaderProps<TColumnId>) {
  // Get visible columns in order
  const visibleColumns = useMemo(
    () =>
      visibleColumnIds
        .map((id) => columns.find((c) => c.id === id))
        .filter((c): c is ColumnConfig<TColumnId> => c !== undefined),
    [columns, visibleColumnIds],
  );

  // Separate mandatory and optional columns
  const mandatoryColumns = useMemo(
    () => visibleColumns.filter((c) => c.mandatory),
    [visibleColumns],
  );

  return (
    <div
      role="row"
      className={cn(
        "sticky top-0 z-10 grid gap-0 border-b border-zinc-200 bg-zinc-100 text-xs font-medium text-zinc-500",
        "dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400",
        "transition-shadow",
        compact ? "py-1.5" : "py-2",
        isScrolled && "shadow-md",
      )}
      style={{
        gridTemplateColumns: gridTemplate,
        contain: "layout style",
      }}
    >
      {/* Mandatory columns - not draggable */}
      {mandatoryColumns.map((column) => (
        <div
          key={column.id}
          role="columnheader"
          className={cn("px-3", column.align === "right" && "text-right")}
        >
          <SortButton
            id={column.id}
            label={column.label}
            align={column.align}
            sortable={column.sortable !== false}
            isActive={sort.column === column.id}
            direction={sort.column === column.id ? sort.direction : undefined}
            onSort={() => onSort(column.id)}
          />
        </div>
      ))}

      {/* Optional columns - draggable */}
      <SortableContext items={optionalColumnIds} strategy={horizontalListSortingStrategy}>
        {optionalColumnIds.map((columnId) => {
          const column = columns.find((c) => c.id === columnId);
          if (!column) return null;

          return (
            <SortableCell
              key={column.id}
              id={column.id}
              className={cn("px-3", column.align === "right" && "text-right")}
            >
              <SortButton
                id={column.id}
                label={column.label}
                align={column.align}
                sortable={column.sortable !== false}
                isActive={sort.column === column.id}
                direction={sort.column === column.id ? sort.direction : undefined}
                onSort={() => onSort(column.id)}
              />
            </SortableCell>
          );
        })}
      </SortableContext>
    </div>
  );
}) as <TColumnId extends string>(props: TableHeaderProps<TColumnId>) => React.ReactElement;
