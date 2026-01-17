// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * ShellSessionIcon Component
 *
 * Icon for a shell session shown in the activity strip.
 * Shows terminal icon with connection status dot.
 */

"use client";

import { memo } from "react";
import { Terminal } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import type { ConnectionStatus } from "./types";
import type { ShellSessionSnapshot } from "./shell-session-cache";

// =============================================================================
// Types
// =============================================================================

export interface ShellSessionIconProps {
  /** The shell session */
  session: ShellSessionSnapshot;
  /** Whether this session is currently active/focused */
  isActive?: boolean;
  /** Called when the icon is clicked */
  onClick?: () => void;
  /** Called when the session should be closed */
  onClose?: () => void;
  /** Additional className */
  className?: string;
}

// =============================================================================
// Status Dot Styles
// =============================================================================

const STATUS_DOT_STYLES: Record<ConnectionStatus, string> = {
  idle: "bg-zinc-500",
  connecting: "animate-pulse bg-amber-400",
  connected: "bg-emerald-400",
  disconnected: "border border-red-400 bg-transparent",
  error: "bg-red-400",
};

const STATUS_LABELS: Record<ConnectionStatus, string> = {
  idle: "Idle",
  connecting: "Connecting...",
  connected: "Connected",
  disconnected: "Disconnected - Click to reconnect",
  error: "Error",
};

// =============================================================================
// Component
// =============================================================================

export const ShellSessionIcon = memo(function ShellSessionIcon({
  session,
  isActive,
  onClick,
  className,
}: ShellSessionIconProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className={cn(
            "relative flex size-8 items-center justify-center rounded-lg transition-colors",
            "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900",
            "dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
            isActive && "bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100",
            "focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2",
            "focus-visible:ring-offset-white dark:focus-visible:ring-offset-zinc-900",
            "focus-visible:outline-none",
            className,
          )}
          aria-label={`${session.taskName} shell - ${STATUS_LABELS[session.status]}`}
        >
          <Terminal
            className="size-4"
            aria-hidden="true"
          />
          {/* Status dot */}
          <span
            className={cn("absolute -right-0.5 -bottom-0.5 size-2 rounded-full", STATUS_DOT_STYLES[session.status])}
            aria-hidden="true"
          />
        </button>
      </TooltipTrigger>
      <TooltipContent side="left">
        <div className="text-xs">
          <div className="font-medium">{session.taskName}</div>
          <div className="text-zinc-400">{STATUS_LABELS[session.status]}</div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
});
