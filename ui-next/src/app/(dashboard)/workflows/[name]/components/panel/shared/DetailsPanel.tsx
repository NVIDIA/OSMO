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
 * Content Views:
 * - WorkflowDetails: Workflow-level info (base layer)
 * - GroupDetails: Task list with search, sort, filter
 * - TaskDetails: Task info, actions, sibling navigation
 *
 * Keyboard Navigation:
 * - Escape → Collapse panel (URL navigation handles back via browser)
 * - Enter → Expand panel (when focused on collapsed strip)
 */

"use client";

import { memo, useEffect, useCallback, useMemo } from "react";
import { FileText, BarChart3, Activity } from "lucide-react";
import { SidePanel, PanelCollapsedStrip, PanelHeader, PanelCollapseButton, PanelTitle } from "@/components/panel";
import type { WorkflowQueryResponse } from "@/lib/api/generated";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import { cn } from "@/lib/utils";
import { WorkflowDetails } from "../workflow/WorkflowDetails";
import { GroupDetails } from "../group/GroupDetails";
import { TaskDetails } from "../task/TaskDetails";
import type { DetailsPanelProps } from "../../../lib/panel-types";
import { useAnnouncer } from "@/hooks";
import { ShellActivityStrip, useShellNavigationGuard } from "@/components/terminal";

// NOTE: We intentionally do NOT use a focus trap here.
// This is a non-modal side panel (role="complementary"), not a dialog.
// Users should be able to Tab freely between the panel and the DAG.
// Focus traps are only appropriate for modal dialogs that block interaction.

// ============================================================================
// Workflow Quick Links (domain-specific collapsed content)
// ============================================================================

interface WorkflowQuickLinksProps {
  workflow?: WorkflowQueryResponse;
}

/**
 * Quick action links shown in the collapsed strip.
 * This is workflow-specific content that uses PanelCollapsedStrip's slot.
 */
const WorkflowQuickLinks = memo(function WorkflowQuickLinks({ workflow }: WorkflowQuickLinksProps) {
  const quickLinks = useMemo(() => {
    if (!workflow) return [];
    return [
      { id: "logs", url: workflow.logs, icon: FileText, label: "Logs" },
      { id: "dashboard", url: workflow.dashboard_url, icon: BarChart3, label: "Dashboard" },
      { id: "grafana", url: workflow.grafana_url, icon: Activity, label: "Grafana" },
    ].filter((link) => link.url);
  }, [workflow]);

  if (quickLinks.length === 0) return null;

  return (
    <>
      {/* Separator */}
      <div className="my-3 h-px w-5 bg-zinc-200 dark:bg-zinc-700" />

      {/* Quick action links */}
      <div className="flex flex-col items-center space-y-1">
        {quickLinks.map((link) => {
          const Icon = link.icon;
          return (
            <Tooltip key={link.id}>
              <TooltipTrigger asChild>
                <a
                  href={link.url!}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
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
                </a>
              </TooltipTrigger>
              <TooltipContent side="left">{link.label}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </>
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
  onClose,
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
  onCancelWorkflow,
  fallbackContent,
  containerRef,
  onDraggingChange,
}: DetailsPanelProps) {
  const announce = useAnnouncer();

  // Warn before page unload when shell sessions are active
  useShellNavigationGuard();

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

  // Handle selecting a shell session from activity strip
  const handleSelectShellSession = useCallback(
    (taskName: string) => {
      // Expand the panel if collapsed
      if (isCollapsed && onToggleCollapsed) {
        onToggleCollapsed();
      }
      // If there's a task selection handler and we have groups, select the task
      if (onSelectTask && allGroups) {
        // Find the group containing this task
        for (const g of allGroups) {
          const foundTask = g.tasks?.find((t) => t.name === taskName);
          if (foundTask) {
            onSelectTask(foundTask, g);
            break;
          }
        }
      }
    },
    [isCollapsed, onToggleCollapsed, onSelectTask, allGroups],
  );

  // Collapsed content with workflow quick links and shell activity strip
  // Focus management is handled by SidePanel via onTransitionEnd
  const collapsedContent = onToggleCollapsed ? (
    <PanelCollapsedStrip onExpand={onToggleCollapsed}>
      <WorkflowQuickLinks workflow={workflow} />
      <ShellActivityStrip
        currentTaskName={task?.name}
        onSelectSession={handleSelectShellSession}
      />
    </PanelCollapsedStrip>
  ) : undefined;

  return (
    <SidePanel
      width={panelPct}
      onWidthChange={onPanelResize}
      isCollapsed={isCollapsed}
      onToggleCollapsed={onToggleCollapsed}
      collapsedContent={collapsedContent}
      onEscapeKey={handleEscapeKey}
      aria-label={ariaLabel}
      className="dag-details-panel"
      containerRef={containerRef}
      onDraggingChange={onDraggingChange}
    >
      {/* Workflow Details (base layer) */}
      {view === "workflow" && workflow && (
        <WorkflowDetails
          workflow={workflow}
          onClose={onToggleCollapsed ?? onClose}
          onCancel={onCancelWorkflow}
          onPanelResize={onPanelResize}
          isDetailsExpanded={isDetailsExpanded}
          onToggleDetailsExpanded={onToggleDetailsExpanded}
        />
      )}

      {/* Group Details */}
      {view === "group" && group && (
        <GroupDetails
          group={group}
          allGroups={allGroups}
          onSelectTask={onSelectTask}
          onSelectGroup={onSelectGroup}
          onClose={onToggleCollapsed ?? onClose}
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
          onClose={onToggleCollapsed ?? onClose}
          onPanelResize={onPanelResize}
          isDetailsExpanded={isDetailsExpanded}
          onToggleDetailsExpanded={onToggleDetailsExpanded}
        />
      )}

      {/* Fallback content (loading/error states) - with minimal header for collapse */}
      {fallbackContent && (
        <>
          <PanelHeader
            title={<PanelTitle>{workflow?.name ?? "Workflow Details"}</PanelTitle>}
            actions={<PanelCollapseButton onCollapse={onToggleCollapsed ?? onClose} />}
          />
          {fallbackContent}
        </>
      )}
    </SidePanel>
  );
});
