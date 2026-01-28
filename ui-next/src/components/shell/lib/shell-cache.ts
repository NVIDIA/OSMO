//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at

//http://www.apache.org/licenses/LICENSE-2.0

//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.

//SPDX-License-Identifier: Apache-2.0

/**
 * Immutable Session Cache
 *
 * This module provides a Map-based cache for shell sessions with immutable updates.
 * Sessions persist across UI component mount/unmount cycles.
 *
 * **Architecture:**
 * - All CachedSession fields are readonly (enforced immutability)
 * - All updates create new objects (no mutations)
 * - Cache only stores data - no cleanup logic or side effects
 *
 * **Public API (for consumers):**
 * - `useShellSession(key)` - React hook to observe a session
 * - `useShellSessions()` - React hook to observe all sessions
 * - `getAllSessions()` - Get all sessions (non-React)
 * - `hasSession(key)` - Check if session exists
 *
 * **Internal API (for useShell hook only - marked with _):**
 * - `_getSession(key)` - Get session by key
 * - `_createSession(session)` - Create new session
 * - `_updateSession(key, updates)` - Update session immutably
 * - `_deleteSession(key)` - Delete session
 *
 * NOTE: Internal APIs should ONLY be called by useShell hook.
 * Direct cache manipulation from components violates encapsulation.
 */

import { useSyncExternalStore } from "react";
import type { ShellState, TerminalAddons } from "./shell-state";

/**
 * Immutable session data structure.
 * All fields are readonly to enforce immutability at the type level.
 */
export interface CachedSession {
  /** Unique session identifier (typically taskId) */
  readonly key: string;
  /** Workflow name for this session */
  readonly workflowName: string;
  /** Task name for this session */
  readonly taskName: string;
  /** Shell command (e.g., "/bin/bash") */
  readonly shell: string;
  /** Current state machine state */
  readonly state: ShellState;
  /** Terminal addons (fit, search, webgl) */
  readonly addons: TerminalAddons | null;
  /** DOM container element for terminal rendering */
  readonly container: HTMLElement | null;
  /** Connection in progress flag (prevents concurrent attempts) */
  readonly isConnecting: boolean;
  /** Backend initialization timeout handle */
  readonly backendTimeout: NodeJS.Timeout | null;
  /** Initial resize message sent flag (backend bug workaround) */
  readonly initialResizeSent: boolean;
  /** Terminal input listener disposable */
  readonly onDataDisposable: { dispose: () => void } | null;
}

/**
 * Type for partial session updates.
 * Cannot change identity fields (key, workflowName, taskName, shell).
 */
export type SessionUpdate = Partial<Omit<CachedSession, "key" | "workflowName" | "taskName" | "shell">>;

// ============================================================================
// Private State
// ============================================================================

const cache = new Map<string, CachedSession>();
const listeners = new Set<() => void>();
let cachedSnapshot: CachedSession[] = [];

function notifyListeners(): void {
  cachedSnapshot = Array.from(cache.values());
  listeners.forEach((listener) => listener());
}

// ============================================================================
// Public API (for React components)
// ============================================================================

/**
 * Check if a session exists in the cache.
 * @param key - Session key
 * @returns true if session exists
 */
export function hasSession(key: string): boolean {
  return cache.has(key);
}

/**
 * Get all sessions (non-React).
 * Returns a snapshot - mutations won't affect returned array.
 * @returns Array of all sessions
 */
export function getAllSessions(): readonly CachedSession[] {
  return cachedSnapshot;
}

/**
 * Subscribe to cache changes (for useSyncExternalStore).
 * @param callback - Called when cache changes
 * @returns Unsubscribe function
 */
function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

/**
 * Get cache snapshot (for useSyncExternalStore).
 * @returns Array of all sessions
 */
function getSnapshot(): CachedSession[] {
  return cachedSnapshot;
}

/**
 * React hook to observe all shell sessions.
 * Re-renders when any session changes.
 * @returns Array of all sessions
 */
export function useShellSessions(): readonly CachedSession[] {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/**
 * React hook to observe a specific shell session.
 * Re-renders when the session changes.
 * @param key - Session key
 * @returns Session or undefined if not found
 */
export function useShellSession(key: string): CachedSession | undefined {
  const sessions = useShellSessions();
  return sessions.find((s) => s.key === key);
}

// ============================================================================
// Internal API (for useShell hook only)
// ============================================================================

/**
 * INTERNAL: Get session by key.
 * Used by useShell hook for internal logic.
 * Components should use useShellSession() instead.
 *
 * @param key - Session key
 * @returns Session or undefined
 * @internal
 */
export function _getSession(key: string): CachedSession | undefined {
  return cache.get(key);
}

/**
 * INTERNAL: Create a new session.
 * Used by useShell hook when initializing.
 * Components should not create sessions directly.
 *
 * @param session - New session data
 * @internal
 */
export function _createSession(session: CachedSession): void {
  cache.set(session.key, session);
  notifyListeners();
}

/**
 * INTERNAL: Update session immutably.
 * Used by useShell hook for all state changes.
 * Components should call useShell methods, not update cache directly.
 *
 * This performs an immutable update - creates new session object.
 * Cannot change identity fields (key, workflowName, taskName, shell).
 *
 * @param key - Session key
 * @param updates - Partial updates to apply
 * @internal
 */
export function _updateSession(key: string, updates: SessionUpdate): void {
  const session = cache.get(key);
  if (!session) {
    console.warn(`[ShellCache] Cannot update non-existent session: ${key}`);
    return;
  }

  // Immutable update - create new object
  const updated: CachedSession = {
    ...session,
    ...updates,
  };

  cache.set(key, updated);
  notifyListeners();
}

/**
 * INTERNAL: Delete session from cache.
 * Used by useShell hook's dispose() method.
 * Components should not delete sessions directly.
 *
 * NOTE: This only removes from cache - resource cleanup (terminal.dispose(),
 * ws.close(), clearTimeout) must be done by the caller BEFORE deletion.
 *
 * @param key - Session key
 * @internal
 */
export function _deleteSession(key: string): void {
  cache.delete(key);
  notifyListeners();
}
