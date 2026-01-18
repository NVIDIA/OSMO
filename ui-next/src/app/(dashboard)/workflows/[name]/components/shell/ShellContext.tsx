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
 * Thin React wrapper around the shell session cache.
 * Provides actions for managing shells. State comes from useShellSessions().
 *
 * The actual state is managed in shell-session-cache.ts:
 * - shellIntents Map: what the UI wants to render
 * - sessionCache Map: actual terminal/WebSocket instances
 *
 * This context just provides convenient action functions that
 * delegate to the cache module.
 *
 * @see shell-session-cache.ts for lifecycle documentation
 */

"use client";

import { createContext, useContext, useCallback, useMemo, type ReactNode } from "react";
import {
  openShellIntent,
  hasShellIntent,
  disconnectSession,
  disposeSession,
  useShellSessions,
} from "@/components/shell";

// =============================================================================
// Types
// =============================================================================

interface ShellContextValue {
  /** Request a shell to be rendered (called by TaskDetails on Connect click) */
  connectShell: (taskId: string, taskName: string, workflowName: string, shell: string) => void;

  /** Disconnect only - closes WebSocket but keeps session in list for reconnect */
  disconnectOnly: (taskId: string) => void;

  /** Remove a shell from rendering and dispose its session */
  removeShell: (taskId: string) => void;

  /** Check if a shell intent exists for a given task */
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
  // Subscribe to session changes so we can iterate over all shells for disconnectAll
  const { sessions } = useShellSessions();

  const connectShell = useCallback((taskId: string, taskName: string, workflowName: string, shell: string) => {
    // Delegate to cache - adds to shellIntents Map
    openShellIntent(taskId, taskName, workflowName, shell);
  }, []);

  const disconnectOnly = useCallback((taskId: string) => {
    // Delegate to cache - closes WebSocket but keeps session/intent
    disconnectSession(taskId);
  }, []);

  const removeShell = useCallback((taskId: string) => {
    // Delegate to cache - disposes session AND removes intent
    disposeSession(taskId);
  }, []);

  const hasActiveShell = useCallback((taskId: string) => {
    // Delegate to cache - checks if intent exists
    return hasShellIntent(taskId);
  }, []);

  const disconnectAll = useCallback(() => {
    // Dispose all shells from current snapshot
    for (const shell of sessions) {
      disposeSession(shell.taskId);
    }
  }, [sessions]);

  const value = useMemo<ShellContextValue>(
    () => ({
      connectShell,
      disconnectOnly,
      removeShell,
      hasActiveShell,
      disconnectAll,
    }),
    [connectShell, disconnectOnly, removeShell, hasActiveShell, disconnectAll],
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
