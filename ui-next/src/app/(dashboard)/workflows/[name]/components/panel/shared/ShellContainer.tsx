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
 * Renders all shell sessions at the DetailsPanel level to persist
 * connections across task/group navigation. Each shell is rendered but
 * hidden unless it's the currently viewed task on the Shell tab.
 *
 * Flow:
 * 1. User clicks "Connect" in TaskDetails → openSession() creates session in store
 * 2. ShellContainer picks up the session and renders TaskShell
 * 3. TaskShell auto-connects and updates store status via callbacks
 * 4. Sessions persist across navigation until user closes or session ends
 */

"use client";

import { memo, useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { cn } from "@/lib/utils";
import { useShellStore } from "../../../stores";
import { TaskShell } from "../task/TaskShell";
import type { ConnectionStatusType } from "@/components/shell";

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
}

// =============================================================================
// Component
// =============================================================================

export const ShellContainer = memo(function ShellContainer({
  workflowName,
  currentTaskName,
  isShellTabActive,
}: ShellContainerProps) {
  // Get sessions and store actions
  const sessions = useShellStore(useShallow((s) => Object.values(s.sessions)));
  const updateStatus = useShellStore((s) => s.updateStatus);
  const closeSession = useShellStore((s) => s.closeSession);

  // Handle status changes from TaskShell - update the store
  const handleStatusChange = useCallback(
    (taskName: string, status: ConnectionStatusType) => {
      updateStatus(taskName, status);
    },
    [updateStatus],
  );

  // Handle session ended - remove from store
  const handleSessionEnded = useCallback(
    (taskName: string) => {
      closeSession(taskName);
    },
    [closeSession],
  );

  // Render all registered sessions (sessions are created when user clicks "Connect")
  if (sessions.length === 0) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {sessions.map((session) => {
        const isVisible = isShellTabActive && session.taskName === currentTaskName;

        return (
          <div
            key={session.taskName}
            className={cn("absolute inset-0 p-4", isVisible ? "pointer-events-auto" : "pointer-events-none invisible")}
          >
            <TaskShell
              workflowName={workflowName}
              taskName={session.taskName}
              shell={session.shell}
              onStatusChange={(status) => handleStatusChange(session.taskName, status)}
              onSessionEnded={() => handleSessionEnded(session.taskName)}
            />
          </div>
        );
      })}
    </div>
  );
});
