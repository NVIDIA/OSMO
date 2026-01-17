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
 * Renders all shell sessions at the workflow level to persist
 * connections across task/group navigation. Uses a portal to render
 * into the correct position within TaskDetails' shell tab content area.
 *
 * Flow:
 * 1. User clicks "Connect" in TaskDetails → ShellContext.connectShell() adds to activeShells
 * 2. ShellContainer sees activeShells → renders TaskShell for each
 * 3. TaskShell mounts → useShell creates session in cache (with terminal)
 * 4. TaskDetails registers portal target via ShellPortalContext when shell tab active
 * 5. ShellContainer portals into the target
 * 6. Sessions persist across navigation until user closes or session ends
 */

"use client";

import { memo, useCallback } from "react";
import { createPortal } from "react-dom";
import { TaskShell } from "../panel/task/TaskShell";
import { useShellPortal } from "./ShellPortalContext";
import { useShellContext } from "./ShellContext";
import { updateSessionStatus, type ConnectionStatusType } from "@/components/shell";

// =============================================================================
// Types
// =============================================================================

export interface ShellContainerProps {
  /** Workflow name for shell connections */
  workflowName: string;
  /** Currently viewed task ID (UUID) */
  currentTaskId?: string;
  /** Whether the shell tab is currently active */
  isShellTabActive: boolean;
}

// =============================================================================
// Component
// =============================================================================

export const ShellContainer = memo(function ShellContainer({
  workflowName,
  currentTaskId,
  isShellTabActive,
}: ShellContainerProps) {
  // Get active shells from context (what to render)
  const { activeShells, disconnectShell } = useShellContext();

  // Get the portal target from context
  const { portalTarget } = useShellPortal();

  // Handle status changes from TaskShell - update the session cache
  const handleStatusChange = useCallback((taskId: string, status: ConnectionStatusType) => {
    updateSessionStatus(taskId, status);
  }, []);

  // Handle session ended - disconnect via context (removes from activeShells + disposes session)
  const handleSessionEnded = useCallback(
    (taskId: string) => {
      disconnectShell(taskId);
    },
    [disconnectShell],
  );

  // Don't render if no active shells
  if (activeShells.length === 0) {
    return null;
  }

  // Determine which shell is visible (if any)
  // A shell is visible when: shell tab is active + portal target exists + shell matches current task
  const visibleShell =
    isShellTabActive && portalTarget ? activeShells.find((shell) => shell.taskId === currentTaskId) : undefined;

  // All other shells are hidden but stay mounted to preserve terminal instances
  const hiddenShells = activeShells.filter((shell) => shell !== visibleShell);

  return (
    <>
      {/* Visible shell - portaled into TaskDetails shell tab area */}
      {visibleShell &&
        portalTarget &&
        createPortal(
          <div className="h-full w-full p-4">
            <TaskShell
              taskId={visibleShell.taskId}
              workflowName={workflowName}
              taskName={visibleShell.taskName}
              shell={visibleShell.shell}
              onStatusChange={(status) => handleStatusChange(visibleShell.taskId, status)}
              onSessionEnded={() => handleSessionEnded(visibleShell.taskId)}
            />
          </div>,
          portalTarget,
        )}

      {/* Hidden shells - stay mounted in invisible container to preserve terminal instances */}
      {hiddenShells.length > 0 && (
        <div className="pointer-events-none invisible absolute -left-[9999px] size-0 overflow-hidden">
          {hiddenShells.map((shell) => (
            <TaskShell
              key={shell.taskId}
              taskId={shell.taskId}
              workflowName={workflowName}
              taskName={shell.taskName}
              shell={shell.shell}
              onStatusChange={(status) => handleStatusChange(shell.taskId, status)}
              onSessionEnded={() => handleSessionEnded(shell.taskId)}
            />
          ))}
        </div>
      )}
    </>
  );
});
