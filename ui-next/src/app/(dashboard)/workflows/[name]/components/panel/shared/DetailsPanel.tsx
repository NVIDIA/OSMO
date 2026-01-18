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
import { FileText, Info, History, ArrowLeftFromLine, ArrowRightFromLine, type LucideIcon } from "lucide-react";
import type { WorkflowTab } from "../../../hooks/use-navigation-state";
import { useEventCallback } from "usehooks-ts";
import { SidePanel, PanelHeader, PanelTitle } from "@/components/panel";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/shadcn/tooltip";
import { cn, formatHotkey } from "@/lib/utils";
import { WorkflowDetails } from "../workflow/WorkflowDetails";
import { GroupDetails } from "../group/GroupDetails";
import { TaskDetails } from "../task/TaskDetails";
import type { DetailsPanelProps } from "../../../lib/panel-types";
import { useAnnouncer } from "@/hooks";
import { ShellSessionIcon, reconnectSession, useShellSessions } from "@/components/shell";
import { useShellContext } from "../../shell";

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
  isCollapsed?: boolean;
  onToggleCollapsed?: () => void;
  /** Keyboard shortcut for toggle (e.g., "mod+]") - displayed in tooltip */
  toggleHotkey?: string;
  /** Generic quick actions to display */
  quickActions?: QuickAction[];
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
  isCollapsed,
  onToggleCollapsed,
  toggleHotkey,
  quickActions,
  currentTaskId,
  onSelectSession,
  onDisconnectSession,
  onReconnectSession,
  onRemoveSession,
}: WorkflowEdgeStripProps) {
  const { sessions } = useShellSessions();

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

  // Handle keyboard navigation: Enter toggles the panel
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        onToggleCollapsed?.();
      }
    },
    [onToggleCollapsed],
  );

  const hasQuickActions = quickActions && quickActions.length > 0;
  const hasShellSessions = sessions.length > 0;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full flex-col items-center py-3">
        {/* Expand/Collapse button */}
        {onToggleCollapsed && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onToggleCollapsed}
                onKeyDown={handleKeyDown}
                className={cn(
                  "flex size-8 items-center justify-center rounded-lg",
                  "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
                  "dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
                  "transition-colors",
                  "focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2",
                  "focus-visible:ring-offset-white dark:focus-visible:ring-offset-zinc-900",
                  "focus-visible:outline-none",
                  "focus-visible:bg-zinc-100 dark:focus-visible:bg-zinc-800",
                )}
                aria-label={isCollapsed ? "Expand panel (Enter)" : "Collapse panel (Enter)"}
              >
                {isCollapsed ? (
                  <ArrowLeftFromLine
                    className="size-4 shrink-0"
                    aria-hidden="true"
                  />
                ) : (
                  <ArrowRightFromLine
                    className="size-4 shrink-0"
                    aria-hidden="true"
                  />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="left"
              className="flex items-center gap-2"
            >
              <span>{isCollapsed ? "Expand panel" : "Collapse panel"}</span>
              {toggleHotkey && (
                <kbd className="rounded border border-zinc-600 bg-zinc-700 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
                  {formatHotkey(toggleHotkey)}
                </kbd>
              )}
            </TooltipContent>
          </Tooltip>
        )}

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
            {sessions.map((session) => (
              <ShellSessionIcon
                key={session.taskId}
                session={session}
                isActive={session.taskId === currentTaskId}
                onClick={handleSessionClick}
                onSelect={() => handleSelect(session.taskId)}
                onDisconnect={() => handleDisconnect(session.taskId)}
                onReconnect={() => handleReconnect(session.taskId)}
                onRemove={() => handleRemove(session.taskId)}
                data-task-id={session.taskId}
              />
            ))}
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
  fallbackContent,
  containerRef,
  onDraggingChange,
  onShellTabChange,
  selectedTab,
  setSelectedTab,
  selectedWorkflowTab,
  setSelectedWorkflowTab,
}: DetailsPanelProps) {
  const announce = useAnnouncer();
  const { disconnectOnly, removeShell } = useShellContext();

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
      // Trigger reconnection directly through the session cache
      reconnectSession(taskId);
      // Expand panel and go to shell tab
      handleSelectShellSession(taskId);
    },
    [handleSelectShellSession],
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
    if (view !== "workflow" && onBackToWorkflow) {
      onBackToWorkflow();
    }
    // Set the workflow tab
    setSelectedWorkflowTab?.(tab);
  });

  // Build quick actions for the edge strip
  const quickActions: QuickAction[] = useMemo(() => {
    if (!workflow) return [];
    return [
      { id: "overview", icon: Info, label: "Workflow Overview", onClick: () => navigateToWorkflowTab("overview") },
      { id: "logs", icon: FileText, label: "Workflow Logs", onClick: () => navigateToWorkflowTab("logs") },
      { id: "events", icon: History, label: "Workflow Events", onClick: () => navigateToWorkflowTab("events") },
    ];
  }, [workflow, navigateToWorkflowTab]);

  // Unified edge strip - always visible on left side
  // Contains: expand/collapse button, quick actions, shell sessions
  const edgeContent = (
    <WorkflowEdgeStrip
      isCollapsed={isCollapsed}
      onToggleCollapsed={onToggleCollapsed}
      toggleHotkey={toggleHotkey}
      quickActions={quickActions}
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
      isCollapsed={isCollapsed}
      onToggleCollapsed={onToggleCollapsed}
      toggleHotkey={toggleHotkey}
      edgeContent={edgeContent}
      onEscapeKey={handleEscapeKey}
      aria-label={ariaLabel}
      className="dag-details-panel"
      containerRef={containerRef}
      onDraggingChange={onDraggingChange}
      focusTargetRef={focusTargetRef}
    >
      {/* Workflow Details (base layer) */}
      {view === "workflow" && workflow && (
        <WorkflowDetails
          workflow={workflow}
          onCancel={onCancelWorkflow}
          onPanelResize={onPanelResize}
          isDetailsExpanded={isDetailsExpanded}
          onToggleDetailsExpanded={onToggleDetailsExpanded}
          selectedTab={selectedWorkflowTab}
          setSelectedTab={setSelectedWorkflowTab}
        />
      )}

      {/* Group Details */}
      {view === "group" && group && (
        <GroupDetails
          group={group}
          allGroups={allGroups}
          onSelectTask={onSelectTask}
          onSelectGroup={onSelectGroup}
          onBack={onBackToWorkflow}
          onPanelResize={onPanelResize}
          isDetailsExpanded={isDetailsExpanded}
          onToggleDetailsExpanded={onToggleDetailsExpanded}
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
          onPanelResize={onPanelResize}
          isDetailsExpanded={isDetailsExpanded}
          onToggleDetailsExpanded={onToggleDetailsExpanded}
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
