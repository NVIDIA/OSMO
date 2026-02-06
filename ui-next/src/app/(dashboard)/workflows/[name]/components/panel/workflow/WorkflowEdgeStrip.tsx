//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at
//
//http://www.apache.org/licenses/LICENSE-2.0
//
//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.
//
//SPDX-License-Identifier: Apache-2.0

/**
 * WorkflowEdgeStrip Component
 *
 * Unified edge strip that's always visible on the left side of the panel.
 * Contains: expand/collapse button, quick actions, shell session icons.
 * Same appearance whether panel is collapsed or expanded - provides consistency.
 */

"use client";

import { memo, useCallback, type MouseEvent } from "react";
import { Network, PanelLeftClose, type LucideIcon } from "lucide-react";
import { useEventCallback } from "usehooks-ts";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/shadcn/tooltip";
import { cn } from "@/lib/utils";
import { ShellSessionIcon } from "@/components/shell/components/ShellSessionIcon";
import { useShellSessions } from "@/components/shell/lib/shell-cache";
import { SemiStatefulButton } from "@/components/shadcn/semi-stateful-button";
import { usePanelResizeMachine, useDisplayDagVisible, useIsPanelCollapsed } from "../../../lib/panel-resize-context";

// =============================================================================
// Types
// =============================================================================

/** Generic quick action for the edge strip */
export interface QuickAction {
  id: string;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}

export interface WorkflowEdgeStripProps {
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

// =============================================================================
// Component
// =============================================================================

export const WorkflowEdgeStrip = memo(function WorkflowEdgeStrip({
  quickActions,
  workflowName,
  currentTaskId,
  onSelectSession,
  onDisconnectSession,
  onReconnectSession,
  onRemoveSession,
}: WorkflowEdgeStripProps) {
  const allSessions = useShellSessions();

  // DAG visibility toggle state - use granular selectors for optimal performance
  // Only re-renders when these specific values change, not on all state machine updates
  const dagVisible = useDisplayDagVisible();
  const isCollapsed = useIsPanelCollapsed();
  const machine = usePanelResizeMachine();

  // Actions accessed via machine instance (stable references)
  const showDAG = useCallback(() => machine.showDAG(), [machine]);
  const hideDAG = useCallback(() => machine.hideDAG(), [machine]);
  const expand = useCallback(() => machine.expand(), [machine]);

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
      // isCollapsed is derived from widthPct, so this covers both cases:
      // - User clicked collapse button
      // - User dragged to strip width
      if (isCollapsed) {
        expand();
      }
      onSelectSession?.(taskId);
    }
  });

  const handleSelect = useEventCallback((taskId: string) => {
    // isCollapsed is derived from widthPct - unified check
    if (isCollapsed) {
      expand();
    }
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
                const handleClick = () => {
                  // isCollapsed is derived from widthPct - unified check
                  if (isCollapsed) {
                    expand();
                  }
                  action.onClick();
                };
                return (
                  <Tooltip key={action.id}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={handleClick}
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
