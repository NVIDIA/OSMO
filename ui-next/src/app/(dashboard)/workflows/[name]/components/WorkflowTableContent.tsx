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
 * WorkflowTableContent Component
 *
 * Pure table visualization without panel/shell. Handles table rendering,
 * filtering, and toolbar. Panel and shell are composed externally.
 */

"use client";

import { memo, useMemo } from "react";
import { InlineErrorBoundary } from "@/components/error/inline-error-boundary";
import { useResultsCount } from "@/hooks/use-results-count";
import { useUrlChips } from "@/hooks/use-url-chips";
import { filterByChips } from "@/components/filter-bar/lib/filter";
import { WorkflowTasksTable } from "@/app/(dashboard)/workflows/[name]/components/table/WorkflowTasksTable";
import { WorkflowTasksToolbar } from "@/app/(dashboard)/workflows/[name]/components/table/WorkflowTasksToolbar";
import { TASK_SEARCH_FIELDS } from "@/app/(dashboard)/workflows/[name]/lib/task-search-fields";
import type {
  TaskWithDuration,
  GroupWithLayout,
  TaskQueryResponse,
  WorkflowQueryResponse,
} from "@/app/(dashboard)/workflows/[name]/lib/workflow-types";

// =============================================================================
// Types
// =============================================================================

export interface WorkflowTableContentProps {
  /** Workflow data */
  workflow: WorkflowQueryResponse;
  /** Groups with layout information */
  groups: GroupWithLayout[];
  /** Currently selected group name (from URL) */
  selectedGroupName: string | null;
  /** Currently selected task name (from URL) */
  selectedTaskName: string | null;
  /** Group selection handler */
  onSelectGroup: (group: GroupWithLayout) => void;
  /** Task selection handler */
  onSelectTask: (task: TaskQueryResponse, group: GroupWithLayout) => void;
}

// =============================================================================
// Component
// =============================================================================

export const WorkflowTableContent = memo(function WorkflowTableContent(props: WorkflowTableContentProps) {
  const { groups, selectedGroupName, selectedTaskName, onSelectGroup, onSelectTask } = props;

  // Filter chips - URL-synced via shared hook
  const { searchChips, setSearchChips } = useUrlChips();

  // Collect all tasks from all groups for filtering
  const allTasks = useMemo((): TaskWithDuration[] => {
    const tasks: TaskWithDuration[] = [];
    for (const group of groups) {
      if (group.tasks) {
        for (const task of group.tasks) {
          tasks.push({
            ...task,
            duration: null, // Will be computed by WorkflowTasksTable
            _groupName: group.name,
          } as TaskWithDuration & { _groupName: string });
        }
      }
    }
    return tasks;
  }, [groups]);

  // Apply filters to get filtered tasks for results count
  const filteredTasks = useMemo(() => {
    if (searchChips.length === 0) return allTasks;
    return filterByChips(allTasks, searchChips, TASK_SEARCH_FIELDS);
  }, [allTasks, searchChips]);

  // Results count for FilterBar display
  const resultsCount = useResultsCount({
    total: allTasks.length,
    filteredTotal: filteredTasks.length,
    hasActiveFilters: searchChips.length > 0,
  });

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      {/* Toolbar with search and controls */}
      <div className="shrink-0">
        <InlineErrorBoundary
          title="Toolbar error"
          compact
        >
          <WorkflowTasksToolbar
            tasks={allTasks}
            searchChips={searchChips}
            onSearchChipsChange={setSearchChips}
            resultsCount={resultsCount}
          />
        </InlineErrorBoundary>
      </div>

      {/* Main tasks table */}
      <div className="min-h-0 flex-1">
        <InlineErrorBoundary
          title="Unable to display tasks table"
          resetKeys={[groups.length]}
        >
          <WorkflowTasksTable
            groups={groups}
            onSelectGroup={onSelectGroup}
            onSelectTask={onSelectTask}
            selectedGroupName={selectedGroupName ?? undefined}
            selectedTaskName={selectedTaskName ?? undefined}
          />
        </InlineErrorBoundary>
      </div>
    </div>
  );
});
