// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * ShellContainer Component
 *
 * Renders all active shell sessions at the DetailsPanel level to persist
 * connections across task/group navigation. Each shell is rendered but
 * hidden unless it's the currently viewed task on the Shell tab.
 *
 * This component subscribes to the shell store and renders a TaskShell
 * for each session that has been connected at least once.
 */

"use client";

import { memo } from "react";
import { useShallow } from "zustand/react/shallow";
import { cn } from "@/lib/utils";
import { useShellStore } from "../../../stores";
import { TaskShell } from "../task/TaskShell";

// =============================================================================
// Types
// =============================================================================

export interface ShellContainerProps {
  /** Workflow name for shell connections */
  workflowName: string;
  /** Currently viewed task name (if any) */
  currentTaskName?: string;
  /** Whether the shell tab is currently active */
  isShellTabActive: boolean;
  /** Called when shell status changes */
  onShellStatusChange?: (taskName: string, status: string) => void;
  /** Called when a shell session ends cleanly */
  onShellSessionEnded?: (taskName: string) => void;
}

// =============================================================================
// Component
// =============================================================================

export const ShellContainer = memo(function ShellContainer({
  workflowName,
  currentTaskName,
  isShellTabActive,
  onShellStatusChange,
  onShellSessionEnded,
}: ShellContainerProps) {
  // Get sessions from store - only render sessions that exist
  const sessions = useShellStore(useShallow((s) => Object.values(s.sessions)));

  // Filter to only sessions that have been interacted with (not just registered)
  // Sessions with status other than "idle" have been connected at some point
  const activeSessions = sessions.filter(
    (s) => s.status === "connecting" || s.status === "connected" || s.status === "disconnected" || s.status === "error",
  );

  if (activeSessions.length === 0) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {activeSessions.map((session) => {
        const isVisible = isShellTabActive && session.taskName === currentTaskName;

        return (
          <div
            key={session.taskName}
            className={cn("absolute inset-0 p-4", isVisible ? "pointer-events-auto" : "pointer-events-none invisible")}
          >
            <TaskShell
              workflowName={workflowName}
              taskName={session.taskName}
              onStatusChange={(status) => onShellStatusChange?.(session.taskName, status)}
              onSessionEnded={() => onShellSessionEnded?.(session.taskName)}
            />
          </div>
        );
      })}
    </div>
  );
});
