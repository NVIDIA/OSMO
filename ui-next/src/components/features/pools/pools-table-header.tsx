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
 * Pools Table Header Component
 *
 * Header row with sortable columns and DND column reordering.
 * Uses @dnd-kit for horizontal-only column drag.
 */

"use client";

import { memo, useCallback } from "react";
import { DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors } from "@dnd-kit/core";
import type { DragEndEvent, Modifier } from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// Inline restrictToHorizontalAxis modifier to avoid @dnd-kit/modifiers dependency
const restrictToHorizontalAxis: Modifier = ({ transform }) => ({
  ...transform,
  y: 0,
});
import { ChevronUp, ChevronDown, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { POOL_COLUMN_MAP, MANDATORY_COLUMN_IDS } from "./pool-columns";
import type { PoolColumnDef } from "./pool-columns";

export interface PoolsTableHeaderProps {
  /** Visible column IDs in display order */
  visibleColumnIds: string[];
  /** Current column order */
  columnOrder: string[];
  /** CSS grid template */
  gridTemplate: string;
  /** Minimum header width */
  minWidth: number;
  /** Current sort state */
  sort: { column: string; direction: "asc" | "desc" } | null;
  /** Callback when sort changes */
  onSort: (column: string) => void;
  /** Callback when column order changes */
  onColumnOrderChange: (order: string[]) => void;
}

/**
 * Sortable header cell component.
 */
const SortableHeaderCell = memo(function SortableHeaderCell({
  column,
  sort,
  onSort,
}: {
  column: PoolColumnDef;
  sort: { column: string; direction: "asc" | "desc" } | null;
  onSort: (column: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: column.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const isSorted = sort?.column === column.id;
  const sortDirection = isSorted ? sort.direction : null;

  const handleClick = useCallback(() => {
    if (column.sortable) {
      onSort(column.id);
    }
  }, [column.id, column.sortable, onSort]);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400",
        column.sortable && "cursor-pointer select-none hover:text-zinc-700 dark:hover:text-zinc-200",
        isDragging && "z-10",
      )}
      onClick={handleClick}
    >
      {/* Drag handle */}
      <span
        className="cursor-grab text-zinc-300 hover:text-zinc-500 dark:text-zinc-600 dark:hover:text-zinc-400"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-3" />
      </span>

      {/* Column label */}
      <span>{column.header}</span>

      {/* Sort indicator */}
      {column.sortable && (
        <span className="ml-0.5">
          {sortDirection === "asc" && <ChevronUp className="size-3" />}
          {sortDirection === "desc" && <ChevronDown className="size-3" />}
          {!sortDirection && <ChevronUp className="size-3 opacity-0" />}
        </span>
      )}
    </div>
  );
});

/**
 * Static header cell for mandatory columns (not draggable).
 */
const StaticHeaderCell = memo(function StaticHeaderCell({
  column,
  sort,
  onSort,
}: {
  column: PoolColumnDef;
  sort: { column: string; direction: "asc" | "desc" } | null;
  onSort: (column: string) => void;
}) {
  const isSorted = sort?.column === column.id;
  const sortDirection = isSorted ? sort.direction : null;

  const handleClick = useCallback(() => {
    if (column.sortable) {
      onSort(column.id);
    }
  }, [column.id, column.sortable, onSort]);

  return (
    <div
      className={cn(
        "flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400",
        column.sortable && "cursor-pointer select-none hover:text-zinc-700 dark:hover:text-zinc-200",
      )}
      onClick={handleClick}
    >
      <span>{column.header}</span>

      {column.sortable && (
        <span className="ml-0.5">
          {sortDirection === "asc" && <ChevronUp className="size-3" />}
          {sortDirection === "desc" && <ChevronDown className="size-3" />}
          {!sortDirection && <ChevronUp className="size-3 opacity-0" />}
        </span>
      )}
    </div>
  );
});

export const PoolsTableHeader = memo(function PoolsTableHeader({
  visibleColumnIds,
  columnOrder,
  gridTemplate,
  minWidth,
  sort,
  onSort,
  onColumnOrderChange,
}: PoolsTableHeaderProps) {
  // Get ordered visible columns
  const orderedColumns = columnOrder
    .filter((id) => visibleColumnIds.includes(id))
    .map((id) => POOL_COLUMN_MAP.get(id))
    .filter((col): col is PoolColumnDef => col !== undefined);

  // Separate mandatory and optional columns
  const mandatoryColumns = orderedColumns.filter((c) => MANDATORY_COLUMN_IDS.has(c.id));
  const optionalColumns = orderedColumns.filter((c) => !MANDATORY_COLUMN_IDS.has(c.id));
  const optionalColumnIds = optionalColumns.map((c) => c.id);

  // DND sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  // Handle column reorder
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (over && active.id !== over.id) {
        const oldIndex = columnOrder.indexOf(active.id as string);
        const newIndex = columnOrder.indexOf(over.id as string);
        onColumnOrderChange(arrayMove(columnOrder, oldIndex, newIndex));
      }
    },
    [columnOrder, onColumnOrderChange],
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
        className="pools-contained grid items-center gap-6 border-b border-zinc-200 bg-zinc-50 px-3 py-2.5 dark:border-zinc-700 dark:bg-zinc-800/80"
        style={{
          gridTemplateColumns: gridTemplate,
          minWidth,
        }}
      >
        {/* Mandatory columns (not draggable) */}
        {mandatoryColumns.map((column) => (
          <StaticHeaderCell key={column.id} column={column} sort={sort} onSort={onSort} />
        ))}

        {/* Optional columns (draggable) */}
        <SortableContext items={optionalColumnIds} strategy={horizontalListSortingStrategy}>
          {optionalColumns.map((column) => (
            <SortableHeaderCell key={column.id} column={column} sort={sort} onSort={onSort} />
          ))}
        </SortableContext>
      </div>
    </DndContext>
  );
});
