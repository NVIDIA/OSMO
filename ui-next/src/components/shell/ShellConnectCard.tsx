// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * ShellConnectCard Component
 *
 * Idle state overlay with Connect button and shell selector.
 * Shown when the shell is not yet connected.
 */

"use client";

import { memo, useState, useCallback } from "react";
import { Terminal, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/shadcn/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/shadcn/dropdown-menu";
import { SHELL_OPTIONS, SHELL_CONFIG } from "./types";

// =============================================================================
// Types
// =============================================================================

export interface ShellConnectCardProps {
  /** Called when user clicks connect */
  onConnect: (shell: string) => void;
  /** Additional className */
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

export const ShellConnectCard = memo(function ShellConnectCard({ onConnect, className }: ShellConnectCardProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Get default shell label
  const defaultShell = SHELL_OPTIONS.find((s) => s.value === SHELL_CONFIG.DEFAULT_SHELL);
  const defaultLabel = defaultShell?.label ?? "bash";

  const handleConnect = useCallback(() => {
    onConnect(SHELL_CONFIG.DEFAULT_SHELL);
  }, [onConnect]);

  const handleShellSelect = useCallback(
    (shell: string) => {
      setIsOpen(false);
      onConnect(shell);
    },
    [onConnect],
  );

  return (
    <div className={cn("shell-connect-card", className)}>
      <div className="shell-connect-card-content">
        {/* Icon */}
        <div className="shell-connect-card-icon">
          <Terminal className="size-6 text-zinc-400" />
        </div>

        {/* Title */}
        <div className="shell-connect-card-title">Interactive Shell</div>

        {/* Connect Button with Shell Dropdown */}
        <div className="shell-connect-card-actions">
          <div className="shell-connect-button-group">
            {/* Main Connect Button */}
            <Button
              variant="default"
              size="sm"
              onClick={handleConnect}
              className="rounded-r-none border-r border-r-white/20"
            >
              Connect
            </Button>

            {/* Shell Selector Dropdown */}
            <DropdownMenu
              open={isOpen}
              onOpenChange={setIsOpen}
            >
              <DropdownMenuTrigger asChild>
                <Button
                  variant="default"
                  size="sm"
                  className="rounded-l-none px-2"
                  aria-label="Select shell"
                >
                  <span className="mr-1 text-xs opacity-70">{defaultLabel}</span>
                  <ChevronDown className="size-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="min-w-[100px]"
              >
                {SHELL_OPTIONS.map((option) => (
                  <DropdownMenuItem
                    key={option.value}
                    onClick={() => handleShellSelect(option.value)}
                    className="text-xs"
                  >
                    {option.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Hint */}
        <div className="shell-connect-card-hint">Uses container resources while active</div>
      </div>
    </div>
  );
});
