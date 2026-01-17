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
 * 1. User clicks "Connect" in TaskDetails → openSession() creates session in store
 * 2. TaskDetails registers portal target via ShellPortalContext when shell tab active
 * 3. ShellContainer portals into the target and renders TaskShell
 * 4. TaskShell auto-connects and updates store status via callbacks
 * 5. Sessions persist across navigation until user closes or session ends
 */

"use client";

import { memo, useCallback } from "react";
import { createPortal } from "react-dom";
import { useShallow } from "zustand/react/shallow";
import { useShellStore } from "../../stores";
import { TaskShell } from "../panel/task/TaskShell";
import { useShellPortal } from "./ShellPortalContext";
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

  // Get the portal target from context
  const { portalTarget } = useShellPortal();

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

  // Don't render if no sessions or no portal target
  if (sessions.length === 0 || !portalTarget) {
    return null;
  }

  // Render the visible shell into the portal target
  // Hidden shells are rendered in an invisible container to maintain WebSocket connections
  const visibleSession = sessions.find((session) => isShellTabActive && session.taskName === currentTaskName);
  const hiddenSessions = sessions.filter((session) => !(isShellTabActive && session.taskName === currentTaskName));

  return (
    <>
      {/* Visible shell - portaled into TaskDetails shell tab area */}
      {visibleSession &&
        createPortal(
          <div className="h-full w-full p-4">
            <TaskShell
              workflowName={workflowName}
              taskName={visibleSession.taskName}
              shell={visibleSession.shell}
              onStatusChange={(status) => handleStatusChange(visibleSession.taskName, status)}
              onSessionEnded={() => handleSessionEnded(visibleSession.taskName)}
            />
          </div>,
          portalTarget,
        )}

      {/* Hidden shells - maintain WebSocket connections in invisible container */}
      {hiddenSessions.length > 0 && (
        <div className="pointer-events-none invisible absolute -left-[9999px] size-0 overflow-hidden">
          {hiddenSessions.map((session) => (
            <TaskShell
              key={session.taskName}
              workflowName={workflowName}
              taskName={session.taskName}
              shell={session.shell}
              onStatusChange={(status) => handleStatusChange(session.taskName, status)}
              onSessionEnded={() => handleSessionEnded(session.taskName)}
            />
          ))}
        </div>
      )}
    </>
  );
});
