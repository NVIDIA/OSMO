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
 * Hook to generate common DetailsPanel props from view props.
 *
 * Both WorkflowDAGView and WorkflowTableView need to render a DetailsPanel with
 * nearly identical props. This hook consolidates that prop mapping to reduce
 * duplication and ensure consistency.
 */

import { useMemo } from "react";
import type { RefObject } from "react";
import type { WorkflowViewCommonProps } from "../lib/view-types";
import type { DetailsPanelProps } from "../lib/panel-types";
import type { GroupWithLayout } from "../lib/workflow-types";
import { ACTIVITY_STRIP_WIDTH_PX, PANEL_CONSTRAINTS } from "../lib/panel-constants";

interface UsePanelPropsOptions extends WorkflowViewCommonProps {
  /** Optional override for allGroups (DAG view uses dagGroups with layout) */
  allGroups?: GroupWithLayout[];
  /** Ref to the container element for resize calculations */
  containerRef: RefObject<HTMLDivElement | null>;
  /** Additional className for the panel */
  className?: string;
  /** Callback when panel resize drag starts (for snap zone integration) */
  onDragStart?: () => void;
  /** Callback when panel resize drag ends (for snap zone integration) */
  onDragEnd?: () => void;
  /**
   * When true, panel fills its container (for use inside CSS Grid).
   * The grid controls sizing via grid-template-columns, panel just fills its cell.
   */
  fillContainer?: boolean;
}

/**
 * Props for ShellContainer with workflowName narrowed to string.
 * Use the check `shellContainerProps.workflowName &&` before rendering.
 */
export interface ShellContainerRenderProps {
  workflowName: string;
  currentTaskId: string | undefined;
  isShellTabActive: boolean;
}

/**
 * Generates stable props for the DetailsPanel component.
 *
 * @param options - View props and options
 * @returns Props object for DetailsPanel, plus ShellContainer props (check workflowName before use)
 */
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
    // Snap zone integration
    onDragStart,
    onDragEnd,
    // Grid container mode
    fillContainer,
  } = options;

  // Use provided allGroups or fall back to groups
  const effectiveAllGroups = allGroups ?? groups;

  // Memoize panel props to prevent unnecessary re-renders
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
      // Workflow-specific: Allow resizing down to activity strip width
      // This overrides the default PANEL.MIN_WIDTH_PCT (33%) used by pools/resources
      minWidth: PANEL_CONSTRAINTS.MIN_PCT, // Effectively disable percentage minimum (rely on minWidthPx instead)
      minWidthPx: ACTIVITY_STRIP_WIDTH_PX, // Enforce exact activity strip width in pixels
      // Workflow-specific: Allow full width for panel-only view
      maxWidth: PANEL_CONSTRAINTS.MAX_PCT,
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
    ],
  );

  // Extract stable references for memoization
  const workflowName = workflow?.name;
  const currentTaskId = selectedTask?.task_uuid;

  // Memoize shell container props - returns null if no workflow name
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
