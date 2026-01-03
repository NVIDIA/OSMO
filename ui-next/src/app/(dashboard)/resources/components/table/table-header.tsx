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

import { memo } from "react";
import {
  SortableContext,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { cn } from "@/lib/utils";
import { SortButton, SortableCell } from "@/components/data-table";
import { COLUMN_LABELS, MANDATORY_COLUMN_IDS, type ResourceColumnId } from "../../lib/resource-columns";

export type SortColumn = ResourceColumnId;
export type SortDirection = "asc" | "desc";

export interface SortState {
  column: SortColumn | null;
  direction: SortDirection;
}

/** Column alignment by ID */
const COLUMN_ALIGN: Record<ResourceColumnId, "left" | "right"> = {
  resource: "left",
  type: "left",
  pools: "left",
  platform: "left",
  backend: "left",
  gpu: "right",
  cpu: "right",
  memory: "right",
  storage: "right",
};

// =============================================================================
// Table Header
// =============================================================================

interface TableHeaderProps {
  compact: boolean;
  /** IDs of columns to display (in order) */
  visibleColumnIds: ResourceColumnId[];
  /** IDs of optional (draggable) columns in order */
  optionalColumnIds: ResourceColumnId[];
  sort: SortState;
  onSort: (column: SortColumn) => void;
}

/**
 * Memoized table header with drag-and-drop column reordering.
 * Uses shared SortButton and SortableCell from @/components/data-table.
 * Mandatory columns (resource) are not draggable, optional columns are.
 */
export const TableHeader = memo(function TableHeader({
  compact,
  visibleColumnIds,
  optionalColumnIds,
  sort,
  onSort,
}: TableHeaderProps) {
  // Mandatory columns are rendered separately (not draggable)
  const mandatoryColumns = visibleColumnIds.filter((id) => MANDATORY_COLUMN_IDS.has(id));

  return (
    <div
      role="row"
      className={cn(
        "grid gap-0 border-b border-zinc-200 bg-zinc-100 text-xs font-medium text-zinc-500",
        "dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400",
        compact ? "py-1.5" : "py-2",
      )}
      style={{ gridTemplateColumns: "var(--table-grid-columns)", contain: "layout style" }}
    >
      {/* Mandatory columns - not draggable */}
      {mandatoryColumns.map((columnId) => {
        const align = COLUMN_ALIGN[columnId];
        return (
          <div
            key={columnId}
            role="columnheader"
            className={cn("px-3", align === "right" && "text-right")}
          >
            <SortButton
              id={columnId}
              label={COLUMN_LABELS[columnId]}
              align={align}
              isActive={sort.column === columnId}
              direction={sort.direction}
              onSort={() => onSort(columnId)}
            />
          </div>
        );
      })}

      {/* Optional columns - draggable, use optionalColumnIds for correct order */}
      <SortableContext items={optionalColumnIds} strategy={horizontalListSortingStrategy}>
        {optionalColumnIds.map((columnId) => {
          const align = COLUMN_ALIGN[columnId];
          return (
            <SortableCell
              key={columnId}
              id={columnId}
              className={cn("px-3", align === "right" && "text-right")}
            >
              <SortButton
                id={columnId}
                label={COLUMN_LABELS[columnId]}
                align={align}
                isActive={sort.column === columnId}
                direction={sort.direction}
                onSort={() => onSort(columnId)}
              />
            </SortableCell>
          );
        })}
      </SortableContext>
    </div>
  );
});
