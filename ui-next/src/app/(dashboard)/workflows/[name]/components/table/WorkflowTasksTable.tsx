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
import { ChevronDown, ChevronRight, Check, Loader2, AlertCircle, Clock } from "lucide-react";
import { cn, naturalCompare } from "@/lib/utils";
import { DataTable, type Section, type SortState } from "@/components/data-table";
import { useSharedPreferences } from "@/stores";
import { TABLE_ROW_HEIGHTS } from "@/lib/config";
import { useTick } from "@/hooks";

import { calculateDuration, formatDuration } from "../../lib/workflow-types";
import { computeTaskStats, computeGroupStatus, computeGroupDuration, STATUS_SORT_ORDER, getStatusCategory, STATUS_STYLES } from "../../lib/status";
import { formatDateTimeSuccinct, formatDateTimeFull } from "@/lib/format-date";
import { createTaskColumns } from "../../lib/task-column-defs";
import { TASK_COLUMN_SIZE_CONFIG, MANDATORY_COLUMN_IDS, asTaskColumnIds } from "../../lib/task-columns";
import { useTaskTableStore } from "../../stores";

import type {
  GroupWithLayout,
  TaskQueryResponse,
  TaskWithDuration,
  WorkflowQueryResponse,
} from "../../lib/workflow-types";

// =============================================================================
// Types
// =============================================================================

export interface WorkflowTasksTableProps {
  /** The workflow data */
  workflow: WorkflowQueryResponse;
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
  status: ReturnType<typeof computeGroupStatus>;
  duration: number | null;
}

// =============================================================================
// Helpers
// =============================================================================

/** Generate unique task ID (group + task name + retry) */
function getTaskId(task: TaskWithDuration, groupName: string): string {
  return `${groupName}:${task.name}:${task.retry_id}`;
}

// =============================================================================
// Group Header Component
// =============================================================================

interface GroupHeaderRowProps {
  section: Section<TaskWithDuration, GroupSectionMeta>;
  isExpanded: boolean;
  onToggle: () => void;
  onClick: () => void;
}

const GroupHeaderRow = memo(function GroupHeaderRow({ section, isExpanded, onToggle, onClick }: GroupHeaderRowProps) {
  const { metadata } = section;
  if (!metadata) return null;

  const { group, stats, status } = metadata;

  // Get status category and styles for badge
  const category = getStatusCategory(group.status);
  const styles = STATUS_STYLES[category];
  const StatusIcon = category === "completed" ? Check : category === "running" ? Loader2 : category === "failed" ? AlertCircle : Clock;

  // Calculate duration from group response
  const groupDuration = calculateDuration(group.start_time, group.end_time, Date.now());

  return (
    <div
      className="group-header-row flex h-full w-full cursor-pointer items-center"
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      role="button"
      tabIndex={0}
      aria-expanded={isExpanded}
      aria-label={`Group ${group.name}, ${stats.completed} of ${stats.total} tasks complete`}
    >
      {/* Name column */}
      <div className="flex min-w-0 items-center gap-2 px-3" style={{ width: "var(--col-name, 200px)" }}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-gray-200 dark:hover:bg-zinc-700"
          aria-label={isExpanded ? "Collapse group" : "Expand group"}
        >
          {isExpanded ? (
            <ChevronDown className="size-3.5 text-gray-500 dark:text-zinc-400" />
          ) : (
            <ChevronRight className="size-3.5 text-gray-500 dark:text-zinc-400" />
          )}
        </button>
        <span className="min-w-0 truncate font-medium text-gray-900 dark:text-zinc-100">{group.name}</span>
      </div>

      {/* Status column */}
      <div className="flex items-center px-3" style={{ width: "var(--col-status, 120px)" }}>
        <span className={cn("inline-flex items-center gap-1.5 rounded px-2 py-0.5", styles.bg)}>
          <StatusIcon className={cn("size-3.5", styles.text, category === "running" && "animate-spin")} />
          <span className={cn("text-xs font-semibold", styles.text)}>{group.status}</span>
        </span>
      </div>

      {/* Duration column */}
      <div className="px-3 text-gray-500 tabular-nums dark:text-zinc-400" style={{ width: "var(--col-duration, 100px)" }}>
        {formatDuration(groupDuration)}
      </div>

      {/* Node column (empty for groups) */}
      <div className="px-3 text-gray-400 dark:text-zinc-500" style={{ width: "var(--col-node, 120px)" }}>
        —
      </div>

      {/* Pod IP column (empty for groups) */}
      <div className="px-3 text-gray-400 dark:text-zinc-500" style={{ width: "var(--col-podIp, 120px)" }}>
        —
      </div>

      {/* Exit Code column (empty for groups) */}
      <div className="px-3 text-gray-400 dark:text-zinc-500" style={{ width: "var(--col-exitCode, 80px)" }}>
        —
      </div>

      {/* Start Time column */}
      <div className="px-3 text-gray-500 tabular-nums dark:text-zinc-400" style={{ width: "var(--col-startTime, 110px)" }}>
        {group.start_time ? (
          <span className="whitespace-nowrap" title={formatDateTimeFull(group.start_time)}>
            {formatDateTimeSuccinct(group.start_time)}
          </span>
        ) : (
          <span className="text-gray-400 dark:text-zinc-500">—</span>
        )}
      </div>

      {/* End Time column */}
      <div className="px-3 text-gray-500 tabular-nums dark:text-zinc-400" style={{ width: "var(--col-endTime, 110px)" }}>
        {group.end_time ? (
          <span className="whitespace-nowrap" title={formatDateTimeFull(group.end_time)}>
            {formatDateTimeSuccinct(group.end_time)}
          </span>
        ) : (
          <span className="text-gray-400 dark:text-zinc-500">—</span>
        )}
      </div>

      {/* Retry column (empty for groups) */}
      <div className="px-3 text-gray-400 dark:text-zinc-500" style={{ width: "var(--col-retry, 80px)" }}>
        —
      </div>
    </div>
  );
});

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

  // Shared preferences (compact mode)
  const compactMode = useSharedPreferences((s) => s.compactMode);

  // Task table store (column visibility, order, sort)
  const visibleColumnIds = asTaskColumnIds(useTaskTableStore((s) => s.visibleColumnIds));
  const columnOrder = asTaskColumnIds(useTaskTableStore((s) => s.columnOrder));
  const setColumnOrder = useTaskTableStore((s) => s.setColumnOrder);
  const sort = useTaskTableStore((s) => s.sort);
  const setSort = useTaskTableStore((s) => s.setSort);

  // Row height and section height based on compact mode
  const rowHeight = compactMode ? TABLE_ROW_HEIGHTS.COMPACT : TABLE_ROW_HEIGHTS.NORMAL;
  const sectionHeight = compactMode ? TABLE_ROW_HEIGHTS.COMPACT : TABLE_ROW_HEIGHTS.NORMAL;

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

  // Transform groups into sections with computed metadata
  const sections = useMemo((): Section<TaskWithDuration, GroupSectionMeta>[] => {
    return groups.map((group) => {
      // Compute tasks with duration
      const tasksWithDuration: TaskWithDuration[] = (group.tasks || []).map(
        (task) =>
          ({
            ...task,
            duration: calculateDuration(task.start_time, task.end_time, now),
            // Store group reference for row click handler
            _groupName: group.name,
          }) as TaskWithDuration & { _groupName: string },
      );

      // Sort tasks if we have a comparator
      const sortedTasks = sortComparator ? [...tasksWithDuration].sort(sortComparator) : tasksWithDuration;

      // Compute stats
      const stats = computeTaskStats(sortedTasks);
      const status = computeGroupStatus(stats);
      const duration = computeGroupDuration(stats, now);

      // Filter out collapsed groups' tasks
      const isExpanded = !collapsedGroups.has(group.name);
      const items = isExpanded ? sortedTasks : [];

      return {
        id: group.name,
        label: group.name,
        items,
        metadata: {
          group,
          stats,
          status,
          duration,
        },
      };
    });
  }, [groups, now, sortComparator, collapsedGroups]);

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

  // Render section header
  const renderSectionHeader = useCallback(
    (section: Section<TaskWithDuration, GroupSectionMeta>) => {
      const isExpanded = !collapsedGroups.has(section.id);
      const group = section.metadata?.group;

      return (
        <GroupHeaderRow
          section={section}
          isExpanded={isExpanded}
          onToggle={() => handleToggleGroup(section.id)}
          onClick={() => {
            if (group) {
              onSelectGroup(group);
            }
          }}
        />
      );
    },
    [collapsedGroups, handleToggleGroup, onSelectGroup],
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

  // Handle column order change
  const handleColumnOrderChange = useCallback(
    (newOrder: string[]) => {
      setColumnOrder(newOrder);
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

  // Row class name for zebra striping within groups
  const rowClassName = useCallback(
    (task: TaskWithDuration) => {
      // Use the task's position within its group for zebra striping
      const groupName = (task as TaskWithDuration & { _groupName?: string })._groupName;
      const group = groupName ? groupMap.get(groupName) : undefined;
      if (!group) return "";

      const taskIndex = group.tasks?.findIndex((t) => t.name === task.name && t.retry_id === task.retry_id) ?? 0;
      return taskIndex % 2 === 0 ? "bg-white dark:bg-zinc-950" : "bg-gray-50/50 dark:bg-zinc-900/50";
    },
    [groupMap],
  );

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
    <div className="table-container relative h-full">
      <DataTable<TaskWithDuration, GroupSectionMeta>
        data={[]}
        sections={sections}
        columns={columns}
        getRowId={getRowId}
        renderSectionHeader={renderSectionHeader}
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
        sectionHeight={sectionHeight}
        compact={compactMode}
        className="text-sm"
        scrollClassName="scrollbar-styled flex-1"
        // State
        emptyContent={emptyContent}
        // Interaction
        onRowClick={handleRowClick}
        selectedRowId={selectedRowId}
        rowClassName={rowClassName}
        // Sticky section headers
        stickyHeaders
      />
    </div>
  );
});
