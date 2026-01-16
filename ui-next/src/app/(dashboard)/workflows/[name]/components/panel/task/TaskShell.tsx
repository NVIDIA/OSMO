// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * TaskShell Component
 *
 * Shell interface for a running task within the details panel.
 * Wraps ShellTerminal with task-specific context and overlays.
 *
 * Behavior:
 * - Initial: Terminal rendered with semi-transparent overlay + Connect button
 * - Connected: Full interactive shell, no overlay
 * - Disconnected: Terminal history preserved, inline status bar with Reconnect
 * - Reconnect: Preserves history, reconnects WebSocket
 *
 * The terminal is always mounted to preserve scrollback history across
 * connect/disconnect cycles.
 */

"use client";

import { memo, useCallback, useState, useRef } from "react";
import { Terminal, Plug, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/shadcn/button";
import { ShellTerminal, type ShellTerminalRef, type ConnectionStatusType } from "@/components/shell";

// =============================================================================
// Types
// =============================================================================

export interface TaskShellProps {
  /** Workflow name for the exec API */
  workflowName: string;
  /** Task name to exec into */
  taskName: string;
  /** Called when shell session ends (user types exit or Ctrl+D) */
  onSessionEnded?: () => void;
  /** Additional className for the container */
  className?: string;
}

// =============================================================================
// Connect Overlay Component
// =============================================================================

interface ConnectOverlayProps {
  taskName: string;
  onConnect: () => void;
}

const ConnectOverlay = memo(function ConnectOverlay({ taskName, onConnect }: ConnectOverlayProps) {
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-zinc-950/80 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-4 rounded-lg border border-zinc-800 bg-zinc-900/90 p-6 shadow-xl">
        <div className="flex size-12 items-center justify-center rounded-full bg-zinc-800">
          <Terminal className="size-6 text-zinc-400" />
        </div>
        <div className="text-center">
          <h3 className="text-sm font-medium text-zinc-100">Interactive Shell</h3>
          <p className="mt-1 max-w-xs text-xs text-zinc-400">
            Connect to open a shell session in <span className="font-medium text-zinc-300">{taskName}</span>
          </p>
        </div>
        <Button
          variant="default"
          size="sm"
          onClick={onConnect}
          className="mt-1"
        >
          <Plug className="mr-1.5 size-3.5" />
          Connect
        </Button>
        <p className="text-xs text-zinc-500">Shell sessions use container resources while active</p>
      </div>
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
    <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-3 border-b border-amber-600/30 bg-amber-950/90 px-3 py-2 backdrop-blur-sm">
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
  workflowName,
  taskName,
  onSessionEnded,
  className,
}: TaskShellProps) {
  // Ref to control ShellTerminal imperatively
  const shellRef = useRef<ShellTerminalRef>(null);

  // Track connection status
  const [status, setStatus] = useState<ConnectionStatusType>("idle");
  const [lastError, setLastError] = useState<string | null>(null);

  // Determine UI state
  const showConnectOverlay = status === "idle";
  const showDisconnectedBar = status === "disconnected" || status === "error";
  const isConnecting = status === "connecting";

  // Handle connect button click
  const handleConnect = useCallback(() => {
    setLastError(null);
    shellRef.current?.connect();
  }, []);

  // Handle reconnect button click
  const handleReconnect = useCallback(() => {
    setLastError(null);
    shellRef.current?.connect();
  }, []);

  // Handle status changes from ShellTerminal
  const handleStatusChange = useCallback((newStatus: ConnectionStatusType) => {
    setStatus(newStatus);
    // Clear error when successfully connected
    if (newStatus === "connected") {
      setLastError(null);
    }
  }, []);

  // Handle connection error
  const handleError = useCallback((error: Error) => {
    setLastError(error.message);
  }, []);

  // Handle connection success - focus the terminal
  const handleConnected = useCallback(() => {
    shellRef.current?.focus();
  }, []);

  return (
    <div className={cn("relative flex h-full min-h-[300px] flex-col", className)}>
      {/* Terminal - always mounted to preserve history */}
      <ShellTerminal
        ref={shellRef}
        workflowName={workflowName}
        taskName={taskName}
        autoConnect={false}
        onStatusChange={handleStatusChange}
        onConnected={handleConnected}
        onError={handleError}
        onSessionEnded={onSessionEnded}
        className={cn(
          "flex-1 transition-opacity duration-200",
          showConnectOverlay && "opacity-40",
          isConnecting && "opacity-70",
        )}
      />

      {/* Connect overlay - shown on initial state */}
      {showConnectOverlay && (
        <ConnectOverlay
          taskName={taskName}
          onConnect={handleConnect}
        />
      )}

      {/* Disconnected bar - shown when disconnected but preserving history */}
      {showDisconnectedBar && (
        <DisconnectedBar
          error={lastError}
          onReconnect={handleReconnect}
        />
      )}

      {/* Connecting indicator */}
      {isConnecting && (
        <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-center gap-2 border-b border-blue-600/30 bg-blue-950/90 px-3 py-2 backdrop-blur-sm">
          <div className="size-2 animate-pulse rounded-full bg-blue-400" />
          <span className="text-xs font-medium text-blue-200">Connecting...</span>
        </div>
      )}
    </div>
  );
});
