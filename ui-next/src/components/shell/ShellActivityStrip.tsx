// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * ShellActivityStrip Component
 *
 * Shows active shell sessions in the panel's collapsed strip.
 * Each session is shown as an icon with status indicator.
 */

"use client";

import { memo, type MouseEvent } from "react";
import { useEventCallback } from "usehooks-ts";
import { cn } from "@/lib/utils";
import { TooltipProvider } from "@/components/shadcn/tooltip";
import { ShellSessionIcon } from "./ShellSessionIcon";
import { useShellSessions } from "./use-shell-sessions";

// =============================================================================
// Types
// =============================================================================

export interface ShellActivityStripProps {
  /** Currently viewed task ID (to highlight active session) */
  currentTaskId?: string;
  /** Called when a session is clicked */
  onSelectSession?: (taskId: string) => void;
  /** Additional className */
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

export const ShellActivityStrip = memo(function ShellActivityStrip({
  currentTaskId,
  onSelectSession,
  className,
}: ShellActivityStripProps) {
  const { sessions } = useShellSessions();

  // Stable callback that reads taskId from data attribute - no closures per item
  const handleSessionClick = useEventCallback((e: MouseEvent<HTMLButtonElement>) => {
    const taskId = e.currentTarget.dataset.taskId;
    if (taskId) {
      onSelectSession?.(taskId);
    }
  });

  if (sessions.length === 0) {
    return null;
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className={cn("flex flex-col items-center gap-1", className)}>
        {/* Divider */}
        <div
          className="my-2 h-px w-5 bg-zinc-200 dark:bg-zinc-700"
          aria-hidden="true"
        />

        {/* Session icons - using data attributes for O(1) handler binding */}
        {sessions.map((session) => (
          <ShellSessionIcon
            key={session.taskId}
            session={session}
            isActive={session.taskId === currentTaskId}
            onClick={handleSessionClick}
            data-task-id={session.taskId}
          />
        ))}
      </div>
    </TooltipProvider>
  );
});
