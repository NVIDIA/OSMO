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

"use client";

import { memo, useCallback, type MouseEvent } from "react";
import { Network, PanelLeftClose, ArrowRightFromLine, ArrowLeftToLine, type LucideIcon } from "lucide-react";
import { useEventCallback } from "usehooks-ts";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/shadcn/tooltip";
import { cn, isMac } from "@/lib/utils";
import { ShellSessionIcon } from "@/components/shell/components/ShellSessionIcon";
import { VerticalRefreshControl } from "@/components/refresh/VerticalRefreshControl";
import type { RefreshControlProps } from "@/components/refresh/types";
import { useShellSessions } from "@/components/shell/lib/shell-cache";
import { SemiStatefulButton } from "@/components/shadcn/semi-stateful-button";
import {
  usePanelResizeMachine,
  useDisplayDagVisible,
  useIsPanelCollapsed,
} from "@/app/(dashboard)/workflows/[name]/lib/panel-resize-context";

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
  refreshControl?: RefreshControlProps;
}

export const WorkflowEdgeStrip = memo(function WorkflowEdgeStrip({
  quickActions,
  workflowName,
  currentTaskId,
  onSelectSession,
  onDisconnectSession,
  onReconnectSession,
  onRemoveSession,
  refreshControl,
}: WorkflowEdgeStripProps) {
  const allSessions = useShellSessions();

  const dagVisible = useDisplayDagVisible();
  const isCollapsed = useIsPanelCollapsed();
  const machine = usePanelResizeMachine();

  const showDAG = useCallback(() => machine.showDAG(), [machine]);
  const hideDAG = useCallback(() => machine.hideDAG(), [machine]);
  const expand = useCallback(() => machine.expand(), [machine]);
  const toggleCollapsed = useCallback(() => machine.toggleCollapsed(), [machine]);

  const handleToggleDAG = useEventCallback(() => {
    if (dagVisible) {
      hideDAG();
    } else {
      showDAG();
    }
  });

  const handleTogglePanel = useEventCallback(() => {
    toggleCollapsed();
  });

  const sessions = workflowName ? allSessions.filter((s) => s.workflowName === workflowName) : allSessions;

  const handleSessionClick = useEventCallback((e: MouseEvent<HTMLButtonElement>) => {
    const taskId = e.currentTarget.dataset.taskId;
    if (taskId) {
      if (isCollapsed) {
        expand();
      }
      onSelectSession?.(taskId);
    }
  });

  const handleSelect = useEventCallback((taskId: string) => {
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
      <div className="flex h-full flex-col items-center justify-between py-3">
        <div className="flex flex-col items-center">
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

        <div className="flex flex-col items-center space-y-1">
          {refreshControl && (
            <div
              className="my-3 h-px w-5 bg-zinc-200 dark:bg-zinc-700"
              aria-hidden="true"
            />
          )}

          {refreshControl && (
            <VerticalRefreshControl
              onRefresh={refreshControl.onRefresh}
              isRefreshing={refreshControl.isRefreshing}
              interval={refreshControl.interval}
              setInterval={refreshControl.setInterval}
            />
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleTogglePanel}
                className={cn(
                  "flex size-8 items-center justify-center rounded-lg",
                  "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700",
                  "dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200",
                  "transition-colors",
                )}
                aria-label={isCollapsed ? "Details panel is hidden" : "Currently showing details panel"}
              >
                {isCollapsed ? (
                  <ArrowLeftToLine
                    className="size-4"
                    aria-hidden="true"
                  />
                ) : (
                  <ArrowRightFromLine
                    className="size-4"
                    aria-hidden="true"
                  />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">
              {isCollapsed ? `Show Details (${isMac ? "⌘I" : "Ctrl+I"})` : `Hide Details (${isMac ? "⌘I" : "Ctrl+I"})`}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  );
});
