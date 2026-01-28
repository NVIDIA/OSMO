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
 * Map-based cache for shell sessions. State transitions and lifecycles are
 * handled by useShell hook; this module only handles storage and React integration.
 */

import { useSyncExternalStore } from "react";
import type { ShellState, TerminalAddons } from "../lib/shell-state";

export interface CachedSession {
  readonly key: string;
  readonly workflowName: string;
  readonly taskName: string;
  readonly shell: string;
  state: ShellState;
  addons: TerminalAddons | null;
  container: HTMLElement | null;
}

const cache = new Map<string, CachedSession>();
const listeners = new Set<() => void>();

function notifyListeners(): void {
  listeners.forEach((listener) => listener());
}

export function getSession(key: string): CachedSession | undefined {
  return cache.get(key);
}

export function createSession(session: CachedSession): void {
  cache.set(session.key, session);
  notifyListeners();
}

export function updateState(key: string, state: ShellState): void {
  const session = cache.get(key);
  if (!session) return;

  session.state = state;
  notifyListeners();
}

export function updateAddons(key: string, addons: TerminalAddons | null): void {
  const session = cache.get(key);
  if (!session) return;

  session.addons = addons;
  notifyListeners();
}

export function updateContainer(key: string, container: HTMLElement | null): void {
  const session = cache.get(key);
  if (!session) return;

  session.container = container;
  notifyListeners();
}

export function deleteSession(key: string): void {
  const session = cache.get(key);
  if (!session) return;

  if (session.state.phase !== "idle" && "terminal" in session.state) {
    session.state.terminal.dispose();
  }
  if (session.state.phase === "ready" || session.state.phase === "initializing") {
    session.state.ws.close();
  }
  session.addons?.webglAddon?.dispose();

  cache.delete(key);
  notifyListeners();
}

export function getAllSessions(): CachedSession[] {
  return Array.from(cache.values());
}

export function hasSession(key: string): boolean {
  return cache.has(key);
}

export function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function getSnapshot(): CachedSession[] {
  return getAllSessions();
}

export function useShellSessions(): CachedSession[] {
  return useSyncExternalStore(subscribe, getSnapshot);
}

export function useShellSession(key: string): CachedSession | undefined {
  const sessions = useShellSessions();
  return sessions.find((s) => s.key === key);
}
