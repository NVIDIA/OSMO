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

import { memo, useCallback, useEffect, useMemo, useRef, type MouseEvent } from "react";
import { TextSearch, Info, History, Network, PanelLeftClose, List, FileCode, type LucideIcon } from "lucide-react";
import type { WorkflowTab } from "../../../hooks/use-navigation-state";
import { useEventCallback } from "usehooks-ts";
import { SidePanel, PanelHeader, PanelTitle } from "@/components/panel";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/shadcn/tooltip";
import { cn } from "@/lib/utils";
import type { DetailsPanelProps } from "../../../lib/panel-types";
import { useAnnouncer } from "@/hooks";
import { ShellSessionIcon, useShellSessions } from "@/components/shell";
import { useShellContext } from "../../shell";
import { useDagVisible } from "@/stores";
import { SemiStatefulButton } from "@/components/shadcn/semi-stateful-button";
import { usePanelResize } from "../../../lib/panel-resize-context";

// =============================================================================
// Direct Imports - Eager loading for instant panel rendering
// =============================================================================

// Panel views are ALWAYS needed (not optional) - dynamic imports add unnecessary delay.
// Direct imports eliminate 100-300ms skeleton flash at cost of ~30KB route bundle increase.
// Trade-off: Workflow page is PRIMARY feature, instant UX is worth the bundle size.

import { WorkflowDetails } from "../workflow/WorkflowDetails";
import { GroupDetails } from "../group/GroupDetails";
import { TaskDetails } from "../task/TaskDetails";

// NOTE: We intentionally do NOT use a focus trap here.
// This is a non-modal side panel (role="complementary"), not a dialog.
// Users should be able to Tab freely between the panel and the DAG.
// Focus traps are only appropriate for modal dialogs that block interaction.

// ============================================================================
// Workflow Edge Strip - Unified strip with expand, links, and shells
// ============================================================================

/** Generic quick action for the edge strip */
interface QuickAction {
  id: string;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}

interface WorkflowEdgeStripProps {
  /** Generic quick actions to display */
  quickActions?: QuickAction[];
  /** Current workflow name - used to filter sessions */
  workflowName?: string;
  currentTaskId?: string;
  onSelectSession?: (taskId: string) => void;
  onDisconnectSession?: (taskId: string) => void;
  onReconnectSession?: (taskId: string) => void;
  onRemoveSession?: (taskId: string) => void;
}

/**
 * Unified edge strip that's always visible on the left side of the panel.
 * Contains: expand/collapse button, quick actions, shell session icons.
 * Same appearance whether panel is collapsed or expanded - provides consistency.
 */
const WorkflowEdgeStrip = memo(function WorkflowEdgeStrip({
  quickActions,
  workflowName,
  currentTaskId,
  onSelectSession,
  onDisconnectSession,
  onReconnectSession,
  onRemoveSession,
}: WorkflowEdgeStripProps) {
  const allSessions = useShellSessions();

  // DAG visibility toggle state
  const dagVisible = useDagVisible();
  const { showDAG, hideDAG } = usePanelResize();

  const handleToggleDAG = useEventCallback(() => {
    if (dagVisible) {
      hideDAG();
    } else {
      showDAG();
    }
  });

  // Filter sessions to only show those belonging to this workflow
  const sessions = workflowName ? allSessions.filter((s) => s.workflowName === workflowName) : allSessions;

  // Shell session handlers - stable callbacks using data attributes
  const handleSessionClick = useEventCallback((e: MouseEvent<HTMLButtonElement>) => {
    const taskId = e.currentTarget.dataset.taskId;
    if (taskId) {
      onSelectSession?.(taskId);
    }
  });

  const handleSelect = useEventCallback((taskId: string) => {
    onSelectSession?.(taskId);
  });

  const handleDisconnect = useEventCallback((taskId: string) => {
    onDisconnectSession?.(taskId);
  });

  const handleReconnect = useEventCallback((taskId: string) => {
    onReconnectSession?.(taskId);
  });

  const handleRemove = useEventCallback((taskId: string) => {
    onRemoveSession?.(taskId);
  });

  const hasQuickActions = quickActions && quickActions.length > 0;
  const hasShellSessions = sessions.length > 0;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full flex-col items-center py-3">
        {/* DAG Visibility Toggle */}
        <SemiStatefulButton
          onClick={handleToggleDAG}
          currentStateIcon={dagVisible ? <Network className="size-4" /> : <PanelLeftClose className="size-4" />}
          nextStateIcon={dagVisible ? <PanelLeftClose className="size-4" /> : <Network className="size-4" />}
          label={dagVisible ? "Hide DAG" : "Show DAG"}
          aria-label={dagVisible ? "Currently showing DAG view" : "DAG view is hidden"}
          tooltipSide="left"
          variant="ghost"
          size="icon-sm"
          className={cn(
            "rounded-lg border-0 bg-transparent shadow-none",
            "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700",
            "dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200",
            "focus-visible:ring-0 focus-visible:ring-offset-0",
          )}
        />

        {/* Quick actions */}
        {hasQuickActions && (
          <>
            <div
              className="my-3 h-px w-5 bg-zinc-200 dark:bg-zinc-700"
              aria-hidden="true"
            />
            <div className="flex flex-col items-center space-y-1">
              {quickActions.map((action) => {
                const Icon = action.icon;
                return (
                  <Tooltip key={action.id}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={action.onClick}
                        className={cn(
                          "flex size-8 items-center justify-center rounded-lg",
                          "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700",
                          "dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200",
                          "transition-colors",
                        )}
                      >
                        <Icon
                          className="size-4"
                          aria-hidden="true"
                        />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="left">{action.label}</TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          </>
        )}

        {/* Shell session icons */}
        {hasShellSessions && (
          <>
            <div
              className="my-3 h-px w-5 bg-zinc-200 dark:bg-zinc-700"
              aria-hidden="true"
            />
            <div className="flex flex-col items-center space-y-1">
              {sessions.map((session) => (
                <ShellSessionIcon
                  key={session.key}
                  session={session}
                  isActive={session.key === currentTaskId}
                  onClick={handleSessionClick}
                  onSelect={() => handleSelect(session.key)}
                  onDisconnect={() => handleDisconnect(session.key)}
                  onReconnect={() => handleReconnect(session.key)}
                  onRemove={() => handleRemove(session.key)}
                  data-task-id={session.key}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </TooltipProvider>
  );
});

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
  maxWidth,
  className,
  onDragStart,
  onDragEnd,
  fillContainer,
}: DetailsPanelProps) {
  const announce = useAnnouncer();
  const { disconnectOnly, removeShell, reconnectShell } = useShellContext();

  // Ref to override focus behavior when panel expands.
  // - undefined: use default (focus first focusable)
  // - null: skip focus (shell will handle its own focus)
  // - HTMLElement: focus that element
  const focusTargetRef = useRef<HTMLElement | null | undefined>(undefined);

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
      maxWidth={maxWidth}
      isCollapsed={isCollapsed}
      onToggleCollapsed={onToggleCollapsed}
      toggleHotkey={toggleHotkey}
      edgeContent={edgeContent}
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
    </SidePanel>
  );
});
