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

import { useSyncExternalStore, useMemo } from "react";
import { subscribe, getSessionsSnapshot, type ShellSessionSnapshot } from "./shell-session-cache";

// =============================================================================
// Types
// =============================================================================

export interface UseShellSessionsReturn {
  /** All sessions as an array */
  sessions: ShellSessionSnapshot[];
  /** Session lookup map by taskId (O(1) access) */
  sessionMap: Map<string, ShellSessionSnapshot>;
  /** Get a session by taskId (O(1)) */
  getSession: (taskId: string) => ShellSessionSnapshot | undefined;
  /** Check if a session exists (O(1)) */
  hasSession: (taskId: string) => boolean;
  /** Whether there are any active sessions */
  hasActiveSessions: boolean;
  /** Count of active sessions */
  activeSessionCount: number;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Check if a session status is considered "active".
 */
function isActiveStatus(status: ShellSessionSnapshot["status"]): boolean {
  return status === "connecting" || status === "connected";
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook to access shell session state with automatic updates.
 * Uses memoized Map for O(1) lookups and computed active counts.
 */
export function useShellSessions(): UseShellSessionsReturn {
  const sessions = useSyncExternalStore(subscribe, getSessionsSnapshot, getSessionsSnapshot);

  // Memoize the session map and computed values to avoid recalculating on every render.
  // These only change when `sessions` reference changes (from cache updates).
  const { sessionMap, hasActiveSessions, activeSessionCount } = useMemo(() => {
    const map = new Map<string, ShellSessionSnapshot>();
    let activeCount = 0;

    for (const session of sessions) {
      map.set(session.key, session);
      if (isActiveStatus(session.status)) {
        activeCount++;
      }
    }

    return {
      sessionMap: map,
      hasActiveSessions: activeCount > 0,
      activeSessionCount: activeCount,
    };
  }, [sessions]);

  // Stable getSession - uses map reference which is stable per sessions update
  const getSession = sessionMap.get.bind(sessionMap);

  // Stable hasSession - uses map reference which is stable per sessions update
  const hasSession = sessionMap.has.bind(sessionMap);

  return {
    sessions,
    sessionMap,
    getSession,
    hasSession,
    hasActiveSessions,
    activeSessionCount,
  };
}

/**
 * Hook to get a specific session by taskId.
 * Returns undefined if session doesn't exist.
 * Reuses useShellSessions for O(1) lookup via Map.
 */
export function useShellSession(taskId: string | undefined): ShellSessionSnapshot | undefined {
  const { getSession } = useShellSessions();
  return taskId ? getSession(taskId) : undefined;
}
