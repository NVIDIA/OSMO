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

import { memo, useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { cn } from "@/lib/utils";
import { TooltipProvider } from "@/components/shadcn/tooltip";
import { useShellStore } from "@/app/(dashboard)/workflows/[name]/stores";
import { ShellSessionIcon } from "./ShellSessionIcon";
import type { ShellSession } from "./types";

// =============================================================================
// Types
// =============================================================================

export interface ShellActivityStripProps {
  /** Currently viewed task name (to highlight active session) */
  currentTaskName?: string;
  /** Called when a session is clicked */
  onSelectSession?: (taskName: string) => void;
  /** Additional className */
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

export const ShellActivityStrip = memo(function ShellActivityStrip({
  currentTaskName,
  onSelectSession,
  className,
}: ShellActivityStripProps) {
  // Use shallow comparison for the sessions object to avoid infinite loop
  const sessionsMap = useShellStore(useShallow((s) => s.sessions));

  // Derive list from map - memoized to avoid creating new array each render
  const sessions = useMemo(() => Object.values(sessionsMap), [sessionsMap]);

  const handleSessionClick = useCallback(
    (session: ShellSession) => {
      onSelectSession?.(session.taskName);
    },
    [onSelectSession],
  );

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

        {/* Session icons */}
        {sessions.map((session) => (
          <ShellSessionIcon
            key={session.taskName}
            session={session}
            isActive={session.taskName === currentTaskName}
            onClick={() => handleSessionClick(session)}
          />
        ))}
      </div>
    </TooltipProvider>
  );
});
