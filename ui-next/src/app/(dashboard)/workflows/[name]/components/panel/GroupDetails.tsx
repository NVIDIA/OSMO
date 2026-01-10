// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * GroupDetails Component
 *
 * Content component for displaying group details within DetailsPanel.
 * Features:
 * - Smart search with chip-based filters
 * - Canonical DataTable with virtualization
 * - Sortable and reorderable columns
 * - Compact/comfortable toggle (shared preference)
 * - Column visibility controls (persisted via Zustand store)
 */

"use client";

import { useState, useMemo, useCallback, memo } from "react";
import { Check, Loader2, AlertCircle, Clock, Rows3, Rows4, Columns } from "lucide-react";
import { cn } from "@/lib/utils";
import { DataTable, type SortState } from "@/components/data-table";
import { useSharedPreferences } from "@/stores";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/shadcn/dropdown-menu";
import { Toggle } from "@/components/shadcn/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import { STATUS_SORT_ORDER } from "../../lib/status";
import { calculateDuration, formatDuration } from "../../lib/workflow-types";
import { computeTaskStats, computeGroupStatus, computeGroupDuration } from "../../lib/status";
import type { GroupDetailsProps } from "../../lib/panel-types";
import type { TaskWithDuration } from "../../lib/workflow-types";
import {
  OPTIONAL_COLUMNS_ALPHABETICAL,
  MANDATORY_COLUMN_IDS,
  TASK_COLUMN_SIZE_CONFIG,
  asTaskColumnIds,
  type TaskColumnId,
} from "../../lib/task-columns";
import { createTaskColumns } from "../../lib/task-column-defs";
import { SmartSearch, filterByChips, type SearchChip } from "@/components/smart-search";
import { TASK_SEARCH_FIELDS, createTaskPresets } from "../../lib/task-search-fields";
import { useTaskTableStore } from "../../stores";
import { DetailsPanelHeader, ColumnMenuContent } from "./DetailsPanelHeader";
import { GroupTimeline } from "./GroupTimeline";
import { DependencyPills } from "./DependencyPills";
import { TABLE_ROW_HEIGHTS } from "@/lib/config";

// =============================================================================
// Constants
// =============================================================================

/** Stable row ID extractor */
const getRowId = (task: TaskWithDuration) => task.name;

// =============================================================================
// Component
// =============================================================================

interface GroupDetailsInternalProps extends GroupDetailsProps {
  onClose: () => void;
  /** Navigate back to workflow details */
  onBack?: () => void;
  onPanelResize: (pct: number) => void;
  isDetailsExpanded: boolean;
  onToggleDetailsExpanded: () => void;
}

export const GroupDetails = memo(function GroupDetails({
  group,
  allGroups,
  onSelectTask,
  onSelectGroup,
  onClose,
  onBack,
  onPanelResize,
  isDetailsExpanded,
  onToggleDetailsExpanded,
}: GroupDetailsInternalProps) {
  const [searchChips, setSearchChips] = useState<SearchChip[]>([]);
  const [selectedTaskName, setSelectedTaskName] = useState<string | null>(null);

  // Shared preferences (compact mode)
  const compactMode = useSharedPreferences((s) => s.compactMode);
  const toggleCompactMode = useSharedPreferences((s) => s.toggleCompactMode);

  // Task table store (column visibility, order, sort - persisted via Zustand)
  const visibleColumnIds = asTaskColumnIds(useTaskTableStore((s) => s.visibleColumnIds));
  const columnOrder = asTaskColumnIds(useTaskTableStore((s) => s.columnOrder));
  const setColumnOrder = useTaskTableStore((s) => s.setColumnOrder);
  const toggleColumn = useTaskTableStore((s) => s.toggleColumn);
  const sort = useTaskTableStore((s) => s.sort);
  const setSort = useTaskTableStore((s) => s.setSort);

  // Row height based on compact mode
  const rowHeight = compactMode ? TABLE_ROW_HEIGHTS.COMPACT : TABLE_ROW_HEIGHTS.NORMAL;

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

  // TanStack column definitions
  const columns = useMemo(() => createTaskColumns(), []);

  // Fixed columns (not draggable)
  const fixedColumns = useMemo(() => Array.from(MANDATORY_COLUMN_IDS), []);

  // Column visibility map for TanStack
  const columnVisibility = useMemo(() => {
    const visibility: Record<string, boolean> = {};
    columnOrder.forEach((id) => {
      visibility[id] = false;
    });
    visibleColumnIds.forEach((id) => {
      visibility[id] = true;
    });
    return visibility;
  }, [columnOrder, visibleColumnIds]);

  // Sort comparator for client-side sorting
  // Uses the entire sort object as dependency to satisfy React Compiler optimization
  const sortComparator = useMemo(() => {
    const column = sort?.column;
    const direction = sort?.direction;
    if (!column) return null;
    const dir = direction === "asc" ? 1 : -1;

    switch (column) {
      case "status":
        return (a: TaskWithDuration, b: TaskWithDuration) =>
          ((STATUS_SORT_ORDER[a.status] ?? 99) - (STATUS_SORT_ORDER[b.status] ?? 99)) * dir;
      case "name":
        return (a: TaskWithDuration, b: TaskWithDuration) => a.name.localeCompare(b.name) * dir;
      case "duration":
        return (a: TaskWithDuration, b: TaskWithDuration) => ((a.duration ?? 0) - (b.duration ?? 0)) * dir;
      case "node":
        return (a: TaskWithDuration, b: TaskWithDuration) => (a.node_name ?? "").localeCompare(b.node_name ?? "") * dir;
      case "podIp":
        return (a: TaskWithDuration, b: TaskWithDuration) => (a.pod_ip ?? "").localeCompare(b.pod_ip ?? "") * dir;
      case "exitCode":
        return (a: TaskWithDuration, b: TaskWithDuration) => ((a.exit_code ?? -1) - (b.exit_code ?? -1)) * dir;
      case "startTime":
        return (a: TaskWithDuration, b: TaskWithDuration) => {
          const aTime = a.start_time ? new Date(a.start_time).getTime() : 0;
          const bTime = b.start_time ? new Date(b.start_time).getTime() : 0;
          return (aTime - bTime) * dir;
        };
      case "endTime":
        return (a: TaskWithDuration, b: TaskWithDuration) => {
          const aTime = a.end_time ? new Date(a.end_time).getTime() : 0;
          const bTime = b.end_time ? new Date(b.end_time).getTime() : 0;
          return (aTime - bTime) * dir;
        };
      case "retry":
        return (a: TaskWithDuration, b: TaskWithDuration) => (a.retry_id - b.retry_id) * dir;
      default:
        return null;
    }
  }, [sort]);

  // Filter and sort tasks
  const filteredTasks = useMemo(() => {
    let result = filterByChips(tasksWithDuration, searchChips, TASK_SEARCH_FIELDS);
    if (sortComparator) {
      result = [...result].sort(sortComparator);
    }
    return result;
  }, [tasksWithDuration, searchChips, sortComparator]);

  // Create presets for state filtering
  const taskPresets = useMemo(() => createTaskPresets(tasksWithDuration), [tasksWithDuration]);

  // Callbacks
  const handleColumnOrderChange = useCallback(
    (newOrder: string[]) => {
      setColumnOrder(newOrder);
    },
    [setColumnOrder],
  );

  const handleSortChange = useCallback(
    (newSort: SortState<string>) => {
      if (newSort.column) {
        setSort(newSort.column);
      }
    },
    [setSort],
  );

  const handleRowClick = useCallback(
    (task: TaskWithDuration) => {
      setSelectedTaskName(task.name);
      onSelectTask(task, group);
    },
    [group, onSelectTask],
  );

  const handleClearFilters = useCallback(() => {
    setSearchChips([]);
  }, []);

  // Handle dependency pill click
  const handleSelectGroupByName = useCallback(
    (groupName: string) => {
      if (onSelectGroup) {
        const targetGroup = allGroups.find((g) => g.name === groupName);
        if (targetGroup) {
          onSelectGroup(targetGroup);
        }
      }
    },
    [allGroups, onSelectGroup],
  );

  // Status content for header (Row 2) - clean, no error message here
  const statusContent = (
    <div className="flex items-center gap-1.5 text-xs">
      <span
        className={cn(
          "flex items-center gap-1.5",
          groupStatus.status === "completed" && "text-emerald-400",
          groupStatus.status === "running" && "text-blue-400",
          groupStatus.status === "failed" && "text-red-600 dark:text-red-400",
          groupStatus.status === "pending" && "text-gray-500 dark:text-zinc-400",
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
          <span className="text-gray-400 dark:text-zinc-600">·</span>
          <span className="text-gray-500 dark:text-zinc-400">{formatDuration(groupDuration)}</span>
        </>
      )}
    </div>
  );

  // Menu content (columns submenu in header dropdown)
  const menuContent = (
    <ColumnMenuContent
      columns={OPTIONAL_COLUMNS_ALPHABETICAL}
      visibleColumnIds={visibleColumnIds}
      onToggleColumn={toggleColumn}
    />
  );

  // Compute upstream/downstream groups for dependencies
  const upstreamGroups = allGroups.filter((g) => g.downstream_groups?.includes(group.name));
  const downstreamGroups = allGroups.filter((g) => group.downstream_groups?.includes(g.name));

  // Check if we have any expandable content
  const hasFailureMessage = !!group.failure_message;
  const hasTimeline = group.scheduling_start_time || group.start_time;
  const hasDependencies = upstreamGroups.length > 0 || downstreamGroups.length > 0;
  const hasExpandableContent = hasFailureMessage || hasTimeline || hasDependencies;

  // Expandable content for header (failure message first, then timeline, then dependencies)
  const expandableContent = hasExpandableContent ? (
    <div className="space-y-3">
      {/* Failure message - first item when present */}
      {hasFailureMessage && (
        <div className="flex items-start gap-1.5 text-xs text-red-400">
          <AlertCircle className="mt-0.5 size-3 shrink-0" />
          <span>{group.failure_message}</span>
        </div>
      )}
      {hasTimeline && <GroupTimeline group={group} />}
      {hasDependencies && (
        <DependencyPills
          upstreamGroups={upstreamGroups}
          downstreamGroups={downstreamGroups}
          onSelectGroup={handleSelectGroupByName}
        />
      )}
    </div>
  ) : undefined;

  // Empty content for table
  const emptyContent = useMemo(
    () => (
      <div className="flex h-32 items-center justify-center text-sm text-gray-500 dark:text-zinc-400">
        No tasks match your filters
      </div>
    ),
    [],
  );

  // Convert store sort to DataTable format
  const tableSorting = useMemo<SortState<string> | undefined>(() => {
    if (!sort) return undefined;
    return { column: sort.column, direction: sort.direction };
  }, [sort]);

  return (
    <div className="relative flex h-full flex-col">
      {/* Header with expandable details */}
      <DetailsPanelHeader
        viewType="group"
        title={group.name}
        subtitle={`${stats.total} tasks`}
        statusContent={statusContent}
        breadcrumb={onBack ? "Workflow" : undefined}
        onBack={onBack}
        onClose={onClose}
        onPanelResize={onPanelResize}
        menuContent={menuContent}
        expandableContent={expandableContent}
        isExpanded={isDetailsExpanded}
        onToggleExpand={onToggleDetailsExpanded}
      />

      {/* Toolbar: Search + Controls */}
      <div className="space-y-2 border-b border-gray-200 px-4 py-3 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="min-w-0 flex-1">
            <SmartSearch
              data={tasksWithDuration}
              fields={TASK_SEARCH_FIELDS}
              chips={searchChips}
              onChipsChange={setSearchChips}
              presets={taskPresets}
              placeholder="Filter by name, status:, ip:, duration:..."
            />
          </div>

          {/* Table controls */}
          <div className="flex shrink-0 items-center gap-1">
            {/* Compact/Comfortable Toggle */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Toggle
                  size="sm"
                  pressed={compactMode}
                  onPressedChange={toggleCompactMode}
                  aria-label={compactMode ? "Comfortable view" : "Compact view"}
                >
                  {compactMode ? <Rows4 className="size-4" /> : <Rows3 className="size-4" />}
                </Toggle>
              </TooltipTrigger>
              <TooltipContent>{compactMode ? "Comfortable view" : "Compact view"}</TooltipContent>
            </Tooltip>

            {/* Column Visibility Dropdown */}
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Toggle
                      size="sm"
                      aria-label="Toggle columns"
                    >
                      <Columns className="size-4" />
                    </Toggle>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>Toggle columns</TooltipContent>
              </Tooltip>
              <DropdownMenuContent
                align="end"
                className="w-40"
              >
                <DropdownMenuLabel>Columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {OPTIONAL_COLUMNS_ALPHABETICAL.map((column) => (
                  <DropdownMenuCheckboxItem
                    key={column.id}
                    checked={visibleColumnIds.includes(column.id as TaskColumnId)}
                    onCheckedChange={() => toggleColumn(column.id)}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {column.menuLabel ?? column.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Filter summary */}
        {searchChips.length > 0 && (
          <div className="flex items-center justify-between text-xs text-gray-500 dark:text-zinc-400">
            <span>
              Showing {filteredTasks.length} of {stats.total} tasks
            </span>
            <button
              onClick={handleClearFilters}
              className="text-blue-400 hover:text-blue-300"
            >
              Clear filters
            </button>
          </div>
        )}
      </div>

      {/* Task List - using canonical DataTable */}
      <DataTable<TaskWithDuration>
        data={filteredTasks}
        columns={columns}
        getRowId={getRowId}
        // Column management
        columnOrder={columnOrder}
        onColumnOrderChange={handleColumnOrderChange}
        columnVisibility={columnVisibility}
        fixedColumns={fixedColumns}
        // Column sizing
        columnSizeConfigs={TASK_COLUMN_SIZE_CONFIG}
        // Sorting
        sorting={tableSorting}
        onSortingChange={handleSortChange}
        // Layout
        rowHeight={rowHeight}
        compact={compactMode}
        className="text-sm"
        scrollClassName="flex-1"
        // State
        emptyContent={emptyContent}
        // Interaction
        onRowClick={handleRowClick}
        selectedRowId={selectedTaskName ?? undefined}
      />
    </div>
  );
});
