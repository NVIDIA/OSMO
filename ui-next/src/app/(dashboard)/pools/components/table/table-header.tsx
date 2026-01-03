/**
 * Copyright (c) 2025-2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

"use client";

import { memo, useCallback } from "react";
import { SortableContext, horizontalListSortingStrategy } from "@dnd-kit/sortable";
import { cn } from "@/lib/utils";
import { SortButton, SortableCell } from "@/components/data-table";
import type { ColumnDef, SortState } from "@/lib/table";
import { MANDATORY_COLUMN_IDS, type PoolColumnId } from "../../lib/pool-columns";

// =============================================================================
// Types
// =============================================================================

export interface TableHeaderProps {
  columns: ColumnDef<PoolColumnId>[];
  sort: SortState<PoolColumnId>;
  onSort: (column: PoolColumnId) => void;
  optionalColumnIds: PoolColumnId[];
}

// =============================================================================
// Component
// =============================================================================

/**
 * TableHeader - Pool table header with sortable columns.
 *
 * Composes from shared SortButton and SortableCell components.
 * Mandatory columns are static, optional columns are draggable.
 */
export const TableHeader = memo(function TableHeader({
  columns,
  sort,
  onSort,
  optionalColumnIds,
}: TableHeaderProps) {
  // Helper to create sort handler for a column
  const handleSort = useCallback(
    (columnId: PoolColumnId) => () => onSort(columnId),
    [onSort]
  );

  return (
    <thead className="pools-thead sticky top-0 z-20 border-b border-zinc-200 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800">
      <tr>
        {/* Mandatory columns (non-draggable) */}
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
              <SortButton
                id={col.id}
                label={col.label}
                align={col.align}
                sortable={col.sortable}
                isActive={sort.column === col.id}
                direction={sort.direction}
                onSort={handleSort(col.id)}
              />
            </th>
          ))}

        {/* Optional columns (draggable) */}
        <SortableContext items={optionalColumnIds} strategy={horizontalListSortingStrategy}>
          {columns
            .filter((c) => !MANDATORY_COLUMN_IDS.has(c.id))
            .map((col) => (
              <SortableCell
                key={col.id}
                id={col.id}
                as="th"
                className={cn(
                  "pools-th px-3 py-2 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400",
                  col.align === "right" && "text-right",
                )}
              >
                <SortButton
                  id={col.id}
                  label={col.label}
                  align={col.align}
                  sortable={col.sortable}
                  isActive={sort.column === col.id}
                  direction={sort.direction}
                  onSort={handleSort(col.id)}
                />
              </SortableCell>
            ))}
        </SortableContext>
      </tr>
    </thead>
  );
});
