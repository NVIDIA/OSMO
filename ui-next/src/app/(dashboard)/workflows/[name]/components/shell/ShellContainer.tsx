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
 * 1. User clicks "Connect" → openShellIntent() adds to cache
 * 2. ShellContainer sees new shell via useShellSessions() → renders TaskShell
 * 3. TaskShell mounts → useShell creates session in cache (with terminal)
 * 4. TaskDetails registers portal target via ShellPortalContext when shell tab active
 * 5. ShellContainer portals into the target
 * 6. Sessions persist across navigation until user removes or session ends
 */

"use client";

import { memo } from "react";
import { createPortal } from "react-dom";
import { TaskShell } from "@/app/(dashboard)/workflows/[name]/components/panel/task/TaskShell";
import { useShellPortal } from "@/app/(dashboard)/workflows/[name]/components/shell/ShellPortalContext";
import { useShellSessions } from "@/components/shell/lib/shell-cache";

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
  // Get shells from cache
  const allShells = useShellSessions();

  // Get the portal target from context
  const { portalTarget } = useShellPortal();

  // Filter shells to only include those from this workflow
  // This prevents shells from other workflows from being rendered/mounted here
  const shells = allShells.filter((shell) => shell.workflowName === workflowName);

  // Don't render if no shells for this workflow
  if (shells.length === 0) {
    return null;
  }

  // Determine which shell is visible (if any)
  // A shell is visible when: shell tab is active + portal target exists + shell matches current task
  const visibleShell =
    isShellTabActive && portalTarget ? shells.find((shell) => shell.key === currentTaskId) : undefined;

  // All other shells are hidden but stay mounted to preserve terminal instances
  const hiddenShells = shells.filter((shell) => shell !== visibleShell);

  return (
    <>
      {/* Visible shell - portaled into TaskDetails shell tab area */}
      {visibleShell &&
        portalTarget &&
        createPortal(
          <div className="h-full w-full p-4">
            <TaskShell
              taskId={visibleShell.key}
              workflowName={workflowName}
              taskName={visibleShell.taskName}
              shell={visibleShell.shell}
              isVisible
            />
          </div>,
          portalTarget,
        )}

      {/* Hidden shells - stay mounted in invisible container to preserve terminal instances */}
      {hiddenShells.length > 0 && (
        <div className="pointer-events-none invisible absolute -left-[9999px] size-0 overflow-hidden">
          {hiddenShells.map((shell) => (
            <TaskShell
              key={shell.key}
              taskId={shell.key}
              workflowName={workflowName}
              taskName={shell.taskName}
              shell={shell.shell}
            />
          ))}
        </div>
      )}
    </>
  );
});
