// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * Shell Session Store
 *
 * Zustand store for managing shell sessions across the workflow detail page.
 * Tracks active sessions, connection status, and handles session persistence.
 *
 * Key features:
 * - Multiple concurrent sessions (one per task)
 * - Session persistence in sessionStorage for page refresh recovery
 * - Derived state for navigation guards
 *
 * Usage:
 * ```tsx
 * const { sessions, openSession, closeSession } = useShellStore();
 * const hasActiveSessions = useShellStore((s) => s.hasActiveSessions);
 * ```
 */

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import type { ShellSession, ConnectionStatus, PersistedSession } from "@/components/terminal/types";
import { TERMINAL_CONFIG } from "@/components/terminal/types";

// =============================================================================
// Storage Key
// =============================================================================

const STORAGE_KEY = "osmo-shell-sessions";

// =============================================================================
// Types
// =============================================================================

interface ShellState {
  /** Map of taskName -> ShellSession */
  sessions: Record<string, ShellSession>;
}

interface ShellActions {
  /** Open a new session or get existing one */
  openSession: (workflowName: string, taskName: string, shell?: string) => ShellSession;
  /** Update session status */
  updateStatus: (taskName: string, status: ConnectionStatus, error?: string) => void;
  /** Mark session as connected */
  markConnected: (taskName: string) => void;
  /** Mark session as disconnected */
  markDisconnected: (taskName: string) => void;
  /** Close and remove a session */
  closeSession: (taskName: string) => void;
  /** Close all sessions */
  closeAllSessions: () => void;
  /** Restore sessions from sessionStorage (called on mount) */
  restoreFromStorage: () => void;
  /** Get session by task name */
  getSession: (taskName: string) => ShellSession | undefined;
}

interface ShellDerived {
  /** Whether there are any active (non-closed) sessions */
  hasActiveSessions: boolean;
  /** Count of active sessions */
  activeSessionCount: number;
  /** Get all sessions as array */
  sessionList: ShellSession[];
}

export type ShellStore = ShellState & ShellActions & ShellDerived;

// =============================================================================
// Session Storage Helpers
// =============================================================================

function persistToStorage(sessions: Record<string, ShellSession>): void {
  try {
    const toPersist: PersistedSession[] = Object.values(sessions).map((s) => ({
      taskName: s.taskName,
      shell: s.shell,
      workflowName: s.workflowName,
    }));
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(toPersist));
  } catch {
    // sessionStorage may be unavailable (SSR, private mode)
  }
}

function loadFromStorage(): PersistedSession[] {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    return JSON.parse(stored) as PersistedSession[];
  } catch {
    return [];
  }
}

function removeFromStorage(taskName: string): void {
  try {
    const stored = loadFromStorage();
    const filtered = stored.filter((s) => s.taskName !== taskName);
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  } catch {
    // Ignore storage errors
  }
}

function clearStorage(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}

// =============================================================================
// Store
// =============================================================================

export const useShellStore = create<ShellStore>()(
  devtools(
    immer((set, get) => ({
      // State
      sessions: {},

      // Derived (computed on access)
      get hasActiveSessions() {
        const sessions = get().sessions;
        return Object.values(sessions).some((s) => s.status === "connecting" || s.status === "connected");
      },

      get activeSessionCount() {
        const sessions = get().sessions;
        return Object.values(sessions).filter((s) => s.status === "connecting" || s.status === "connected").length;
      },

      get sessionList() {
        return Object.values(get().sessions);
      },

      // Actions
      openSession: (workflowName, taskName, shell = TERMINAL_CONFIG.DEFAULT_SHELL) => {
        const existing = get().sessions[taskName];
        if (existing) {
          return existing;
        }

        const session: ShellSession = {
          taskName,
          shell,
          workflowName,
          status: "idle",
          createdAt: Date.now(),
        };

        set(
          (state) => {
            state.sessions[taskName] = session;
          },
          false,
          "openSession",
        );

        // Persist to sessionStorage
        persistToStorage(get().sessions);

        return session;
      },

      updateStatus: (taskName, status, error) => {
        set(
          (state) => {
            const session = state.sessions[taskName];
            if (session) {
              session.status = status;
              session.error = error;
              if (status === "connected") {
                session.connectedAt = Date.now();
              }
            }
          },
          false,
          "updateStatus",
        );
      },

      markConnected: (taskName) => {
        set(
          (state) => {
            const session = state.sessions[taskName];
            if (session) {
              session.status = "connected";
              session.connectedAt = Date.now();
              session.error = undefined;
            }
          },
          false,
          "markConnected",
        );
      },

      markDisconnected: (taskName) => {
        set(
          (state) => {
            const session = state.sessions[taskName];
            if (session) {
              session.status = "disconnected";
            }
          },
          false,
          "markDisconnected",
        );
      },

      closeSession: (taskName) => {
        set(
          (state) => {
            delete state.sessions[taskName];
          },
          false,
          "closeSession",
        );
        removeFromStorage(taskName);
      },

      closeAllSessions: () => {
        set(
          (state) => {
            state.sessions = {};
          },
          false,
          "closeAllSessions",
        );
        clearStorage();
      },

      restoreFromStorage: () => {
        const persisted = loadFromStorage();
        if (persisted.length === 0) return;

        set(
          (state) => {
            for (const p of persisted) {
              // Restore as disconnected - user must click to reconnect
              state.sessions[p.taskName] = {
                taskName: p.taskName,
                shell: p.shell,
                workflowName: p.workflowName,
                status: "disconnected",
                createdAt: Date.now(),
              };
            }
          },
          false,
          "restoreFromStorage",
        );
      },

      getSession: (taskName) => {
        return get().sessions[taskName];
      },
    })),
    {
      name: "shell-store",
      enabled: process.env.NODE_ENV === "development",
    },
  ),
);
