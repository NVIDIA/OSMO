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

/** Unified inspector panel for workflow/group/task details with resize, collapse, and edge strip. */

"use client";

import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { TextSearch, Info, History, List, FileCode } from "lucide-react";
import type { WorkflowTab } from "@/app/(dashboard)/workflows/[name]/hooks/use-navigation-state";
import { useEventCallback } from "usehooks-ts";
import { PanelHeader, PanelTitle } from "@/components/panel/panel-header";
import { SidePanel } from "@/components/panel/side-panel";
import { cn } from "@/lib/utils";
import type { DetailsPanelProps } from "@/app/(dashboard)/workflows/[name]/lib/panel-types";
import { useAnnouncer } from "@/hooks/use-announcer";
import { useShellContext } from "@/features/workflows/detail/shell/shell-context";
import { usePanelResize } from "@/app/(dashboard)/workflows/[name]/lib/panel-resize-context";
import { ACTIVITY_STRIP_WIDTH_PX } from "@/app/(dashboard)/workflows/[name]/lib/panel-constants";
import {
  WorkflowEdgeStrip,
  type QuickAction,
} from "@/app/(dashboard)/workflows/[name]/components/panel/workflow/workflow-edge-strip";

// Eager imports - panel views are always needed, dynamic imports add 100-300ms flash
import { WorkflowDetails } from "@/app/(dashboard)/workflows/[name]/components/panel/workflow/workflow-details";
import { GroupDetails } from "@/app/(dashboard)/workflows/[name]/components/panel/group/group-details";
import { TaskDetails } from "@/app/(dashboard)/workflows/[name]/components/panel/task/task-details";
import { ContentSlideWrapper } from "@/app/(dashboard)/workflows/[name]/components/panel/views/content-slide-wrapper";

export const DetailsPanel = memo(function DetailsPanel({
  view,
  workflow,
  group,
  allGroups,
  task,
  onBackToGroup,
  onBackToWorkflow,
  onSelectTask,
  onSelectGroup,
  panelPct,
  onPanelResize,
  isDetailsExpanded,
  onToggleDetailsExpanded,
  isCollapsed,
  onToggleCollapsed,
  toggleHotkey,
  onCancelWorkflow,
  onResubmitWorkflow,
  fallbackContent,
  containerRef,
  onDraggingChange,
  onShellTabChange,
  selectedTab,
  setSelectedTab,
  selectedWorkflowTab,
  setSelectedWorkflowTab,
  selectedGroupTab,
  setSelectedGroupTab,
  minWidth,
  minWidthPx,
  maxWidth,
  className,
  onDragStart,
  onDragEnd,
  fillContainer,
  isTerminal,
  autoRefresh,
}: DetailsPanelProps) {
  const announce = useAnnouncer();
  const { disconnectOnly, removeShell, reconnectShell } = useShellContext();

  // Access resize state for smooth snap animations
  const { phase, preSnapWidthPct, snapTarget } = usePanelResize();

  // Ref to override focus behavior when panel expands.
  // - undefined: use default (focus first focusable)
  // - null: skip focus (shell will handle its own focus)
  // - HTMLElement: focus that element
  const focusTargetRef = useRef<HTMLElement | null | undefined>(undefined);

  // Local container ref for ContentSlideWrapper (fallback if external ref not provided)
  const localContainerRef = useRef<HTMLDivElement>(null);
  const effectiveContainerRef = containerRef ?? localContainerRef;

  // Escape key collapses the panel
  const handleEscapeKey = useCallback(() => {
    if (onToggleCollapsed) {
      onToggleCollapsed();
    }
  }, [onToggleCollapsed]);

  const workflowName = workflow?.name;
  const groupName = group?.name;
  const taskCount = group?.tasks?.length ?? 0;
  const taskName = task?.name;

  // Announce panel state changes to screen readers
  useEffect(() => {
    if (view === "workflow" && workflowName) {
      announce(`Workflow details panel. ${workflowName}.`);
    } else if (view === "group" && groupName) {
      announce(`Group details. ${groupName}, ${taskCount} tasks.`);
    } else if (view === "task" && taskName) {
      announce(`Task details. ${taskName}.`);
    }
  }, [view, workflowName, groupName, taskCount, taskName, announce]);

  // Get aria label based on current view
  const ariaLabel =
    view === "workflow"
      ? `Workflow details: ${workflow?.name}`
      : view === "group"
        ? `Group details: ${group?.name}`
        : `Task details: ${task?.name}`;

  // Handle selecting a shell session from edge strip (opens panel + shell tab)
  const handleSelectShellSession = useCallback(
    (taskId: string) => {
      // Expand the panel if collapsed
      if (isCollapsed && onToggleCollapsed) {
        // Set focus target to null to skip panel's default focus
        // (the shell will handle its own focus via isVisible)
        focusTargetRef.current = null;
        onToggleCollapsed();
      }
      // If there's a task selection handler and we have groups, select the task
      if (onSelectTask && allGroups) {
        // Find the group containing this task by UUID
        for (const g of allGroups) {
          const foundTask = g.tasks?.find((t) => t.task_uuid === taskId);
          if (foundTask) {
            onSelectTask(foundTask, g);
            // Switch to shell tab - focus will be handled by TaskShell's isVisible effect
            setSelectedTab?.("shell");
            break;
          }
        }
      }
    },
    [isCollapsed, onToggleCollapsed, onSelectTask, allGroups, setSelectedTab],
  );

  // Handle disconnecting a shell session (closes WebSocket, keeps in list)
  const handleDisconnectSession = useCallback(
    (taskId: string) => {
      disconnectOnly(taskId);
    },
    [disconnectOnly],
  );

  // Handle reconnecting a shell session (opens panel + shell tab + triggers reconnection)
  const handleReconnectSession = useCallback(
    (taskId: string) => {
      // Trigger reconnection through ShellContext
      reconnectShell(taskId);
      // Expand panel and go to shell tab
      handleSelectShellSession(taskId);
    },
    [reconnectShell, handleSelectShellSession],
  );

  // Handle removing a shell session (closes WebSocket + removes from list)
  const handleRemoveSession = useCallback(
    (taskId: string) => {
      removeShell(taskId);
    },
    [removeShell],
  );

  // Navigate to a workflow tab, going back to workflow view if needed
  const navigateToWorkflowTab = useEventCallback((tab: WorkflowTab) => {
    // Expand panel if collapsed
    if (isCollapsed && onToggleCollapsed) {
      onToggleCollapsed();
    }
    // Navigate back to workflow view if we're on group or task
    if (view !== "workflow") {
      // Call onBackToWorkflow if provided, otherwise no-op
      // (onBackToWorkflow should always be provided per the interface, but being defensive)
      if (onBackToWorkflow) {
        onBackToWorkflow();
      }
    }
    // Set the workflow tab (must be after navigation to ensure we're in workflow view)
    if (setSelectedWorkflowTab) {
      setSelectedWorkflowTab(tab);
    }
  });

  // Build quick actions for the edge strip
  // Always show quick actions (they'll navigate back to workflow if needed)
  const quickActions: QuickAction[] = useMemo(() => {
    return [
      { id: "overview", icon: Info, label: "Workflow Overview", onClick: () => navigateToWorkflowTab("overview") },
      { id: "tasks", icon: List, label: "Workflow Tasks", onClick: () => navigateToWorkflowTab("tasks") },
      { id: "logs", icon: TextSearch, label: "Workflow Logs", onClick: () => navigateToWorkflowTab("logs") },
      { id: "events", icon: History, label: "Workflow Events", onClick: () => navigateToWorkflowTab("events") },
      { id: "spec", icon: FileCode, label: "Workflow Spec", onClick: () => navigateToWorkflowTab("spec") },
    ];
  }, [navigateToWorkflowTab]);

  // Terminal workflows show manual-only refresh (no interval selector)
  // because polling has already stopped and the interval has no effect.
  const refreshControl = useMemo(() => {
    if (!autoRefresh) return undefined;
    if (isTerminal) {
      return { onRefresh: autoRefresh.onRefresh, isRefreshing: autoRefresh.isRefreshing };
    }
    return autoRefresh;
  }, [autoRefresh, isTerminal]);

  const edgeContent = (
    <WorkflowEdgeStrip
      quickActions={quickActions}
      workflowName={workflow?.name}
      currentTaskId={task?.task_uuid}
      onSelectSession={handleSelectShellSession}
      onDisconnectSession={handleDisconnectSession}
      onReconnectSession={handleReconnectSession}
      onRemoveSession={handleRemoveSession}
      refreshControl={refreshControl}
    />
  );

  return (
    <SidePanel
      width={panelPct}
      onWidthChange={onPanelResize}
      minWidth={minWidth}
      minWidthPx={minWidthPx}
      maxWidth={maxWidth}
      isCollapsed={isCollapsed}
      onToggleCollapsed={onToggleCollapsed}
      toggleHotkey={toggleHotkey}
      edgeContent={edgeContent}
      edgeWidth={ACTIVITY_STRIP_WIDTH_PX}
      onEscapeKey={handleEscapeKey}
      aria-label={ariaLabel}
      className={cn("dag-details-panel", className)}
      containerRef={containerRef}
      onDraggingChange={onDraggingChange}
      focusTargetRef={focusTargetRef}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      fillContainer={fillContainer}
    >
      {/* Wrap all content in animation controller for smooth snap transitions */}
      <ContentSlideWrapper
        phase={phase}
        preSnapWidthPct={preSnapWidthPct}
        snapTarget={snapTarget}
        containerRef={effectiveContainerRef}
      >
        {/* Workflow Details (base layer) */}
        {view === "workflow" && workflow && (
          <WorkflowDetails
            workflow={workflow}
            onCancel={onCancelWorkflow}
            onResubmit={onResubmitWorkflow}
            isDetailsExpanded={isDetailsExpanded}
            onToggleDetailsExpanded={onToggleDetailsExpanded}
            selectedTab={selectedWorkflowTab}
            setSelectedTab={setSelectedWorkflowTab}
            allGroups={allGroups}
            selectedGroupName={group?.name ?? null}
            selectedTaskName={task?.name ?? null}
            onSelectGroup={onSelectGroup}
            onSelectTask={onSelectTask}
          />
        )}

        {/* Group Details */}
        {view === "group" && group && (
          <GroupDetails
            group={group}
            allGroups={allGroups}
            workflowName={workflow?.name}
            onSelectTask={onSelectTask}
            onSelectGroup={onSelectGroup}
            onBack={onBackToWorkflow}
            selectedGroupTab={selectedGroupTab}
            setSelectedGroupTab={setSelectedGroupTab}
          />
        )}

        {/* Task Details */}
        {view === "task" && task && group && (
          <TaskDetails
            group={group}
            allGroups={allGroups}
            task={task}
            workflowName={workflow?.name}
            onBackToGroup={onBackToGroup}
            onBackToWorkflow={onBackToWorkflow}
            onSelectTask={onSelectTask}
            onSelectGroup={onSelectGroup}
            onShellTabChange={onShellTabChange}
            selectedTab={selectedTab}
            setSelectedTab={setSelectedTab}
          />
        )}

        {/* Fallback content (loading/error states) - with minimal header */}
        {fallbackContent && (
          <>
            <PanelHeader title={<PanelTitle>{workflow?.name ?? "Workflow Details"}</PanelTitle>} />
            {fallbackContent}
          </>
        )}
      </ContentSlideWrapper>
    </SidePanel>
  );
});
