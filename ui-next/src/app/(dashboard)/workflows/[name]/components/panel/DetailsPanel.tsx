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
 * - Resizable width with drag handle (via ResizablePanel)
 * - Collapsible to edge strip
 * - Breadcrumb navigation between layers
 * - Screen reader announcements
 * - URL-synced navigation for shareable deep links
 *
 * Architecture:
 * - DetailsPanel (container): Composes ResizablePanel, handles view switching
 * - WorkflowDetails (content): Workflow-level info (base layer)
 * - GroupDetails (content): Task list with search, sort, filter
 * - TaskDetails (content): Task info, actions, sibling navigation
 *
 * Keyboard Navigation:
 * - Escape → Collapse panel (URL navigation handles back via browser)
 * - Enter → Expand panel (when collapsed, handled in page.tsx)
 */

"use client";

import { memo, useEffect, useCallback, useMemo } from "react";
import { FileText, BarChart3, Activity } from "lucide-react";
import { ResizablePanel, PanelCollapsedStrip } from "@/components/panel";
import type { WorkflowQueryResponse } from "@/lib/api/generated";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import { cn } from "@/lib/utils";
import { WorkflowDetails } from "./WorkflowDetails";
import { GroupDetails } from "./GroupDetails";
import { TaskDetails } from "./TaskDetails";
import type { DetailsPanelProps } from "../../lib/panel-types";
import { useAnnouncer } from "@/hooks";

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
  mainContent,
}: DetailsPanelProps) {
  const announce = useAnnouncer();

  // Escape key collapses the panel
  // Back navigation is handled via browser back button (URL-synced via nuqs)
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

  // Collapsed content with workflow quick links
  const collapsedContent = onToggleCollapsed ? (
    <PanelCollapsedStrip onExpand={onToggleCollapsed}>
      <WorkflowQuickLinks workflow={workflow} />
    </PanelCollapsedStrip>
  ) : undefined;

  return (
    <ResizablePanel
      open={true}
      onClose={onClose}
      width={panelPct}
      onWidthChange={onPanelResize}
      mainContent={mainContent}
      backdrop={false}
      collapsible
      isCollapsed={isCollapsed}
      onToggleCollapsed={onToggleCollapsed}
      collapsedContent={collapsedContent}
      onEscapeKey={handleEscapeKey}
      aria-label={ariaLabel}
      className="dag-details-panel"
    >
      {/* Workflow Details (base layer) */}
      {view === "workflow" && workflow && (
        <WorkflowDetails
          workflow={workflow}
          onClose={onToggleCollapsed ?? onClose}
          onCancel={onCancelWorkflow}
          onPanelResize={onPanelResize}
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
          onBackToGroup={onBackToGroup}
          onSelectTask={onSelectTask}
          onSelectGroup={onSelectGroup}
          onClose={onToggleCollapsed ?? onClose}
          onPanelResize={onPanelResize}
          isDetailsExpanded={isDetailsExpanded}
          onToggleDetailsExpanded={onToggleDetailsExpanded}
        />
      )}
    </ResizablePanel>
  );
});
