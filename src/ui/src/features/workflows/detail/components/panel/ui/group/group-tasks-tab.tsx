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
import { DataTable } from "@/components/data-table/data-table";
import { TableToolbar } from "@/components/data-table/table-toolbar";
import { useColumnVisibility } from "@/components/data-table/hooks/use-column-visibility";
import type { SortState } from "@/components/data-table/types";
import { useCompactMode } from "@/hooks/shared-preferences-hooks";
import { createTaskSortComparator } from "@/features/workflows/detail/lib/status";
import type { TaskWithDuration, GroupWithLayout } from "@/features/workflows/detail/lib/workflow-types";
import type { TaskQueryResponse } from "@/features/workflows/detail/lib/workflow-types";
import {
  OPTIONAL_COLUMNS_ALPHABETICAL,
  MANDATORY_COLUMN_IDS,
  TASK_COLUMN_SIZE_CONFIG,
  asTaskColumnIds,
} from "@/features/workflows/detail/components/panel/core/lib/task-columns";
import { createTaskColumns } from "@/features/workflows/detail/components/panel/core/lib/task-column-defs";
import { filterByChips } from "@/components/filter-bar/lib/filter";
import type { SearchChip } from "@/components/filter-bar/lib/types";
import { TASK_SEARCH_FIELDS } from "@/features/workflows/detail/components/panel/core/lib/task-search-fields";
import { TASK_GROUP_STATUS_PRESETS } from "@/lib/task-group-status-presets";
import { useTaskTableStore } from "@/features/workflows/detail/components/panel/core/stores/task-table-store";
import { TABLE_ROW_HEIGHTS } from "@/lib/config";
import { useResultsCount } from "@/components/filter-bar/hooks/use-results-count";
import {
  useIsSuspended,
  usePanelResizeMachine,
} from "@/features/workflows/detail/components/panel/core/context/panel-resize-context";
import { TaskNameCell } from "@/features/workflows/detail/components/panel/ui/table/tree/task-name-cell";

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

  // Panel resize coordination (suspend during transitions, recalculate on layout stable)
  const isSuspended = useIsSuspended();
  const machine = usePanelResizeMachine();
  const registerLayoutStableCallback = useCallback(
    (callback: () => void) => machine.registerCallback("onLayoutStable", callback),
    [machine],
  );

  // Shared preferences (hydration-safe - used for row height calculation)
  const compactMode = useCompactMode();

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
  // Note: Remove custom header padding from name column (it's only needed for tree layout)
  const columns = useMemo(() => {
    const cols = createTaskColumns({
      renderTaskNameCell: (props) => <TaskNameCell {...props} />,
    });
    // Return immutable-mapped columns, removing headerClassName from name column
    return cols.map((col) =>
      col.id === "name" && col.meta?.headerClassName !== undefined
        ? { ...col, meta: { ...col.meta, headerClassName: undefined } }
        : col,
    );
  }, []);

  // Fixed columns (not draggable)
  const fixedColumns = useMemo(() => Array.from(MANDATORY_COLUMN_IDS), []);

  // Column visibility map for TanStack
  const columnVisibility = useColumnVisibility(columnOrder, visibleColumnIds);

  // Sort comparator (shared with WorkflowTasksTable via createTaskSortComparator)
  const sortComparator = useMemo(
    () => createTaskSortComparator<TaskWithDuration>(sort?.column, sort?.direction),
    [sort],
  );

  // Filter and sort tasks
  const filteredTasks = useMemo(() => {
    let result = filterByChips(tasksWithDuration, searchChips, TASK_SEARCH_FIELDS);
    if (sortComparator) {
      result = [...result].sort(sortComparator);
    }
    return result;
  }, [tasksWithDuration, searchChips, sortComparator]);

  // Results count for FilterBar display
  const resultsCount = useResultsCount({
    total: totalTasks,
    filteredTotal: filteredTasks.length,
    hasActiveFilters: searchChips.length > 0,
  });

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

  return (
    <div className="flex h-full flex-col overflow-hidden">
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
          defaultField="name"
          placeholder="Filter by name, status:, ip:, duration:..."
          searchPresets={TASK_GROUP_STATUS_PRESETS}
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
        onColumnOrderChange={setColumnOrder}
        columnVisibility={columnVisibility}
        fixedColumns={fixedColumns}
        // Column sizing
        columnSizeConfigs={TASK_COLUMN_SIZE_CONFIG}
        suspendResize={isSuspended}
        registerLayoutStableCallback={registerLayoutStableCallback}
        // Sorting
        sorting={sort ?? undefined}
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
