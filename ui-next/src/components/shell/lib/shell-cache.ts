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

import { useSyncExternalStore, useCallback } from "react";
import type { ShellState, TerminalAddons } from "@/components/shell/lib/shell-state";

export interface CachedSession {
  readonly key: string;
  readonly workflowName: string;
  readonly taskName: string;
  readonly shell: string;
  readonly state: ShellState;
  readonly addons: TerminalAddons | null;
  readonly container: HTMLElement | null;
  readonly isConnecting: boolean;
  readonly backendTimeout: NodeJS.Timeout | null;
  readonly initialResizeSent: boolean;
  readonly onDataDisposable: { dispose: () => void } | null;
  readonly reconnectCallback: (() => Promise<void>) | null;
  // FitAddon.proposeDimensions() returns NaN until the render service has measured dimensions
  readonly terminalReady: boolean;
  readonly onRenderDisposable: { dispose: () => void } | null;
}

export type SessionUpdate = Partial<Omit<CachedSession, "key" | "workflowName" | "taskName" | "shell">>;

const cache = new Map<string, CachedSession>();
const listeners = new Set<() => void>();
let cachedSnapshot: CachedSession[] = [];

function notifyListeners(): void {
  cachedSnapshot = Array.from(cache.values());
  listeners.forEach((listener) => listener());
}

export function hasSession(key: string): boolean {
  return cache.has(key);
}

export function getAllSessions(): readonly CachedSession[] {
  return cachedSnapshot;
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function getSnapshot(): CachedSession[] {
  return cachedSnapshot;
}

function getServerSnapshot(): CachedSession[] {
  return [];
}

export function useShellSessions(): readonly CachedSession[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function useShellSession(key: string): CachedSession | undefined {
  const getSnapshot = useCallback(() => cache.get(key), [key]);
  const getServerSnapshot = useCallback(() => undefined, []);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// Internal APIs - should ONLY be called by useShell hook

export function _getSession(key: string): CachedSession | undefined {
  return cache.get(key);
}

export function _createSession(session: CachedSession): void {
  cache.set(session.key, session);
  notifyListeners();
}

export function _updateSession(key: string, updates: SessionUpdate): void {
  const session = cache.get(key);
  if (!session) {
    console.warn(`[ShellCache] Cannot update non-existent session: ${key}`);
    return;
  }

  const updated: CachedSession = { ...session, ...updates };
  cache.set(key, updated);
  notifyListeners();
}

export function _deleteSession(key: string): void {
  cache.delete(key);
  notifyListeners();
}

export function disconnectSession(key: string): void {
  const session = cache.get(key);
  if (!session) return;

  if (
    (session.state.phase === "ready" || session.state.phase === "initializing" || session.state.phase === "opening") &&
    "ws" in session.state &&
    session.state.ws
  ) {
    session.state.ws.close();
  }
}

export async function reconnectSession(key: string): Promise<void> {
  const session = cache.get(key);
  if (!session?.reconnectCallback) return;
  await session.reconnectCallback();
}
