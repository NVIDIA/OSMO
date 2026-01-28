// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import { memo } from "react";
import { Terminal, Unplug, RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/shadcn/context-menu";
import { StatusDot, STATUS_LABELS } from "./StatusDot";
import type { CachedSession } from "../lib/shell-cache";

export interface ShellSessionIconProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  session: CachedSession;
  isActive?: boolean;
  onSelect?: () => void;
  onDisconnect?: () => void;
  onReconnect?: () => void;
  onRemove?: () => void;
}

export const ShellSessionIcon = memo(function ShellSessionIcon({
  session,
  isActive,
  onSelect,
  onDisconnect,
  onReconnect,
  onRemove,
  className,
  ...buttonProps
}: ShellSessionIconProps) {
  const phase = session.state.phase;
  const isConnected = phase === "connecting" || phase === "opening" || phase === "initializing" || phase === "ready";
  const isDisconnected = phase === "disconnected";
  const isError = phase === "error";

  return (
    <ContextMenu>
      <Tooltip>
        <ContextMenuTrigger asChild>
          <TooltipTrigger asChild>
            <button
              type="button"
              {...buttonProps}
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
              aria-label={`${session.taskName} shell - ${STATUS_LABELS[phase]}`}
            >
              <Terminal
                className="size-4"
                aria-hidden="true"
              />
              <StatusDot
                status={phase}
                className="absolute -right-0.5 -bottom-0.5"
              />
            </button>
          </TooltipTrigger>
        </ContextMenuTrigger>
        <TooltipContent side="left">
          <div className="text-xs">
            <div className="font-medium">{session.taskName}</div>
            <div className="text-zinc-400">{STATUS_LABELS[phase]}</div>
          </div>
        </TooltipContent>
      </Tooltip>

      <ContextMenuContent>
        {onSelect ? (
          <ContextMenuItem
            onClick={onSelect}
            className="flex flex-col items-start gap-0.5"
          >
            <span className="max-w-[180px] truncate font-medium">{session.taskName}</span>
            <span className="flex items-center gap-1.5 text-xs font-normal text-zinc-500">
              <StatusDot
                status={phase}
                className="size-2"
              />
              {STATUS_LABELS[phase]}
            </span>
          </ContextMenuItem>
        ) : (
          <ContextMenuLabel className="flex flex-col gap-0.5">
            <span className="max-w-[180px] truncate">{session.taskName}</span>
            <span className="flex items-center gap-1.5 text-xs font-normal text-zinc-500">
              <StatusDot
                status={phase}
                className="size-2"
              />
              {STATUS_LABELS[phase]}
            </span>
          </ContextMenuLabel>
        )}

        <ContextMenuSeparator />

        {isConnected && onDisconnect && (
          <ContextMenuItem onClick={onDisconnect}>
            <Unplug className="size-4" />
            Disconnect
          </ContextMenuItem>
        )}

        {(isDisconnected || isError) && onReconnect && (
          <ContextMenuItem onClick={onReconnect}>
            <RefreshCw className="size-4" />
            {isError ? "Retry" : "Reconnect"}
          </ContextMenuItem>
        )}

        {onRemove && (
          <ContextMenuItem
            variant="destructive"
            onClick={onRemove}
          >
            <X className="size-4" />
            Remove Session
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
});
