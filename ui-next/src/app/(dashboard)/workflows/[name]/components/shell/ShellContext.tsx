// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * ShellContext
 *
 * Manages which shells should be rendered (separate from actual session state).
 * This context handles the "intent to render" while the session cache handles
 * the actual terminal/WebSocket instances.
 *
 * Separation of Concerns:
 * - ShellContext: "What shells should be rendered" (triggers component mounting)
 * - Session Cache: "Terminal + WebSocket instances" (created when component mounts)
 *
 * Flow:
 * 1. User clicks Connect → connectShell() adds to activeShells
 * 2. ShellContainer sees activeShells → renders TaskShell for each
 * 3. TaskShell mounts → useShell creates session in cache (with terminal)
 * 4. User disconnects → disconnectShell() removes from activeShells + disposes session
 */

"use client";

import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from "react";
import { disposeSession } from "@/components/shell";

// =============================================================================
// Types
// =============================================================================

/** Shell that should be rendered */
export interface ActiveShell {
  /** Task UUID - unique identifier */
  taskId: string;
  /** Task name for display */
  taskName: string;
  /** Shell executable (e.g., /bin/bash) */
  shell: string;
}

interface ShellContextValue {
  /** Shells that should be rendered */
  activeShells: ActiveShell[];

  /** Request a shell to be rendered (called by TaskDetails on Connect click) */
  connectShell: (taskId: string, taskName: string, shell: string) => void;

  /** Remove a shell from rendering and dispose its session */
  disconnectShell: (taskId: string) => void;

  /** Check if a shell is active for a given task */
  hasActiveShell: (taskId: string) => boolean;

  /** Disconnect all shells (called on page leave) */
  disconnectAll: () => void;
}

// =============================================================================
// Context
// =============================================================================

const ShellContext = createContext<ShellContextValue | null>(null);

// =============================================================================
// Provider
// =============================================================================

export function ShellProvider({ children }: { children: ReactNode }) {
  const [activeShells, setActiveShells] = useState<ActiveShell[]>([]);

  const connectShell = useCallback((taskId: string, taskName: string, shell: string) => {
    setActiveShells((prev) => {
      // Don't add if already exists
      if (prev.some((s) => s.taskId === taskId)) {
        return prev;
      }
      return [...prev, { taskId, taskName, shell }];
    });
  }, []);

  const disconnectShell = useCallback((taskId: string) => {
    // Remove from active shells
    setActiveShells((prev) => prev.filter((s) => s.taskId !== taskId));
    // Dispose the session in cache (cleans up terminal + WebSocket)
    disposeSession(taskId);
  }, []);

  const hasActiveShell = useCallback(
    (taskId: string) => {
      return activeShells.some((s) => s.taskId === taskId);
    },
    [activeShells],
  );

  const disconnectAll = useCallback(() => {
    // Dispose all sessions
    for (const shell of activeShells) {
      disposeSession(shell.taskId);
    }
    // Clear state
    setActiveShells([]);
  }, [activeShells]);

  const value = useMemo<ShellContextValue>(
    () => ({
      activeShells,
      connectShell,
      disconnectShell,
      hasActiveShell,
      disconnectAll,
    }),
    [activeShells, connectShell, disconnectShell, hasActiveShell, disconnectAll],
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

// =============================================================================
// Hook
// =============================================================================

export function useShellContext(): ShellContextValue {
  const context = useContext(ShellContext);
  if (!context) {
    throw new Error("useShellContext must be used within a ShellProvider");
  }
  return context;
}
