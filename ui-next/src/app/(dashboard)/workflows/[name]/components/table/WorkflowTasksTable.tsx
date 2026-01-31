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
 * WorkflowTasksTable Component
 *
 * A grouped table view that displays workflow tasks organized by groups.
 * Each group is a collapsible section with:
 * - Group header showing name, progress bar, and summary stats
 * - Task rows using the canonical task column definitions
 *
 * Uses the DataTable component with sections support for virtualization
 * and efficient rendering of large workflows.
 */

"use client";

import { useMemo, useCallback, useState, memo } from "react";
import { naturalCompare } from "@/lib/utils";
import { DataTable, type Section, type SortState, getColumnCSSValue, TableToolbar } from "@/components/data-table";
import { useSharedPreferences } from "@/stores";
import { TABLE_ROW_HEIGHTS } from "@/lib/config";
import { useTick, useResultsCount } from "@/hooks";
import type { CellContext, ColumnDef } from "@tanstack/react-table";

import { calculateTaskDuration } from "../../lib/workflow-types";
import { TaskGroupStatus } from "@/lib/api/generated";
import { computeTaskStats, STATUS_SORT_ORDER } from "../../lib/status";
import { createTaskColumns } from "../../lib/task-column-defs";
import {
  TASK_WITH_TREE_COLUMN_SIZE_CONFIG,
  MANDATORY_COLUMN_IDS,
  OPTIONAL_COLUMNS_ALPHABETICAL,
  asTaskColumnIds,
} from "../../lib/task-columns";
import { useTaskTableStore } from "../../stores";
import { TreeConnector, TreeGroupCell, GroupNameCell } from "./tree";
import { filterByChips, type SearchChip } from "@/components/filter-bar";
import { TASK_SEARCH_FIELDS, TASK_PRESETS } from "../../lib/task-search-fields";

import type { GroupWithLayout, TaskQueryResponse, TaskWithDuration } from "../../lib/workflow-types";

// =============================================================================
// Types
// =============================================================================

export interface WorkflowTasksTableProps {
  /** Groups with computed layout information */
  groups: GroupWithLayout[];
  /** Callback when a group is selected */
  onSelectGroup: (group: GroupWithLayout) => void;
  /** Callback when a task is selected */
  onSelectTask: (task: TaskQueryResponse, group: GroupWithLayout) => void;
  /** Currently selected group name (for highlighting) */
  selectedGroupName?: string;
  /** Currently selected task name (for highlighting) */
  selectedTaskName?: string;
}

/**
 * Metadata attached to each section for rendering the group header.
 */
interface GroupSectionMeta {
  group: GroupWithLayout;
  stats: ReturnType<typeof computeTaskStats>;
  /** TOTAL task count (unfiltered - for badge display) */
  taskCount: number;
  /** Whether original group has exactly one task */
  isSingleTask: boolean;
  /** Whether to skip rendering the group row (for single-task groups with visible task) */
  skipGroupRow?: boolean;
  /** Whether the group has any visible tasks after filtering */
  hasVisibleTasks: boolean;
  /** Visual row index for zebra striping (consistent across group and task rows) */
  _visualRowIndex?: number;
}

// =============================================================================
// Helpers
// =============================================================================

/** Generate unique task ID (group + task name + retry) */
function getTaskId(task: TaskWithDuration, groupName: string): string {
  return `${groupName}:${task.name}:${task.retry_id}`;
}

// =============================================================================
// Component
// =============================================================================

export const WorkflowTasksTable = memo(function WorkflowTasksTable({
  groups,
  onSelectGroup,
  onSelectTask,
  selectedGroupName,
  selectedTaskName,
}: WorkflowTasksTableProps) {
  // Track which groups are expanded (all expanded by default)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  // Search chips for filtering
  const [searchChips, setSearchChips] = useState<SearchChip[]>([]);

  // Shared preferences (compact mode)
  const compactMode = useSharedPreferences((s) => s.compactMode);

  // Task table store (column visibility, order, sort)
  const visibleColumnIds = asTaskColumnIds(useTaskTableStore((s) => s.visibleColumnIds));
  const columnOrder = asTaskColumnIds(useTaskTableStore((s) => s.columnOrder));
  const setColumnOrder = useTaskTableStore((s) => s.setColumnOrder);
  const toggleColumn = useTaskTableStore((s) => s.toggleColumn);
  const sort = useTaskTableStore((s) => s.sort);
  const setSort = useTaskTableStore((s) => s.setSort);

  // Row height based on compact mode (also used for section headers)
  const rowHeight = compactMode ? TABLE_ROW_HEIGHTS.COMPACT : TABLE_ROW_HEIGHTS.NORMAL;

  // Synchronized tick for live durations
  const now = useTick();

  // Map of group name to group for quick lookup
  const groupMap = useMemo(() => {
    const map = new Map<string, GroupWithLayout>();
    for (const group of groups) {
      map.set(group.name, group);
    }
    return map;
  }, [groups]);

  // Sort comparator (same as GroupDetails)
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

  // Calculate total task count
  const totalTasks = useMemo(() => {
    return groups.reduce((sum, group) => sum + (group.tasks?.length ?? 0), 0);
  }, [groups]);

  // Flatten all tasks for TableToolbar (needed for data prop)
  const allTasksWithDuration = useMemo(() => {
    const tasks: TaskWithDuration[] = [];
    for (const group of groups) {
      for (const task of group.tasks || []) {
        tasks.push({
          ...task,
          duration: calculateTaskDuration(task.start_time, task.end_time, task.status as TaskGroupStatus, now),
        });
      }
    }
    return tasks;
  }, [groups, now]);

  // Transform groups into sections with computed metadata
  // Critical flow: Raw tasks → Filter → Sort → Calculate position (_isLastTask) → Render
  const { sections, filteredTaskCount } = useMemo((): {
    sections: Section<TaskWithDuration, GroupSectionMeta>[];
    filteredTaskCount: number;
  } => {
    let totalFiltered = 0;
    const builtSections = groups.map((group) => {
      const taskArray = group.tasks || [];
      const totalTaskCount = taskArray.length;
      const isSingleTaskOriginal = totalTaskCount === 1;

      // Build tasks with duration (status-aware calculation)
      const buildTaskWithDuration = (task: (typeof taskArray)[0]): TaskWithDuration => ({
        ...task,
        duration: calculateTaskDuration(task.start_time, task.end_time, task.status as TaskGroupStatus, now),
        _groupName: group.name,
      });

      // ==== SINGLE-TASK GROUP ====
      if (isSingleTaskOriginal) {
        const singleTask = taskArray[0];
        const taskWithDuration = buildTaskWithDuration(singleTask);

        // Apply search filter
        const filteredArray = filterByChips([taskWithDuration], searchChips, TASK_SEARCH_FIELDS);
        const matchesFilter = filteredArray.length > 0;

        if (!matchesFilter) {
          // Task filtered out: skip entire group (don't show group header)
          return null;
        }

        // Task visible: skip group row, render task with single-task styling
        const visibleTask: TaskWithDuration = {
          ...taskWithDuration,
          _isSingleTaskGroup: true,
          _isLastTask: true, // Only task, so it's last
          _taskIndex: 0,
        };

        totalFiltered += 1; // Count this task

        return {
          id: group.name,
          label: group.name,
          items: [visibleTask],
          metadata: {
            group,
            stats: computeTaskStats([visibleTask]),
            taskCount: totalTaskCount,
            isSingleTask: true,
            skipGroupRow: true, // Skip group row for visible single task
            hasVisibleTasks: true,
          },
        };
      }

      // ==== MULTI-TASK GROUP ====
      const isExpanded = !collapsedGroups.has(group.name);

      if (!isExpanded) {
        // Collapsed: check if ANY task matches the filter
        const allTasksWithDuration = taskArray.map(buildTaskWithDuration);
        const matchingTasks = filterByChips(allTasksWithDuration, searchChips, TASK_SEARCH_FIELDS);

        if (matchingTasks.length === 0) {
          // No matching tasks: skip entire group (don't show group header)
          return null;
        }

        // Show group row with no tasks visible (but we know some match the filter)
        return {
          id: group.name,
          label: group.name,
          items: [],
          metadata: {
            group,
            stats: computeTaskStats(allTasksWithDuration),
            taskCount: totalTaskCount,
            isSingleTask: false,
            skipGroupRow: false,
            hasVisibleTasks: false, // No visible tasks when collapsed
          },
        };
      }

      // Expanded: build all tasks with duration
      const tasksWithDuration = taskArray.map(buildTaskWithDuration);

      // Step 1: Apply search filtering
      const filteredTasks = filterByChips(tasksWithDuration, searchChips, TASK_SEARCH_FIELDS);

      if (filteredTasks.length === 0) {
        // No matching tasks: skip entire group (don't show group header)
        return null;
      }

      // Step 2: Apply sorting to filtered tasks
      const sortedTasks = sortComparator ? [...filteredTasks].sort(sortComparator) : filteredTasks;

      // Step 3: Calculate position on FINAL visible list
      const visibleTasks: TaskWithDuration[] = sortedTasks.map((task, index) => ({
        ...task,
        _isLastTask: index === sortedTasks.length - 1,
        _taskIndex: index,
        _isSingleTaskGroup: false,
      }));

      // Count filtered tasks
      totalFiltered += visibleTasks.length;

      // Compute stats on visible tasks (for accurate progress display)
      const stats = computeTaskStats(visibleTasks);

      return {
        id: group.name,
        label: group.name,
        items: visibleTasks,
        metadata: {
          group,
          stats,
          taskCount: totalTaskCount, // Original count for badge
          isSingleTask: false,
          skipGroupRow: false,
          hasVisibleTasks: visibleTasks.length > 0,
        },
      };
    });

    // Filter out null sections (groups with no matching tasks)
    const nonNullSections = builtSections.filter((section): section is NonNullable<typeof section> => section !== null);

    // Second pass: Calculate visual row index for zebra striping
    // Count visible rows (section headers that aren't skipped + all task rows)
    let visualRowIndex = 0;
    const finalSections = nonNullSections.map((section) => {
      const skipHeader = section.metadata?.skipGroupRow === true;

      // Capture visual row index for section header (before incrementing)
      const sectionVisualRowIndex = skipHeader ? undefined : visualRowIndex;

      // Increment for section header (if not skipped)
      if (!skipHeader) {
        visualRowIndex++;
      }

      // Add visual row index to each task and increment counter
      const itemsWithVisualIndex = section.items.map((task) => ({
        ...task,
        _visualRowIndex: visualRowIndex++,
      }));

      return {
        ...section,
        items: itemsWithVisualIndex,
        // Store section's visual row index in metadata for zebra striping
        metadata: section.metadata ? { ...section.metadata, _visualRowIndex: sectionVisualRowIndex } : section.metadata,
      };
    });

    return { sections: finalSections, filteredTaskCount: totalFiltered };
  }, [groups, collapsedGroups, sortComparator, searchChips, now]);

  // Results count for FilterBar display
  const resultsCount = useResultsCount({
    total: totalTasks,
    filteredTotal: filteredTaskCount,
    hasActiveFilters: searchChips.length > 0,
  });

  // TanStack column definitions (tree column + task columns)
  const columns = useMemo(() => {
    const baseColumns = createTaskColumns();

    // Create a dedicated tree column as the first column
    const treeColumn: ColumnDef<TaskWithDuration> = {
      id: "_tree",
      header: "", // Empty header - no text
      enableResizing: false, // Prevent manual resize + auto-sizing
      enableSorting: false,
      meta: {
        // No padding - tree components handle their own spacing.
        // This uses dependency injection via TanStack Table's meta property
        // so VirtualTableBody doesn't need hardcoded knowledge of tree columns.
        cellClassName: "p-0",
      },
      cell: (props: CellContext<TaskWithDuration, unknown>) => {
        const task = props.row.original;

        return (
          <TreeConnector
            isLast={task._isLastTask ?? false}
            isSingleTaskGroup={task._isSingleTaskGroup ?? false}
          />
        );
      },
    };

    // Return tree column + all base columns
    return [treeColumn, ...baseColumns];
  }, []);

  // Fixed columns (not draggable) - tree column must be first
  const fixedColumns = useMemo(() => ["_tree", ...Array.from(MANDATORY_COLUMN_IDS)], []);

  // Ensure tree column is always first in the order
  const tableColumnOrder = useMemo(() => ["_tree", ...columnOrder], [columnOrder]);

  // Column visibility map for TanStack
  const columnVisibility = useMemo(() => {
    const visibility: Record<string, boolean> = {
      _tree: true, // Tree column is always visible
    };
    columnOrder.forEach((id) => {
      visibility[id] = false;
    });
    visibleColumnIds.forEach((id) => {
      visibility[id] = true;
    });
    return visibility;
  }, [columnOrder, visibleColumnIds]);

  // Get row ID - includes group name for uniqueness
  const getRowId = useCallback((task: TaskWithDuration) => {
    // Access the stored group name from task augmentation
    const groupName = (task as TaskWithDuration & { _groupName?: string })._groupName ?? "";
    return getTaskId(task, groupName);
  }, []);

  // Toggle group expansion
  const handleToggleGroup = useCallback((groupName: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupName)) {
        next.delete(groupName);
      } else {
        next.add(groupName);
      }
      return next;
    });
  }, []);

  // Render section header (as table cells)
  const renderSectionHeader = useCallback(
    (section: Section<TaskWithDuration, GroupSectionMeta>) => {
      const { group, stats, skipGroupRow, taskCount, hasVisibleTasks, _visualRowIndex } = section.metadata || {};
      if (!group) return null;

      // Skip group row for single-task groups where the task is visible
      if (skipGroupRow) return null;

      const isExpanded = !collapsedGroups.has(section.id);
      const displayTaskCount = taskCount ?? stats?.total ?? 0;

      // Get column IDs for width styling
      const columnIds = columns.map((col) => {
        if (typeof col.id === "string") return col.id;
        if ("accessorKey" in col && col.accessorKey) return String(col.accessorKey);
        return "";
      });

      return (
        <>
          {/* Tree column cell - TreeGroupCell handles expand/collapse
              No padding - cell content is centered within the 2rem column */}
          <td
            role="gridcell"
            className="flex items-center p-0"
            style={{
              width: getColumnCSSValue("_tree"),
              minWidth: getColumnCSSValue("_tree"),
              flex: "none",
            }}
          >
            <TreeGroupCell
              isExpanded={isExpanded}
              hasVisibleTasks={hasVisibleTasks ?? false}
              onToggle={() => handleToggleGroup(section.id)}
            />
          </td>

          {/* Name column cell - GroupNameCell with badge and count
              Uses px-4 to match regular row cells from VirtualTableBody */}
          <td
            role="gridcell"
            className="flex items-center px-4"
            style={{
              width: getColumnCSSValue(columnIds[1] || "name"),
              minWidth: getColumnCSSValue(columnIds[1] || "name"),
              flex: "none",
            }}
            onClick={() => onSelectGroup(group)}
          >
            <GroupNameCell
              name={group.name}
              taskCount={displayTaskCount}
            />
          </td>

          {/* Remaining columns - empty cells to maintain structure */}
          {columnIds.slice(2).map((colId, i) => (
            <td
              key={colId || i}
              role="gridcell"
              className="px-4"
              style={{
                width: getColumnCSSValue(colId),
                minWidth: getColumnCSSValue(colId),
                flex: "none",
              }}
              onClick={() => onSelectGroup(group)}
            />
          ))}
        </>
      );
    },
    [collapsedGroups, handleToggleGroup, columns, onSelectGroup],
  );

  // Handle row click
  const handleRowClick = useCallback(
    (task: TaskWithDuration) => {
      const groupName = (task as TaskWithDuration & { _groupName?: string })._groupName;
      const group = groupName ? groupMap.get(groupName) : undefined;
      if (group) {
        onSelectTask(task, group);
      }
    },
    [groupMap, onSelectTask],
  );

  // Handle column order change (filter out tree column before saving to store)
  const handleColumnOrderChange = useCallback(
    (newOrder: string[]) => {
      // Remove _tree column as it's not part of the task columns managed by the store
      const taskColumnOrder = newOrder.filter((id) => id !== "_tree");
      setColumnOrder(taskColumnOrder);
    },
    [setColumnOrder],
  );

  // Handle sort change
  const handleSortChange = useCallback(
    (newSort: SortState<string>) => {
      if (newSort.column) {
        setSort(newSort.column);
      }
    },
    [setSort],
  );

  // Convert store sort to DataTable format
  const tableSorting = useMemo<SortState<string> | undefined>(() => {
    if (!sort) return undefined;
    return { column: sort.column, direction: sort.direction };
  }, [sort]);

  // Compute selected row ID for highlighting
  const selectedRowId = useMemo(() => {
    if (!selectedTaskName || !selectedGroupName) return undefined;
    // Find the task in the selected group to get retry_id
    const group = groupMap.get(selectedGroupName);
    const task = group?.tasks?.find((t) => t.name === selectedTaskName);
    if (!task) return undefined;
    return getTaskId(task as TaskWithDuration, selectedGroupName);
  }, [selectedTaskName, selectedGroupName, groupMap]);

  // Row class name for zebra striping across all visible rows
  const rowClassName = useCallback((task: TaskWithDuration) => {
    // Use visual row index for consistent striping (ignores skipped section headers)
    const visualIndex = task._visualRowIndex ?? 0;
    return visualIndex % 2 === 0 ? "bg-white dark:bg-zinc-950" : "bg-gray-50/50 dark:bg-zinc-900/50";
  }, []);

  // Section class name for zebra striping and borders (matches task rows)
  const sectionClassName = useCallback((section: Section<TaskWithDuration, GroupSectionMeta>) => {
    const visualIndex = section.metadata?._visualRowIndex ?? 0;
    const zebraClass = visualIndex % 2 === 0 ? "bg-white dark:bg-zinc-950" : "bg-gray-50/50 dark:bg-zinc-900/50";
    // Add bottom border to match task rows
    return `${zebraClass} border-b border-zinc-200 dark:border-zinc-800`;
  }, []);

  // Empty state - only show "no groups" message if there are actually no groups
  // If groups exist but are all collapsed, return null to keep section headers visible
  const emptyContent = useMemo(() => {
    if (groups.length === 0) {
      return (
        <div className="flex h-48 items-center justify-center text-sm text-gray-500 dark:text-zinc-400">
          No task groups in this workflow
        </div>
      );
    }
    // Groups exist but are all collapsed - return null to keep section headers visible for expanding
    return null;
  }, [groups.length]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Toolbar: Search + Controls */}
      <div className="border-b border-gray-200 px-4 py-3 dark:border-zinc-800">
        <TableToolbar
          data={allTasksWithDuration}
          searchFields={TASK_SEARCH_FIELDS}
          columns={OPTIONAL_COLUMNS_ALPHABETICAL}
          visibleColumnIds={visibleColumnIds}
          onToggleColumn={toggleColumn}
          searchChips={searchChips}
          onSearchChipsChange={setSearchChips}
          placeholder="Filter by name, status:, ip:, duration:..."
          searchPresets={TASK_PRESETS}
          resultsCount={resultsCount}
        />
      </div>

      {/* Task List - grouped table with tree view */}
      <DataTable<TaskWithDuration, GroupSectionMeta>
        data={[]}
        sections={sections}
        columns={columns}
        getRowId={getRowId}
        renderSectionHeader={renderSectionHeader}
        // Column management
        columnOrder={tableColumnOrder}
        onColumnOrderChange={handleColumnOrderChange}
        columnVisibility={columnVisibility}
        fixedColumns={fixedColumns}
        // Column sizing (includes tree column + task columns)
        columnSizeConfigs={TASK_WITH_TREE_COLUMN_SIZE_CONFIG}
        // Sorting
        sorting={tableSorting}
        onSortingChange={handleSortChange}
        // Layout
        rowHeight={rowHeight}
        sectionHeight={rowHeight}
        compact={compactMode}
        className="text-sm"
        scrollClassName="flex-1"
        // State
        emptyContent={emptyContent}
        // Interaction
        onRowClick={handleRowClick}
        selectedRowId={selectedRowId}
        rowClassName={rowClassName}
        sectionClassName={sectionClassName}
        // Sticky section headers
        stickyHeaders
      />
    </div>
  );
});
