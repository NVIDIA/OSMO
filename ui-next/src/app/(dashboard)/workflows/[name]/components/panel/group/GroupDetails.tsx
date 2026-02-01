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
import { Check, Loader2, AlertCircle, Clock, Info, List } from "lucide-react";
import { cn } from "@/lib/utils";
import { PanelTabs, TabPanel, SeparatedParts, type PanelTab } from "@/components/panel";
import { calculateDuration, formatDuration } from "../../../lib/workflow-types";
import { computeTaskStats, computeGroupStatus, computeGroupDuration } from "../../../lib/status";
import type { GroupDetailsProps } from "../../../lib/panel-types";
import type { TaskWithDuration } from "../../../lib/workflow-types";
import { DetailsPanelHeader } from "../shared/DetailsPanelHeader";
import { useTick } from "@/hooks";
import type { BreadcrumbSegment } from "../../../lib/panel-types";
import { GroupOverviewTab } from "./GroupOverviewTab";
import { GroupTasksTab } from "./GroupTasksTab";
import type { GroupTab } from "../../../hooks/use-navigation-state";

// =============================================================================
// Component
// =============================================================================

interface GroupDetailsInternalProps extends GroupDetailsProps {
  /** Navigate back to workflow details */
  onBack?: () => void;
}

export const GroupDetails = memo(function GroupDetails({
  group,
  allGroups,
  onSelectTask,
  onSelectGroup,
  onBack,
  selectedGroupTab = "overview",
  setSelectedGroupTab,
}: GroupDetailsInternalProps) {
  const [selectedTaskName, setSelectedTaskName] = useState<string | null>(null);

  // Synchronized tick for live durations
  const now = useTick();

  // Compute tasks with duration (using synchronized tick for running tasks)
  const tasksWithDuration: TaskWithDuration[] = useMemo(() => {
    return (group.tasks || []).map((task) => ({
      ...task,
      duration: calculateDuration(task.start_time, task.end_time, now),
    }));
  }, [group.tasks, now]);

  // Compute stats (single pass)
  const stats = useMemo(() => computeTaskStats(tasksWithDuration), [tasksWithDuration]);
  const groupStatus = useMemo(() => computeGroupStatus(stats), [stats]);
  // Use synchronized tick for running group duration
  const groupDuration = useMemo(() => computeGroupDuration(stats, now), [stats, now]);

  // Define available tabs - both Overview and Tasks are always available
  // Note: Tasks tab shows a table of tasks within this group (not the DAG),
  // so it should always be available regardless of the dagVisible preference.
  const availableTabs = useMemo<PanelTab[]>(
    () => [
      { id: "overview", label: "Overview", icon: Info },
      { id: "tasks", label: "Tasks", icon: List },
    ],
    [],
  );

  // Derive active tab - fallback to "overview" if current tab unavailable
  const activeTab = useMemo<GroupTab>(() => {
    const isTabAvailable = availableTabs.some((t) => t.id === selectedGroupTab);
    return isTabAvailable ? selectedGroupTab : "overview";
  }, [selectedGroupTab, availableTabs]);

  // Tab change handler
  const handleTabChange = useCallback(
    (value: string) => {
      if (setSelectedGroupTab && (value === "overview" || value === "tasks")) {
        setSelectedGroupTab(value);
      }
    },
    [setSelectedGroupTab],
  );

  // Handle dependency pill click (pass group name directly to GroupOverviewTab)
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

  // Callback wrapper for overview tab
  const handleOverviewSelectGroup = useCallback(
    (groupName: string) => {
      handleSelectGroupByName(groupName);
    },
    [handleSelectGroupByName],
  );

  // Status content for header (Row 2) - clean, no error message here
  const statusContent = (
    <SeparatedParts className="text-xs">
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
        <span className="text-gray-500 dark:text-zinc-400">{formatDuration(groupDuration)}</span>
      )}
    </SeparatedParts>
  );

  // Build breadcrumbs for hierarchical navigation (Workflow > Group)
  const breadcrumbs = useMemo((): BreadcrumbSegment[] => {
    if (!onBack) return [];
    return [{ label: "Workflow", onClick: onBack }];
  }, [onBack]);

  return (
    <div className="relative flex h-full w-full min-w-0 flex-col overflow-hidden">
      {/* Header (compact - no expandable content) */}
      <DetailsPanelHeader
        viewType="group"
        title={group.name}
        subtitle={`${stats.total} tasks`}
        statusContent={statusContent}
        breadcrumbs={breadcrumbs.length > 0 ? breadcrumbs : undefined}
      />

      {/* Tabs */}
      <PanelTabs
        tabs={availableTabs}
        value={activeTab}
        onValueChange={handleTabChange}
      />

      {/* Tab Content */}
      <div className="relative flex-1 overflow-hidden">
        {/* Overview Tab */}
        <TabPanel
          tab="overview"
          activeTab={activeTab}
          scrollable={true}
        >
          <GroupOverviewTab
            group={group}
            allGroups={allGroups}
            onSelectGroup={handleOverviewSelectGroup}
          />
        </TabPanel>

        {/* Tasks Tab - always available (shows table of tasks within this group) */}
        <TabPanel
          tab="tasks"
          activeTab={activeTab}
          scrollable={false}
        >
          <GroupTasksTab
            tasksWithDuration={tasksWithDuration}
            group={group}
            totalTasks={stats.total}
            onSelectTask={onSelectTask}
            selectedTaskName={selectedTaskName}
            onSelectedTaskNameChange={setSelectedTaskName}
          />
        </TabPanel>
      </div>
    </div>
  );
});
