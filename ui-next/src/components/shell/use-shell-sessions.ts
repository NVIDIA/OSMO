// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * useShellSessions Hook
 *
 * React hook for accessing shell session state.
 * Uses useSyncExternalStore to subscribe to cache changes.
 *
 * Usage:
 * ```tsx
 * const { sessions, getSession, hasSession } = useShellSessions();
 * ```
 */

"use client";

import { useSyncExternalStore, useCallback } from "react";
import { subscribe, getSessionsSnapshot, type ShellSessionSnapshot } from "./shell-session-cache";

// =============================================================================
// Types
// =============================================================================

export interface UseShellSessionsReturn {
  /** All sessions as an array */
  sessions: ShellSessionSnapshot[];
  /** Get a session by taskId */
  getSession: (taskId: string) => ShellSessionSnapshot | undefined;
  /** Check if a session exists */
  hasSession: (taskId: string) => boolean;
  /** Whether there are any active sessions */
  hasActiveSessions: boolean;
  /** Count of active sessions */
  activeSessionCount: number;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook to access shell session state with automatic updates.
 */
export function useShellSessions(): UseShellSessionsReturn {
  const sessions = useSyncExternalStore(subscribe, getSessionsSnapshot, getSessionsSnapshot);

  const getSession = useCallback(
    (taskId: string): ShellSessionSnapshot | undefined => {
      return sessions.find((s) => s.key === taskId);
    },
    [sessions],
  );

  const hasSession = useCallback(
    (taskId: string): boolean => {
      return sessions.some((s) => s.key === taskId);
    },
    [sessions],
  );

  const hasActiveSessions = sessions.some((s) => s.status === "connecting" || s.status === "connected");

  const activeSessionCount = sessions.filter((s) => s.status === "connecting" || s.status === "connected").length;

  return {
    sessions,
    getSession,
    hasSession,
    hasActiveSessions,
    activeSessionCount,
  };
}

/**
 * Hook to get a specific session by taskId.
 * Returns undefined if session doesn't exist.
 */
export function useShellSession(taskId: string | undefined): ShellSessionSnapshot | undefined {
  const sessions = useSyncExternalStore(subscribe, getSessionsSnapshot, getSessionsSnapshot);
  return taskId ? sessions.find((s) => s.key === taskId) : undefined;
}
