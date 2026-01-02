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
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { COLUMN_LABELS, type ResourceColumnId } from "../../lib";

export type SortColumn = ResourceColumnId;
export type SortDirection = "asc" | "desc";

export interface SortState {
  column: SortColumn | null;
  direction: SortDirection;
}

/** Column alignment by ID */
const COLUMN_ALIGN: Record<ResourceColumnId, "left" | "right"> = {
  resource: "left",
  pools: "left",
  platform: "left",
  gpu: "right",
  cpu: "right",
  memory: "right",
  storage: "right",
};

interface TableHeaderProps {
  compact: boolean;
  /** IDs of columns to display (in order) */
  visibleColumnIds: ResourceColumnId[];
  sort: SortState;
  onSort: (column: SortColumn) => void;
}

/**
 * Memoized table header - only re-renders when sort state or layout changes.
 * Uses CSS custom property --table-grid-columns from parent for column alignment.
 * Styled to match the pools table header (neutral gray tones).
 */
export const TableHeader = memo(function TableHeader({
  compact,
  visibleColumnIds,
  sort,
  onSort,
}: TableHeaderProps) {
  // Build columns from visible IDs
  const columns = useMemo(
    () =>
      visibleColumnIds.map((id) => ({
        label: COLUMN_LABELS[id],
        column: id,
        align: COLUMN_ALIGN[id],
      })),
    [visibleColumnIds],
  );

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
      {columns.map((col) => {
        const isActive = sort.column === col.column;
        return (
          <button
            key={col.column}
            role="columnheader"
            onClick={() => onSort(col.column)}
            aria-sort={isActive ? (sort.direction === "asc" ? "ascending" : "descending") : undefined}
            className={cn(
              "flex items-center gap-1 px-3 transition-colors",
              "hover:text-zinc-900 dark:hover:text-zinc-100",
              col.align === "right" && "justify-end",
            )}
          >
            <span className="truncate">{col.label}</span>
            {isActive ? (
              sort.direction === "asc" ? (
                <ChevronUp className="size-3 shrink-0" aria-hidden="true" />
              ) : (
                <ChevronDown className="size-3 shrink-0" aria-hidden="true" />
              )
            ) : (
              <ChevronsUpDown className="size-3 shrink-0 opacity-30" aria-hidden="true" />
            )}
          </button>
        );
      })}
    </div>
  );
});
