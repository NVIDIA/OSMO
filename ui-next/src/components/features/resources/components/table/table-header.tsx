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
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import {
  SortableContext,
  useSortable,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { cn } from "@/lib/utils";
import { COLUMN_LABELS, MANDATORY_COLUMN_IDS, type ResourceColumnId } from "../../lib";

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
// Sort Button Component (shared between mandatory and optional columns)
// =============================================================================

interface SortButtonProps {
  columnId: ResourceColumnId;
  label: string;
  align: "left" | "right";
  sort: SortState;
  onSort: (column: SortColumn) => void;
}

function SortButton({ columnId, label, align, sort, onSort }: SortButtonProps) {
  const isActive = sort.column === columnId;

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onSort(columnId);
      }}
      aria-sort={isActive ? (sort.direction === "asc" ? "ascending" : "descending") : undefined}
      className={cn(
        "flex items-center gap-1 whitespace-nowrap transition-colors",
        "hover:text-zinc-900 dark:hover:text-zinc-100",
        align === "right" && "ml-auto",
      )}
    >
      <span>{label}</span>
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
}

// =============================================================================
// Sortable Header Cell (draggable column header)
// =============================================================================

interface SortableHeaderCellProps {
  columnId: ResourceColumnId;
  sort: SortState;
  onSort: (column: SortColumn) => void;
}

function SortableHeaderCell({ columnId, sort, onSort }: SortableHeaderCellProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, node } = useSortable({ id: columnId });
  const width = node.current?.offsetWidth;
  const align = COLUMN_ALIGN[columnId];

  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, 0, 0)` : undefined,
    transition,
    zIndex: isDragging ? 10 : undefined,
    opacity: isDragging ? 0.8 : 1,
    width: isDragging && width ? width : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      role="columnheader"
      style={style}
      className={cn(
        "cursor-grab px-3 active:cursor-grabbing",
        isDragging && "rounded bg-zinc-200 shadow-md ring-1 ring-zinc-300 dark:bg-zinc-700 dark:ring-zinc-600",
        align === "right" && "text-right",
      )}
    >
      <SortButton
        columnId={columnId}
        label={COLUMN_LABELS[columnId]}
        align={align}
        sort={sort}
        onSort={onSort}
      />
    </div>
  );
}

const MemoizedSortableHeaderCell = memo(SortableHeaderCell);

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
              columnId={columnId}
              label={COLUMN_LABELS[columnId]}
              align={align}
              sort={sort}
              onSort={onSort}
            />
          </div>
        );
      })}

      {/* Optional columns - draggable, use optionalColumnIds for correct order */}
      <SortableContext items={optionalColumnIds} strategy={horizontalListSortingStrategy}>
        {optionalColumnIds.map((columnId) => (
          <MemoizedSortableHeaderCell
            key={columnId}
            columnId={columnId}
            sort={sort}
            onSort={onSort}
          />
        ))}
      </SortableContext>
    </div>
  );
});
