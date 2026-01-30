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
 * GroupTasksTab Component
 *
 * Tasks tab content for GroupDetails panel.
 * Displays filterable, sortable task list with virtualization.
 */

"use client";

import { useState, useMemo, useCallback, memo } from "react";
import { naturalCompare } from "@/lib/utils";
import { DataTable, TableToolbar, type SortState } from "@/components/data-table";
import { useSharedPreferences } from "@/stores";
import { STATUS_SORT_ORDER } from "../../../lib/status";
import type { TaskWithDuration, GroupWithLayout } from "../../../lib/workflow-types";
import type { TaskQueryResponse } from "../../../lib/workflow-types";
import {
  OPTIONAL_COLUMNS_ALPHABETICAL,
  MANDATORY_COLUMN_IDS,
  TASK_COLUMN_SIZE_CONFIG,
  asTaskColumnIds,
} from "../../../lib/task-columns";
import { createTaskColumns } from "../../../lib/task-column-defs";
import { filterByChips, type SearchChip } from "@/components/filter-bar";
import { TASK_SEARCH_FIELDS, TASK_PRESETS } from "../../../lib/task-search-fields";
import { useTaskTableStore } from "../../../stores";
import { TABLE_ROW_HEIGHTS } from "@/lib/config";
import { useResultsCount } from "@/hooks";

// =============================================================================
// Constants
// =============================================================================

/** Stable row ID extractor */
const getRowId = (task: TaskWithDuration) => task.name;

// =============================================================================
// Component
// =============================================================================

export interface GroupTasksTabProps {
  /** Tasks with computed duration */
  tasksWithDuration: TaskWithDuration[];
  /** The group containing the tasks */
  group: GroupWithLayout;
  /** Total task count (for results display) */
  totalTasks: number;
  /** Callback when selecting a task */
  onSelectTask: (task: TaskQueryResponse, group: GroupWithLayout) => void;
  /** Currently selected task name */
  selectedTaskName: string | null;
  /** Callback when task selection changes */
  onSelectedTaskNameChange: (name: string | null) => void;
}

export const GroupTasksTab = memo(function GroupTasksTab({
  tasksWithDuration,
  group,
  totalTasks,
  onSelectTask,
  selectedTaskName,
  onSelectedTaskNameChange,
}: GroupTasksTabProps) {
  const [searchChips, setSearchChips] = useState<SearchChip[]>([]);

  // Shared preferences (compact mode - used for row height calculation)
  const compactMode = useSharedPreferences((s) => s.compactMode);

  // Task table store (column visibility, order, sort - persisted via Zustand)
  const visibleColumnIds = asTaskColumnIds(useTaskTableStore((s) => s.visibleColumnIds));
  const columnOrder = asTaskColumnIds(useTaskTableStore((s) => s.columnOrder));
  const setColumnOrder = useTaskTableStore((s) => s.setColumnOrder);
  const toggleColumn = useTaskTableStore((s) => s.toggleColumn);
  const sort = useTaskTableStore((s) => s.sort);
  const setSort = useTaskTableStore((s) => s.setSort);

  // Row height based on compact mode
  const rowHeight = compactMode ? TABLE_ROW_HEIGHTS.COMPACT : TABLE_ROW_HEIGHTS.NORMAL;

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
        return (a: TaskWithDuration, b: TaskWithDuration) => naturalCompare(a.name, b.name) * dir;
      case "duration":
        return (a: TaskWithDuration, b: TaskWithDuration) => ((a.duration ?? 0) - (b.duration ?? 0)) * dir;
      case "node":
        return (a: TaskWithDuration, b: TaskWithDuration) => naturalCompare(a.node_name ?? "", b.node_name ?? "") * dir;
      case "podIp":
        return (a: TaskWithDuration, b: TaskWithDuration) => naturalCompare(a.pod_ip ?? "", b.pod_ip ?? "") * dir;
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

  // Static presets for state filtering
  const taskPresets = TASK_PRESETS;

  // Results count for FilterBar display
  const resultsCount = useResultsCount({
    total: totalTasks,
    filteredTotal: filteredTasks.length,
    hasActiveFilters: searchChips.length > 0,
  });

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
      onSelectedTaskNameChange(task.name);
      onSelectTask(task, group);
    },
    [group, onSelectTask, onSelectedTaskNameChange],
  );

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
    <div className="flex h-full flex-col">
      {/* Toolbar: Search + Controls */}
      <div className="border-b border-gray-200 px-4 py-3 dark:border-zinc-800">
        <TableToolbar
          data={tasksWithDuration}
          searchFields={TASK_SEARCH_FIELDS}
          columns={OPTIONAL_COLUMNS_ALPHABETICAL}
          visibleColumnIds={visibleColumnIds}
          onToggleColumn={toggleColumn}
          searchChips={searchChips}
          onSearchChipsChange={setSearchChips}
          placeholder="Filter by name, status:, ip:, duration:..."
          searchPresets={taskPresets}
          resultsCount={resultsCount}
        />
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
