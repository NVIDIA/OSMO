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

"use client";

import { createContext, useContext, useCallback, useMemo, type ReactNode } from "react";
import { useShellSessions, deleteSession, getSession, hasSession } from "@/components/shell";
import { ShellNavigationGuard } from "./ShellNavigationGuard";

/** Shell intents - pending shell connections requested by UI */
const shellIntents = new Map<
  string,
  {
    taskId: string;
    taskName: string;
    workflowName: string;
    shell: string;
  }
>();

interface ShellContextValue {
  /** Request a shell to be rendered (called by TaskDetails on Connect click) */
  connectShell: (taskId: string, taskName: string, workflowName: string, shell: string) => void;

  /** Disconnect only - closes WebSocket but keeps session in list for reconnect */
  disconnectOnly: (taskId: string) => void;

  /** Remove a shell from rendering and dispose its session */
  removeShell: (taskId: string) => void;

  /** Check if a shell intent exists for a given task */
  hasActiveShell: (taskId: string) => boolean;

  /** Disconnect all shells for the current workflow (called on page leave) */
  disconnectAll: () => void;
}

interface ShellProviderProps {
  workflowName: string;
  children: ReactNode;
}

const ShellContext = createContext<ShellContextValue | null>(null);

export function ShellProvider({ workflowName, children }: ShellProviderProps) {
  const sessions = useShellSessions();

  const connectShell = useCallback((taskId: string, taskName: string, wfName: string, shell: string) => {
    shellIntents.set(taskId, { taskId, taskName, workflowName: wfName, shell });
  }, []);

  const disconnectOnly = useCallback((taskId: string) => {
    const session = getSession(taskId);
    if (!session) return;

    if (session.state.phase === "ready" || session.state.phase === "initializing") {
      session.state.ws.close();
    }
  }, []);

  const removeShell = useCallback((taskId: string) => {
    shellIntents.delete(taskId);
    deleteSession(taskId);
  }, []);

  const hasActiveShell = useCallback((taskId: string) => {
    return shellIntents.has(taskId) || hasSession(taskId);
  }, []);

  const disconnectAll = useCallback(() => {
    const workflowSessions = sessions.filter((s) => s.workflowName === workflowName);
    for (const session of workflowSessions) {
      shellIntents.delete(session.key);
      deleteSession(session.key);
    }
  }, [sessions, workflowName]);

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

  return (
    <ShellContext.Provider value={value}>
      <ShellNavigationGuard
        workflowName={workflowName}
        onCleanup={disconnectAll}
      >
        {children}
      </ShellNavigationGuard>
    </ShellContext.Provider>
  );
}

export function useShellContext(): ShellContextValue {
  const context = useContext(ShellContext);
  if (!context) {
    throw new Error("useShellContext must be used within a ShellProvider");
  }
  return context;
}

/** Get shell intent if exists (for ShellContainer) */
export function getShellIntent(taskId: string) {
  return shellIntents.get(taskId);
}

/** Clear shell intent (called after shell is created) */
export function clearShellIntent(taskId: string): void {
  shellIntents.delete(taskId);
}
