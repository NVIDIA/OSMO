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

import { useMemo } from "react";
import type { RefObject } from "react";
import type { WorkflowViewCommonProps } from "@/features/workflows/detail/lib/view-types";
import type { DetailsPanelProps } from "@/features/workflows/detail/lib/panel-types";
import type { GroupWithLayout } from "@/features/workflows/detail/lib/workflow-types";
import { ACTIVITY_STRIP_WIDTH_PX, PANEL_CONSTRAINTS } from "@/features/workflows/detail/lib/panel-constants";

interface UsePanelPropsOptions extends WorkflowViewCommonProps {
  allGroups?: GroupWithLayout[];
  containerRef: RefObject<HTMLDivElement | null>;
  className?: string;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  fillContainer?: boolean;
  isTerminal?: boolean;
  autoRefresh?: {
    interval: number;
    setInterval: (interval: number) => void;
    onRefresh: () => void;
    isRefreshing: boolean;
  };
}

export interface ShellContainerRenderProps {
  workflowName: string;
  currentTaskId: string | undefined;
  isShellTabActive: boolean;
}

/** Consolidates DetailsPanel + ShellContainer props from view-level state. */
export function usePanelProps(options: UsePanelPropsOptions): {
  panelProps: Omit<DetailsPanelProps, "onDraggingChange">;
  shellContainerProps: ShellContainerRenderProps | null;
} {
  const {
    // Data
    workflow,
    groups,
    allGroups,
    // Selection
    selectedGroup,
    selectedTask,
    currentPanelView,
    // Navigation
    onSelectGroup,
    onSelectTask,
    onBackToGroup,
    onBackToWorkflow,
    // Panel state
    panelPct,
    onPanelResize,
    isDetailsExpanded,
    onToggleDetailsExpanded,
    isPanelCollapsed,
    togglePanelCollapsed,
    panelOverrideContent,
    // Tab state
    selectedTab,
    setSelectedTab,
    selectedWorkflowTab,
    setSelectedWorkflowTab,
    selectedGroupTab,
    setSelectedGroupTab,
    onShellTabChange,
    activeShellTaskName,
    // Workflow actions
    onCancelWorkflow,
    onResubmitWorkflow,
    // Layout
    containerRef,
    className,
    onDragStart,
    onDragEnd,
    fillContainer,
    isTerminal,
    autoRefresh,
  } = options;

  const effectiveAllGroups = allGroups ?? groups;

  const panelProps = useMemo<Omit<DetailsPanelProps, "onDraggingChange">>(
    () => ({
      view: currentPanelView,
      workflow,
      group: selectedGroup,
      allGroups: effectiveAllGroups,
      task: selectedTask,
      onBackToGroup,
      onBackToWorkflow,
      onSelectTask,
      onSelectGroup,
      panelPct,
      onPanelResize,
      isDetailsExpanded,
      onToggleDetailsExpanded,
      isCollapsed: isPanelCollapsed,
      onToggleCollapsed: togglePanelCollapsed,
      toggleHotkey: "mod+i",
      onCancelWorkflow,
      onResubmitWorkflow,
      fallbackContent: panelOverrideContent,
      containerRef,
      onShellTabChange,
      selectedTab: selectedTab ?? undefined,
      setSelectedTab,
      selectedWorkflowTab: selectedWorkflowTab ?? undefined,
      setSelectedWorkflowTab,
      selectedGroupTab: selectedGroupTab ?? undefined,
      setSelectedGroupTab,
      className,
      onDragStart,
      onDragEnd,
      fillContainer,
      // Override default PANEL.MIN_WIDTH_PCT - rely on pixel minimum instead
      minWidth: PANEL_CONSTRAINTS.MIN_PCT,
      minWidthPx: ACTIVITY_STRIP_WIDTH_PX,
      maxWidth: PANEL_CONSTRAINTS.MAX_PCT,
      isTerminal,
      autoRefresh,
    }),
    [
      currentPanelView,
      workflow,
      selectedGroup,
      effectiveAllGroups,
      selectedTask,
      onBackToGroup,
      onBackToWorkflow,
      onSelectTask,
      onSelectGroup,
      panelPct,
      onPanelResize,
      isDetailsExpanded,
      onToggleDetailsExpanded,
      isPanelCollapsed,
      togglePanelCollapsed,
      onCancelWorkflow,
      onResubmitWorkflow,
      panelOverrideContent,
      containerRef,
      onShellTabChange,
      selectedTab,
      setSelectedTab,
      selectedWorkflowTab,
      setSelectedWorkflowTab,
      selectedGroupTab,
      setSelectedGroupTab,
      className,
      onDragStart,
      onDragEnd,
      fillContainer,
      isTerminal,
      autoRefresh,
    ],
  );

  const workflowName = workflow?.name;
  const currentTaskId = selectedTask?.task_uuid;

  const shellContainerProps = useMemo<ShellContainerRenderProps | null>(() => {
    if (!workflowName) return null;
    return {
      workflowName,
      currentTaskId,
      isShellTabActive: activeShellTaskName !== null,
    };
  }, [workflowName, currentTaskId, activeShellTaskName]);

  return { panelProps, shellContainerProps };
}
