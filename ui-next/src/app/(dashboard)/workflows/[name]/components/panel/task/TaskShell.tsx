// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * TaskShell Components
 *
 * Shell interface for a running task within the details panel.
 *
 * Exports:
 * - ShellConnectPrompt: Initial connect UI with shell selector
 * - TaskShell: Active shell terminal with reconnect handling
 *
 * TaskShell behavior:
 * - Auto-connects when mounted
 * - Connected: Full interactive shell
 * - Disconnected: Terminal history preserved, inline status bar with Reconnect
 * - Reconnect: Preserves history, reconnects WebSocket
 *
 * The terminal is always mounted to preserve scrollback history across
 * connect/disconnect cycles.
 */

"use client";

import { memo, useState, useRef, useEffect, startTransition } from "react";
import { useEventCallback } from "usehooks-ts";
import { Plug, AlertCircle, Terminal, ChevronDown, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/shadcn/button";
import { Input } from "@/components/shadcn/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/shadcn/dropdown-menu";
import {
  ShellTerminal,
  SHELL_OPTIONS,
  type ShellTerminalRef,
  type ConnectionStatusType,
  hasSession,
  getSessionStatus,
  getSessionError,
} from "@/components/shell";

// =============================================================================
// Types
// =============================================================================

export interface TaskShellProps {
  /** Task UUID from backend - used as unique session key */
  taskId: string;
  /** Workflow name for the exec API */
  workflowName: string;
  /** Task name to exec into */
  taskName: string;
  /** Shell to use (e.g., /bin/bash, /bin/sh, /bin/zsh) */
  shell?: string;
  /** Called when connection status changes */
  onStatusChange?: (status: ConnectionStatusType) => void;
  /** Called when shell session ends (user types exit or Ctrl+D) */
  onSessionEnded?: () => void;
  /** Whether this shell is currently visible (triggers focus when becoming visible) */
  isVisible?: boolean;
  /** Additional className for the container */
  className?: string;
}

export interface ShellConnectPromptProps {
  /** Called when user clicks connect with selected shell */
  onConnect: (shell: string) => void;
}

// =============================================================================
// Shell Connect Prompt (initial state before connection)
// =============================================================================

// Use shared SHELL_OPTIONS from @/components/shell for single source of truth

export const ShellConnectPrompt = memo(function ShellConnectPrompt({ onConnect }: ShellConnectPromptProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customShell, setCustomShell] = useState("");

  // useEventCallback: stable refs that always access latest props/state
  const handleShellSelect = useEventCallback((shell: string) => {
    setIsOpen(false);
    onConnect(shell);
  });

  const handleCustomSelect = useEventCallback(() => {
    setIsOpen(false);
    setShowCustomInput(true);
  });

  const handleCustomConnect = useEventCallback(() => {
    if (customShell.trim()) {
      onConnect(customShell.trim());
    }
  });

  const handleCustomKeyDown = useEventCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && customShell.trim()) {
      onConnect(customShell.trim());
    } else if (e.key === "Escape") {
      setShowCustomInput(false);
      setCustomShell("");
    }
  });

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-gray-100 dark:bg-zinc-800">
        <Terminal className="size-6 text-gray-400 dark:text-zinc-500" />
      </div>
      <div>
        <h3 className="text-sm font-medium text-gray-900 dark:text-zinc-100">Interactive Shell</h3>
        <p className="mt-1 max-w-xs text-xs text-gray-500 dark:text-zinc-400">
          Connect to open a shell session in the running container
        </p>
      </div>

      {showCustomInput ? (
        <div className="mt-2 flex w-full max-w-xs items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            onClick={() => {
              setShowCustomInput(false);
              setCustomShell("");
            }}
            aria-label="Back to shell selection"
          >
            <ArrowLeft className="size-4" />
          </Button>
          <Input
            type="text"
            placeholder="/bin/sh"
            value={customShell}
            onChange={(e) => setCustomShell(e.target.value)}
            onKeyDown={handleCustomKeyDown}
            className="h-8 flex-1 font-mono text-xs"
            autoFocus
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleCustomConnect}
            disabled={!customShell.trim()}
          >
            Connect
          </Button>
        </div>
      ) : (
        <div className="mt-2 flex">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleShellSelect("/bin/bash")}
            className="rounded-r-none border-r-0"
          >
            <Terminal className="mr-1.5 size-3.5" />
            Connect
          </Button>
          <DropdownMenu
            open={isOpen}
            onOpenChange={setIsOpen}
          >
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="rounded-l-none px-2"
                aria-label="Select shell"
              >
                <ChevronDown className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="min-w-[140px]"
            >
              {SHELL_OPTIONS.map((option) => (
                <DropdownMenuItem
                  key={option.value}
                  onClick={() => handleShellSelect(option.value)}
                  className="font-mono text-xs"
                >
                  {option.label}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem
                onClick={handleCustomSelect}
                className="text-xs"
              >
                Custom...
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      <p className="text-xs text-gray-400 dark:text-zinc-500">Uses container resources while active</p>
    </div>
  );
});

// =============================================================================
// Disconnected Status Bar Component
// =============================================================================

interface DisconnectedBarProps {
  error?: string | null;
  onReconnect: () => void;
}

const DisconnectedBar = memo(function DisconnectedBar({ error, onReconnect }: DisconnectedBarProps) {
  return (
    <div className="absolute inset-x-0 bottom-0 z-10 flex items-center justify-between gap-3 border-t border-amber-600/30 bg-amber-950/90 px-3 py-2 backdrop-blur-sm">
      <div className="flex items-center gap-2">
        {error ? (
          <>
            <AlertCircle className="size-4 text-red-400" />
            <span className="text-xs font-medium text-red-300">Connection error</span>
            <span className="text-xs text-red-400/80">· {error}</span>
          </>
        ) : (
          <>
            <div className="size-2 rounded-full bg-amber-500" />
            <span className="text-xs font-medium text-amber-200">Disconnected</span>
            <span className="text-xs text-amber-300/70">· Shell history preserved</span>
          </>
        )}
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onReconnect}
        className="h-6 border-amber-600/50 bg-amber-900/50 px-2 text-xs text-amber-200 hover:bg-amber-800/70 hover:text-amber-100"
      >
        <Plug className="mr-1 size-3" />
        Reconnect
      </Button>
    </div>
  );
});

// =============================================================================
// Main Component
// =============================================================================

export const TaskShell = memo(function TaskShell({
  taskId,
  workflowName,
  taskName,
  shell,
  onStatusChange: onStatusChangeProp,
  onSessionEnded,
  isVisible = false,
  className,
}: TaskShellProps) {
  // Ref to control ShellTerminal imperatively
  const shellRef = useRef<ShellTerminalRef>(null);

  // Use taskId (UUID) as the session key for uniqueness
  const sessionKey = taskId;

  // Check if this is a fresh session or returning to an existing one
  const sessionExists = hasSession(sessionKey);
  const cachedStatus = getSessionStatus(sessionKey);
  const cachedError = getSessionError(sessionKey);

  // Track connection status - restore from cache if session exists
  // This preserves the exact state when switching tabs (connected, disconnected, error)
  const [status, setStatus] = useState<ConnectionStatusType>(() => {
    if (sessionExists && cachedStatus) {
      return cachedStatus;
    }
    // No session yet - will auto-connect
    return "connecting";
  });

  // Restore error from cache if session exists
  const [lastError, setLastError] = useState<string | null>(() => (sessionExists ? (cachedError ?? null) : null));

  // Track if session ended cleanly (user typed exit or Ctrl+D)
  // Used to suppress disconnected bar when session ends intentionally
  const [sessionEnded, setSessionEnded] = useState(false);

  // Reset state when session changes (different workflow/task selected)
  // useState initializer only runs on first mount, so we need this effect
  useEffect(() => {
    const exists = hasSession(sessionKey);
    const cached = getSessionStatus(sessionKey);
    const cachedErr = getSessionError(sessionKey);

    startTransition(() => {
      if (exists && cached) {
        setStatus(cached);
        setLastError(cachedErr ?? null);
      } else {
        setStatus("connecting");
        setLastError(null);
      }
      setSessionEnded(false);
    });
  }, [sessionKey]);

  // Determine UI state - don't show disconnected bar if session ended cleanly
  const showDisconnectedBar = (status === "disconnected" || status === "error") && !sessionEnded;
  const isConnecting = status === "connecting";

  // Handle reconnect button click
  // useEventCallback: stable ref, no deps needed, avoids re-renders
  const handleReconnect = useEventCallback(() => {
    setLastError(null);
    setSessionEnded(false);
    shellRef.current?.connect();
  });

  // Handle session ended - mark as ended to suppress disconnected bar
  // useEventCallback: always has access to latest onSessionEnded
  const handleSessionEnded = useEventCallback(() => {
    setSessionEnded(true);
    onSessionEnded?.();
  });

  // Handle status changes from ShellTerminal
  // useEventCallback: frequently called, stable reference avoids child re-renders
  const handleStatusChange = useEventCallback((newStatus: ConnectionStatusType) => {
    setStatus(newStatus);
    // Clear error and reset session ended flag when connecting/connected
    if (newStatus === "connecting" || newStatus === "connected") {
      setLastError(null);
      setSessionEnded(false);
    }
    // Forward to parent
    onStatusChangeProp?.(newStatus);
  });

  // Handle connection error
  // useEventCallback: stable ref for ShellTerminal's onError prop
  const handleError = useEventCallback((error: Error) => {
    setLastError(error.message);
  });

  // Handle connection success - focus the terminal
  // useEventCallback: stable ref for ShellTerminal's onConnected prop
  const handleConnected = useEventCallback(() => {
    shellRef.current?.focus();
  });

  // Auto-focus when becoming visible (e.g., navigating to shell tab)
  // This allows immediate typing without an extra click
  useEffect(() => {
    if (isVisible && status === "connected") {
      shellRef.current?.focus();
    }
  }, [isVisible, status]);

  return (
    <div className={cn("relative flex h-full min-h-[300px] flex-col", className)}>
      {/* Terminal - starts session if none exists, restores state if one does */}
      <ShellTerminal
        ref={shellRef}
        taskId={taskId}
        workflowName={workflowName}
        taskName={taskName}
        shell={shell}
        onStatusChange={handleStatusChange}
        onConnected={handleConnected}
        onError={handleError}
        onSessionEnded={handleSessionEnded}
        className={cn("flex-1 transition-opacity duration-200", isConnecting && "opacity-70")}
      />

      {/* Disconnected bar - shown when disconnected but preserving history */}
      {showDisconnectedBar && (
        <DisconnectedBar
          error={lastError}
          onReconnect={handleReconnect}
        />
      )}

      {/* Connecting indicator */}
      {isConnecting && (
        <div className="absolute inset-x-0 bottom-0 z-10 flex items-center justify-center gap-2 border-t border-blue-600/30 bg-blue-950/90 px-3 py-2 backdrop-blur-sm">
          <div className="size-2 animate-pulse rounded-full bg-blue-400" />
          <span className="text-xs font-medium text-blue-200">Connecting...</span>
        </div>
      )}
    </div>
  );
});
