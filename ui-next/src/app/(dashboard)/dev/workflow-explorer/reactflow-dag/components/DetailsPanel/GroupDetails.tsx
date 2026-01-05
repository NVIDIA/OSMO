// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * GroupDetails Component
 *
 * Content component for displaying group details within DetailsPanel.
 * Features:
 * - Smart search with chip-based filters
 * - Virtualized task table
 * - Sortable and reorderable columns
 */

"use client";

import { useState, useMemo, useCallback, memo } from "react";
import { Check, Loader2, AlertCircle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { STATUS_SORT_ORDER } from "../../constants";
import { calculateDuration, formatDuration } from "../../../workflow-types";
import { computeTaskStats, computeGroupStatus, computeGroupDuration } from "../../utils/status";
import { usePersistedSettings } from "../../hooks";
import type { GroupDetailsProps } from "../../types/panel";
import type { TaskWithDuration, ColumnDef, ColumnId, SortColumn, SearchChip } from "../../types/table";
import {
  MANDATORY_COLUMNS,
  OPTIONAL_COLUMNS_ALPHABETICAL,
  OPTIONAL_COLUMN_MAP,
  DEFAULT_VISIBLE_OPTIONAL,
} from "../GroupPanel/column-config";
import { SmartSearch, filterTasksByChips } from "../GroupPanel/SmartSearch";
import { VirtualizedTaskList } from "../GroupPanel/TaskTable";
import { DetailsPanelHeader, ColumnMenuContent } from "./DetailsPanelHeader";
import { GroupTimeline } from "./GroupTimeline";
import { DependencyPills } from "./DependencyPills";

// ============================================================================
// Component
// ============================================================================

interface GroupDetailsInternalProps extends GroupDetailsProps {
  onClose: () => void;
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
  onPanelResize,
  isDetailsExpanded,
  onToggleDetailsExpanded,
}: GroupDetailsInternalProps) {
  const [searchChips, setSearchChips] = useState<SearchChip[]>([]);
  const [selectedTaskName, setSelectedTaskName] = useState<string | null>(null);

  // Persisted settings
  const [sort, setSort] = usePersistedSettings("sort", { column: "status", direction: "asc" });
  const [visibleOptionalIds, setVisibleOptionalIds] = usePersistedSettings(
    "visibleColumnIds",
    DEFAULT_VISIBLE_OPTIONAL,
  );

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
  const toggleColumn = useCallback(
    (columnId: ColumnId) => {
      setVisibleOptionalIds((prev) => {
        if (prev.includes(columnId)) {
          return prev.filter((id) => id !== columnId);
        }
        return [...prev, columnId];
      });
    },
    [setVisibleOptionalIds],
  );

  const reorderColumns = useCallback(
    (newOrder: ColumnId[]) => {
      setVisibleOptionalIds(newOrder);
    },
    [setVisibleOptionalIds],
  );

  const handleSort = useCallback(
    (column: SortColumn) => {
      setSort((prev) => {
        if (prev.column === column) {
          if (prev.direction === "asc") return { column, direction: "desc" };
          return { column: null, direction: "asc" };
        }
        return { column, direction: "asc" };
      });
    },
    [setSort],
  );

  const handleSelectTask = useCallback(
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

  // Menu content
  const menuContent = (
    <ColumnMenuContent
      columns={OPTIONAL_COLUMNS_ALPHABETICAL}
      visibleColumnIds={visibleOptionalIds}
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

  return (
    <>
      {/* Header with expandable details */}
      <DetailsPanelHeader
        viewType="group"
        title={group.name}
        subtitle={`${stats.total} tasks`}
        statusContent={statusContent}
        onClose={onClose}
        onPanelResize={onPanelResize}
        menuContent={menuContent}
        expandableContent={expandableContent}
        isExpanded={isDetailsExpanded}
        onToggleExpand={onToggleDetailsExpanded}
      />

      {/* Search */}
      <div className="space-y-2 border-b border-gray-200 dark:border-zinc-800 px-4 py-3">
        <SmartSearch
          tasks={tasksWithDuration}
          chips={searchChips}
          onChipsChange={setSearchChips}
          placeholder="Filter by name, status:, ip:, duration:, and more..."
        />
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
    </>
  );
});
