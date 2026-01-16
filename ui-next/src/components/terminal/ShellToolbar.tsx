// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * ShellToolbar Component
 *
 * Toolbar for the terminal with shell selector and actions.
 */

"use client";

import { memo, useState, useCallback } from "react";
import { ChevronDown, Search, X, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/shadcn/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/shadcn/dropdown-menu";
import { ConnectionStatus } from "./ConnectionStatus";
import { SHELL_OPTIONS, type ConnectionStatus as ConnectionStatusType } from "./types";

// =============================================================================
// Types
// =============================================================================

export interface ShellToolbarProps {
  /** Current shell */
  shell: string;
  /** Called when shell is changed */
  onShellChange: (shell: string) => void;
  /** Connection status */
  status: ConnectionStatusType;
  /** Error message if any */
  error?: string | null;
  /** Called when reconnect is clicked */
  onReconnect?: () => void;
  /** Called when disconnect is clicked */
  onDisconnect?: () => void;
  /** Called when search is toggled */
  onToggleSearch?: () => void;
  /** Whether search is active */
  isSearchActive?: boolean;
  /** Whether shell can be changed (not connected) */
  canChangeShell?: boolean;
  /** Additional className */
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

export const ShellToolbar = memo(function ShellToolbar({
  shell,
  onShellChange,
  status,
  error,
  onReconnect,
  onDisconnect,
  onToggleSearch,
  isSearchActive,
  canChangeShell = true,
  className,
}: ShellToolbarProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Get shell label for display
  const shellLabel = SHELL_OPTIONS.find((s) => s.value === shell)?.label ?? shell.split("/").pop();

  const handleShellSelect = useCallback(
    (value: string) => {
      onShellChange(value);
      setIsOpen(false);
    },
    [onShellChange],
  );

  const isConnected = status === "connected";
  const isConnecting = status === "connecting";
  const isDisconnected = status === "disconnected" || status === "error";

  return (
    <div className={cn("terminal-status flex items-center justify-between", className)}>
      <div className="terminal-status-left flex items-center gap-3">
        {/* Shell Selector */}
        <DropdownMenu
          open={isOpen}
          onOpenChange={setIsOpen}
        >
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 gap-1 px-2 text-xs text-zinc-400 hover:text-zinc-200"
              disabled={!canChangeShell || isConnected || isConnecting}
            >
              {shellLabel}
              <ChevronDown className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="min-w-[100px]"
          >
            {SHELL_OPTIONS.map((option) => (
              <DropdownMenuItem
                key={option.value}
                onClick={() => handleShellSelect(option.value)}
                className={cn("text-xs", shell === option.value && "bg-accent")}
              >
                {option.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Connection Status */}
        <ConnectionStatus status={status} />

        {/* Error message */}
        {error && <span className="max-w-[150px] truncate text-xs text-red-400">{error}</span>}
      </div>

      <div className="terminal-status-right flex items-center gap-1">
        {/* Search Toggle */}
        {onToggleSearch && (
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-5 px-2 text-xs text-zinc-400 hover:text-zinc-200",
              isSearchActive && "bg-zinc-700 text-zinc-200",
            )}
            onClick={onToggleSearch}
            title="Search (Ctrl+Shift+F)"
          >
            <Search className="size-3" />
          </Button>
        )}

        {/* Reconnect Button */}
        {isDisconnected && onReconnect && (
          <Button
            variant="ghost"
            size="sm"
            className="h-5 gap-1 px-2 text-xs text-zinc-400 hover:text-zinc-200"
            onClick={onReconnect}
          >
            <RefreshCw className="size-3" />
            Reconnect
          </Button>
        )}

        {/* Disconnect Button */}
        {(isConnected || isConnecting) && onDisconnect && (
          <Button
            variant="ghost"
            size="sm"
            className="h-5 gap-1 px-2 text-xs text-zinc-400 hover:text-zinc-200"
            onClick={onDisconnect}
          >
            <X className="size-3" />
            Disconnect
          </Button>
        )}
      </div>
    </div>
  );
});
