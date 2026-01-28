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

import { memo, useRef } from "react";
import dynamic from "next/dynamic";
import { WorkflowTasksTable, DetailsPanel } from ".";
import { PANEL } from "@/components/panel";
import type { GroupWithLayout, TaskQueryResponse, WorkflowQueryResponse } from "../lib/workflow-types";
import type { DetailsPanelView } from "../lib/panel-types";
import type { WorkflowTab, TaskTab } from "../hooks/use-navigation-state";

// Shell container is heavy (xterm.js), load dynamically
const ShellContainer = dynamic(() => import("./shell/ShellContainer").then((m) => ({ default: m.ShellContainer })), {
  ssr: false,
});

// =============================================================================
// Types
// =============================================================================

export interface WorkflowTableViewProps {
  // Data
  workflow: WorkflowQueryResponse;
  groups: GroupWithLayout[];

  // Selection state
  selectedGroupName: string | null;
  selectedTaskName: string | null;
  selectedGroup: GroupWithLayout | null;
  selectedTask: TaskQueryResponse | null;
  currentPanelView: DetailsPanelView;

  // Navigation handlers
  onSelectGroup: (group: GroupWithLayout) => void;
  onSelectTask: (task: TaskQueryResponse, group: GroupWithLayout) => void;
  onBackToGroup: () => void;
  onBackToWorkflow: () => void;

  // Panel state
  panelPct: number;
  onPanelResize: (pct: number) => void;
  isDetailsExpanded: boolean;
  onToggleDetailsExpanded: () => void;
  isPanelCollapsed: boolean;
  togglePanelCollapsed: () => void;
  panelOverrideContent?: React.ReactNode;
  onPanelDraggingChange?: (isDragging: boolean) => void;

  // Workflow actions
  onCancelWorkflow?: () => void;

  // Tab state
  selectedTab: TaskTab | null;
  setSelectedTab: (tab: TaskTab) => void;
  selectedWorkflowTab: WorkflowTab | null;
  setSelectedWorkflowTab: (tab: WorkflowTab) => void;
  onShellTabChange: (taskName: string | null) => void;
  activeShellTaskName: string | null;
}

// =============================================================================
// Component
// =============================================================================

export const WorkflowTableView = memo(function WorkflowTableView({
  workflow,
  groups,
  selectedGroupName,
  selectedTaskName,
  selectedGroup,
  selectedTask,
  currentPanelView,
  onSelectGroup,
  onSelectTask,
  onBackToGroup,
  onBackToWorkflow,
  panelPct,
  onPanelResize,
  isDetailsExpanded,
  onToggleDetailsExpanded,
  isPanelCollapsed,
  togglePanelCollapsed,
  panelOverrideContent,
  onPanelDraggingChange,
  onCancelWorkflow,
  selectedTab,
  setSelectedTab,
  selectedWorkflowTab,
  setSelectedWorkflowTab,
  onShellTabChange,
  activeShellTaskName,
}: WorkflowTableViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Reserve space for the edge strip to maintain consistent table layout
  // This prevents the table from jumping when the panel expands/collapses
  const tablePaddingRight = PANEL.COLLAPSED_WIDTH_PX;

  return (
    <div
      ref={containerRef}
      className="relative h-full overflow-hidden bg-gray-50 dark:bg-zinc-950"
    >
      {/* Table - full width, lower z-index */}
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
        <WorkflowTasksTable
          workflow={workflow}
          groups={groups}
          onSelectGroup={onSelectGroup}
          onSelectTask={onSelectTask}
          selectedGroupName={selectedGroupName ?? undefined}
          selectedTaskName={selectedTaskName ?? undefined}
        />
      </main>

      {/* Panel - positioned on right side */}
      <DetailsPanel
        view={currentPanelView}
        workflow={workflow}
        group={selectedGroup}
        allGroups={groups}
        task={selectedTask}
        onBackToGroup={onBackToGroup}
        onBackToWorkflow={onBackToWorkflow}
        onSelectTask={onSelectTask}
        onSelectGroup={onSelectGroup}
        panelPct={panelPct}
        onPanelResize={onPanelResize}
        isDetailsExpanded={isDetailsExpanded}
        onToggleDetailsExpanded={onToggleDetailsExpanded}
        isCollapsed={isPanelCollapsed}
        onToggleCollapsed={togglePanelCollapsed}
        toggleHotkey="mod+i"
        onCancelWorkflow={onCancelWorkflow}
        fallbackContent={panelOverrideContent}
        containerRef={containerRef}
        onDraggingChange={onPanelDraggingChange}
        onShellTabChange={onShellTabChange}
        selectedTab={selectedTab ?? undefined}
        setSelectedTab={(tab: TaskTab) => setSelectedTab(tab)}
        selectedWorkflowTab={selectedWorkflowTab ?? undefined}
        setSelectedWorkflowTab={(tab: WorkflowTab) => setSelectedWorkflowTab(tab)}
        className="absolute inset-y-0 right-0 z-10"
      />

      {/* Shell Container - renders shells, portals into TaskDetails */}
      {workflow.name && (
        <ShellContainer
          workflowName={workflow.name}
          currentTaskId={selectedTask?.task_uuid}
          isShellTabActive={activeShellTaskName !== null}
        />
      )}
    </div>
  );
});
