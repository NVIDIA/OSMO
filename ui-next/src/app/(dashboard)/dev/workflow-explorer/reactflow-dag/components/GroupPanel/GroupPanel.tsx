// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * GroupPanel Component
 *
 * Displays a group's tasks in a searchable, sortable, virtualized table.
 * Serves as the intermediate view between DAG overview and task details.
 *
 * Features:
 * - Smart search with chip-based filters
 * - Virtualized task list for large groups
 * - Sortable and reorderable columns
 * - Column visibility customization
 * - GPU-accelerated rendering
 */

"use client";

import { useState, useMemo, useCallback, memo } from "react";
import { X, MoreVertical, Columns, Check, Loader2, AlertCircle, Clock, PanelLeftClose, Columns2, PanelLeft } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { GPU_STYLES, PANEL, STATUS_SORT_ORDER } from "../../constants";
import { calculateDuration, formatDuration } from "../../../workflow-types";
import { computeTaskStats, computeGroupStatus, computeGroupDuration } from "../../utils/status";
import { usePersistedState } from "../../hooks";
import type { TaskWithDuration, ColumnDef, ColumnId, SortState, SortColumn, SearchChip, GroupPanelProps } from "./types";
import { MANDATORY_COLUMNS, OPTIONAL_COLUMNS_ALPHABETICAL, OPTIONAL_COLUMN_MAP, DEFAULT_VISIBLE_OPTIONAL } from "./column-config";
import { SmartSearch, filterTasksByChips } from "./SmartSearch";
import { VirtualizedTaskList } from "./TaskTable";

// ============================================================================
// Width Preset Icons
// ============================================================================

const WIDTH_PRESET_ICONS = {
  33: PanelLeftClose,
  50: Columns2,
  75: PanelLeft,
} as const;

// ============================================================================
// GroupPanel Component
// ============================================================================

export const GroupPanel = memo(function GroupPanel({
  group,
  onClose,
  onSelectTask,
  panelPct,
  onPanelResize,
}: GroupPanelProps) {
  const [searchChips, setSearchChips] = useState<SearchChip[]>([]);
  const [selectedTaskName, setSelectedTaskName] = useState<string | null>(null);

  // Persisted settings
  const [sort, setSort] = usePersistedState<SortState>("sort", { column: "status", direction: "asc" });
  const [visibleOptionalIds, setVisibleOptionalIds] = usePersistedState<string[]>("visibleColumnIds", DEFAULT_VISIBLE_OPTIONAL);

  // Compute tasks with duration
  const tasksWithDuration: TaskWithDuration[] = useMemo(() => {
    return (group.tasks || []).map((task) => ({
      ...task,
      duration: calculateDuration(task.start_time, task.end_time),
    }));
  }, [group.tasks]);

  // Compute stats (single pass)
  const stats = useMemo(() => computeTaskStats(tasksWithDuration), [tasksWithDuration]);
  const groupStatus = useMemo(() => computeGroupStatus(stats), [stats]);
  const groupDuration = useMemo(() => computeGroupDuration(stats), [stats]);

  // Build visible columns
  const visibleColumns = useMemo(() => {
    const optionalCols = (visibleOptionalIds as ColumnId[])
      .map((id) => OPTIONAL_COLUMN_MAP.get(id))
      .filter(Boolean) as ColumnDef[];
    return [...MANDATORY_COLUMNS, ...optionalCols];
  }, [visibleOptionalIds]);

  // Sort comparator
  const sortComparator = useMemo(() => {
    if (!sort.column) return null;
    const dir = sort.direction === "asc" ? 1 : -1;

    switch (sort.column) {
      case "status": return (a: TaskWithDuration, b: TaskWithDuration) => ((STATUS_SORT_ORDER[a.status] ?? 99) - (STATUS_SORT_ORDER[b.status] ?? 99)) * dir;
      case "name": return (a: TaskWithDuration, b: TaskWithDuration) => a.name.localeCompare(b.name) * dir;
      case "duration": return (a: TaskWithDuration, b: TaskWithDuration) => ((a.duration ?? 0) - (b.duration ?? 0)) * dir;
      case "node": return (a: TaskWithDuration, b: TaskWithDuration) => (a.node_name ?? "").localeCompare(b.node_name ?? "") * dir;
      case "podIp": return (a: TaskWithDuration, b: TaskWithDuration) => (a.pod_ip ?? "").localeCompare(b.pod_ip ?? "") * dir;
      case "exitCode": return (a: TaskWithDuration, b: TaskWithDuration) => ((a.exit_code ?? -1) - (b.exit_code ?? -1)) * dir;
      case "startTime": return (a: TaskWithDuration, b: TaskWithDuration) => {
        const aTime = a.start_time ? new Date(a.start_time).getTime() : 0;
        const bTime = b.start_time ? new Date(b.start_time).getTime() : 0;
        return (aTime - bTime) * dir;
      };
      case "endTime": return (a: TaskWithDuration, b: TaskWithDuration) => {
        const aTime = a.end_time ? new Date(a.end_time).getTime() : 0;
        const bTime = b.end_time ? new Date(b.end_time).getTime() : 0;
        return (aTime - bTime) * dir;
      };
      case "retry": return (a: TaskWithDuration, b: TaskWithDuration) => (a.retry_id - b.retry_id) * dir;
      default: return null;
    }
  }, [sort.column, sort.direction]);

  // Filter and sort tasks
  const filteredTasks = useMemo(() => {
    let result = filterTasksByChips(tasksWithDuration, searchChips);
    if (sortComparator) {
      result = [...result].sort(sortComparator);
    }
    return result;
  }, [tasksWithDuration, searchChips, sortComparator]);

  // Callbacks
  const toggleColumn = useCallback((columnId: ColumnId) => {
    setVisibleOptionalIds((prev) => {
      const prevIds = prev as ColumnId[];
      if (prevIds.includes(columnId)) {
        return prevIds.filter((id) => id !== columnId);
      }
      return [...prevIds, columnId];
    });
  }, [setVisibleOptionalIds]);

  const reorderColumns = useCallback((newOrder: ColumnId[]) => {
    setVisibleOptionalIds(newOrder);
  }, [setVisibleOptionalIds]);

  const handleSort = useCallback((column: SortColumn) => {
    setSort((prev) => {
      if (prev.column === column) {
        if (prev.direction === "asc") return { column, direction: "desc" };
        return { column: null, direction: "asc" };
      }
      return { column, direction: "asc" };
    });
  }, [setSort]);

  const handleSelectTask = useCallback((task: TaskWithDuration) => {
    setSelectedTaskName(task.name);
    onSelectTask(task, group);
  }, [group, onSelectTask]);

  const handleClearFilters = useCallback(() => {
    setSearchChips([]);
  }, []);

  return (
    <div
      className="flex h-full flex-col overflow-hidden bg-white shadow-[-0.25rem_0_1rem_-0.25rem_rgba(0,0,0,0.1)] dark:bg-zinc-950 dark:shadow-[-0.25rem_0_1rem_-0.25rem_rgba(0,0,0,0.4)]"
      style={GPU_STYLES.contained}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-sm font-semibold text-zinc-900 dark:text-white">{group.name}</h2>
            <span className="text-zinc-300 dark:text-zinc-600">·</span>
            <span className="shrink-0 text-sm text-zinc-500 dark:text-zinc-400">{stats.total} tasks</span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs">
            <span
              className={cn(
                "flex items-center gap-1.5",
                groupStatus.status === "completed" && "text-emerald-600 dark:text-emerald-400",
                groupStatus.status === "running" && "text-blue-600 dark:text-blue-400",
                groupStatus.status === "failed" && "text-red-600 dark:text-red-400",
                groupStatus.status === "pending" && "text-zinc-500 dark:text-zinc-400",
              )}
            >
              {groupStatus.status === "completed" && <Check className="size-3" />}
              {groupStatus.status === "running" && <Loader2 className="size-3 animate-spin" />}
              {groupStatus.status === "failed" && <AlertCircle className="size-3" />}
              {groupStatus.status === "pending" && <Clock className="size-3" />}
              <span className="font-medium">{groupStatus.label}</span>
            </span>
            {groupDuration !== null && (
              <>
                <span className="text-zinc-300 dark:text-zinc-600">·</span>
                <span className="text-zinc-500 dark:text-zinc-400">{formatDuration(groupDuration)}</span>
              </>
            )}
          </div>
        </div>

        <div className="ml-2 flex shrink-0 items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300">
                <MoreVertical className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Columns className="mr-2 size-4" />
                  Columns
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-36">
                  {OPTIONAL_COLUMNS_ALPHABETICAL.map((col) => (
                    <DropdownMenuCheckboxItem
                      key={col.id}
                      checked={(visibleOptionalIds as ColumnId[]).includes(col.id)}
                      onCheckedChange={() => toggleColumn(col.id)}
                      onSelect={(e) => e.preventDefault()}
                    >
                      {col.menuLabel}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              {onPanelResize && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs text-zinc-500">Snap to</DropdownMenuLabel>
                  {PANEL.WIDTH_PRESETS.map((pct) => {
                    const Icon = WIDTH_PRESET_ICONS[pct];
                    return (
                      <DropdownMenuItem key={pct} onClick={() => onPanelResize(pct)}>
                        <Icon className="mr-2 size-4" />
                        <span>{pct}%</span>
                      </DropdownMenuItem>
                    );
                  })}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="space-y-2 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
        <SmartSearch
          tasks={tasksWithDuration}
          chips={searchChips}
          onChipsChange={setSearchChips}
          placeholder="Filter by name, status:, ip:, duration:, and more..."
        />
        {searchChips.length > 0 && (
          <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
            <span>Showing {filteredTasks.length} of {stats.total} tasks</span>
            <button onClick={handleClearFilters} className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300">
              Clear filters
            </button>
          </div>
        )}
      </div>

      {/* Task List */}
      <VirtualizedTaskList
        tasks={filteredTasks}
        columns={visibleColumns}
        selectedTaskName={selectedTaskName}
        onSelectTask={handleSelectTask}
        sort={sort}
        onSort={handleSort}
        optionalColumnIds={visibleOptionalIds as ColumnId[]}
        onReorderColumns={reorderColumns}
      />
    </div>
  );
});
