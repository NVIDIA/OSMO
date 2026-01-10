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
 * - Resizable width with drag handle
 * - Collapsible to edge strip
 * - Breadcrumb navigation between layers
 * - Screen reader announcements
 *
 * Architecture:
 * - DetailsPanel (container): Resize handle, width management, view switching, collapsed state
 * - WorkflowDetails (content): Workflow-level info (base layer)
 * - GroupDetails (content): Task list with search, sort, filter
 * - TaskDetails (content): Task info, actions, sibling navigation
 */

"use client";

import { memo, useRef, useEffect, useCallback } from "react";
import { GripVertical, ArrowLeftFromLine, ArrowRightToLine, FileText, BarChart3, Activity } from "lucide-react";
import type { WorkflowQueryResponse } from "@/lib/api/generated";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import { cn } from "@/lib/utils";
import { WorkflowDetails } from "./WorkflowDetails";
import { GroupDetails } from "./GroupDetails";
import { TaskDetails } from "./TaskDetails";
import type { DetailsPanelProps } from "../../lib/panel-types";
import { useAnnouncer } from "@/hooks";
import { getStatusIcon } from "../../lib/status";

// NOTE: We intentionally do NOT use a focus trap here.
// This is a non-modal side panel (role="complementary"), not a dialog.
// Users should be able to Tab freely between the panel and the DAG.
// Focus traps are only appropriate for modal dialogs that block interaction.

// ============================================================================
// Collapsed Edge Strip
// ============================================================================

interface CollapsedStripProps {
  workflow?: WorkflowQueryResponse;
  onExpand: () => void;
}

const CollapsedStrip = memo(function CollapsedStrip({ workflow, onExpand }: CollapsedStripProps) {
  // Build quick action links
  const quickLinks = workflow
    ? [
        { id: "logs", url: workflow.logs, icon: FileText, label: "Logs" },
        { id: "dashboard", url: workflow.dashboard_url, icon: BarChart3, label: "Dashboard" },
        { id: "grafana", url: workflow.grafana_url, icon: Activity, label: "Grafana" },
      ].filter((link) => link.url)
    : [];

  return (
    <div className="relative flex h-full w-full flex-col items-center py-3">
      {/* Status icon at top - tooltip shows status text */}
      {workflow && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onExpand}
              className="shrink-0 rounded p-1 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              {getStatusIcon(workflow.status, "size-5")}
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">{workflow.status}</TooltipContent>
        </Tooltip>
      )}

      {/* Separator */}
      {quickLinks.length > 0 && <div className="my-3 h-px w-5 bg-zinc-200 dark:bg-zinc-700" />}

      {/* Quick action links - space-y-1 matches left nav */}
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

      {/* Spacer */}
      <div className="flex-1" />

      {/* Expand button at bottom */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onExpand}
            className={cn(
              "flex size-8 items-center justify-center rounded-lg",
              "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
              "dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
              "transition-all duration-200 ease-out",
            )}
          >
            <ArrowLeftFromLine
              className="size-4 shrink-0"
              aria-hidden="true"
            />
          </button>
        </TooltipTrigger>
        <TooltipContent side="left">Expand details</TooltipContent>
      </Tooltip>
    </div>
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
  isDragging,
  bindResizeHandle,
  isDetailsExpanded,
  onToggleDetailsExpanded,
  isCollapsed,
  onToggleCollapsed,
  onCancelWorkflow,
}: DetailsPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const announce = useAnnouncer();

  // Handle Escape key - navigate back or close
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        const target = e.target as HTMLElement;
        const isInDropdown = target.closest("[data-radix-popper-content-wrapper]");
        if (!isInDropdown) {
          // Navigate back through layers: task → group → workflow → collapse
          if (view === "task") {
            onBackToGroup();
          } else if (view === "group") {
            onBackToWorkflow();
          } else if (onToggleCollapsed) {
            onToggleCollapsed();
          }
        }
      }
    },
    [view, onBackToGroup, onBackToWorkflow, onToggleCollapsed],
  );

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

  // Calculate panel width - animate between collapsed (40px) and expanded
  const panelWidth = isCollapsed ? "40px" : `${panelPct}%`;

  return (
    <>
      {/* Resize Handle - when expanded, positioned dynamically based on panel width */}
      {!isCollapsed && (
        <div
          className={cn(
            "group absolute top-0 z-20 h-full w-0.5 cursor-ew-resize",
            isDragging ? "bg-blue-500" : "bg-transparent hover:bg-gray-300 dark:hover:bg-zinc-600",
          )}
          {...bindResizeHandle()}
          style={{
            left: `${100 - panelPct}%`,
            transform: "translateX(-50%)",
            willChange: isDragging ? "left" : "auto",
          }}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panel"
          aria-valuenow={panelPct}
          aria-valuemin={20}
          aria-valuemax={80}
        >
          <div
            className={cn(
              "dag-details-panel-handle absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded bg-gray-200 px-0.5 py-1 shadow transition-opacity duration-150 dark:bg-zinc-700",
              isDragging ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            )}
            aria-hidden="true"
          >
            <GripVertical className="size-3.5 text-gray-500 dark:text-zinc-400" />
          </div>
        </div>
      )}

      {/* Panel Container - animates width like left nav (disabled during drag) */}
      <aside
        ref={panelRef}
        className={cn(
          "dag-details-panel absolute inset-y-0 right-0 z-10 flex flex-col overflow-hidden border-l border-gray-200 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95",
          // Only animate when not dragging - prevents lag during manual resize
          !isDragging && "transition-all duration-200 ease-out",
        )}
        style={{ width: panelWidth }}
        role="complementary"
        aria-label={ariaLabel}
        onKeyDown={handleKeyDown}
      >
        {/* Collapsed content - always rendered but hidden when expanded */}
        <div
          className={cn(
            "absolute inset-0 transition-opacity duration-200 ease-out",
            isCollapsed ? "opacity-100" : "pointer-events-none opacity-0",
          )}
        >
          <CollapsedStrip
            workflow={workflow}
            onExpand={onToggleCollapsed!}
          />
        </div>

        {/* Expanded content - always rendered but hidden when collapsed */}
        <div
          className={cn(
            "relative flex h-full flex-col transition-opacity duration-200 ease-out",
            isCollapsed ? "pointer-events-none opacity-0" : "opacity-100",
          )}
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

          {/* Shared Collapse Button - appears at bottom-left corner */}
          {onToggleCollapsed && (
            <button
              onClick={onToggleCollapsed}
              className="absolute bottom-3 left-3 z-20 flex h-8 items-center gap-2 rounded-lg bg-white/90 px-2 text-sm font-medium text-zinc-600 shadow-sm ring-1 ring-gray-200 backdrop-blur transition-all duration-200 ease-out hover:bg-zinc-100 hover:text-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:bg-zinc-900/90 dark:text-zinc-400 dark:ring-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              aria-label="Collapse panel"
            >
              <ArrowRightToLine
                className="size-4 shrink-0"
                aria-hidden="true"
              />
              <span>Collapse</span>
            </button>
          )}
        </div>
      </aside>
    </>
  );
});
