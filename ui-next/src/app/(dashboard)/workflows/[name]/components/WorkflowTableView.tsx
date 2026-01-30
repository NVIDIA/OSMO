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
 * WorkflowTableView Component
 *
 * Table view for workflows with overlay panel using CSS Grid.
 * Grid creates two columns with explicit sizing (percentages when expanded, pixels when collapsed)
 * with panel overlaying table via z-index stacking. This preserves side-by-side resize math
 * while achieving visual overlay effect. Explicit sizing avoids circular dependency with auto columns.
 */

"use client";

import { memo, useRef, useMemo, useCallback } from "react";
import dynamic from "next/dynamic";
import { InlineErrorBoundary } from "@/components/error";
import { useUrlChips, useResultsCount } from "@/hooks";
import { filterByChips } from "@/components/filter-bar";
import { WorkflowTasksTable, DetailsPanel } from ".";
import { WorkflowTasksToolbar } from "./table/WorkflowTasksToolbar";
import { PANEL } from "@/components/panel";
import { usePanelProps } from "../hooks/use-panel-props";
import { TASK_SEARCH_FIELDS } from "../lib/task-search-fields";
import type { WorkflowViewCommonProps } from "../lib/view-types";
import type { TaskWithDuration, GroupWithLayout, TaskQueryResponse } from "../lib/workflow-types";

// Shell container is heavy (xterm.js), load dynamically
const ShellContainer = dynamic(() => import("./shell/ShellContainer").then((m) => ({ default: m.ShellContainer })), {
  ssr: false,
});

// =============================================================================
// Types
// =============================================================================

/**
 * Table view props use the common view props without DAG-specific additions.
 * Table view doesn't need panning or selectionKey (DAG-specific).
 */
export type WorkflowTableViewProps = WorkflowViewCommonProps;

// =============================================================================
// Component
// =============================================================================

export const WorkflowTableView = memo(function WorkflowTableView(props: WorkflowTableViewProps) {
  const {
    groups,
    selectedGroupName,
    selectedTaskName,
    onSelectGroup,
    onSelectTask,
    onPanelDraggingChange,
    isPanelCollapsed,
    expandPanel,
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);

  // Wrapped navigation handlers for re-click behavior
  // When clicking an already-selected row, expand the panel if it's collapsed
  const handleNavigateToGroup = useCallback(
    (group: GroupWithLayout) => {
      const isAlreadySelected = selectedGroupName === group.name && !selectedTaskName;
      if (isAlreadySelected && isPanelCollapsed) {
        expandPanel();
      } else {
        onSelectGroup(group);
      }
    },
    [selectedGroupName, selectedTaskName, isPanelCollapsed, expandPanel, onSelectGroup],
  );

  const handleNavigateToTask = useCallback(
    (task: TaskQueryResponse, group: GroupWithLayout) => {
      const isAlreadySelected = selectedGroupName === group.name && selectedTaskName === task.name;
      if (isAlreadySelected && isPanelCollapsed) {
        expandPanel();
      } else {
        onSelectTask(task, group);
      }
    },
    [selectedGroupName, selectedTaskName, isPanelCollapsed, expandPanel, onSelectTask],
  );

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

  // Generate common panel props from view props
  const { panelProps, shellContainerProps } = usePanelProps({
    ...props,
    containerRef,
    className: "absolute inset-y-0 right-0 z-10",
  });

  // Reserve space for the edge strip to maintain consistent table layout
  // This prevents the table from jumping when the panel expands/collapses
  const tablePaddingRight = PANEL.COLLAPSED_WIDTH_PX;

  return (
    <div
      ref={containerRef}
      className="relative h-full overflow-hidden"
    >
      {/* Table with toolbar - full width, lower z-index */}
      <main
        id="workflow-table"
        className="absolute inset-0 overflow-hidden"
        style={{
          paddingRight: `${tablePaddingRight}px`,
          zIndex: 0,
        }}
        role="main"
        aria-label="Workflow tasks table"
      >
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
                onSelectGroup={handleNavigateToGroup}
                onSelectTask={handleNavigateToTask}
                selectedGroupName={selectedGroupName ?? undefined}
                selectedTaskName={selectedTaskName ?? undefined}
              />
            </InlineErrorBoundary>
          </div>
        </div>
      </main>

      {/* Panel - positioned on right side */}
      <DetailsPanel
        {...panelProps}
        onDraggingChange={onPanelDraggingChange}
      />

      {/* Shell Container - renders shells, portals into TaskDetails */}
      {shellContainerProps && <ShellContainer {...shellContainerProps} />}
    </div>
  );
});
