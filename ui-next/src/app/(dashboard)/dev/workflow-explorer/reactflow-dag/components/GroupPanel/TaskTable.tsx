// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * TaskTable Components
 *
 * Virtualized, sortable task table with drag-to-reorder columns.
 * Optimized for large datasets with GPU-accelerated rendering.
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
import { useVirtualizerCompat } from "@/hooks";
import { TABLE_ROW_HEIGHT } from "../../constants";
import { formatDuration } from "../../../workflow-types";
import { getStatusIconCompact } from "../../utils/status";
import type { TaskWithDuration, ColumnDef, ColumnId, SortState, SortColumn } from "../../types/table";
import { COLUMN_MAP, MANDATORY_COLUMN_IDS, getGridTemplate, getMinTableWidth } from "./column-config";

// ============================================================================
// Helpers
// ============================================================================

function formatTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const date = new Date(dateStr);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const ampm = hours >= 12 ? "p" : "a";
  const hour12 = hours % 12 || 12;
  return `${month}/${day} ${hour12}:${minutes}${ampm}`;
}

// Horizontal-only modifier - locks Y axis completely
const restrictToHorizontalAxis = ({
  transform,
}: {
  transform: { x: number; y: number; scaleX: number; scaleY: number };
}) => ({
  ...transform,
  y: 0,
  scaleX: 1,
  scaleY: 1,
});

// ============================================================================
// TaskCell Component
// ============================================================================

const TaskCell = memo(function TaskCell({ task, columnId }: { task: TaskWithDuration; columnId: ColumnId }) {
  switch (columnId) {
    case "status":
      return getStatusIconCompact(task.status);
    case "name":
      return (
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium text-gray-900 dark:text-zinc-100">{task.name}</span>
          {task.lead && (
            <span className="shrink-0 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium tracking-wide text-amber-700 uppercase ring-1 ring-amber-600/20 ring-inset dark:bg-amber-500/20 dark:text-amber-400 dark:ring-amber-500/30">
              Lead
            </span>
          )}
        </div>
      );
    case "duration":
      return (
        <span className="whitespace-nowrap text-gray-500 tabular-nums dark:text-zinc-400">
          {formatDuration(task.duration)}
        </span>
      );
    case "node":
      return <span className="truncate text-gray-500 dark:text-zinc-400">{task.node_name ?? "—"}</span>;
    case "podIp":
      return (
        <span className="truncate font-mono text-xs whitespace-nowrap text-gray-500 dark:text-zinc-400">
          {task.pod_ip ?? "—"}
        </span>
      );
    case "exitCode":
      return (
        <span
          className={cn(
            "whitespace-nowrap tabular-nums",
            task.exit_code === 0
              ? "text-gray-500 dark:text-zinc-400"
              : task.exit_code !== undefined
                ? "text-red-600 dark:text-red-400"
                : "text-gray-400 dark:text-zinc-500",
          )}
        >
          {task.exit_code ?? "—"}
        </span>
      );
    case "startTime":
      return (
        <span className="whitespace-nowrap text-gray-500 tabular-nums dark:text-zinc-400">
          {formatTime(task.start_time)}
        </span>
      );
    case "endTime":
      return (
        <span className="whitespace-nowrap text-gray-500 tabular-nums dark:text-zinc-400">
          {formatTime(task.end_time)}
        </span>
      );
    case "retry":
      return (
        <span
          className={cn(
            "whitespace-nowrap tabular-nums",
            task.retry_id > 0 ? "text-amber-600 dark:text-amber-400" : "text-gray-400 dark:text-zinc-500",
          )}
        >
          {task.retry_id > 0 ? task.retry_id : "—"}
        </span>
      );
    default:
      return <span>—</span>;
  }
});

// ============================================================================
// TaskRow Component
// ============================================================================

const TaskRow = memo(
  function TaskRow({
    task,
    gridTemplate,
    minWidth,
    isSelected,
    onSelect,
    visibleColumnIds,
  }: {
    task: TaskWithDuration;
    gridTemplate: string;
    minWidth: number;
    isSelected: boolean;
    onSelect: () => void;
    visibleColumnIds: ColumnId[];
  }) {
    const rowStyle = useMemo(
      () => ({
        gridTemplateColumns: gridTemplate,
        minWidth,
      }),
      [gridTemplate, minWidth],
    );

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
          "dag-contained grid cursor-pointer items-center gap-6 border-b border-gray-200 px-3 py-2 text-sm transition-colors duration-75 dark:border-zinc-800",
          "focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none focus-visible:ring-inset",
          isSelected ? "bg-blue-100 dark:bg-blue-900/30" : "hover:bg-gray-100 dark:hover:bg-zinc-800/50",
        )}
        style={rowStyle}
      >
        {visibleColumnIds.map((colId) => {
          const col = COLUMN_MAP.get(colId)!;
          return (
            <div
              key={colId}
              role="cell"
              className={cn("flex items-center overflow-hidden", col.align === "right" && "justify-end")}
            >
              <TaskCell
                task={task}
                columnId={colId}
              />
            </div>
          );
        })}
      </div>
    );
  },
  (prev, next) =>
    prev.task === next.task &&
    prev.gridTemplate === next.gridTemplate &&
    prev.minWidth === next.minWidth &&
    prev.isSelected === next.isSelected &&
    prev.visibleColumnIds === next.visibleColumnIds,
);

// ============================================================================
// SortableHeaderCell Component
// ============================================================================

const SortableHeaderCell = memo(function SortableHeaderCell({
  col,
  sort,
  onSort,
}: {
  col: ColumnDef;
  sort: SortState;
  onSort: (column: SortColumn) => void;
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
      style={style}
      className={cn(
        "flex cursor-grab items-center active:cursor-grabbing",
        isDragging && "rounded bg-gray-200 px-2 shadow-md ring-1 ring-gray-300 dark:bg-zinc-700 dark:ring-zinc-600",
        col.align === "right" && "justify-end",
      )}
      {...attributes}
      {...listeners}
      role="columnheader"
    >
      <button
        onClick={handleClick}
        disabled={!col.sortable}
        aria-sort={sort.column === col.id ? (sort.direction === "asc" ? "ascending" : "descending") : undefined}
        className={cn("flex items-center gap-1 truncate transition-colors", col.sortable && "hover:text-white")}
      >
        <span className="truncate">{col.label}</span>
        {col.sortable &&
          (sort.column === col.id ? (
            sort.direction === "asc" ? (
              <ChevronUp
                className="size-3 shrink-0"
                aria-hidden="true"
              />
            ) : (
              <ChevronDown
                className="size-3 shrink-0"
                aria-hidden="true"
              />
            )
          ) : (
            <ChevronsUpDown
              className="size-3 shrink-0 opacity-30"
              aria-hidden="true"
            />
          ))}
      </button>
    </div>
  );
});

// ============================================================================
// TaskTableHeader Component
// ============================================================================

const TaskTableHeader = memo(function TaskTableHeader({
  columns,
  gridTemplate,
  minWidth,
  sort,
  onSort,
  optionalColumnIds,
  onReorder,
}: {
  columns: ColumnDef[];
  gridTemplate: string;
  minWidth: number;
  sort: SortState;
  onSort: (column: SortColumn) => void;
  optionalColumnIds: ColumnId[];
  onReorder: (newOrder: ColumnId[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (over && active.id !== over.id) {
        const oldIndex = optionalColumnIds.indexOf(active.id as ColumnId);
        const newIndex = optionalColumnIds.indexOf(over.id as ColumnId);
        if (oldIndex !== -1 && newIndex !== -1) {
          onReorder(arrayMove(optionalColumnIds, oldIndex, newIndex));
        }
      }
    },
    [optionalColumnIds, onReorder],
  );

  // Use pre-computed constant instead of useMemo
  const mandatoryIds = MANDATORY_COLUMN_IDS;

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
        className="dag-gpu-accelerated grid items-center gap-6 border-b border-gray-200 bg-gray-100 px-3 py-2 text-xs font-medium text-gray-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400"
        style={{ gridTemplateColumns: gridTemplate, minWidth }}
      >
        {columns
          .filter((c) => mandatoryIds.has(c.id))
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
                className={cn("flex items-center gap-1 truncate transition-colors", col.sortable && "hover:text-white")}
              >
                <span className="truncate">{col.label}</span>
                {col.sortable &&
                  (sort.column === col.id ? (
                    sort.direction === "asc" ? (
                      <ChevronUp
                        className="size-3 shrink-0"
                        aria-hidden="true"
                      />
                    ) : (
                      <ChevronDown
                        className="size-3 shrink-0"
                        aria-hidden="true"
                      />
                    )
                  ) : (
                    <ChevronsUpDown
                      className="size-3 shrink-0 opacity-30"
                      aria-hidden="true"
                    />
                  ))}
              </button>
            </div>
          ))}

        <SortableContext
          items={optionalColumnIds}
          strategy={horizontalListSortingStrategy}
        >
          {columns
            .filter((c) => !mandatoryIds.has(c.id))
            .map((col) => (
              <SortableHeaderCell
                key={col.id}
                col={col}
                sort={sort}
                onSort={onSort}
              />
            ))}
        </SortableContext>
      </div>
    </DndContext>
  );
});

// ============================================================================
// VirtualizedTaskList Component
// ============================================================================

interface VirtualizedTaskListProps {
  tasks: TaskWithDuration[];
  columns: ColumnDef[];
  selectedTaskName: string | null;
  onSelectTask: (task: TaskWithDuration) => void;
  sort: SortState;
  onSort: (column: SortColumn) => void;
  optionalColumnIds: ColumnId[];
  onReorderColumns: (newOrder: ColumnId[]) => void;
}

export const VirtualizedTaskList = memo(function VirtualizedTaskList({
  tasks,
  columns,
  selectedTaskName,
  onSelectTask,
  sort,
  onSort,
  optionalColumnIds,
  onReorderColumns,
}: VirtualizedTaskListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizerCompat({
    count: tasks.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => TABLE_ROW_HEIGHT,
    overscan: 15,
  });

  const gridTemplate = useMemo(() => getGridTemplate(columns), [columns]);
  const minWidth = useMemo(() => getMinTableWidth(columns), [columns]);
  const visibleColumnIds = useMemo(() => columns.map((c) => c.id), [columns]);

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  if (tasks.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-gray-500 dark:text-zinc-400">
        No tasks match your filters
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="dag-table-container flex-1 overflow-auto overscroll-contain"
      role="table"
      aria-label="Task list"
      aria-rowcount={tasks.length}
    >
      <div style={{ minWidth }}>
        <div
          className="dag-table-header-wrapper sticky top-0 z-10 touch-none bg-white dark:bg-zinc-900"
          role="rowgroup"
        >
          <TaskTableHeader
            columns={columns}
            gridTemplate={gridTemplate}
            minWidth={minWidth}
            sort={sort}
            onSort={onSort}
            optionalColumnIds={optionalColumnIds}
            onReorder={onReorderColumns}
          />
        </div>

        <div
          className="dag-table-virtual-container relative"
          role="rowgroup"
          style={{ height: totalSize }}
        >
          {virtualItems.map((virtualRow) => {
            const task = tasks[virtualRow.index];
            return (
              <div
                key={task.name}
                className="dag-virtual-item absolute top-0 left-0 w-full"
                style={{
                  height: TABLE_ROW_HEIGHT,
                  transform: `translate3d(0, ${virtualRow.start}px, 0)`,
                }}
              >
                <TaskRow
                  task={task}
                  gridTemplate={gridTemplate}
                  minWidth={minWidth}
                  isSelected={selectedTaskName === task.name}
                  onSelect={() => onSelectTask(task)}
                  visibleColumnIds={visibleColumnIds}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});
