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
 * DetailsPanel Component
 *
 * Unified inspector panel for workflow, group, and task details with:
 * - Multi-layer navigation (workflow → group → task)
 * - Resizable width with drag handle (via SidePanel)
 * - Collapsible to edge strip
 * - Breadcrumb navigation between layers
 * - Screen reader announcements
 * - URL-synced navigation for shareable deep links
 *
 * Architecture (Side-by-Side Model):
 * - DetailsPanel wraps SidePanel for resize/collapse functionality
 * - Used as a sibling to the DAG canvas in a flexbox layout
 * - DAG and Panel are completely decoupled
 *
 * Edge Strip:
 * - Always visible on left side of panel (both collapsed and expanded)
 * - Contains: expand/collapse button, workflow tab quick actions, shell sessions
 * - Provides consistent UI and eliminates separate collapsed content
 *
 * Content Views:
 * - WorkflowDetails: Workflow-level info (base layer)
 * - GroupDetails: Task list with search, sort, filter
 * - TaskDetails: Task info, actions, sibling navigation
 *
 * Keyboard Navigation:
 * - Escape → Collapse panel (URL navigation handles back via browser)
 * - Enter → Expand panel (when focused on edge strip button)
 */

"use client";

import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { TextSearch, Info, History, List, FileCode } from "lucide-react";
import type { WorkflowTab } from "../../../hooks/use-navigation-state";
import { useEventCallback } from "usehooks-ts";
import { PanelHeader, PanelTitle } from "@/components/panel/panel-header";
import { SidePanel } from "@/components/panel/side-panel";
import { cn } from "@/lib/utils";
import type { DetailsPanelProps } from "../../../lib/panel-types";
import { useAnnouncer } from "@/hooks/use-announcer";
import { useShellContext } from "../../shell/ShellContext";
import { usePanelResize } from "../../../lib/panel-resize-context";
import { ACTIVITY_STRIP_WIDTH_PX } from "../../../lib/panel-constants";
import { WorkflowEdgeStrip, type QuickAction } from "../workflow/WorkflowEdgeStrip";

// =============================================================================
// Direct Imports - Eager loading for instant panel rendering
// =============================================================================

// Panel views are ALWAYS needed (not optional) - dynamic imports add unnecessary delay.
// Direct imports eliminate 100-300ms skeleton flash at cost of ~30KB route bundle increase.
// Trade-off: Workflow page is PRIMARY feature, instant UX is worth the bundle size.

import { WorkflowDetails } from "../workflow/WorkflowDetails";
import { GroupDetails } from "../group/GroupDetails";
import { TaskDetails } from "../task/TaskDetails";
import { ContentSlideWrapper } from "./ContentSlideWrapper";

// NOTE: We intentionally do NOT use a focus trap here.
// This is a non-modal side panel (role="complementary"), not a dialog.
// Users should be able to Tab freely between the panel and the DAG.
// Focus traps are only appropriate for modal dialogs that block interaction.

// ============================================================================
// Main Component
// ============================================================================

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

  // Announce panel state changes to screen readers
  useEffect(() => {
    if (view === "workflow" && workflow) {
      announce(`Workflow details panel. ${workflow.name}.`);
    } else if (view === "group" && group) {
      const taskCount = group.tasks?.length ?? 0;
      announce(`Group details. ${group.name}, ${taskCount} tasks.`);
    } else if (view === "task" && task) {
      announce(`Task details. ${task.name}.`);
    }
  }, [view, workflow, group, task, announce]);

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

  // Unified edge strip - always visible on left side
  // Contains: DAG toggle, quick actions, shell sessions
  const edgeContent = (
    <WorkflowEdgeStrip
      quickActions={quickActions}
      workflowName={workflow?.name}
      currentTaskId={task?.task_uuid}
      onSelectSession={handleSelectShellSession}
      onDisconnectSession={handleDisconnectSession}
      onReconnectSession={handleReconnectSession}
      onRemoveSession={handleRemoveSession}
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
